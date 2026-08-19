import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { importAppointments, importCustomers } from '../modules/imports/service.js';
import { organizationParams, orgId } from './helpers.js';

/**
 * Importación desde CSV.
 *
 * `dryRun` viene activado de fábrica: quien llame sin pensarlo recibe un
 * ensayo, no mil filas escritas. Escribir de verdad hay que pedirlo.
 */
const importRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const body = z.object({
    /** Contenido del fichero, tal cual. */
    csv: z.string().min(1).max(2_000_000),
    dryRun: z.boolean().default(true),
  });

  const reportSchema = z.object({
    total: z.number().int(),
    created: z.number().int(),
    updated: z.number().int(),
    skipped: z.number().int(),
    errors: z.number().int(),
    dryRun: z.boolean(),
    results: z.array(
      z.object({
        row: z.number().int(),
        status: z.enum(['created', 'updated', 'skipped', 'error']),
        message: z.string().optional(),
        name: z.string().optional(),
      }),
    ),
  });

  app.post(
    '/import/customers',
    {
      schema: {
        tags: ['importacion'],
        summary: 'Importar clientes desde CSV',
        description:
          'Con `dryRun` hace todo el trabajo menos escribir y devuelve el mismo informe, fila a fila.',
        params: organizationParams,
        body,
        response: { 200: reportSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'customer:write');
      return importCustomers(orgId(request), request.body.csv, { dryRun: request.body.dryRun });
    },
  );

  app.post(
    '/import/appointments',
    {
      schema: {
        tags: ['importacion'],
        summary: 'Importar citas desde CSV',
        description:
          'Pensado para el histórico de otra aplicación. Las citas futuras comprueban solape; las pasadas no.',
        params: organizationParams,
        body,
        response: { 200: reportSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'appointment:write');
      return importAppointments(orgId(request), request.body.csv, { dryRun: request.body.dryRun });
    },
  );
};

export default importRoutes;
