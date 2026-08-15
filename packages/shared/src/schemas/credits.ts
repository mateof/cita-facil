import { z } from 'zod';
import { avatarFieldsSchema } from './avatar.js';
import { currencySchema, idSchema, moneySchema } from './common.js';

/**
 * Bonos: series de sesiones prepagadas.
 *
 * Se llaman "bono" de cara al usuario y `credit pack` en la base de datos, que
 * es como se nombraron las tablas originales. Un bono tiene un tipo (cuántas
 * sesiones, a qué precio, para qué servicios) y de cada tipo se emiten bonos
 * concretos a personas concretas, con su saldo y su caducidad.
 */

/* -------------------------------------------------------------------------- */
/* Tipos de bono                                                              */
/* -------------------------------------------------------------------------- */

export const createCreditPackSchema = z.object({
  name: z.string().min(1).max(140).trim(),
  description: z.string().max(1000).optional(),
  /** Sesiones que incluye. */
  credits: z.number().int().min(1).max(1000),
  priceCents: moneySchema,
  currency: currencySchema,
  /** Días de validez desde la emisión. 0 = sin caducidad. */
  validityDays: z.number().int().min(0).max(3650).default(365),
  /** Servicios donde se puede canjear. Vacío = todos los de la organización. */
  serviceIds: z.array(idSchema).max(200).default([]),
  /** El cliente puede comprarlo desde la web. Si no, solo lo emite el centro. */
  onlinePurchase: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
}).merge(avatarFieldsSchema);
export type CreateCreditPackInput = z.infer<typeof createCreditPackSchema>;

export const updateCreditPackSchema = createCreditPackSchema.partial();
export type UpdateCreditPackInput = z.infer<typeof updateCreditPackSchema>;

export const creditPackSchema = z.object({
  id: idSchema,
  name: z.string(),
  description: z.string().nullable(),
  credits: z.number().int(),
  priceCents: z.number().int(),
  currency: z.string(),
  validityDays: z.number().int(),
  serviceIds: z.array(idSchema),
  /** Nombres de los servicios cubiertos, para no resolverlos en el cliente. */
  serviceNames: z.array(z.string()),
  onlinePurchase: z.boolean(),
  sortOrder: z.number().int(),
  active: z.boolean(),
  imageUrl: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  /** Bonos vivos emitidos de este tipo. Solo se rellena en el panel. */
  issuedCount: z.number().int().optional(),
});
export type CreditPack = z.infer<typeof creditPackSchema>;

/* -------------------------------------------------------------------------- */
/* Bonos emitidos                                                             */
/* -------------------------------------------------------------------------- */

export const CREDIT_WALLET_STATUSES = ['active', 'exhausted', 'expired', 'cancelled'] as const;
export type CreditWalletStatus = (typeof CREDIT_WALLET_STATUSES)[number];

export const creditWalletSchema = z.object({
  id: idSchema,
  packId: idSchema.nullable(),
  packName: z.string(),
  userId: idSchema,
  userName: z.string().nullable(),
  userEmail: z.string().nullable(),
  total: z.number().int(),
  used: z.number().int(),
  remaining: z.number().int(),
  expiresAt: z.string().nullable(),
  status: z.enum(CREDIT_WALLET_STATUSES),
  /** `online` si lo compró el cliente, `admin` si lo emitió el centro. */
  source: z.string(),
  note: z.string().nullable(),
  /** Servicios que cubre. Vacío = todos. */
  serviceIds: z.array(idSchema),
  serviceNames: z.array(z.string()),
  createdAt: z.string(),
});
export type CreditWallet = z.infer<typeof creditWalletSchema>;

/** Emisión manual desde el panel. */
export const grantCreditPackSchema = z.object({
  userId: idSchema,
  packId: idSchema,
  /** Sesiones a emitir. Por defecto, las del tipo de bono. */
  credits: z.number().int().min(1).max(1000).optional(),
  /** Caducidad explícita. Por defecto se calcula con los días de validez. */
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  note: z.string().max(300).optional(),
});
export type GrantCreditPackInput = z.infer<typeof grantCreditPackSchema>;

/** Ajuste de un bono ya emitido. */
export const adjustCreditWalletSchema = z
  .object({
    /** Sesiones que se suman (positivo) o se retiran (negativo). */
    delta: z.number().int().min(-1000).max(1000).optional(),
    /**
     * Sesiones totales del bono. Es lo que usa el formulario de edición, donde
     * se escribe la cifra final en vez de la diferencia.
     */
    total: z.number().int().min(0).max(10000).optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
    /** `true` anula el bono, `false` lo reactiva. */
    cancelled: z.boolean().optional(),
    note: z.string().max(300).optional(),
  })
  .refine(
    (value) =>
      value.delta !== undefined ||
      value.total !== undefined ||
      value.expiresAt !== undefined ||
      value.cancelled !== undefined ||
      value.note !== undefined,
    { message: 'No hay nada que cambiar' },
  )
  .refine((value) => value.delta === undefined || value.total === undefined, {
    message: 'Indica las sesiones totales o la diferencia, pero no las dos',
  });
export type AdjustCreditWalletInput = z.infer<typeof adjustCreditWalletSchema>;

export const creditMovementSchema = z.object({
  id: idSchema,
  delta: z.number().int(),
  reason: z.string(),
  appointmentId: idSchema.nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});

/* -------------------------------------------------------------------------- */
/* Saldo del cliente                                                          */
/* -------------------------------------------------------------------------- */

export const creditBalanceSchema = z.object({
  /** Sesiones disponibles sumando todos los bonos vivos. */
  available: z.number().int(),
  wallets: z.array(creditWalletSchema),
  /** Tipos de bono que este cliente puede comprar ahora mismo por la web. */
  packsForSale: z.array(creditPackSchema),
});
export type CreditBalance = z.infer<typeof creditBalanceSchema>;

/**
 * Respuesta de "¿puedo reservar este servicio?" cuando el servicio exige bono.
 * La página de reserva la usa para decidir si deja seguir o manda a comprar.
 */
export const creditEligibilitySchema = z.object({
  required: z.boolean(),
  allowed: z.boolean(),
  available: z.number().int(),
  reason: z.enum(['ok', 'not_required', 'anonymous', 'no_credits']),
  packsForSale: z.array(creditPackSchema),
});
export type CreditEligibility = z.infer<typeof creditEligibilitySchema>;
