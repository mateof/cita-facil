import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createThemeSchema,
  okResponseSchema,
  themeFileSchema,
  themeSchema,
  updateThemeSchema,
} from '@cita-facil/shared';
import {
  activateTheme,
  copyPreset,
  createTheme,
  deactivateThemes,
  deleteTheme,
  exportTheme,
  getTheme,
  importTheme,
  listThemes,
  updateTheme,
} from '../modules/themes/service.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/**
 * Temas de la organización.
 *
 * Todo cuelga de `settings:write`, que es el permiso de quien configura el
 * negocio: cambiar el aspecto de la página pública es una decisión suya, no del
 * mostrador.
 */
const themeRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/themes',
    {
      schema: {
        tags: ['temas'],
        summary: 'Temas de la organización',
        params: organizationParams,
        response: { 200: z.array(themeSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:read');
      return listThemes(orgId(request));
    },
  );

  app.post(
    '/themes',
    {
      schema: {
        tags: ['temas'],
        summary: 'Crear un tema',
        params: organizationParams,
        body: createThemeSchema,
        response: { 201: themeSchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'settings:write');
      const tema = await createTheme(orgId(request), request.body, request.auth.userId);
      return reply.status(201).send(tema);
    },
  );

  app.get(
    '/themes/:id',
    {
      schema: {
        tags: ['temas'],
        summary: 'Un tema',
        params: organizationAndIdParams,
        response: { 200: themeSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:read');
      return getTheme(orgId(request), request.params.id);
    },
  );

  app.patch(
    '/themes/:id',
    {
      schema: {
        tags: ['temas'],
        summary: 'Modificar un tema',
        params: organizationAndIdParams,
        body: updateThemeSchema,
        response: { 200: themeSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:write');
      return updateTheme(orgId(request), request.params.id, request.body, request.auth.userId);
    },
  );

  app.delete(
    '/themes/:id',
    {
      schema: {
        tags: ['temas'],
        summary: 'Borrar un tema',
        params: organizationAndIdParams,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:write');
      await deleteTheme(orgId(request), request.params.id);
      return { ok: true as const };
    },
  );

  app.post(
    '/themes/:id/activate',
    {
      schema: {
        tags: ['temas'],
        summary: 'Poner un tema en uso',
        description: 'Desactiva el que estuviera en uso: solo hay uno activo por organización.',
        params: organizationAndIdParams,
        response: { 200: themeSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:write');
      return activateTheme(orgId(request), request.params.id, request.auth.userId);
    },
  );

  app.post(
    '/themes/deactivate',
    {
      schema: {
        tags: ['temas'],
        summary: 'Volver al aspecto de serie',
        params: organizationParams,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:write');
      await deactivateThemes(orgId(request));
      return { ok: true as const };
    },
  );

  app.get(
    '/themes/:id/export',
    {
      schema: {
        tags: ['temas'],
        summary: 'Exportar un tema a fichero',
        params: organizationAndIdParams,
        response: { 200: themeFileSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:read');
      return exportTheme(orgId(request), request.params.id);
    },
  );

  app.post(
    '/themes/import',
    {
      schema: {
        tags: ['temas'],
        summary: 'Importar un tema desde un fichero',
        description: 'Los ajustes que no estén en el catálogo de esta versión se descartan.',
        params: organizationParams,
        body: themeFileSchema,
        response: { 201: themeSchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'settings:write');
      const tema = await importTheme(orgId(request), request.body, request.auth.userId);
      return reply.status(201).send(tema);
    },
  );

  app.post(
    '/themes/presets/:preset',
    {
      schema: {
        tags: ['temas'],
        summary: 'Copiar un tema de ejemplo',
        params: organizationParams.extend({ preset: z.string().max(40) }),
        response: { 201: themeSchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'settings:write');
      const tema = await copyPreset(orgId(request), request.params.preset, request.auth.userId);
      return reply.status(201).send(tema);
    },
  );
};

export default themeRoutes;
