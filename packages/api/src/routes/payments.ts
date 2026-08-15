import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createCheckoutSchema,
  paginationSchema,
  paymentSettingsSchema,
  refundSchema,
} from '@cita-facil/shared';
import { db } from '../db/index.js';
import {
  createCheckout,
  describePaymentSettings,
  handleRedsysNotification,
  handleStripeWebhook,
  markPaymentPaid,
  refundAppointmentPayments,
  savePaymentSettings,
} from '../modules/payments/service.js';
import { organizationAndIdParams, organizationParams, orgId } from './helpers.js';

/** Cobros, devoluciones, bonos y configuración de la pasarela. */
const paymentRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/payments/checkout',
    {
      schema: {
        tags: ['pagos'],
        summary: 'Iniciar un pago',
        description:
          'Devuelve la URL de redirección (Stripe) o el formulario autoenviado que hay que publicar contra el TPV (Redsys).',
        params: organizationParams,
        body: createCheckoutSchema,
      },
    },
    async (request) => {
      return createCheckout({
        organizationId: orgId(request),
        appointmentId: request.body.appointmentId,
        creditPackId: request.body.creditPackId,
        userId: request.auth.userId,
        provider: request.body.provider,
        locale: request.locale as never,
        returnUrl: request.body.returnUrl,
        cancelUrl: request.body.cancelUrl,
      });
    },
  );

  app.get(
    '/payments',
    {
      schema: {
        tags: ['pagos'],
        summary: 'Pagos de la organización',
        params: organizationParams,
        querystring: paginationSchema.extend({
          status: z.string().optional(),
          appointmentId: z.string().optional(),
        }),
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'payment:read');

      let query = db()
        .selectFrom('payments')
        .selectAll()
        .where('organization_id', '=', orgId(request));
      if (request.query.status) query = query.where('status', '=', request.query.status);
      if (request.query.appointmentId) {
        query = query.where('appointment_id', '=', request.query.appointmentId);
      }

      const items = await query
        .orderBy('created_at', 'desc')
        .limit(request.query.pageSize)
        .offset((request.query.page - 1) * request.query.pageSize)
        .execute();

      return { items, page: request.query.page, pageSize: request.query.pageSize };
    },
  );

  app.post(
    '/payments/:id/mark-paid',
    {
      schema: {
        tags: ['pagos'],
        summary: 'Marcar un cobro como recibido',
        description: 'Para cobros en efectivo o por transferencia registrados a mano.',
        params: organizationAndIdParams,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'payment:refund');
      await markPaymentPaid(request.params.id);
      return { ok: true };
    },
  );

  app.post(
    '/appointments/:id/refund',
    {
      schema: {
        tags: ['pagos'],
        summary: 'Devolver el importe de una cita',
        params: organizationAndIdParams,
        body: refundSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'payment:refund');
      return refundAppointmentPayments(request.params.id, {
        amountCents: request.body.amountCents,
        reason: request.body.reason,
      });
    },
  );

  /* ------------------------------------------------------- Configuración */

  app.get(
    '/payments/settings',
    { schema: { tags: ['pagos'], summary: 'Configuración de la pasarela', params: organizationParams } },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:read');
      return describePaymentSettings(orgId(request));
    },
  );

  app.put(
    '/payments/settings',
    {
      schema: {
        tags: ['pagos'],
        summary: 'Guardar la configuración de la pasarela',
        description: 'Las credenciales se guardan cifradas y nunca se devuelven en las consultas.',
        params: organizationParams,
        body: paymentSettingsSchema,
      },
    },
    async (request) => {
      request.requirePermission(orgId(request), 'settings:write');
      await savePaymentSettings(orgId(request), request.body);
      return { ok: true };
    },
  );

  /* ----------------------------------------------- Webhooks de pasarelas */

  app.post(
    '/payments/stripe/webhook',
    {
      config: { rawBody: true },
      schema: {
        tags: ['pagos'],
        summary: 'Notificaciones de Stripe',
        params: organizationParams,
      },
    },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string') {
        return reply.status(400).send({ error: { code: 'missing_signature', message: 'Falta la firma' } });
      }
      const payload =
        typeof request.body === 'string' ? request.body : JSON.stringify(request.body);
      return handleStripeWebhook({
        organizationId: orgId(request),
        payload,
        signature,
      });
    },
  );

  app.post(
    '/payments/redsys/notify',
    {
      schema: {
        tags: ['pagos'],
        summary: 'Notificación del TPV de Redsys',
        params: organizationParams,
      },
    },
    async (request) => {
      return handleRedsysNotification({
        organizationId: orgId(request),
        body: (request.body ?? {}) as Record<string, string>,
      });
    },
  );

  /* Los bonos se sirven desde `routes/credits.ts`. */
};

export default paymentRoutes;
