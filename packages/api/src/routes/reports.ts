import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { isoDateSchema } from '@cita-facil/shared';
import { db } from '../db/index.js';
import { localToInstant, todayIn } from '../lib/dates.js';
import { getOrganization } from '../modules/catalog/service.js';
import { NotFoundError } from '../lib/errors.js';
import {
  EXPORT_TYPES,
  daily,
  exportReport,
  hours,
  resolveRange,
  resources,
  services,
  staff,
  summary,
} from '../modules/reports/service.js';
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

  app.get(
    '/reports/summary',
    {
      schema: {
        tags: ['informes'],
        summary: 'Resumen general',
        description: 'Incluye el mismo número de días inmediatamente anterior, para comparar.',
        params: organizationParams,
        querystring: rangeQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'report:read');
      return summary(orgId(request), await resolveRange(orgId(request), request.query));
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
      return daily(orgId(request), await resolveRange(orgId(request), request.query));
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
      return services(orgId(request), await resolveRange(orgId(request), request.query));
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
      return resources(orgId(request), await resolveRange(orgId(request), request.query));
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
      return hours(orgId(request), await resolveRange(orgId(request), request.query));
    },
  );

  app.get(
    '/reports/staff',
    {
      schema: {
        tags: ['informes'],
        summary: 'Reparto por profesional y comisiones',
        description:
          'Lo que factura cada agenda y lo que le corresponde de comisión, calculada sobre lo cobrado.',
        params: organizationParams,
        querystring: rangeQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'report:read');
      return staff(orgId(request), await resolveRange(orgId(request), request.query));
    },
  );

  app.get(
    '/reports/export',
    {
      schema: {
        tags: ['informes'],
        summary: 'Descargar un informe en CSV',
        description:
          'Separador punto y coma y decimales con coma, que es lo que espera Excel en español.',
        params: organizationParams,
        querystring: rangeQuery.extend({ type: z.enum(EXPORT_TYPES) }),
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'report:read');
      const range = await resolveRange(orgId(request), request.query);
      const csv = await exportReport(orgId(request), request.query.type, range);

      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header(
          'content-disposition',
          `attachment; filename="${request.query.type}-${range.from}-${range.to}.csv"`,
        )
        .send(csv);
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

export default reportRoutes;
