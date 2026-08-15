import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ORG_ROLES,
  PAGE_KEYS,
  ROLE_RANK,
  createOrganizationSchema,
  emailSchema,
  organizationPageSchema,
  updateOrganizationPageSchema,
  updateOrganizationSchema,
  type OrgRole,
} from '@cita-facil/shared';
import { db } from '../db/index.js';
import { env } from '../config/env.js';
import { newId, randomToken } from '../lib/ids.js';
import { hashToken } from '../lib/crypto.js';
import { isoNow } from '../lib/dates.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import {
  createOrganization,
  deleteOrganization,
  getOrganization,
  listOrganizationsForUser,
  organizationUsage,
  updateOrganization,
} from '../modules/catalog/service.js';
import { listPages, savePage } from '../modules/catalog/pages.js';
import { getAuthSettings } from '../modules/settings/access-policy.js';
import { notify } from '../modules/notifications/service.js';
import { recordAudit } from '../modules/audit/service.js';
import { idParams, organizationParams } from './helpers.js';

/**
 * Organizaciones y su personal. La organización es la unidad de aislamiento:
 * todo lo demás (sedes, servicios, citas) cuelga de una y los permisos se
 * comprueban siempre contra ella.
 */
const organizationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/',
    { schema: { tags: ['catalogo'], summary: 'Organizaciones a las que pertenezco' } },
    async (request) => {
      const user = request.requireUser();
      if (request.auth.platformRole === 'superadmin') {
        const rows = await db()
          .selectFrom('organizations')
          .selectAll()
          .where('deleted_at', 'is', null)
          .orderBy('name')
          .execute();
        return rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          timezone: row.timezone,
          locale: row.locale,
          currency: row.currency,
          status: row.status,
        }));
      }
      return listOrganizationsForUser(user.id);
    },
  );

  app.post(
    '/',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Crear una organización',
        body: createOrganizationSchema,
      },
    },
    async (request, reply) => {
      const user = request.requireUser();

      // Crear una organización es una operación de la instalación, no algo que
      // pueda hacer cualquiera que se registre. Solo se abre si el
      // administrador enciende el autoservicio, que es el modo "servicio".
      if (request.auth.platformRole !== 'superadmin') {
        const settings = await getAuthSettings();
        if (!settings.allowOrganizationSelfService) {
          throw new ForbiddenError(
            'Solo el administrador de la instalación puede crear organizaciones',
            'organization_creation_restricted',
          );
        }
      }

      const organization = await createOrganization(request.body, user.id);
      await recordAudit({
        organizationId: organization.id,
        actorId: user.id,
        action: 'organization.create',
        entityType: 'organization',
        entityId: organization.id,
        ip: request.ip,
      });
      return reply.status(201).send(organization);
    },
  );

  app.get(
    '/:organizationId',
    { schema: { tags: ['catalogo'], summary: 'Detalle de la organización', params: organizationParams } },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'org:read');
      const organization = await getOrganization(request.params.organizationId);
      if (!organization) throw new NotFoundError('La organización no existe');
      return organization;
    },
  );

  app.patch(
    '/:organizationId',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Actualizar la organización',
        params: organizationParams,
        body: updateOrganizationSchema,
      },
    },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'org:update');
      const organization = await updateOrganization(request.params.organizationId, request.body);
      await recordAudit({
        organizationId: organization.id,
        actorId: request.auth.userId,
        action: 'organization.update',
        entityType: 'organization',
        entityId: organization.id,
        changes: request.body,
        ip: request.ip,
      });
      return organization;
    },
  );

  /* --------------------------------------------------------------- Páginas */

  app.get(
    '/:organizationId/pages',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Páginas de contenido',
        description:
          'Contacto y sobre nosotros. Devuelve siempre las dos, vacías si todavía no se han escrito.',
        params: organizationParams,
        response: { 200: z.array(organizationPageSchema) },
      },
    },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'org:read');
      return listPages(request.params.organizationId);
    },
  );

  app.put(
    '/:organizationId/pages/:key',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Guardar una página de contenido',
        params: organizationParams.extend({ key: z.enum(PAGE_KEYS) }),
        body: updateOrganizationPageSchema,
        response: { 200: organizationPageSchema },
      },
    },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'org:update');
      const page = await savePage(
        request.params.organizationId,
        request.params.key,
        request.body,
        request.auth.userId,
      );
      await recordAudit({
        organizationId: request.params.organizationId,
        actorId: request.auth.userId,
        action: 'organization.page.update',
        entityType: 'organization_page',
        entityId: page.id,
        changes: { key: page.key, published: page.published },
        ip: request.ip,
      });
      return page;
    },
  );

  app.get(
    '/:organizationId/usage',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Qué cuelga de la organización',
        description: 'Sedes, servicios, citas y personal. Se usa para avisar antes de darla de baja.',
        params: organizationParams,
        response: {
          200: z.object({
            locations: z.number().int(),
            services: z.number().int(),
            appointments: z.number().int(),
            members: z.number().int(),
          }),
        },
      },
    },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'org:read');
      return organizationUsage(request.params.organizationId);
    },
  );

  app.delete(
    '/:organizationId',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Dar de baja una organización',
        description:
          'Borrado lógico: deja de aparecer y su personal pierde el acceso, pero el histórico de citas se conserva.',
        params: organizationParams,
      },
    },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'org:delete');
      const organization = await getOrganization(request.params.organizationId);
      if (!organization) throw new NotFoundError('La organización no existe');

      await deleteOrganization(request.params.organizationId);
      await recordAudit({
        organizationId: request.params.organizationId,
        actorId: request.auth.userId,
        action: 'organization.delete',
        entityType: 'organization',
        entityId: request.params.organizationId,
        changes: { name: organization.name },
        ip: request.ip,
      });
      return { ok: true as const };
    },
  );

  /* -------------------------------------------------------------- Personal */

  app.get(
    '/:organizationId/members',
    { schema: { tags: ['catalogo'], summary: 'Personal de la organización', params: organizationParams } },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'member:read');

      const rows = await db()
        .selectFrom('memberships')
        .innerJoin('users', 'users.id', 'memberships.user_id')
        .select([
          'memberships.id',
          'memberships.role',
          'memberships.job_title',
          'memberships.bookable',
          'memberships.active',
          'memberships.created_at',
          'users.id as user_id',
          'users.name',
          'users.email',
          'users.avatar_url',
        ])
        .where('memberships.organization_id', '=', request.params.organizationId)
        .orderBy('users.name')
        .execute();

      const locationRows = await db()
        .selectFrom('membership_locations')
        .select(['membership_id', 'location_id'])
        .where(
          'membership_id',
          'in',
          rows.length > 0 ? rows.map((row) => row.id) : [''],
        )
        .execute();

      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        email: row.email,
        avatarUrl: row.avatar_url,
        role: row.role,
        jobTitle: row.job_title,
        bookable: row.bookable === 1,
        active: row.active === 1,
        locationIds: locationRows
          .filter((location) => location.membership_id === row.id)
          .map((location) => location.location_id),
        createdAt: row.created_at,
      }));
    },
  );

  app.post(
    '/:organizationId/invitations',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Invitar a alguien al equipo',
        params: organizationParams,
        body: z.object({
          email: emailSchema,
          role: z.enum(ORG_ROLES).default('staff'),
          locationIds: z.array(z.string()).max(50).optional(),
        }),
      },
    },
    async (request, reply) => {
      const access = request.requirePermission(request.params.organizationId, 'member:invite');
      assertCanManageRole(access.role, request.body.role);

      const token = randomToken(32);
      const id = newId();

      await db()
        .insertInto('invitations')
        .values({
          id,
          organization_id: request.params.organizationId,
          email: request.body.email,
          role: request.body.role,
          token_hash: hashToken(token, 'invitation'),
          invited_by: request.auth.userId,
          location_ids_json: request.body.locationIds
            ? JSON.stringify(request.body.locationIds)
            : null,
          expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
          accepted_at: null,
          created_at: isoNow(),
        })
        .execute();

      const organization = await getOrganization(request.params.organizationId);
      await notify({
        event: 'account.welcome',
        organizationId: request.params.organizationId,
        to: { email: request.body.email },
        locale: (organization?.locale as never) ?? 'es',
        channels: ['email'],
        vars: {
          usuario: request.body.email,
          organizacion: organization?.name ?? env.APP_NAME,
          enlace: `${env.APP_URL}/invitacion?token=${token}`,
        },
      });

      return reply.status(201).send({ id, expiresIn: '7 días' });
    },
  );

  app.get(
    '/:organizationId/invitations',
    { schema: { tags: ['catalogo'], summary: 'Invitaciones pendientes', params: organizationParams } },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'member:read');
      const rows = await db()
        .selectFrom('invitations')
        .select(['id', 'email', 'role', 'expires_at', 'accepted_at', 'created_at'])
        .where('organization_id', '=', request.params.organizationId)
        .where('accepted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .execute();
      return rows;
    },
  );

  app.delete(
    '/:organizationId/invitations/:id',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Anular una invitación',
        params: organizationParams.merge(idParams),
      },
    },
    async (request) => {
      request.requirePermission(request.params.organizationId, 'member:invite');
      await db()
        .deleteFrom('invitations')
        .where('id', '=', request.params.id)
        .where('organization_id', '=', request.params.organizationId)
        .execute();
      return { ok: true };
    },
  );

  app.patch(
    '/:organizationId/members/:id',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Cambiar el rol o los datos de un miembro',
        params: organizationParams.merge(idParams),
        body: z.object({
          role: z.enum(ORG_ROLES).optional(),
          jobTitle: z.string().max(120).nullable().optional(),
          bookable: z.boolean().optional(),
          active: z.boolean().optional(),
          locationIds: z.array(z.string()).max(50).optional(),
        }),
      },
    },
    async (request) => {
      const access = request.requirePermission(request.params.organizationId, 'member:update');

      const membership = await db()
        .selectFrom('memberships')
        .selectAll()
        .where('id', '=', request.params.id)
        .where('organization_id', '=', request.params.organizationId)
        .executeTakeFirst();
      if (!membership) throw new NotFoundError('El miembro no existe');

      assertCanManageRole(access.role, membership.role as OrgRole);
      if (request.body.role) assertCanManageRole(access.role, request.body.role);

      const patch: Record<string, unknown> = { updated_at: isoNow() };
      if (request.body.role !== undefined) patch.role = request.body.role;
      if (request.body.jobTitle !== undefined) patch.job_title = request.body.jobTitle;
      if (request.body.bookable !== undefined) patch.bookable = request.body.bookable ? 1 : 0;
      if (request.body.active !== undefined) patch.active = request.body.active ? 1 : 0;

      await db().updateTable('memberships').set(patch).where('id', '=', membership.id).execute();

      if (request.body.locationIds) {
        await db()
          .deleteFrom('membership_locations')
          .where('membership_id', '=', membership.id)
          .execute();
        if (request.body.locationIds.length > 0) {
          await db()
            .insertInto('membership_locations')
            .values(
              request.body.locationIds.map((locationId) => ({
                membership_id: membership.id,
                location_id: locationId,
              })),
            )
            .execute();
        }
      }

      await recordAudit({
        organizationId: request.params.organizationId,
        actorId: request.auth.userId,
        action: 'member.update',
        entityType: 'membership',
        entityId: membership.id,
        changes: request.body,
        ip: request.ip,
      });

      return { ok: true };
    },
  );

  app.delete(
    '/:organizationId/members/:id',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Sacar a alguien del equipo',
        params: organizationParams.merge(idParams),
      },
    },
    async (request) => {
      const access = request.requirePermission(request.params.organizationId, 'member:remove');

      const membership = await db()
        .selectFrom('memberships')
        .selectAll()
        .where('id', '=', request.params.id)
        .where('organization_id', '=', request.params.organizationId)
        .executeTakeFirst();
      if (!membership) throw new NotFoundError('El miembro no existe');
      assertCanManageRole(access.role, membership.role as OrgRole);

      if (membership.role === 'owner') {
        const owners = await db()
          .selectFrom('memberships')
          .select(['id'])
          .where('organization_id', '=', request.params.organizationId)
          .where('role', '=', 'owner')
          .where('active', '=', 1)
          .execute();
        if (owners.length <= 1) {
          throw new ConflictError(
            'La organización necesita al menos una persona propietaria',
            'last_owner',
          );
        }
      }

      await db().deleteFrom('membership_locations').where('membership_id', '=', membership.id).execute();
      await db().deleteFrom('memberships').where('id', '=', membership.id).execute();
      return { ok: true };
    },
  );
};

/**
 * Nadie puede tocar a alguien de rango igual o superior al suyo. Sin esto, un
 * administrador podría degradar a la persona propietaria o darse a sí mismo
 * más privilegios de los que tiene.
 */
function assertCanManageRole(actorRole: OrgRole, targetRole: OrgRole): void {
  if (ROLE_RANK[actorRole] <= ROLE_RANK[targetRole] && actorRole !== 'owner') {
    throw new ForbiddenError(
      'No puedes gestionar a alguien con tu mismo rol o superior',
      'insufficient_role',
    );
  }
}

export default organizationRoutes;
