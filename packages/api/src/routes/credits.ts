import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CREDIT_WALLET_STATUSES,
  adjustCreditWalletSchema,
  createCreditPackSchema,
  creditBalanceSchema,
  creditEligibilitySchema,
  creditMovementSchema,
  creditPackSchema,
  creditWalletSchema,
  grantCreditPackSchema,
  okResponseSchema,
  updateCreditPackSchema,
} from '@cita-facil/shared';
import { ConflictError } from '../lib/errors.js';
import {
  adjustWallet,
  balanceFor,
  createPack,
  deletePack,
  eligibilityFor,
  getWallet,
  grantPack,
  listPacks,
  listWallets,
  payAppointmentWithCredit,
  searchCustomers,
  updatePack,
  walletMovements,
} from '../modules/credits/service.js';
import { isStaffOf, organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/**
 * Bonos: tipos de bono, bonos emitidos y saldo del cliente.
 *
 * Las rutas de lectura sirven a dos públicos. `/credit-packs` devuelve al
 * cliente solo lo que puede comprar y al personal el catálogo completo con sus
 * contadores, porque son la misma pregunta hecha desde dos sitios y separarlas
 * obligaría a duplicar la pantalla de tipos de bono en el panel.
 */
const creditRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ------------------------------------------------------- Tipos de bono */

  app.get(
    '/credit-packs',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Tipos de bono',
        description:
          'Para el cliente, los que están a la venta por la web. Para el personal, todos, incluidos los inactivos y los que solo se venden en el centro.',
        params: organizationParams,
        response: { 200: z.array(creditPackSchema) },
      },
    },
    async (request) => {
      const staff = isStaffOf(request, orgId(request));
      return listPacks(orgId(request), {
        onlyActive: !staff,
        onlyOnline: !staff,
        withCounts: staff,
      });
    },
  );

  app.post(
    '/credit-packs',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Crear un tipo de bono',
        params: organizationParams,
        body: createCreditPackSchema,
        response: { 201: creditPackSchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'credit:write');
      const pack = await createPack(orgId(request), request.body, request.auth.userId);
      return reply.status(201).send(pack);
    },
  );

  app.patch(
    '/credit-packs/:id',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Actualizar un tipo de bono',
        params: organizationAndIdParams,
        body: updateCreditPackSchema,
        response: { 200: creditPackSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:write');
      return updatePack(orgId(request), request.params.id, request.body, request.auth.userId);
    },
  );

  app.delete(
    '/credit-packs/:id',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Eliminar un tipo de bono',
        description:
          'Si ya se ha emitido algún bono de este tipo, se desactiva en lugar de borrarse: los bonos vivos siguen siendo válidos.',
        params: organizationAndIdParams,
        response: { 200: z.object({ deleted: z.boolean() }) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:write');
      return deletePack(orgId(request), request.params.id, request.auth.userId);
    },
  );

  /* ------------------------------------------------------ Bonos emitidos */

  app.get(
    '/credit-wallets',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Bonos emitidos',
        params: organizationParams,
        querystring: z.object({
          userId: z.string().optional(),
          status: z.enum(CREDIT_WALLET_STATUSES).optional(),
          query: z.string().max(120).optional(),
        }),
        response: { 200: z.array(creditWalletSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:read');
      return listWallets(orgId(request), request.query);
    },
  );

  app.get(
    '/credit-customers',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Buscar a quién entregarle un bono',
        description:
          'Clientes de esta organización por nombre o correo, más cualquier cuenta buscada por su correo exacto.',
        params: organizationParams,
        querystring: z.object({ query: z.string().max(120) }),
        response: {
          200: z.array(
            z.object({ id: z.string(), name: z.string(), email: z.string().nullable() }),
          ),
        },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:write');
      return searchCustomers(orgId(request), request.query.query);
    },
  );

  app.post(
    '/credit-wallets',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Emitir un bono a una persona',
        description:
          'Alta manual desde el panel, sin pasar por la pasarela. Se avisa por correo a quien lo recibe.',
        params: organizationParams,
        body: grantCreditPackSchema,
        response: { 201: creditWalletSchema },
      },
    },
    async (request, reply) => {
      request.requirePermission(orgId(request), 'credit:write');
      const wallet = await grantPack({
        organizationId: orgId(request),
        userId: request.body.userId,
        packId: request.body.packId,
        credits: request.body.credits,
        expiresAt: request.body.expiresAt,
        note: request.body.note,
        source: 'admin',
        grantedBy: request.auth.userId,
      });
      return reply.status(201).send(wallet);
    },
  );

  app.get(
    '/credit-wallets/:id',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Detalle de un bono emitido',
        params: organizationAndIdParams,
        response: { 200: creditWalletSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:read');
      return getWallet(orgId(request), request.params.id);
    },
  );

  app.patch(
    '/credit-wallets/:id',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Ajustar o anular un bono emitido',
        params: organizationAndIdParams,
        body: adjustCreditWalletSchema,
        response: { 200: creditWalletSchema },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:write');
      return adjustWallet(orgId(request), request.params.id, request.body, request.auth.userId);
    },
  );

  app.get(
    '/credit-wallets/:id/movements',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Movimientos de un bono',
        params: organizationAndIdParams,
        response: { 200: z.array(creditMovementSchema) },
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'credit:read');
      return walletMovements(orgId(request), request.params.id);
    },
  );

  /* ------------------------------------------------------ Saldo del cliente */

  app.get(
    '/credits/balance',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Mis bonos en esta organización',
        params: organizationParams,
        response: { 200: creditBalanceSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      return balanceFor(orgId(request), user.id);
    },
  );

  app.get(
    '/credits/eligibility',
    {
      schema: {
        tags: ['bonos'],
        summary: '¿Puedo reservar este servicio?',
        description:
          'Solo mira los bonos. Responde también sin sesión iniciada, para que la página de reserva pueda avisar antes de pedir los datos.',
        params: organizationParams,
        querystring: z.object({ serviceId: z.string().min(1) }),
        response: { 200: creditEligibilitySchema },
      },
    },
    async (request) => {
      return eligibilityFor(orgId(request), request.auth.userId, request.query.serviceId);
    },
  );

  app.post(
    '/appointments/:id/pay-with-credit',
    {
      schema: {
        tags: ['bonos'],
        summary: 'Pagar una cita con un bono',
        description:
          'Para servicios que no exigen bono pero que el cliente quiere canjear igualmente. En los que sí lo exigen la sesión ya se descuenta al reservar.',
        params: organizationAndIdParams,
        response: { 200: okResponseSchema },
      },
    },
    async (request) => {
      const user = request.requireUser();
      const paid = await payAppointmentWithCredit(orgId(request), user.id, request.params.id);
      if (!paid) throw new ConflictError('No te queda ninguna sesión disponible', 'no_credits');
      return { ok: true as const };
    },
  );
};

export default creditRoutes;
