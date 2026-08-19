import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  joinQueueSchema,
  queueEntrySchema,
  queueViewSchema,
  updateQueueEntrySchema,
} from '@cita-facil/shared';
import {
  callNext,
  changeQueueStatus,
  joinQueue,
  queueOf,
} from '../modules/appointments/queue.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/**
 * Cola sin cita previa.
 *
 * Es cosa del mostrador: apuntar a quien llega, llamar al siguiente y cerrar el
 * turno. Pide los mismos permisos que trabajar con citas, porque es el mismo
 * trabajo con otro formato.
 */
const queueRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/queue',
    {
      schema: {
        tags: ['turnos'],
        summary: 'Cola del día',
        params: organizationParams,
        querystring: z.object({ locationId: z.string().optional(), date: z.string().optional() }),
        response: { 200: queueViewSchema },
      },
    },
    async (request) => {
      request.requireOrg(orgId(request));
      return queueOf(orgId(request), request.query);
    },
  );

  app.post(
    '/queue',
    {
      schema: {
        tags: ['turnos'],
        summary: 'Apuntar a alguien en la cola',
        params: organizationParams,
        body: joinQueueSchema,
        response: { 201: queueEntrySchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'appointment:write');
      const entry = await joinQueue(orgId(request), request.body, {
        userId: request.auth.userId,
        isStaff: true,
      });
      return reply.status(201).send(entry);
    },
  );

  app.post(
    '/queue/next',
    {
      schema: {
        tags: ['turnos'],
        summary: 'Llamar al siguiente',
        description: 'Avisa a quien le toca, si dejó un contacto.',
        params: organizationParams,
        body: z.object({ locationId: z.string().optional() }).nullish(),
        response: { 200: queueEntrySchema.nullable() },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      return callNext(orgId(request), { locationId: request.body?.locationId });
    },
  );

  app.patch(
    '/queue/:id',
    {
      schema: {
        tags: ['turnos'],
        summary: 'Cambiar el estado de un turno',
        params: organizationAndIdParams,
        body: updateQueueEntrySchema,
        response: { 200: queueEntrySchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      return changeQueueStatus(orgId(request), request.params.id, request.body.status);
    },
  );
};

export default queueRoutes;
