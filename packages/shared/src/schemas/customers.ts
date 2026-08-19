import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Ficha de cliente.
 *
 * Es la vista que tiene el negocio de una persona: sus datos de contacto, lo
 * que ha reservado, lo que ha gastado, lo que le queda de bono y lo que anotó
 * el mostrador. Se calcula al vuelo sobre las tablas de siempre, así que no
 * puede desviarse del histórico.
 *
 * Todo es por organización. La misma cuenta puede ser clienta de dos negocios y
 * ninguno ve lo del otro, que es la misma regla de privacidad que ya rige la
 * búsqueda de personas.
 */

/** Etiqueta libre del negocio: `vip`, `alergia tinte`, `viene con la niña`. */
export const customerTagSchema = z.string().min(1).max(40).trim();

export const customerSortSchema = z.enum(['name', 'recent', 'appointments', 'spend']);
export type CustomerSort = z.infer<typeof customerSortSchema>;

export const customerListQuerySchema = z.object({
  /** Nombre, correo o teléfono, tolerando acentos y erratas. */
  query: z.string().max(120).optional(),
  tag: customerTagSchema.optional(),
  /** Solo quien no pisa el negocio desde hace al menos estos días. */
  inactiveDays: z.coerce.number().int().min(1).max(3650).optional(),
  /** Solo quien tiene alguna cita por delante. */
  withUpcoming: z.coerce.boolean().optional(),
  /** Solo quien debe sesiones. */
  withDebt: z.coerce.boolean().optional(),
  sort: customerSortSchema.default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

/** Cifras de una persona en este negocio. Todas salen de consultas, no de contadores. */
export const customerStatsSchema = z.object({
  /** Citas que no son `hold` ni cancelaciones: lo que de verdad ocupó agenda. */
  appointments: z.number().int(),
  completed: z.number().int(),
  cancelled: z.number().int(),
  noShows: z.number().int(),
  upcoming: z.number().int(),
  firstVisitAt: z.string().nullable(),
  lastVisitAt: z.string().nullable(),
  nextAppointmentAt: z.string().nullable(),
  /** Suma de los pagos cobrados, descontando devoluciones. */
  spendCents: z.number().int(),
  currency: z.string(),
  /** Sesiones de bono disponibles ahora mismo. */
  creditBalance: z.number().int(),
  /** Sesiones pendientes de pagar. */
  creditDebt: z.number().int(),
});
export type CustomerStats = z.infer<typeof customerStatsSchema>;

export const customerSummarySchema = z.object({
  id: idSchema,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  imageUrl: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
  tags: z.array(z.string()),
  hasNotes: z.boolean(),
  stats: customerStatsSchema,
});
export type CustomerSummary = z.infer<typeof customerSummarySchema>;

export const customerListSchema = z.object({
  items: z.array(customerSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

/** Cita tal y como se enseña en la ficha: lo justo para reconocerla. */
export const customerAppointmentSchema = z.object({
  id: idSchema,
  startsAt: z.string(),
  serviceName: z.string(),
  resourceName: z.string().nullable(),
  status: z.string(),
  priceCents: z.number().int(),
  paymentStatus: z.string(),
});

export const customerWalletSchema = z.object({
  id: idSchema,
  packName: z.string(),
  remaining: z.number().int(),
  total: z.number().int(),
  expiresAt: z.string().nullable(),
});

export const customerDetailSchema = customerSummarySchema.extend({
  nif: z.string().nullable(),
  locale: z.string(),
  notes: z.string().nullable(),
  marketingOptIn: z.boolean(),
  customerSince: z.string().nullable(),
  appointments: z.array(customerAppointmentSchema),
  wallets: z.array(customerWalletSchema),
  reviews: z.array(
    z.object({
      id: idSchema,
      rating: z.number().int(),
      comment: z.string().nullable(),
      serviceName: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type CustomerDetail = z.infer<typeof customerDetailSchema>;

export const updateCustomerProfileSchema = z.object({
  notes: z.string().max(4000).nullish(),
  tags: z.array(customerTagSchema).max(20).optional(),
});
export type UpdateCustomerProfileInput = z.infer<typeof updateCustomerProfileSchema>;
