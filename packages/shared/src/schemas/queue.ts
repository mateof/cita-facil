import { z } from 'zod';
import { idSchema, phoneSchema } from './common.js';

/**
 * Cola sin cita previa.
 *
 * Un turno no es una cita: no ocupa hueco ni bloquea la agenda hasta que
 * alguien lo llama. Lo que se guarda es el orden de llegada, y lo que se
 * calcula es cuánto le queda a cada uno.
 */

export const QUEUE_STATUSES = ['waiting', 'called', 'serving', 'done', 'left'] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const joinQueueSchema = z.object({
  locationId: idSchema.optional(),
  serviceId: idSchema.optional(),
  /** Profesional pedido, si pide uno concreto. */
  resourceId: idSchema.optional(),
  /** Solo el personal puede apuntar a una persona con cuenta. */
  customerId: idSchema.optional(),
  name: z.string().min(2).max(120).trim().optional(),
  phone: phoneSchema.optional(),
  partySize: z.number().int().min(1).max(50).default(1),
  note: z.string().max(500).optional(),
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

export const updateQueueEntrySchema = z.object({
  status: z.enum(QUEUE_STATUSES),
  /** Deja constancia del turno atendido como cita, para el histórico. */
  recordAppointment: z.boolean().default(false),
});

export const queueEntrySchema = z.object({
  id: idSchema,
  ticketNumber: z.number().int(),
  status: z.enum(QUEUE_STATUSES),
  name: z.string(),
  phone: z.string().nullable(),
  serviceId: idSchema.nullable(),
  serviceName: z.string().nullable(),
  resourceId: idSchema.nullable(),
  resourceName: z.string().nullable(),
  partySize: z.number().int(),
  note: z.string().nullable(),
  source: z.string(),
  /** Cuántos hay delante esperando. Cero es "el siguiente". */
  ahead: z.number().int(),
  /** Minutos estimados de espera, calculados sobre la cola de delante. */
  estimatedWaitMinutes: z.number().int(),
  joinedAt: z.string(),
  calledAt: z.string().nullable(),
  servedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;

export const queueViewSchema = z.object({
  date: z.string(),
  locationId: idSchema,
  waiting: z.array(queueEntrySchema),
  called: z.array(queueEntrySchema),
  serving: z.array(queueEntrySchema),
  /** Atendidos y ausencias del día, para poder repescar a alguien. */
  closed: z.array(queueEntrySchema),
});
export type QueueView = z.infer<typeof queueViewSchema>;

/** Lo que ve el cliente al consultar su turno: nada de los demás. */
export const queueTicketSchema = z.object({
  ticketNumber: z.number().int(),
  status: z.enum(QUEUE_STATUSES),
  ahead: z.number().int(),
  estimatedWaitMinutes: z.number().int(),
  organizationName: z.string(),
  locationName: z.string(),
});
