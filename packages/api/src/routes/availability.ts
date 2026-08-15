import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { availabilityQuerySchema, isoDateSchema } from '@cita-facil/shared';
import { computeAvailability } from '../modules/availability/engine.js';
import { addDays } from '../lib/dates.js';
import { organizationParams, orgId } from './helpers.js';

/**
 * Consulta de disponibilidad.
 *
 * No exige autenticación de personal: la página pública de reservas la usa tal
 * cual. Lo que sí cambia es que el personal ve también los huecos que las
 * reglas de antelación ocultarían al cliente, para poder encajar una cita
 * "para dentro de diez minutos" desde el mostrador.
 */
const availabilityRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/availability',
    {
      schema: {
        tags: ['disponibilidad'],
        summary: 'Huecos libres de un servicio',
        description:
          'Devuelve los inicios de cita posibles día a día. En servicios de duración ajustable, `durationMinutes` cambia el resultado: cuanto más largo, menos huecos caben.',
        params: organizationParams,
        querystring: availabilityQuerySchema.innerType().extend({
          /** Solo para el personal: muestra huecos que las reglas ocultarían. */
          ignoreRules: z.coerce.boolean().default(false),
        }),
      },
    },
    async (request) => {
      const query = request.query;
      const isStaff = Boolean(request.auth.organizations.get(orgId(request)));

      return computeAvailability({
        organizationId: orgId(request),
        serviceId: query.serviceId,
        locationId: query.locationId,
        resourceId: query.resourceId,
        from: query.from,
        to: query.to ?? query.from,
        durationMinutes: query.durationMinutes,
        partySize: query.partySize,
        ignoreBookingRules: isStaff && query.ignoreRules,
      });
    },
  );

  app.get(
    '/availability/next',
    {
      schema: {
        tags: ['disponibilidad'],
        summary: 'Primer hueco disponible',
        description:
          'Busca hacia adelante hasta encontrar el primer hueco libre. Útil para el botón "la primera cita que haya" y para los asistentes de voz.',
        params: organizationParams,
        querystring: z.object({
          serviceId: z.string().min(1),
          locationId: z.string().optional(),
          resourceId: z.string().optional(),
          from: isoDateSchema.optional(),
          durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
          partySize: z.coerce.number().int().min(1).max(200).default(1),
          /** Días máximos que se exploran hacia adelante. */
          searchDays: z.coerce.number().int().min(1).max(180).default(60),
        }),
      },
    },
    async (request) => {
      const query = request.query;
      const start = query.from ?? new Date().toISOString().slice(0, 10);

      // Se explora por ventanas de una semana para no calcular dos meses
      // enteros cuando el primer hueco suele estar en los próximos días.
      for (let offset = 0; offset < query.searchDays; offset += 7) {
        const from = addDays(start, offset);
        const to = addDays(start, Math.min(offset + 6, query.searchDays - 1));

        const availability = await computeAvailability({
          organizationId: orgId(request),
          serviceId: query.serviceId,
          locationId: query.locationId,
          resourceId: query.resourceId,
          from,
          to,
          durationMinutes: query.durationMinutes,
          partySize: query.partySize,
        });

        for (const day of availability.days) {
          const slot = day.slots[0];
          if (slot) {
            return { found: true, slot, timezone: availability.timezone };
          }
        }
      }

      return { found: false, slot: null, timezone: null };
    },
  );
};

export default availabilityRoutes;
