import { createReadStream } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  adminCreateUserSchema,
  adminListUsersSchema,
  bulkAllowlistSchema,
  createAllowlistEntrySchema,
  paginationSchema,
  updateAuthSettingsSchema,
} from '@cita-facil/shared';
import { env } from '../config/env.js';
import { redisStatus } from '../lib/redis.js';
import { db } from '../db/index.js';
import { ForbiddenError } from '../lib/errors.js';
import { migrationStatus } from '../db/migrator.js';
import {
  backupPath,
  createBackup,
  deleteBackup,
  listBackupFiles,
  listBackups,
  pruneBackups,
  restoreBackup,
} from '../modules/backups/service.js';
import { schedulerStatus } from '../jobs/scheduler.js';
import { listAudit } from '../modules/audit/service.js';
import { verifyEmailTransport } from '../modules/notifications/channels/email.js';
import { loadTrustStore, resetCertificateCaches } from '../modules/auth/certificate.js';
import { recordAudit } from '../modules/audit/service.js';
import { isProviderConfigured } from '../modules/auth/oidc.js';
import { adminCreateUser, resendActivation } from '../modules/auth/service.js';
import {
  addAllowlistEntries,
  addAllowlistEntry,
  getAuthSettings,
  listAllowlist,
  removeAllowlistEntry,
  saveAuthSettings,
} from '../modules/settings/access-policy.js';

/**
 * Administración de la instalación: copias de seguridad, estado del sistema y
 * traza de auditoría. Todo lo de aquí es exclusivo del superadministrador,
 * salvo la auditoría de una organización concreta.
 */
