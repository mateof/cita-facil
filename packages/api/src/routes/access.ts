import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { accessValidateSchema, paginationSchema } from '@cita-facil/shared';
import { ForbiddenError } from '../lib/errors.js';
import { listAccessLogs, validateAccess } from '../modules/appointments/access.js';
import { organizationParams, orgId } from './helpers.js';

/**
 * Control de acceso físico.
 *
 * Pensado para que lo llame directamente un torno, una puerta o una tablet en
 * la entrada, autenticándose con una clave de API de la organización que tenga
 * el permiso `appointment:checkin`.
 */
const accessRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/access/validate',
    {
      config: {
        // Un lector puede consultar muchas veces por minuto en horas punta.
        rateLimit: { max: 600, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['acceso'],
        summary: 'Comprobar si se permite el acceso',
        description: [
          'Responde siempre 200 con un veredicto explícito en el cuerpo, incluso cuando deniega el paso.',
          'Así el dispositivo puede tratar cualquier respuesta distinta de 200 como un fallo de infraestructura',
          'y aplicar su propia política de contingencia.',
          '',
          'Se puede identificar la cita por el código del QR, por el identificador de la cita,',
          'por el DNI del usuario o por su identificador interno.',
        ].join('\n'),
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: organizationParams,
        body: accessValidateSchema,
      },
    },
    async (request) => {
      const access = request.requireOrg(orgId(request));
      if (!access.permissions.has('appointment:checkin')) {
        throw new ForbiddenError(
          'Esta credencial no puede validar accesos',
          'permission_denied',
        );
      }

      return validateAccess(orgId(request), request.body, {
        deviceId: (request.headers['x-device-id'] as string | undefined) ?? null,
      });
    },
  );

  app.get(
    '/access/logs',
    {
      schema: {
        tags: ['acceso'],
        summary: 'Historial de accesos',
        params: organizationParams,
        querystring: paginationSchema.extend({
          locationId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:read');
      return listAccessLogs({
        organizationId: orgId(request),
        locationId: request.query.locationId,
        from: request.query.from,
        to: request.query.to,
        page: request.query.page,
        pageSize: request.query.pageSize,
      });
    },
  );
};

export default accessRoutes;
