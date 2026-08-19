import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  customerDetailSchema,
  customerListQuerySchema,
  customerListSchema,
  updateCustomerProfileSchema,
} from '@cita-facil/shared';
import {
  getCustomerDetail,
  listCustomerTags,
  listCustomers,
  updateCustomerProfile,
} from '../modules/customers/service.js';
import { organizationParams, orgId } from './helpers.js';

/**
 * Clientes de la organización.
 *
 * Solo se ve a quien es cliente de este negocio: quien ha reservado, quien
 * tiene un bono o quien ya tiene ficha. Es la misma regla de privacidad que
 * rige la búsqueda de personas, y por eso la ficha comprueba la pertenencia
 * antes de responder en lugar de fiarse del identificador que le llega.
 */
const customerRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const customerParams = z.object({
    organizationId: z.string().min(1),
    userId: z.string().min(1),
  });

  app.get(
    '/customers',
    {
      schema: {
        tags: ['clientes'],
        summary: 'Clientes de la organización',
        description:
          'Listado con las cifras de cada persona: citas, faltas, gasto, saldo de bonos y deuda.',
        params: organizationParams,
        querystring: customerListQuerySchema,
        response: { 200: customerListSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'customer:read');
      return listCustomers(orgId(request), request.query);
    },
  );

  app.get(
    '/customer-tags',
    {
      schema: {
        tags: ['clientes'],
        summary: 'Etiquetas en uso',
        params: organizationParams,
        response: { 200: z.array(z.string()) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'customer:read');
      return listCustomerTags(orgId(request));
    },
  );

  app.get(
    '/customers/:userId',
    {
      schema: {
        tags: ['clientes'],
        summary: 'Ficha de un cliente',
        params: customerParams,
        response: { 200: customerDetailSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'customer:read');
      return getCustomerDetail(orgId(request), request.params.userId);
    },
  );

  app.patch(
    '/customers/:userId',
    {
      schema: {
        tags: ['clientes'],
        summary: 'Notas y etiquetas de un cliente',
        description: 'Lo que anota el mostrador. No toca los datos de la cuenta.',
        params: customerParams,
        body: updateCustomerProfileSchema,
        response: { 200: customerDetailSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'customer:write');
      return updateCustomerProfile(orgId(request), request.params.userId, request.body);
    },
  );
};

export default customerRoutes;
