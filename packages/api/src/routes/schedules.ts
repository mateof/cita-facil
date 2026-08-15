import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SCHEDULE_CONFLICT_MODES, idSchema } from '@cita-facil/shared';
import {
  cancelSchedule,
  createSchedule,
  deleteSchedule,
  getSchedule,
  listSchedules,
  runSchedule,
} from '../modules/appointments/schedules.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/**
 * Programaciones semanales.
 *
 * Cuelgan de `/recurring` y no de `/schedules` porque esa dirección ya la usan
 * los horarios de apertura, que son otra cosa: cuándo abre el negocio, no qué
 * cita se repite.
 *
 * Son cosa del mostrador: crear una compromete la agenda de las próximas
 * semanas, así que pide el mismo permiso que reservar en nombre de otro.
 */
const scheduleRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const scheduleSchema = z.object({
    id: idSchema,
    organizationId: idSchema,
    serviceId: idSchema,
    serviceName: z.string(),
    customerId: idSchema,
    customerName: z.string().nullable(),
    locationId: idSchema.nullable(),
    resourceId: idSchema.nullable(),
    weekday: z.number().int(),
    startMinute: z.number().int(),
    durationMinutes: z.number().int().nullable(),
    notes: z.string().nullable(),
    onConflict: z.string(),
    horizonDays: z.number().int(),
    active: z.boolean(),
    cancelledAt: z.string().nullable(),
    createdAt: z.string(),
    occurrences: z
      .array(
        z.object({
          date: z.string(),
          status: z.string(),
          reason: z.string().nullable(),
          appointmentId: idSchema.nullable(),
        }),
      )
      .optional(),
  });

  app.get(
    '/recurring',
    {
      schema: {
        tags: ['programaciones'],
        summary: 'Programaciones semanales',
        params: organizationParams,
        querystring: z.object({
          customerId: idSchema.optional(),
          onlyActive: z.coerce.boolean().optional(),
        }),
        response: { 200: z.array(scheduleSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:read');
      return listSchedules(orgId(request), request.query);
    },
  );

  app.post(
    '/recurring',
    {
      schema: {
        tags: ['programaciones'],
        summary: 'Programar una cita semanal',
        description:
          'Crea la cita de esta semana al momento; las siguientes las va creando el sistema dentro del horizonte configurado.',
        params: organizationParams,
        body: z.object({
          serviceId: idSchema,
          customerId: idSchema,
          locationId: idSchema.nullish(),
          resourceId: idSchema.nullish(),
          /** 1 = lunes ... 7 = domingo. */
          weekday: z.number().int().min(1).max(7),
          startMinute: z.number().int().min(0).max(1439),
          durationMinutes: z.number().int().min(1).max(1440).nullish(),
          notes: z.string().max(500).nullish(),
          onConflict: z.enum(SCHEDULE_CONFLICT_MODES).default('skip'),
          horizonDays: z.number().int().min(1).max(60).default(7),
        }),
        response: { 201: scheduleSchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'appointment:write');
      const schedule = await createSchedule(orgId(request), request.body, request.auth.userId);
      return reply.status(201).send(schedule);
    },
  );

  app.get(
    '/recurring/:id',
    {
      schema: {
        tags: ['programaciones'],
        summary: 'Una programación, con las últimas fechas procesadas',
        params: organizationAndIdParams,
        response: { 200: scheduleSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:read');
      return getSchedule(orgId(request), request.params.id);
    },
  );

  app.delete(
    '/recurring/:id',
    {
      schema: {
        tags: ['programaciones'],
        summary: 'Parar una programación, o quitarla si ya estaba parada',
        description:
          'La primera llamada la para y conserva las citas ya creadas. Sobre una parada, la quita de la lista.',
        params: organizationAndIdParams,
        response: { 200: z.union([scheduleSchema, z.object({ ok: z.literal(true) })]) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      const actual = await getSchedule(orgId(request), request.params.id);

      if (!actual.active) {
        await deleteSchedule(orgId(request), request.params.id);
        return { ok: true as const };
      }
      return cancelSchedule(orgId(request), request.params.id, request.auth.userId);
    },
  );

  app.post(
    '/recurring/:id/run',
    {
      schema: {
        tags: ['programaciones'],
        summary: 'Generar ahora lo que falte',
        description:
          'Lo mismo que hace el planificador cada noche. Útil para no esperar tras cambiar algo.',
        params: organizationAndIdParams,
        response: { 200: z.object({ created: z.number().int() }) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      await getSchedule(orgId(request), request.params.id);
      return { created: await runSchedule(request.params.id) };
    },
  );

  app.get(
    '/credit-debts',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Sesiones que se deben',
        params: organizationParams,
        querystring: z.object({ userId: idSchema.optional() }),
        response: {
          200: z.array(
            z.object({
              id: idSchema,
              userId: idSchema,
              userName: z.string().nullable(),
              appointmentId: idSchema.nullable(),
              createdAt: z.string(),
            }),
          ),
        },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:read');
      const { listDebts } = await import('../modules/credits/debts.js');
      return listDebts(orgId(request), request.query.userId);
    },
  );

  app.post(
    '/appointments/:id/cancel-check',
    {
      schema: {
        tags: ['citas'],
        summary: '¿Todavía se puede cancelar esta cita?',
        description:
          'Lo usa la interfaz para no ofrecer un botón que el servidor va a rechazar.',
        params: organizationAndIdParams,
        response: {
          200: z.object({
            cancellable: z.boolean(),
            cutoffMinutes: z.number().int(),
            minutesLeft: z.number().int(),
          }),
        },
      },
    },
    async (request) => {
      const { cancellationWindow } = await import('../modules/appointments/service.js');
      return cancellationWindow(orgId(request), request.params.id);
    },
  );
};

export default scheduleRoutes;
