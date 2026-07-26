import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createLocationSchema,
  createResourceSchema,
  createServiceCategorySchema,
  createServiceSchema,
  createTimeOffSchema,
  isoDateSchema,
  scheduleExceptionSchema,
  scheduleRuleSchema,
  updateLocationSchema,
  updateResourceSchema,
  updateServiceSchema,
} from '@cita-facil/shared';
import { NotFoundError } from '../lib/errors.js';
import {
  addException,
  addTimeOff,
  createCategory,
  createLocation,
  createResource,
  createService,
  deleteException,
  deleteLocation,
  deleteResource,
  deleteService,
  deleteTimeOff,
  getLocation,
  getResource,
  getSchedule,
  getService,
  listCategories,
  listExceptions,
  listLocations,
  listResources,
  listServices,
  listTimeOff,
  setSchedule,
  updateLocation,
  updateResource,
  updateService,
} from '../modules/catalog/service.js';
import { recordAudit } from '../modules/audit/service.js';
import { organizationParams, organizationAndIdParams, orgId } from './helpers.js';

/** Sedes, recursos, servicios, categorías, horarios y ausencias. */
const catalogRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* -------------------------------------------------------------- Sedes */

  app.get(
    '/locations',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Sedes',
        params: organizationParams,
        querystring: z.object({ onlyActive: z.coerce.boolean().default(false) }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'location:read');
      return listLocations(orgId(request), { onlyActive: request.query.onlyActive });
    },
  );

  app.post(
    '/locations',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Crear sede',
        params: organizationParams,
        body: createLocationSchema,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'location:write');
      const location = await createLocation(orgId(request), request.body);
      return reply.status(201).send(location);
    },
  );

  app.get(
    '/locations/:id',
    { schema: { tags: ['catalogo'], summary: 'Detalle de sede', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'location:read');
      const location = await getLocation(request.params.id);
      if (!location || location.organizationId !== orgId(request)) {
        throw new NotFoundError('La sede no existe');
      }
      return location;
    },
  );

  app.patch(
    '/locations/:id',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Actualizar sede',
        params: organizationAndIdParams,
        body: updateLocationSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'location:write');
      return updateLocation(request.params.id, request.body);
    },
  );

  app.delete(
    '/locations/:id',
    { schema: { tags: ['catalogo'], summary: 'Eliminar sede', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'location:write');
      await deleteLocation(request.params.id);
      return { ok: true };
    },
  );

  /* ----------------------------------------------------------- Recursos */

  app.get(
    '/resources',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Recursos (personal, salas, pistas, equipos)',
        params: organizationParams,
        querystring: z.object({
          locationId: z.string().optional(),
          serviceId: z.string().optional(),
          onlyActive: z.coerce.boolean().default(false),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'resource:read');
      return listResources(orgId(request), request.query);
    },
  );

  app.post(
    '/resources',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Crear recurso',
        params: organizationParams,
        body: createResourceSchema,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'resource:write');
      const resource = await createResource(orgId(request), request.body);
      return reply.status(201).send(resource);
    },
  );

  app.get(
    '/resources/:id',
    { schema: { tags: ['catalogo'], summary: 'Detalle de recurso', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'resource:read');
      const resource = await getResource(request.params.id);
      if (!resource || resource.organizationId !== orgId(request)) {
        throw new NotFoundError('El recurso no existe');
      }
      return resource;
    },
  );

  app.patch(
    '/resources/:id',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Actualizar recurso',
        params: organizationAndIdParams,
        body: updateResourceSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'resource:write');
      return updateResource(request.params.id, request.body);
    },
  );

  app.delete(
    '/resources/:id',
    { schema: { tags: ['catalogo'], summary: 'Eliminar recurso', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'resource:write');
      await deleteResource(request.params.id);
      return { ok: true };
    },
  );

  /* ---------------------------------------------------------- Servicios */

  app.get(
    '/services',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Servicios',
        params: organizationParams,
        querystring: z.object({
          locationId: z.string().optional(),
          onlyActive: z.coerce.boolean().default(false),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'service:read');
      return listServices(orgId(request), request.query);
    },
  );

  app.post(
    '/services',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Crear servicio',
        description:
          'Con durationMode="flexible" el cliente puede elegir cuánto tiempo reserva, entre minDurationMinutes y maxDurationMinutes en tramos de durationStepMinutes.',
        params: organizationParams,
        body: createServiceSchema,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'service:write');
      const service = await createService(orgId(request), request.body);
      await recordAudit({
        organizationId: orgId(request),
        actorId: request.auth.userId,
        action: 'service.create',
        entityType: 'service',
        entityId: service.id,
        ip: request.ip,
      });
      return reply.status(201).send(service);
    },
  );

  app.get(
    '/services/:id',
    { schema: { tags: ['catalogo'], summary: 'Detalle de servicio', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'service:read');
      const service = await getService(request.params.id);
      if (!service || service.organizationId !== orgId(request)) {
        throw new NotFoundError('El servicio no existe');
      }
      return service;
    },
  );

  app.patch(
    '/services/:id',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Actualizar servicio',
        params: organizationAndIdParams,
        body: updateServiceSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'service:write');
      return updateService(request.params.id, request.body);
    },
  );

  app.delete(
    '/services/:id',
    { schema: { tags: ['catalogo'], summary: 'Eliminar servicio', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'service:write');
      await deleteService(request.params.id);
      return { ok: true };
    },
  );

  /* --------------------------------------------------------- Categorías */

  app.get(
    '/service-categories',
    { schema: { tags: ['catalogo'], summary: 'Categorías de servicio', params: organizationParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'service:read');
      return listCategories(orgId(request));
    },
  );

  app.post(
    '/service-categories',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Crear categoría',
        params: organizationParams,
        body: createServiceCategorySchema,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'service:write');
      return reply.status(201).send(await createCategory(orgId(request), request.body));
    },
  );

  /* ----------------------------------------------------------- Horarios */

  const ownerQuery = z.object({
    ownerType: z.enum(['location', 'resource', 'service']),
    ownerId: z.string().min(1),
  });

  app.get(
    '/schedules',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Horario semanal de una sede, recurso o servicio',
        params: organizationParams,
        querystring: ownerQuery,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'schedule:read');
      return getSchedule(orgId(request), request.query.ownerType, request.query.ownerId);
    },
  );

  app.put(
    '/schedules',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Fijar el horario semanal',
        description:
          'Sustituye por completo el horario del propietario indicado. Las horas van en minutos desde medianoche (540 = 09:00).',
        params: organizationParams,
        body: ownerQuery.extend({ rules: z.array(scheduleRuleSchema).max(100) }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'schedule:write');
      await setSchedule(
        orgId(request),
        request.body.ownerType,
        request.body.ownerId,
        request.body.rules,
      );
      return { ok: true };
    },
  );

  app.get(
    '/schedule-exceptions',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Festivos, cierres y aperturas extraordinarias',
        params: organizationParams,
        querystring: z.object({
          ownerType: z.enum(['location', 'resource', 'service']).optional(),
          ownerId: z.string().optional(),
          from: isoDateSchema.optional(),
          to: isoDateSchema.optional(),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'schedule:read');
      return listExceptions(orgId(request), request.query);
    },
  );

  app.post(
    '/schedule-exceptions',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Añadir excepción de calendario',
        params: organizationParams,
        body: scheduleExceptionSchema,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'schedule:write');
      return reply.status(201).send(await addException(orgId(request), request.body));
    },
  );

  app.delete(
    '/schedule-exceptions/:id',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Eliminar excepción',
        params: organizationAndIdParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'schedule:write');
      await deleteException(orgId(request), request.params.id);
      return { ok: true };
    },
  );

  /* ---------------------------------------------------------- Ausencias */

  app.get(
    '/time-off',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Ausencias y bloqueos de agenda',
        params: organizationParams,
        querystring: z.object({
          resourceId: z.string().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'schedule:read');
      return listTimeOff(orgId(request), request.query);
    },
  );

  app.post(
    '/time-off',
    {
      schema: {
        tags: ['catalogo'],
        summary: 'Bloquear una franja',
        description:
          'Devuelve cuántas citas ya reservadas caen dentro de la franja bloqueada, para que el responsable decida si las mueve o las cancela.',
        params: organizationParams,
        body: createTimeOffSchema,
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'schedule:write');
      const result = await addTimeOff(orgId(request), request.body, request.auth.userId);
      return reply.status(201).send(result);
    },
  );

  app.delete(
    '/time-off/:id',
    { schema: { tags: ['catalogo'], summary: 'Quitar bloqueo', params: organizationAndIdParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'schedule:write');
      await deleteTimeOff(orgId(request), request.params.id);
      return { ok: true };
    },
  );
};

export default catalogRoutes;
