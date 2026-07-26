import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  broadcastSchema,
  localeSchema,
  notificationTemplateSchema,
  paginationSchema,
  sendTestNotificationSchema,
  setReminderRulesSchema,
  updateNotificationPreferencesSchema,
} from '@cita-facil/shared';
import { db } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { isoNow } from '../lib/dates.js';
import { BUILTIN_TEMPLATES, builtinTemplate } from '../modules/notifications/templates.js';
import { deliverById, notify } from '../modules/notifications/service.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/** Plantillas, preferencias de la organización, recordatorios y envíos manuales. */
const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/notifications',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Historial de avisos enviados',
        params: organizationParams,
        querystring: paginationSchema.extend({
          status: z.string().optional(),
          channel: z.string().optional(),
          appointmentId: z.string().optional(),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:read');

      let query = db()
        .selectFrom('notifications')
        .select([
          'id',
          'event',
          'channel',
          'destination',
          'subject',
          'status',
          'attempts',
          'last_error',
          'scheduled_at',
          'sent_at',
          'created_at',
        ])
        .where('organization_id', '=', orgId(request));

      if (request.query.status) query = query.where('status', '=', request.query.status);
      if (request.query.channel) query = query.where('channel', '=', request.query.channel);
      if (request.query.appointmentId) {
        query = query.where('appointment_id', '=', request.query.appointmentId);
      }

      const items = await query
        .orderBy('created_at', 'desc')
        .limit(request.query.pageSize)
        .offset((request.query.page - 1) * request.query.pageSize)
        .execute();

      return { items, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  app.post(
    '/notifications/:id/retry',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Reintentar un envío fallido',
        params: organizationAndIdParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:send');
      await db()
        .updateTable('notifications')
        .set({ status: 'scheduled', scheduled_at: isoNow(), attempts: 0 })
        .where('id', '=', request.params.id)
        .where('organization_id', '=', orgId(request))
        .execute();
      const delivered = await deliverById(request.params.id);
      return { delivered };
    },
  );

  /* --------------------------------------------------------- Plantillas */

  app.get(
    '/notification-templates',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Plantillas de aviso',
        description:
          'Devuelve las plantillas propias de la organización y, para lo que no esté personalizado, las integradas.',
        params: organizationParams,
        querystring: z.object({ locale: localeSchema.optional() }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:read');
      const locale = request.query.locale ?? 'es';

      const custom = await db()
        .selectFrom('notification_templates')
        .selectAll()
        .where('organization_id', '=', orgId(request))
        .where('locale', '=', locale)
        .execute();

      const items = [];
      for (const event of NOTIFICATION_EVENTS) {
        for (const channel of NOTIFICATION_CHANNELS) {
          if (channel === 'webhook' || channel === 'inapp') continue;
          const override = custom.find(
            (row) => row.event === event && row.channel === channel,
          );
          const builtin = builtinTemplate(event, channel, locale);
          items.push({
            event,
            channel,
            locale,
            subject: override?.subject ?? builtin.subject,
            body: override?.body ?? builtin.body,
            customized: Boolean(override),
            enabled: override ? override.enabled === 1 : true,
          });
        }
      }
      return { items, availableVariables: TEMPLATE_VARIABLES };
    },
  );

  app.put(
    '/notification-templates',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Personalizar una plantilla',
        params: organizationParams,
        body: notificationTemplateSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:write');
      const { event, channel, locale, subject, body, enabled } = request.body;

      const existing = await db()
        .selectFrom('notification_templates')
        .select(['id'])
        .where('organization_id', '=', orgId(request))
        .where('event', '=', event)
        .where('channel', '=', channel)
        .where('locale', '=', locale)
        .executeTakeFirst();

      if (existing) {
        await db()
          .updateTable('notification_templates')
          .set({ subject: subject ?? null, body, enabled: enabled ? 1 : 0, updated_at: isoNow() })
          .where('id', '=', existing.id)
          .execute();
      } else {
        await db()
          .insertInto('notification_templates')
          .values({
            id: newId(),
            organization_id: orgId(request),
            event,
            channel,
            locale,
            subject: subject ?? null,
            body,
            enabled: enabled ? 1 : 0,
            updated_at: isoNow(),
          })
          .execute();
      }
      return { ok: true };
    },
  );

  app.delete(
    '/notification-templates',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Volver a la plantilla integrada',
        params: organizationParams,
        querystring: z.object({
          event: z.enum(NOTIFICATION_EVENTS),
          channel: z.enum(NOTIFICATION_CHANNELS),
          locale: localeSchema,
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:write');
      await db()
        .deleteFrom('notification_templates')
        .where('organization_id', '=', orgId(request))
        .where('event', '=', request.query.event)
        .where('channel', '=', request.query.channel)
        .where('locale', '=', request.query.locale)
        .execute();
      return { ok: true };
    },
  );

  /* ------------------------------------------------------- Preferencias */

  app.get(
    '/notification-preferences',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Canales activos por defecto en la organización',
        params: organizationParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:read');
      const rows = await db()
        .selectFrom('notification_preferences')
        .select(['event', 'channel', 'enabled'])
        .where('organization_id', '=', orgId(request))
        .where('user_id', 'is', null)
        .execute();
      return rows.map((row) => ({
        event: row.event,
        channel: row.channel,
        enabled: row.enabled === 1,
      }));
    },
  );

  app.put(
    '/notification-preferences',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Definir los canales por defecto',
        params: organizationParams,
        body: updateNotificationPreferencesSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:write');

      for (const preference of request.body.preferences) {
        const existing = await db()
          .selectFrom('notification_preferences')
          .select(['id'])
          .where('organization_id', '=', orgId(request))
          .where('user_id', 'is', null)
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
              organization_id: orgId(request),
              user_id: null,
              event: preference.event,
              channel: preference.channel,
              enabled: preference.enabled ? 1 : 0,
              updated_at: isoNow(),
            })
            .execute();
        }
      }
      return { ok: true };
    },
  );

  /* ------------------------------------------------------ Recordatorios */

  app.get(
    '/reminder-rules',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Recordatorios por defecto de la organización',
        params: organizationParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:read');
      const rows = await db()
        .selectFrom('reminder_rules')
        .select(['id', 'offset_minutes', 'channels_json', 'enabled', 'service_id'])
        .where('organization_id', '=', orgId(request))
        .where('user_id', 'is', null)
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
        tags: ['notificaciones'],
        summary: 'Definir los recordatorios por defecto',
        description:
          'El desfase se indica en minutos antes del inicio de la cita. 1440 es un día antes, 60 una hora antes, y se admite cualquier valor.',
        params: organizationParams,
        body: setReminderRulesSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:write');

      await db()
        .deleteFrom('reminder_rules')
        .where('organization_id', '=', orgId(request))
        .where('user_id', 'is', null)
        .execute();

      if (request.body.rules.length > 0) {
        await db()
          .insertInto('reminder_rules')
          .values(
            request.body.rules.map((rule) => ({
              id: newId(),
              organization_id: orgId(request),
              user_id: null,
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

  /* ------------------------------------------------------------ Envíos */

  app.post(
    '/notifications/test',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Enviarme un aviso de prueba',
        params: organizationParams,
        body: sendTestNotificationSchema,
      },
    },
    async (request) => {
      const user = request.requireUser();
      request.requirePermission(orgId(request), 'notification:send');

      const queued = await notify({
        event: request.body.event,
        userId: user.id,
        organizationId: orgId(request),
        locale: request.body.locale ?? (user.locale as never),
        channels: [request.body.channel],
        vars: {
          usuario: user.name,
          organizacion: 'Prueba',
          servicio: 'Servicio de ejemplo',
          sede: 'Sede de ejemplo',
          fechaHora: new Date().toLocaleString('es-ES'),
          fecha: new Date().toLocaleDateString('es-ES'),
          hora: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
          duracion: 30,
          codigo: 'PRUEBA1234',
          enlace: `${process.env.APP_URL ?? ''}/mis-citas`,
        },
      });

      for (const item of queued) await deliverById(item.id);
      return { sent: queued.length };
    },
  );

  app.post(
    '/notifications/broadcast',
    {
      schema: {
        tags: ['notificaciones'],
        summary: 'Enviar un aviso a un conjunto de clientes',
        params: organizationParams,
        body: broadcastSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'notification:send');
      const recipients = await resolveAudience(orgId(request), request.body);

      let queued = 0;
      for (const recipient of recipients) {
        const result = await notify({
          event: 'appointment.reminder',
          userId: recipient.userId,
          organizationId: orgId(request),
          channels: request.body.channels,
          to: { email: recipient.email, phone: recipient.phone },
          locale: (recipient.locale as never) ?? 'es',
          vars: { usuario: recipient.name ?? '', mensaje: request.body.body },
        });
        queued += result.length;
      }

      return { recipients: recipients.length, queued };
    },
  );
};

async function resolveAudience(
  organizationId: string,
  body: { audience: string; locationId?: string; serviceId?: string; fromDate?: string; toDate?: string },
) {
  const base = db()
    .selectFrom('appointments')
    .leftJoin('users', 'users.id', 'appointments.customer_id')
    .select([
      'appointments.customer_id as user_id',
      'users.name',
      'users.email',
      'users.phone',
      'users.locale',
      'appointments.guest_email',
      'appointments.guest_phone',
      'appointments.guest_name',
    ])
    .where('appointments.organization_id', '=', organizationId)
    .distinct();

  let query = base;
  if (body.audience === 'upcoming_appointments') {
    query = query.where('appointments.starts_at', '>=', isoNow());
  }
  if (body.locationId) query = query.where('appointments.location_id', '=', body.locationId);
  if (body.serviceId) query = query.where('appointments.service_id', '=', body.serviceId);
  if (body.fromDate) query = query.where('appointments.starts_at', '>=', body.fromDate);
  if (body.toDate) query = query.where('appointments.starts_at', '<=', body.toDate);

  const rows = await query.limit(5000).execute();

  const seen = new Set<string>();
  return rows
    .map((row) => ({
      userId: row.user_id,
      name: row.name ?? row.guest_name,
      email: row.email ?? row.guest_email,
      phone: row.phone ?? row.guest_phone,
      locale: row.locale,
    }))
    .filter((recipient) => {
      const key = recipient.userId ?? recipient.email ?? recipient.phone ?? '';
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Variables que se pueden usar en las plantillas, para mostrarlas en el editor. */
const TEMPLATE_VARIABLES = [
  { name: 'usuario', description: 'Nombre del destinatario' },
  { name: 'cliente', description: 'Nombre del cliente de la cita' },
  { name: 'organizacion', description: 'Nombre del establecimiento' },
  { name: 'servicio', description: 'Nombre del servicio' },
  { name: 'sede', description: 'Nombre de la sede' },
  { name: 'profesional', description: 'Recurso o profesional asignado' },
  { name: 'fecha', description: 'Fecha de la cita' },
  { name: 'hora', description: 'Hora de la cita' },
  { name: 'fechaHora', description: 'Fecha y hora completas' },
  { name: 'duracion', description: 'Duración en minutos' },
  { name: 'precio', description: 'Importe con moneda' },
  { name: 'codigo', description: 'Código de acceso' },
  { name: 'enlace', description: 'Enlace a la cita' },
  { name: 'motivo', description: 'Motivo de la cancelación o el cambio' },
];

export { BUILTIN_TEMPLATES };
export default notificationRoutes;
