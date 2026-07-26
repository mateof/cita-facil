import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { isoDateSchema } from '@cita-facil/shared';
import { db } from '../db/index.js';
import { addDays, localToInstant, todayIn } from '../lib/dates.js';
import { getOrganization } from '../modules/catalog/service.js';
import { NotFoundError } from '../lib/errors.js';
import { organizationParams, orgId } from './helpers.js';

/**
 * Informes.
 *
 * Las agregaciones se hacen sobre `local_date`, la fecha local desnormalizada
 * que se guarda en cada cita. Agrupar por el instante UTC daría resultados
 * desplazados: una cita de las 00:30 en Madrid pertenece al día anterior en UTC
 * y aparecería en el informe equivocado.
 */
const reportRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const rangeQuery = z.object({
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
    locationId: z.string().optional(),
  });

  /** Rango por defecto: los últimos 30 días. */
  async function resolveRange(organizationId: string, query: z.infer<typeof rangeQuery>) {
    const organization = await getOrganization(organizationId);
    if (!organization) throw new NotFoundError('La organización no existe');
    const today = todayIn(organization.timezone);
    return {
      from: query.from ?? addDays(today, -29),
      to: query.to ?? today,
      timezone: organization.timezone,
      currency: organization.currency,
    };
  }

  app.get(
    '/reports/summary',
    {
      schema: {
        tags: ['informes'],
        summary: 'Resumen general',
        params: organizationParams,
        querystring: rangeQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'report:read');
      const range = await resolveRange(orgId(request), request.query);

      let base = db()
        .selectFrom('appointments')
        .where('organization_id', '=', orgId(request))
        .where('local_date', '>=', range.from)
        .where('local_date', '<=', range.to)
        .where('status', '!=', 'hold');
      if (request.query.locationId) {
        base = base.where('location_id', '=', request.query.locationId);
      }

      const rows = await base
        .select(['status', 'price_cents', 'payment_status', 'duration_minutes', 'source'])
        .execute();

      const total = rows.length;
      const byStatus = countBy(rows, (row) => row.status);
      const bySource = countBy(rows, (row) => row.source);

      const completed = rows.filter((row) => row.status === 'completed');
      const cancelled = rows.filter((row) => row.status === 'cancelled').length;
      const noShows = rows.filter((row) => row.status === 'no_show').length;

      const revenueCents = rows
        .filter((row) => row.payment_status === 'paid')
        .reduce((sum, row) => sum + row.price_cents, 0);

      const expectedRevenueCents = rows
        .filter((row) => ['confirmed', 'completed', 'checked_in', 'in_progress'].includes(row.status))
        .reduce((sum, row) => sum + row.price_cents, 0);

      return {
        range: { from: range.from, to: range.to },
        currency: range.currency,
        total,
        completed: completed.length,
        cancelled,
        noShows,
        // Tasas expresadas en tanto por ciento con un decimal.
        cancellationRate: total > 0 ? round1((cancelled / total) * 100) : 0,
        noShowRate: total > 0 ? round1((noShows / total) * 100) : 0,
        revenueCents,
        expectedRevenueCents,
        averageTicketCents: completed.length > 0 ? Math.round(revenueCents / completed.length) : 0,
        bookedMinutes: rows
          .filter((row) => !['cancelled', 'rejected', 'expired'].includes(row.status))
          .reduce((sum, row) => sum + row.duration_minutes, 0),
        byStatus,
        bySource,
      };
    },
  );

  app.get(
    '/reports/daily',
    {
      schema: {
        tags: ['informes'],
        summary: 'Citas e ingresos por día',
        params: organizationParams,
        querystring: rangeQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'report:read');
      const range = await resolveRange(orgId(request), request.query);

      let query = db()
        .selectFrom('appointments')
        .select((eb) => [
          'local_date',
          eb.fn.countAll<number>().as('total'),
          eb.fn.sum<number>('price_cents').as('revenue_cents'),
          eb.fn.sum<number>('duration_minutes').as('minutes'),
        ])
        .where('organization_id', '=', orgId(request))
        .where('local_date', '>=', range.from)
        .where('local_date', '<=', range.to)
        .where('status', 'in', ['confirmed', 'checked_in', 'in_progress', 'completed'])
        .groupBy('local_date')
        .orderBy('local_date');

      if (request.query.locationId) {
        query = query.where('location_id', '=', request.query.locationId);
      }

      const rows = await query.execute();
      const byDate = new Map(rows.map((row) => [row.local_date, row]));

      // Se rellenan los días sin citas para que la gráfica no tenga huecos.
      const series = [];
      for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
        const row = byDate.get(date);
        series.push({
          date,
          total: Number(row?.total ?? 0),
          revenueCents: Number(row?.revenue_cents ?? 0),
          minutes: Number(row?.minutes ?? 0),
        });
      }

      return { series, currency: range.currency };
    },
  );

  app.get(
    '/reports/services',
    {
      schema: {
        tags: ['informes'],
        summary: 'Servicios más solicitados',
        params: organizationParams,
        querystring: rangeQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'report:read');
      const range = await resolveRange(orgId(request), request.query);

      const rows = await db()
        .selectFrom('appointments')
        .innerJoin('services', 'services.id', 'appointments.service_id')
        .select((eb) => [
          'services.id',
          'services.name',
          eb.fn.countAll<number>().as('total'),
          eb.fn.sum<number>('appointments.price_cents').as('revenue_cents'),
        ])
        .where('appointments.organization_id', '=', orgId(request))
        .where('appointments.local_date', '>=', range.from)
        .where('appointments.local_date', '<=', range.to)
        .where('appointments.status', 'in', ['confirmed', 'checked_in', 'completed'])
        .groupBy(['services.id', 'services.name'])
        .orderBy('total', 'desc')
        .limit(50)
        .execute();

      return rows.map((row) => ({
        serviceId: row.id,
        name: row.name,
        total: Number(row.total),
        revenueCents: Number(row.revenue_cents ?? 0),
      }));
    },
  );

  app.get(
    '/reports/resources',
    {
      schema: {
        tags: ['informes'],
        summary: 'Ocupación por recurso',
        description:
          'Compara los minutos reservados con los minutos de agenda abierta de cada recurso en el periodo.',
        params: organizationParams,
        querystring: rangeQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'report:read');
      const range = await resolveRange(orgId(request), request.query);

      const booked = await db()
        .selectFrom('appointments')
        .innerJoin('resources', 'resources.id', 'appointments.resource_id')
        .select((eb) => [
          'resources.id',
          'resources.name',
          eb.fn.countAll<number>().as('total'),
          eb.fn.sum<number>('appointments.duration_minutes').as('minutes'),
          eb.fn.sum<number>('appointments.price_cents').as('revenue_cents'),
        ])
        .where('appointments.organization_id', '=', orgId(request))
        .where('appointments.local_date', '>=', range.from)
        .where('appointments.local_date', '<=', range.to)
        .where('appointments.status', 'in', ['confirmed', 'checked_in', 'in_progress', 'completed'])
        .groupBy(['resources.id', 'resources.name'])
        .execute();

      // Minutos de apertura: se suman las reglas de horario de cada recurso (o
      // de su sede si no tiene propio) por cada día del rango.
      const schedules = await db()
        .selectFrom('schedules')
        .select(['owner_type', 'owner_id', 'weekday', 'start_minute', 'end_minute'])
        .where('organization_id', '=', orgId(request))
        .execute();

      const resources = await db()
        .selectFrom('resources')
        .select(['id', 'name', 'location_id'])
        .where('organization_id', '=', orgId(request))
        .where('active', '=', 1)
        .where('deleted_at', 'is', null)
        .execute();

      const days: number[] = [];
      for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
        days.push(new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7);
      }

      return resources.map((resource) => {
        const own = schedules.filter(
          (rule) => rule.owner_type === 'resource' && rule.owner_id === resource.id,
        );
        const inherited = schedules.filter(
          (rule) => rule.owner_type === 'location' && rule.owner_id === resource.location_id,
        );
        const rules = own.length > 0 ? own : inherited;

        const availableMinutes = days.reduce(
          (sum, weekday) =>
            sum +
            rules
              .filter((rule) => rule.weekday === weekday)
              .reduce((total, rule) => total + (rule.end_minute - rule.start_minute), 0),
          0,
        );

        const stats = booked.find((row) => row.id === resource.id);
        const bookedMinutes = Number(stats?.minutes ?? 0);

        return {
          resourceId: resource.id,
          name: resource.name,
          appointments: Number(stats?.total ?? 0),
          bookedMinutes,
          availableMinutes,
          occupancyRate: availableMinutes > 0 ? round1((bookedMinutes / availableMinutes) * 100) : 0,
          revenueCents: Number(stats?.revenue_cents ?? 0),
        };
      });
    },
  );

  app.get(
    '/reports/hours',
    {
      schema: {
        tags: ['informes'],
        summary: 'Distribución de citas por hora del día',
        params: organizationParams,
        querystring: rangeQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'report:read');
      const range = await resolveRange(orgId(request), request.query);

      const rows = await db()
        .selectFrom('appointments')
        .select(['local_start_minute'])
        .where('organization_id', '=', orgId(request))
        .where('local_date', '>=', range.from)
        .where('local_date', '<=', range.to)
        .where('status', 'in', ['confirmed', 'checked_in', 'completed'])
        .execute();

      const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));
      for (const row of rows) {
        const hour = Math.floor(row.local_start_minute / 60);
        if (buckets[hour]) buckets[hour].total += 1;
      }
      return buckets;
    },
  );

  app.get(
    '/reports/today',
    {
      schema: {
        tags: ['informes'],
        summary: 'Panel del día',
        description: 'Lo que hay que saber al abrir el negocio: citas de hoy, pendientes y llegadas.',
        params: organizationParams,
        querystring: z.object({ locationId: z.string().optional(), date: isoDateSchema.optional() }),
      },
    },
    async (request) => {
      request.requireOrg(orgId(request));
      const organization = await getOrganization(orgId(request));
      if (!organization) throw new NotFoundError('La organización no existe');

      const date = request.query.date ?? todayIn(organization.timezone);

      let query = db()
        .selectFrom('appointments')
        .leftJoin('users', 'users.id', 'appointments.customer_id')
        .leftJoin('services', 'services.id', 'appointments.service_id')
        .leftJoin('resources', 'resources.id', 'appointments.resource_id')
        .select([
          'appointments.id',
          'appointments.starts_at',
          'appointments.ends_at',
          'appointments.local_start_minute',
          'appointments.duration_minutes',
          'appointments.status',
          'appointments.party_size',
          'appointments.price_cents',
          'appointments.payment_status',
          'appointments.checked_in_at',
          'appointments.access_code',
          'appointments.guest_name',
          'users.name as customer_name',
          'users.phone as customer_phone',
          'services.name as service_name',
          'services.color as service_color',
          'resources.name as resource_name',
        ])
        .where('appointments.organization_id', '=', orgId(request))
        .where('appointments.local_date', '=', date)
        .where('appointments.status', '!=', 'hold')
        .orderBy('appointments.local_start_minute');

      if (request.query.locationId) {
        query = query.where('appointments.location_id', '=', request.query.locationId);
      }

      const rows = await query.execute();

      return {
        date,
        timezone: organization.timezone,
        dayStart: localToInstant(date, 0, organization.timezone),
        counts: {
          total: rows.length,
          pending: rows.filter((row) => row.status === 'pending').length,
          confirmed: rows.filter((row) => row.status === 'confirmed').length,
          checkedIn: rows.filter((row) => row.checked_in_at !== null).length,
          completed: rows.filter((row) => row.status === 'completed').length,
          cancelled: rows.filter((row) => row.status === 'cancelled').length,
          noShow: rows.filter((row) => row.status === 'no_show').length,
        },
        appointments: rows.map((row) => ({
          id: row.id,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          localStartMinute: row.local_start_minute,
          durationMinutes: row.duration_minutes,
          status: row.status,
          partySize: row.party_size,
          priceCents: row.price_cents,
          paymentStatus: row.payment_status,
          checkedInAt: row.checked_in_at,
          accessCode: row.access_code,
          customerName: row.customer_name ?? row.guest_name,
          customerPhone: row.customer_phone,
          serviceName: row.service_name,
          serviceColor: row.service_color,
          resourceName: row.resource_name,
        })),
      };
    },
  );
};

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    result[value] = (result[value] ?? 0) + 1;
  }
  return result;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export default reportRoutes;