const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** Exige rol de superadministrador de la instalación. */
  const requirePlatformAdmin = (request: { auth: { platformRole: string } }) => {
    if (request.auth.platformRole !== 'superadmin') {
      throw new ForbiddenError(
        'Solo el administrador de la instalación puede hacer esto',
        'platform_admin_required',
      );
    }
  };

  app.get(
    '/status',
    { schema: { tags: ['administracion'], summary: 'Estado del sistema' } },
    async (request) => {
      requirePlatformAdmin(request);

      const [organizations, users, appointments, pendingNotifications, trust] = await Promise.all([
        count('organizations'),
        count('users'),
        count('appointments'),
        db()
          .selectFrom('notifications')
          .select((eb) => eb.fn.countAll<number>().as('total'))
          .where('status', 'in', ['scheduled', 'queued'])
          .executeTakeFirst(),
        loadTrustStore(),
      ]);

      return {
        app: { name: env.APP_NAME, url: env.APP_URL, environment: env.NODE_ENV },
        database: { client: env.DB_CLIENT, migrations: await migrationStatus(db()) },
        counts: {
          organizations,
          users,
          appointments,
          pendingNotifications: Number(pendingNotifications?.total ?? 0),
        },
        scheduler: { enabled: env.SCHEDULER_ENABLED, jobs: schedulerStatus() },
        // Redis es opcional: aquí se ve si está en uso o por qué no.
        cache: redisStatus(),
        channels: {
          email: { enabled: env.MAIL_ENABLED, transport: env.MAIL_TRANSPORT },
          push: env.PUSH_ENABLED,
          telegram: env.TELEGRAM_ENABLED,
          whatsapp: env.WHATSAPP_ENABLED,
          sms: env.SMS_ENABLED,
        },
        payments: { enabled: env.PAYMENTS_ENABLED, provider: env.PAYMENTS_DEFAULT_PROVIDER },
        auth: {
          methods: env.AUTH_METHODS,
          trustedCertificateAuthorities: trust.length,
          mfaRequiredForAdmins: env.MFA_REQUIRED_FOR_ADMINS,
        },
        process: {
          uptimeSeconds: Math.round(process.uptime()),
          memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
          nodeVersion: process.version,
        },
      };
    },
  );

  app.post(
    '/check/email',
    { schema: { tags: ['administracion'], summary: 'Comprobar la conexión SMTP' } },
    async (request) => {
      requirePlatformAdmin(request);
      return { ok: await verifyEmailTransport() };
    },
  );

  app.post(
    '/certificates/reload',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Recargar las autoridades de certificación de confianza',
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      resetCertificateCaches();
      const trust = await loadTrustStore(true);
      return { loaded: trust.length, directory: env.CERT_TRUST_DIR };
    },
  );

  /* ------------------------------------------------------------- Copias */

  app.get(
    '/backups',
    { schema: { tags: ['administracion'], summary: 'Copias de seguridad' } },
    async (request) => {
      requirePlatformAdmin(request);
      const [records, files] = await Promise.all([listBackups(), listBackupFiles()]);
      return {
        config: {
          enabled: env.BACKUP_ENABLED,
          cron: env.BACKUP_CRON,
          directory: env.BACKUP_DIR,
          retentionDays: env.BACKUP_RETENTION_DAYS,
          maxFiles: env.BACKUP_MAX_FILES,
          encrypted: env.BACKUP_ENCRYPT,
        },
        records,
        files,
      };
    },
  );

  app.post(
    '/backups',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Crear una copia ahora',
        body: z.object({ encrypt: z.boolean().optional() }).nullish(),
      },
    },
    async (request, reply) => {
      requirePlatformAdmin(request);
      const record = await createBackup({
        trigger: 'manual',
        encrypt: request.body?.encrypt,
      });
      await recordAudit({
        actorId: request.auth.userId,
        actorType: 'system',
        action: 'backup.create',
        entityType: 'backup',
        entityId: record.id,
        ip: request.ip,
      });
      return reply.status(201).send(record);
    },
  );

  app.get(
    '/backups/:filename/download',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Descargar una copia',
        params: z.object({ filename: z.string().min(1) }),
      },
    },
    async (request, reply) => {
      requirePlatformAdmin(request);
      const path = backupPath(request.params.filename);
      reply.header('content-type', 'application/gzip');
      reply.header('content-disposition', `attachment; filename="${request.params.filename}"`);
      return reply.send(createReadStream(path));
    },
  );

  app.post(
    '/backups/:filename/restore',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Restaurar una copia',
        description:
          'Con truncate=true se vacían las tablas antes de restaurar. Antes de vaciar nada se crea automáticamente una copia de seguridad del estado actual.',
        params: z.object({ filename: z.string().min(1) }),
        body: z.object({
          truncate: z.boolean().default(false),
          confirm: z.literal(true),
        }),
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      const result = await restoreBackup(request.params.filename, {
        truncate: request.body.truncate,
      });
      await recordAudit({
        actorId: request.auth.userId,
        actorType: 'system',
        action: 'backup.restore',
        entityType: 'backup',
        entityId: request.params.filename,
        changes: result,
        ip: request.ip,
      });
      return result;
    },
  );

  app.delete(
    '/backups/:filename',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Eliminar una copia',
        params: z.object({ filename: z.string().min(1) }),
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      await deleteBackup(request.params.filename);
      return { ok: true };
    },
  );

  app.post(
    '/backups/prune',
    { schema: { tags: ['administracion'], summary: 'Aplicar la política de retención' } },
    async (request) => {
      requirePlatformAdmin(request);
      return { removed: await pruneBackups() };
    },
  );

  /* --------------------------------------------------- Acceso y registro */

  app.get(
    '/auth-settings',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Política de acceso de la instalación',
        description:
          'Métodos de acceso activos, modo de registro y reserva anónima. Es de toda la instalación, no de una organización.',
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      const settings = await getAuthSettings();
      return {
        ...settings,
        // Se informa de si cada proveedor federado tiene credenciales, porque
        // activarlo sin configurarlo no serviría de nada.
        configured: {
          oidc: isProviderConfigured('oidc'),
          google: isProviderConfigured('google'),
        },
        googleRedirectUri: `${env.APP_URL}/api/v1/auth/google/callback`,
        oidcRedirectUri: `${env.APP_URL}/api/v1/auth/oidc/callback`,
      };
    },
  );

  app.put(
    '/auth-settings',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Guardar la política de acceso',
        body: updateAuthSettingsSchema,
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      const settings = await saveAuthSettings(request.body);
      await recordAudit({
        actorId: request.auth.userId,
        actorType: 'system',
        action: 'auth.settings.update',
        entityType: 'settings',
        entityId: 'auth.policy',
        changes: request.body,
        ip: request.ip,
      });
      return settings;
    },
  );

  app.get(
    '/allowlist',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Lista de personas autorizadas a darse de alta',
        querystring: z.object({ search: z.string().max(120).optional() }),
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      return listAllowlist({ search: request.query.search });
    },
  );

  app.post(
    '/allowlist',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Autorizar a alguien por correo, dominio o documento',
        body: createAllowlistEntrySchema,
      },
    },
    async (request, reply) => {
      requirePlatformAdmin(request);
      const result = await addAllowlistEntry(request.body, request.auth.userId);
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/allowlist/bulk',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Autorizar a varias personas de una vez',
        description: 'Acepta una lista separada por saltos de línea, comas o puntos y comas.',
        body: bulkAllowlistSchema,
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      return addAllowlistEntries(request.body, request.auth.userId);
    },
  );

  app.delete(
    '/allowlist/:id',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Quitar a alguien de la lista',
        params: z.object({ id: z.string().min(1) }),
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      await removeAllowlistEntry(request.params.id);
      return { ok: true };
    },
  );

  /* ------------------------------------------------------------- Usuarios */

  app.get(
    '/users',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Usuarios de la instalación',
        querystring: adminListUsersSchema,
      },
    },
    async (request) => {
      requirePlatformAdmin(request);

      let base = db().selectFrom('users').where('deleted_at', 'is', null);
      if (request.query.status) base = base.where('status', '=', request.query.status);
      if (request.query.search) {
        const term = `%${request.query.search.toLowerCase()}%`;
        base = base.where((eb) =>
          eb.or([eb('name', 'like', term), eb('email', 'like', term), eb('nif', 'like', term)]),
        );
      }

      const totalRow = await base
        .select((eb) => eb.fn.countAll<number>().as('total'))
        .executeTakeFirst();

      const rows = await base
        .select([
          'id',
          'email',
          'name',
          'nif',
          'phone',
          'platform_role',
          'status',
          'email_verified',
          'mfa_enabled',
          'last_login_at',
          'created_at',
        ])
        .orderBy('created_at', 'desc')
        .limit(request.query.pageSize)
        .offset((request.query.page - 1) * request.query.pageSize)
        .execute();

      const total = Number(totalRow?.total ?? 0);
      return {
        items: rows.map((row) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          nif: row.nif,
          phone: row.phone,
          platformRole: row.platform_role,
          status: row.status,
          emailVerified: row.email_verified === 1,
          mfaEnabled: row.mfa_enabled === 1,
          lastLoginAt: row.last_login_at,
          createdAt: row.created_at,
        })),
        page: request.query.page,
        pageSize: request.query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / request.query.pageSize)),
      };
    },
  );

  app.post(
    '/users',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Crear una cuenta y enviar el enlace de activación',
        description:
          'La cuenta nace pendiente y sin contraseña. La persona recibe un correo con un enlace para elegirla; hasta entonces no se puede entrar con ella.',
        body: adminCreateUserSchema,
      },
    },
    async (request, reply) => {
      requirePlatformAdmin(request);
      const result = await adminCreateUser(request.body, request.auth.userId);
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/users/:id/resend-activation',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Volver a enviar el enlace de activación',
        params: z.object({ id: z.string().min(1) }),
      },
    },
    async (request) => {
      requirePlatformAdmin(request);
      return resendActivation(request.params.id);
    },
  );

  app.patch(
    '/users/:id',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Cambiar el rol o el estado de un usuario',
        params: z.object({ id: z.string().min(1) }),
        body: z.object({
          platformRole: z.enum(['superadmin', 'user']).optional(),
          status: z.enum(['active', 'blocked']).optional(),
        }),
      },
    },
    async (request) => {
      requirePlatformAdmin(request);

      if (request.params.id === request.auth.userId && request.body.platformRole === 'user') {
        // Quitarse a uno mismo el rol puede dejar la instalación sin
        // administrador si es el único.
        const others = await db()
          .selectFrom('users')
          .select(['id'])
          .where('platform_role', '=', 'superadmin')
          .where('status', '=', 'active')
          .where('id', '!=', request.auth.userId)
          .executeTakeFirst();
        if (!others) {
          throw new ForbiddenError(
            'Tiene que quedar al menos un administrador de la instalación',
            'last_platform_admin',
          );
        }
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (request.body.platformRole) patch.platform_role = request.body.platformRole;
      if (request.body.status) patch.status = request.body.status;

      await db().updateTable('users').set(patch).where('id', '=', request.params.id).execute();

      await recordAudit({
        actorId: request.auth.userId,
        actorType: 'system',
        action: 'user.update',
        entityType: 'user',
        entityId: request.params.id,
        changes: request.body,
        ip: request.ip,
      });

      return { ok: true };
    },
  );

  /* ---------------------------------------------------------- Auditoría */

  app.get(
    '/audit',
    {
      schema: {
        tags: ['administracion'],
        summary: 'Traza de auditoría',
        querystring: paginationSchema.extend({
          organizationId: z.string().min(1),
          entityType: z.string().optional(),
          entityId: z.string().optional(),
          actorId: z.string().optional(),
          action: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
      },
    },
    async (request) => {
      request.requirePermission(request.query.organizationId, 'audit:read');
      return listAudit({
        organizationId: request.query.organizationId,
        entityType: request.query.entityType,
        entityId: request.query.entityId,
        actorId: request.query.actorId,
        action: request.query.action,
        from: request.query.from,
        to: request.query.to,
        page: request.query.page,
        pageSize: request.query.pageSize,
      });
    },
  );
};

async function count(table: 'organizations' | 'users' | 'appointments'): Promise<number> {
  const row = await db()
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .executeTakeFirst();
  return Number(row?.total ?? 0);
}

export default adminRoutes;
