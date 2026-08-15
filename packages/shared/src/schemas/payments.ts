import { z } from 'zod';
import { PAYMENT_PROVIDERS } from '../enums.js';
import { idSchema, moneySchema } from './common.js';

export const createCheckoutSchema = z.object({
  appointmentId: idSchema.optional(),
  creditPackId: idSchema.optional(),
  provider: z.enum(PAYMENT_PROVIDERS).optional(),
  returnUrl: z.string().url().max(500).optional(),
  cancelUrl: z.string().url().max(500).optional(),
});
export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export const checkoutResponseSchema = z.object({
  paymentId: idSchema,
  provider: z.enum(PAYMENT_PROVIDERS),
  amountCents: z.number().int(),
  currency: z.string(),
  /** Redirección para Stripe Checkout. */
  redirectUrl: z.string().nullable(),
  /** Formulario autoenviado para Redsys. */
  formPost: z
    .object({
      action: z.string(),
      fields: z.record(z.string(), z.string()),
    })
    .nullable(),
});

export const refundSchema = z.object({
  amountCents: moneySchema.optional(),
  reason: z.string().max(300).optional(),
});

/* Los bonos viven en `schemas/credits.ts`: crecieron lo bastante como para
   tener módulo propio. Aquí solo queda su referencia en el pago. */

export const paymentSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  defaultProvider: z.enum(PAYMENT_PROVIDERS).default('stripe'),
  stripe: z
    .object({
      publishableKey: z.string().max(300).optional(),
      secretKey: z.string().max(300).optional(),
      webhookSecret: z.string().max(300).optional(),
    })
    .optional(),
  redsys: z
    .object({
      merchantCode: z.string().max(32).optional(),
      terminal: z.string().max(8).default('001'),
      secretKey: z.string().max(300).optional(),
      environment: z.enum(['test', 'live']).default('test'),
    })
    .optional(),
});
export type PaymentSettings = z.infer<typeof paymentSettingsSchema>;
