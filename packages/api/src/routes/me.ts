import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  colorSchema,
  iconNameSchema,
  imageUrlSchema,
  localeSchema,
  paginationSchema,
  registerPushDeviceSchema,
  setReminderRulesSchema,
  timezoneSchema,
  updateNotificationPreferencesSchema,
} from '@cita-facil/shared';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { isoNow } from '../lib/dates.js';
import { newId, shortCode } from '../lib/ids.js';
import { NotFoundError } from '../lib/errors.js';
import { toSessionUser } from '../modules/users/repository.js';
import { deletePasskey, listPasskeys } from '../modules/auth/passkeys.js';
import { revokeAllSessions, revokeSession } from '../modules/auth/tokens.js';
import { listCustomerAppointments } from '../modules/appointments/queries.js';
import { webPushPublicKey } from '../modules/notifications/channels/push.js';
import { createChallenge } from '../modules/auth/challenges.js';
import { idParams } from './helpers.js';

/**
 * Perfil del usuario: sus datos, sus dispositivos, sus preferencias de aviso y
 * sus citas. Todo lo de aquí opera siempre sobre el usuario autenticado, nunca
 * sobre un identificador que venga de fuera.
 */
const meRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get('/', { schema: { tags: ['perfil'], summary: 'Datos de la sesión actual' } }, async (request) => {
    const user = request.requireUser();
    return toSessionUser(user);
  });

  app.patch(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Actualizar el perfil',
        body: z.object({
          name: z.string().min(2).max(120).optional(),
          phone: z.string().max(32).nullable().optional(),
          locale: localeSchema.optional(),
          timezone: timezoneSchema.optional(),
          avatarUrl: imageUrlSchema.nullable().optional(),
          icon: iconNameSchema.nullable().optional(),
          color: colorSchema.nullable().optional(),
          marketingOptIn: z.boolean().optional(),
          quietHoursStart: z.number().int().min(0).max(1440).nullable().optional(),
          quietHoursEnd: z.number().int().min(0).max(1440).nullable().optional(),
        }),
      },
    },
    async (request) => {
      const user = request.requireUser();
      const patch: Record<string, unknown> = { updated_at: isoNow() };
      const body = request.body;

      if (body.name !== undefined) patch.name = body.name;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.locale !== undefined) patch.locale = body.locale;
      if (body.timezone !== undefined) patch.timezone = body.timezone;
      if (body.avatarUrl !== undefined) patch.avatar_url = body.avatarUrl;
      if (body.icon !== undefined) patch.icon = body.icon;
      if (body.color !== undefined) patch.color = body.color;
      if (body.marketingOptIn !== undefined) patch.marketing_opt_in = body.marketingOptIn ? 1 : 0;
      if (body.quietHoursStart !== undefined) patch.quiet_hours_start = body.quietHoursStart;
      if (body.quietHoursEnd !== undefined) patch.quiet_hours_end = body.quietHoursEnd;

      await db().updateTable('users').set(patch).where('id', '=', user.id).execute();
      const updated = await db()
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .executeTakeFirstOrThrow();
      return toSessionUser(updated);
    },
  );

  /* ---------------------------------------------------------- Sesiones */

  app.get('/sessions', { schema: { tags: ['perfil'], summary: 'Sesiones abiertas' } }, async (request) => {
    const user = request.requireUser();
    const rows = await db()
      .selectFrom('sessions')
      .select(['id', 'user_agent', 'ip', 'auth_method', 'created_at', 'last_used_at', 'expires_at'])
      .where('user_id', '=', user.id)
      .where('revoked_at', 'is', null)
      .where('expires_at', '>', isoNow())
      .orderBy('last_used_at', 'desc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      userAgent: row.user_agent,
      ip: row.ip,
      method: row.auth_method,
      current: row.id === request.auth.sessionId,
      createdAt: row.created_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
    }));
  });

  app.delete(
    '/sessions/:id',
    { schema: { tags: ['perfil'], summary: 'Cerrar una sesión', params: idParams } },
    async (request) => {
      const user = request.requireUser();
      const session = await db()
        .selectFrom('sessions')
        .select(['id'])
        .where('id', '=', request.params.id)
        .where('user_id', '=', user.id)
        .executeTakeFirst();
      if (!session) throw new NotFoundError('La sesión no existe');
      await revokeSession(session.id);
      return { ok: true };
    },
  );

  app.post(
    '/sessions/revoke-all',
    { schema: { tags: ['perfil'], summary: 'Cerrar el resto de sesiones' } },
    async (request) => {
      const user = request.requireUser();
      const revoked = await revokeAllSessions(user.id, request.auth.sessionId ?? undefined);
      return { revoked };
    },
  );

  /* ---------------------------------------------------------- Passkeys */

  app.get('/passkeys', { schema: { tags: ['perfil'], summary: 'Passkeys registradas' } }, async (request) => {
    const user = request.requireUser();
    return listPasskeys(user.id);
  });

  app.delete(
    '/passkeys/:id',
    { schema: { tags: ['perfil'], summary: 'Eliminar una passkey', params: idParams } },
    async (request) => {
      const user = request.requireUser();
      await deletePasskey(user.id, request.params.id);
      return { ok: true };
    },
  );

  /* ------------------------------------------------------ Notificaciones */

  app.get(
    '/notification-preferences',
    { schema: { tags: ['perfil'], summary: 'Preferencias de aviso' } },
    async (request) => {
      const user = request.requireUser();
      const rows = await db()
        .selectFrom('notification_preferences')
        .select(['event', 'channel', 'enabled'])
        .where('user_id', '=', user.id)
        .execute();

      return {
        preferences: rows.map((row) => ({
          event: row.event,
          channel: row.channel,
          enabled: row.enabled === 1,
        })),
        quietHoursStart: user.quiet_hours_start,
        quietHoursEnd: user.quiet_hours_end,
      };
    },
  );

  app.put(
    '/notification-preferences',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Guardar preferencias de aviso',
        body: updateNotificationPreferencesSchema,
      },
    },
    async (request) => {
      const user = request.requireUser();

      for (const preference of request.body.preferences) {
        const existing = await db()
          .selectFrom('notification_preferences')
          .select(['id'])
          .where('user_id', '=', user.id)
          .where('event', '=', preference.event)
          .where('channel', '=', preference.channel)
          .executeTakeFirst();

        if (existing) {
          await db()
            .updateTable('notification_preferences')
            .set({ enabled: preference.enabled ? 1 : 0, updated_at: isoNow() })
            .where('id', '=', existing.id)
            .execute();
        } else {
          await db()
            .insertInto('notification_preferences')
            .values({
              id: newId(),
              user_id: user.id,
              organization_id: null,
              event: preference.event,
              channel: preference.channel,
              enabled: preference.enabled ? 1 : 0,
              updated_at: isoNow(),
            })
            .execute();
        }
      }

      if (
        request.body.quietHoursStart !== undefined ||
        request.body.quietHoursEnd !== undefined
      ) {
        await db()
          .updateTable('users')
          .set({
            quiet_hours_start: request.body.quietHoursStart ?? null,
            quiet_hours_end: request.body.quietHoursEnd ?? null,
            updated_at: isoNow(),
          })
          .where('id', '=', user.id)
          .execute();
      }

      return { ok: true };
    },
  );

  app.get(
    '/reminder-rules',
    { schema: { tags: ['perfil'], summary: 'Mis recordatorios' } },
    async (request) => {
      const user = request.requireUser();
      const rows = await db()
        .selectFrom('reminder_rules')
        .select(['id', 'offset_minutes', 'channels_json', 'enabled', 'service_id'])
        .where('user_id', '=', user.id)
        .orderBy('offset_minutes', 'desc')
        .execute();

      return rows.map((row) => ({
        id: row.id,
        offsetMinutes: row.offset_minutes,
        channels: JSON.parse(row.channels_json) as string[],
        enabled: row.enabled === 1,
        serviceId: row.service_id,
      }));
    },
  );

  app.put(
    '/reminder-rules',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Definir mis recordatorios',
        description:
          'Sustituye las reglas del usuario. El desfase se expresa en minutos antes de la cita: 1440 es un día, 60 es una hora, y se admite cualquier valor.',
        body: setReminderRulesSchema,
      },
    },
    async (request) => {
      const user = request.requireUser();
      await db().deleteFrom('reminder_rules').where('user_id', '=', user.id).execute();

      if (request.body.rules.length > 0) {
        await db()
          .insertInto('reminder_rules')
          .values(
            request.body.rules.map((rule) => ({
              id: newId(),
              organization_id: null,
              user_id: user.id,
              service_id: rule.serviceId ?? null,
              offset_minutes: rule.offsetMinutes,
              channels_json: JSON.stringify(rule.channels),
              enabled: rule.enabled ? 1 : 0,
              created_at: isoNow(),
              updated_at: isoNow(),
            })),
          )
          .execute();
      }
      return { ok: true };
    },
  );

  /* -------------------------------------------------------- Dispositivos */

  app.get(
    '/push/config',
    { schema: { tags: ['perfil'], summary: 'Clave pública para suscribirse a Web Push' } },
    async () => ({ enabled: env.PUSH_ENABLED, vapidPublicKey: webPushPublicKey() }),
  );

  app.post(
    '/push/devices',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Registrar un dispositivo para notificaciones push',
        body: registerPushDeviceSchema,
      },
    },
    async (request) => {
      const user = request.requireUser();
      const existing = await db()
        .selectFrom('push_devices')
        .select(['id'])
        .where('user_id', '=', user.id)
        .where('token', '=', request.body.token)
        .executeTakeFirst();

      if (existing) {
        await db()
          .updateTable('push_devices')
          .set({ last_used_at: isoNow(), failure_count: 0 })
          .where('id', '=', existing.id)
          .execute();
        return { id: existing.id };
      }

      const id = newId();
      await db()
        .insertInto('push_devices')
        .values({
          id,
          user_id: user.id,
          provider: request.body.provider,
          token: request.body.token,
          keys_json: request.body.keys ? JSON.stringify(request.body.keys) : null,
          device_name: request.body.deviceName ?? null,
          locale: request.body.locale ?? user.locale,
          last_used_at: isoNow(),
          failure_count: 0,
          created_at: isoNow(),
        })
        .execute();
      return { id };
    },
  );

  app.delete(
    '/push/devices/:id',
    { schema: { tags: ['perfil'], summary: 'Dar de baja un dispositivo', params: idParams } },
    async (request) => {
      const user = request.requireUser();
      await db()
        .deleteFrom('push_devices')
        .where('id', '=', request.params.id)
        .where('user_id', '=', user.id)
        .execute();
      return { ok: true };
    },
  );

  /* ---------------------------------------------------- Telegram y WhatsApp */

  app.post(
    '/messaging/telegram/code',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Obtener el código para vincular Telegram',
        description:
          'Devuelve un código de un solo uso. El usuario lo envía al bot y su chat queda vinculado.',
      },
    },
    async (request) => {
      const user = request.requireUser();
      const code = shortCode(8);
      await createChallenge({
        kind: 'messaging_link',
        userId: user.id,
        payload: { channel: 'telegram' },
        code,
        ttlSeconds: 900,
      });
      return {
        code,
        bot: env.TELEGRAM_BOT_USERNAME ?? null,
        instructions: env.TELEGRAM_BOT_USERNAME
          ? `Envía "${code}" al bot @${env.TELEGRAM_BOT_USERNAME}`
          : `Envía "${code}" al bot de Telegram del establecimiento`,
      };
    },
  );

  app.get(
    '/messaging',
    { schema: { tags: ['perfil'], summary: 'Canales de mensajería vinculados' } },
    async (request) => {
      const user = request.requireUser();
      const rows = await db()
        .selectFrom('messaging_links')
        .select(['id', 'channel', 'username', 'verified', 'opt_out', 'created_at'])
        .where('user_id', '=', user.id)
        .execute();
      return rows.map((row) => ({
        id: row.id,
        channel: row.channel,
        username: row.username,
        verified: row.verified === 1,
        optOut: row.opt_out === 1,
        createdAt: row.created_at,
      }));
    },
  );

  app.delete(
    '/messaging/:id',
    { schema: { tags: ['perfil'], summary: 'Desvincular un canal', params: idParams } },
    async (request) => {
      const user = request.requireUser();
      await db()
        .deleteFrom('messaging_links')
        .where('id', '=', request.params.id)
        .where('user_id', '=', user.id)
        .execute();
      return { ok: true };
    },
  );

  app.post(
    '/messaging/whatsapp',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Vincular WhatsApp con el teléfono del perfil',
        body: z.object({ phone: z.string().min(6).max(24) }),
      },
    },
    async (request) => {
      const user = request.requireUser();
      const id = newId();
      await db()
        .insertInto('messaging_links')
        .values({
          id,
          user_id: user.id,
          channel: 'whatsapp',
          external_id: request.body.phone.replace(/[^\d+]/g, ''),
          username: null,
          // El número se da por bueno porque el propio envío falla si no existe;
          // no se hace verificación por código para no gastar mensajes de pago.
          verified: 1,
          opt_out: 0,
          created_at: isoNow(),
        })
        .execute();
      return { id };
    },
  );

  /* ------------------------------------------------------------- Citas */

  app.get(
    '/appointments',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Mis citas',
        querystring: paginationSchema.extend({
          filter: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
        }),
      },
    },
    async (request) => {
      const user = request.requireUser();
      return listCustomerAppointments({
        customerId: user.id,
        upcoming:
          request.query.filter === 'all' ? undefined : request.query.filter === 'upcoming',
        page: request.query.page,
        pageSize: request.query.pageSize,
      });
    },
  );

  app.get(
    '/waitlist',
    { schema: { tags: ['perfil'], summary: 'Mis entradas en listas de espera' } },
    async (request) => {
      const user = request.requireUser();
      const rows = await db()
        .selectFrom('waitlist_entries')
        .leftJoin('services', 'services.id', 'waitlist_entries.service_id')
        .leftJoin('organizations', 'organizations.id', 'waitlist_entries.organization_id')
        .select([
          'waitlist_entries.id',
          'waitlist_entries.status',
          'waitlist_entries.from_date',
          'waitlist_entries.to_date',
          'waitlist_entries.offer_expires_at',
          'services.name as service_name',
          'organizations.name as organization_name',
        ])
        .where('waitlist_entries.customer_id', '=', user.id)
        .where('waitlist_entries.status', 'in', ['waiting', 'offered'])
        .execute();

      return rows.map((row) => ({
        id: row.id,
        status: row.status,
        fromDate: row.from_date,
        toDate: row.to_date,
        offerExpiresAt: row.offer_expires_at,
        serviceName: row.service_name,
        organizationName: row.organization_name,
      }));
    },
  );

  /* ------------------------------------------------- Protección de datos */

  app.get(
    '/export',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Descargar mis datos',
        description:
          'Exporta en JSON los datos personales asociados a la cuenta, para cumplir con el derecho de acceso y portabilidad.',
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      const [appointments, notifications, reviews, devices, sessions] = await Promise.all([
        db().selectFrom('appointments').selectAll().where('customer_id', '=', user.id).execute(),
        db()
          .selectFrom('notifications')
          .select(['event', 'channel', 'destination', 'status', 'created_at'])
          .where('user_id', '=', user.id)
          .execute(),
        db().selectFrom('reviews').selectAll().where('customer_id', '=', user.id).execute(),
        db()
          .selectFrom('push_devices')
          .select(['provider', 'device_name', 'created_at'])
          .where('user_id', '=', user.id)
          .execute(),
        db()
          .selectFrom('sessions')
          .select(['auth_method', 'ip', 'user_agent', 'created_at'])
          .where('user_id', '=', user.id)
          .execute(),
      ]);

      reply.header('content-disposition', `attachment; filename="mis-datos-${user.id}.json"`);
      return {
        exportadoEl: isoNow(),
        usuario: {
          id: user.id,
          email: user.email,
          nombre: user.name,
          telefono: user.phone,
          nif: user.nif,
          idioma: user.locale,
          zonaHoraria: user.timezone,
          altaEl: user.created_at,
        },
        citas: appointments,
        notificaciones: notifications,
        valoraciones: reviews,
        dispositivos: devices,
        sesiones: sessions,
      };
    },
  );

  app.delete(
    '/',
    {
      schema: {
        tags: ['perfil'],
        summary: 'Dar de baja la cuenta',
        description:
          'Anonimiza los datos personales y cancela las citas futuras. El histórico de citas se conserva sin datos identificativos por obligaciones contables del establecimiento.',
        body: z.object({ confirm: z.literal(true) }),
      },
    },
    async (request) => {
      const user = request.requireUser();
      const now = isoNow();

      await db()
        .updateTable('appointments')
        .set({ status: 'cancelled', cancelled_at: now, cancelled_by: 'customer', updated_at: now })
        .where('customer_id', '=', user.id)
        .where('starts_at', '>=', now)
        .where('status', 'in', ['pending', 'confirmed'])
        .execute();

      await db()
        .updateTable('users')
        .set({
          email: null,
          email_key: user.id,
          phone: null,
          nif: null,
          nif_key: user.id,
          name: 'Cuenta dada de baja',
          given_name: null,
          family_name: null,
          password_hash: null,
          avatar_url: null,
          mfa_totp_secret: null,
          mfa_recovery_codes: null,
          status: 'deleted',
          deleted_at: now,
          updated_at: now,
        })
        .where('id', '=', user.id)
        .execute();

      await db().deleteFrom('identities').where('user_id', '=', user.id).execute();
      await db().deleteFrom('webauthn_credentials').where('user_id', '=', user.id).execute();
      await db().deleteFrom('push_devices').where('user_id', '=', user.id).execute();
      await db().deleteFrom('messaging_links').where('user_id', '=', user.id).execute();
      await revokeAllSessions(user.id);

      return { ok: true };
    },
  );
};

export default meRoutes;
