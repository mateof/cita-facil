import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  cancelAppointmentSchema,
  createAppointmentSchema,
  createRecurringAppointmentSchema,
  holdAppointmentSchema,
  joinWaitlistSchema,
  listAppointmentsSchema,
  rescheduleAppointmentSchema,
  updateAppointmentSchema,
} from '@cita-facil/shared';
import { db } from '../db/index.js';
import { ForbiddenError, NotFoundError } from '../lib/errors.js';
import { isoNow } from '../lib/dates.js';
import { newId } from '../lib/ids.js';
import {
  cancelAppointment,
  changeStatus,
  createAppointment,
  holdSlot,
  releaseHold,
  rescheduleAppointment,
  updateAppointment,
} from '../modules/appointments/service.js';
import { createRecurringAppointments } from '../modules/appointments/recurrence.js';
import {
  listAppointments as queryAppointments,
  requireAppointmentDetail,
} from '../modules/appointments/queries.js';
import {
  joinWaitlist,
  leaveWaitlist,
  listWaitlist,
  markWaitlistConverted,
} from '../modules/appointments/waitlist.js';
import { buildIcs, buildReceiptPdf, buildQrPng } from '../modules/appointments/documents.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/**
 * Citas.
 *
 * El mismo endpoint sirve al cliente que reserva desde el móvil y al personal
 * que la crea desde el mostrador; lo que cambia es lo que se permite. El
 * personal puede reservar en nombre de otro, saltarse las reglas de antelación
 * y ver las notas internas.
 */
const appointmentRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /** `true` si quien hace la petición es personal de esta organización. */
  const staffContext = (request: { auth: { organizations: Map<string, unknown> } }, id: string) =>
    request.auth.organizations.has(id);

  /* ------------------------------------------------------------ Consulta */

  app.get(
    '/appointments',
    {
      schema: {
        tags: ['citas'],
        summary: 'Listado de citas (panel)',
        params: organizationParams,
        querystring: listAppointmentsSchema,
      },
    },
    async (request) => {
      const access = request.requireOrg(orgId(request));
      const query = request.query;

      // Quien solo tiene "appointment:read:own" ve únicamente su propia agenda.
      const onlyOwn =
        !access.permissions.has('appointment:read') &&
        access.permissions.has('appointment:read:own');

      let resourceId = query.resourceId;
      if (onlyOwn) {
        const own = await db()
          .selectFrom('resources')
          .select(['id'])
          .where('organization_id', '=', orgId(request))
          .where('user_id', '=', request.auth.userId)
          .executeTakeFirst();
        if (!own) throw new ForbiddenError('No tienes agenda propia', 'no_own_resource');
        resourceId = own.id;
      }

      return queryAppointments({
        organizationId: orgId(request),
        from: query.from,
        to: query.to,
        status: query.status
          ? Array.isArray(query.status)
            ? query.status
            : [query.status]
          : undefined,
        locationId: query.locationId,
        resourceId,
        serviceId: query.serviceId,
        customerId: query.customerId,
        search: query.search,
        allowedLocationIds: access.locationIds.length > 0 ? access.locationIds : undefined,
        sort: query.sort,
        page: query.page,
        pageSize: query.pageSize,
      });
    },
  );

  app.get(
    '/appointments/:id',
    { schema: { tags: ['citas'], summary: 'Detalle de una cita', params: organizationAndIdParams } },
    async (request) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      if (appointment.organizationId !== orgId(request)) {
        throw new NotFoundError('La cita no existe');
      }

      const isStaff = staffContext(request, orgId(request));
      const isOwner = appointment.customerId && appointment.customerId === request.auth.userId;
      if (!isStaff && !isOwner) {
        throw new ForbiddenError('No puedes ver esta cita', 'appointment_forbidden');
      }

      return isStaff ? appointment : { ...appointment, internalNotes: null };
    },
  );

  /* ------------------------------------------------------------- Reserva */

  app.post(
    '/appointments/hold',
    {
      schema: {
        tags: ['citas'],
        summary: 'Bloquear un hueco temporalmente',
        description:
          'Reserva el hueco unos minutos mientras se completa el proceso. Se libera solo si no se confirma.',
        params: organizationParams,
        body: holdAppointmentSchema,
      },
    },
    async (request, reply) => {
      const isStaff = staffContext(request, orgId(request));
      const result = await holdSlot(orgId(request), request.body, {
        userId: request.auth.userId,
        isStaff,
        source: isStaff ? 'admin' : 'web',
      });
      return reply.status(201).send(result);
    },
  );

  app.delete(
    '/appointments/hold/:id',
    { schema: { tags: ['citas'], summary: 'Liberar un hueco bloqueado', params: organizationAndIdParams } },
    async (request) => {
      await releaseHold(request.params.id);
      return { ok: true };
    },
  );

  app.post(
    '/appointments',
    {
      schema: {
        tags: ['citas'],
        summary: 'Reservar una cita',
        params: organizationParams,
        body: createAppointmentSchema.extend({
          /** Entrada de lista de espera que se convierte en esta reserva. */
          waitlistEntryId: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      const isStaff = staffContext(request, orgId(request));
      if (isStaff) request.requirePermission(orgId(request), 'appointment:write');

      const { appointment, idempotentReplay } = await createAppointment(
        orgId(request),
        request.body,
        {
          userId: request.auth.userId,
          isStaff,
          source: request.body.source ?? (isStaff ? 'admin' : 'web'),
          ip: request.ip,
          userAgent: request.headers['user-agent'] ?? null,
          locale: request.locale,
        },
      );

      if (request.body.waitlistEntryId) {
        await markWaitlistConverted(request.body.waitlistEntryId, appointment.id);
      }

      return reply.status(idempotentReplay ? 200 : 201).send(appointment);
    },
  );

  app.post(
    '/appointments/recurring',
    {
      schema: {
        tags: ['citas'],
        summary: 'Crear una serie de citas periódicas',
        description:
          'Repite la reserva cada N semanas en los días indicados. Con onConflict="skip" las repeticiones que caigan en un hueco ocupado se omiten y se informan en la respuesta.',
        params: organizationParams,
        body: createRecurringAppointmentSchema,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'appointment:write');
      const result = await createRecurringAppointments(orgId(request), request.body, {
        userId: request.auth.userId,
        isStaff: true,
        source: 'recurrence',
        ip: request.ip,
      });
      return reply.status(201).send(result);
    },
  );

  /* -------------------------------------------------------- Modificación */

  app.patch(
    '/appointments/:id',
    {
      schema: {
        tags: ['citas'],
        summary: 'Actualizar una cita',
        params: organizationAndIdParams,
        body: updateAppointmentSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      return updateAppointment(request.params.id, request.body, {
        userId: request.auth.userId,
        isStaff: true,
        ip: request.ip,
      });
    },
  );

  app.post(
    '/appointments/:id/reschedule',
    {
      schema: {
        tags: ['citas'],
        summary: 'Cambiar la cita de fecha u hora',
        params: organizationAndIdParams,
        body: rescheduleAppointmentSchema,
      },
    },
    async (request) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      const isStaff = staffContext(request, orgId(request));
      assertCanAct(appointment.customerId, request.auth.userId, isStaff);

      return rescheduleAppointment(request.params.id, request.body, {
        userId: request.auth.userId,
        isStaff,
        ip: request.ip,
      });
    },
  );

  app.post(
    '/appointments/:id/cancel',
    {
      schema: {
        tags: ['citas'],
        summary: 'Cancelar una cita',
        params: organizationAndIdParams,
        body: cancelAppointmentSchema,
      },
    },
    async (request) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      const isStaff = staffContext(request, orgId(request));
      assertCanAct(appointment.customerId, request.auth.userId, isStaff);

      const cancelled = await cancelAppointment(request.params.id, {
        reason: request.body.reason,
        notifyCustomer: request.body.notifyCustomer,
        actor: { userId: request.auth.userId, isStaff, ip: request.ip },
      });

      if (request.body.refund && isStaff) {
        const { refundAppointmentPayments } = await import('../modules/payments/service.js');
        await refundAppointmentPayments(request.params.id, { reason: request.body.reason });
      }

      return cancelled;
    },
  );

  app.post(
    '/appointments/:id/confirm',
    { schema: { tags: ['citas'], summary: 'Aprobar una cita pendiente', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      return changeStatus(request.params.id, 'confirmed', {
        userId: request.auth.userId,
        isStaff: true,
        ip: request.ip,
      });
    },
  );

  app.post(
    '/appointments/:id/status',
    {
      schema: {
        tags: ['citas'],
        summary: 'Cambiar el estado de una cita',
        params: organizationAndIdParams,
        body: z.object({
          status: z.enum([
            'confirmed',
            'checked_in',
            'in_progress',
            'completed',
            'no_show',
            'rejected',
            'cancelled',
          ]),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      return changeStatus(request.params.id, request.body.status, {
        userId: request.auth.userId,
        isStaff: true,
        ip: request.ip,
      });
    },
  );

  app.post(
    '/appointments/:id/check-in',
    {
      schema: {
        tags: ['citas'],
        summary: 'Registrar la llegada del cliente',
        params: organizationAndIdParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:checkin');
      return changeStatus(request.params.id, 'checked_in', {
        userId: request.auth.userId,
        isStaff: true,
        ip: request.ip,
      });
    },
  );

  /* ------------------------------------------------------- Documentación */

  app.get(
    '/appointments/:id/ics',
    {
      schema: {
        tags: ['citas'],
        summary: 'Descargar la cita en formato calendario',
        params: organizationAndIdParams,
      },
    },
    async (request, reply) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      assertCanView(request, appointment.organizationId, appointment.customerId);

      reply.header('content-type', 'text/calendar; charset=utf-8');
      reply.header('content-disposition', `attachment; filename="cita-${appointment.id}.ics"`);
      return buildIcs(appointment);
    },
  );

  app.get(
    '/appointments/:id/receipt',
    {
      schema: {
        tags: ['citas'],
        summary: 'Resguardo de la cita en PDF',
        params: organizationAndIdParams,
      },
    },
    async (request, reply) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      assertCanView(request, appointment.organizationId, appointment.customerId);

      const pdf = await buildReceiptPdf(appointment, request.locale);
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `inline; filename="resguardo-${appointment.id}.pdf"`);
      return reply.send(pdf);
    },
  );

  app.get(
    '/appointments/:id/qr',
    {
      schema: {
        tags: ['citas'],
        summary: 'Código QR de acceso',
        params: organizationAndIdParams,
      },
    },
    async (request, reply) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      assertCanView(request, appointment.organizationId, appointment.customerId);

      const png = await buildQrPng(appointment);
      reply.header('content-type', 'image/png');
      reply.header('cache-control', 'private, max-age=3600');
      return reply.send(png);
    },
  );

  /* --------------------------------------------------------- Valoraciones */

  app.post(
    '/appointments/:id/review',
    {
      schema: {
        tags: ['citas'],
        summary: 'Valorar una cita completada',
        params: organizationAndIdParams,
        body: z.object({
          rating: z.number().int().min(1).max(5),
          comment: z.string().max(2000).optional(),
        }),
      },
    },
    async (request, reply) => {
      const appointment = await requireAppointmentDetail(request.params.id);
      if (appointment.customerId !== request.auth.userId) {
        throw new ForbiddenError('Solo puedes valorar tus propias citas', 'review_forbidden');
      }
      if (appointment.status !== 'completed') {
        throw new ForbiddenError('La cita todavía no se ha completado', 'appointment_not_completed');
      }

      await db()
        .insertInto('reviews')
        .values({
          id: newId(),
          organization_id: appointment.organizationId,
          appointment_id: appointment.id,
          customer_id: appointment.customerId,
          resource_id: appointment.resourceId,
          service_id: appointment.serviceId,
          rating: request.body.rating,
          comment: request.body.comment ?? null,
          published: 1,
          reply: null,
          created_at: isoNow(),
        })
        .execute();

      return reply.status(201).send({ ok: true });
    },
  );

  app.get(
    '/reviews',
    {
      schema: {
        tags: ['citas'],
        summary: 'Valoraciones recibidas',
        params: organizationParams,
        querystring: z.object({
          serviceId: z.string().optional(),
          resourceId: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
        }),
      },
    },
    async (request) => {
      request.requireOrg(orgId(request));
      let query = db()
        .selectFrom('reviews')
        .leftJoin('users', 'users.id', 'reviews.customer_id')
        .leftJoin('services', 'services.id', 'reviews.service_id')
        .select([
          'reviews.id',
          'reviews.rating',
          'reviews.comment',
          'reviews.reply',
          'reviews.created_at',
          'users.name as customer_name',
          'services.name as service_name',
        ])
        .where('reviews.organization_id', '=', orgId(request));

      if (request.query.serviceId) query = query.where('reviews.service_id', '=', request.query.serviceId);
      if (request.query.resourceId) query = query.where('reviews.resource_id', '=', request.query.resourceId);

      const rows = await query
        .orderBy('reviews.created_at', 'desc')
        .limit(request.query.limit)
        .execute();

      const average =
        rows.length > 0 ? rows.reduce((sum, row) => sum + row.rating, 0) / rows.length : null;

      return { items: rows, average, count: rows.length };
    },
  );

  /* ------------------------------------------------------ Lista de espera */

  app.get(
    '/waitlist',
    {
      schema: {
        tags: ['citas'],
        summary: 'Lista de espera',
        params: organizationParams,
        querystring: z.object({ serviceId: z.string().optional() }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:read');
      return listWaitlist(orgId(request), request.query.serviceId);
    },
  );

  app.post(
    '/waitlist',
    {
      schema: {
        tags: ['citas'],
        summary: 'Apuntarse a la lista de espera',
        params: organizationParams,
        body: joinWaitlistSchema.extend({
          guest: z
            .object({
              name: z.string().min(2).max(120),
              email: z.string().email().optional(),
              phone: z.string().max(24).optional(),
            })
            .optional(),
        }),
      },
    },
    async (request, reply) => {
      const result = await joinWaitlist(orgId(request), request.body, request.auth.userId);
      return reply.status(201).send(result);
    },
  );

  app.delete(
    '/waitlist/:id',
    { schema: { tags: ['citas'], summary: 'Salir de la lista de espera', params: organizationAndIdParams } },
    async (request) => {
      const isStaff = staffContext(request, orgId(request));
      await leaveWaitlist(request.params.id, isStaff ? null : request.auth.userId);
      return { ok: true };
    },
  );
};

/** El cliente solo puede actuar sobre sus propias citas. */
function assertCanAct(customerId: string | null, userId: string | null, isStaff: boolean): void {
  if (isStaff) return;
  if (!userId || customerId !== userId) {
    throw new ForbiddenError('No puedes modificar esta cita', 'appointment_forbidden');
  }
}

function assertCanView(
  request: { auth: { organizations: Map<string, unknown>; userId: string | null } },
  organizationId: string,
  customerId: string | null,
): void {
  if (request.auth.organizations.has(organizationId)) return;
  if (customerId && customerId === request.auth.userId) return;
  throw new ForbiddenError('No puedes ver esta cita', 'appointment_forbidden');
}

export default appointmentRoutes;
