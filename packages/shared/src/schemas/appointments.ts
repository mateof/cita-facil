import { z } from 'zod';
import { APPOINTMENT_STATUSES, BOOKING_SOURCES } from '../enums.js';
import {
  emailSchema,
  idSchema,
  isoDateSchema,
  localeSchema,
  paginationSchema,
  phoneSchema,
} from './common.js';
import { submitFormResponseSchema } from './forms.js';

/* -------------------------------------------------------------------------- */
/* Consulta de disponibilidad                                                  */
/* -------------------------------------------------------------------------- */

export const availabilityQuerySchema = z
  .object({
    serviceId: idSchema,
    locationId: idSchema.optional(),
    resourceId: idSchema.optional(),
    from: isoDateSchema,
    to: isoDateSchema.optional(),
    /** Duración pedida por el cliente en servicios de duración ajustable. */
    durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
    /**
     * Servicios que se hacen en la misma visita, uno detrás de otro. La cita
     * ocupa la suma de todos y solo se ofrecen los huecos donde cabe entera.
     * Se admite repetido en la consulta (`?additionalServiceIds=a&...=b`).
     */
    additionalServiceIds: z
      .union([idSchema, z.array(idSchema).max(5)])
      .transform((value) => (Array.isArray(value) ? value : [value]))
      .optional(),
    /** Plazas solicitadas en servicios con aforo. */
    partySize: z.coerce.number().int().min(1).max(200).default(1),
    timezone: z.string().max(64).optional(),
  })
  .refine((v) => !v.to || v.to >= v.from, {
    message: 'El rango de fechas es incorrecto',
    path: ['to'],
  });
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export const availabilitySlotSchema = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  localDate: z.string(),
  localStartMinute: z.number().int(),
  durationMinutes: z.number().int(),
  /** Recursos concretos con hueco libre en ese momento. */
  resourceIds: z.array(idSchema),
  /** Plazas libres considerando el aforo del servicio y del recurso. */
  remainingCapacity: z.number().int(),
  priceCents: z.number().int(),
  currency: z.string(),
});
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

export const availabilityResponseSchema = z.object({
  serviceId: idSchema,
  timezone: z.string(),
  durationMinutes: z.number().int(),
  days: z.array(
    z.object({
      date: isoDateSchema,
      closed: z.boolean(),
      slots: z.array(availabilitySlotSchema),
    }),
  ),
});
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;

/* -------------------------------------------------------------------------- */
/* Creación y modificación de citas                                            */
/* -------------------------------------------------------------------------- */

/** Datos de contacto cuando la reserva la hace alguien sin cuenta. */
export const guestSchema = z.object({
  name: z.string().min(2).max(120).trim(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  locale: localeSchema.optional(),
});

export const createAppointmentSchema = z.object({
  serviceId: idSchema,
  locationId: idSchema.optional(),
  resourceId: idSchema.optional(),
  startsAt: z.string().datetime({ offset: true }),
  /** Solo se admite en servicios con duración ajustable. */
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  /** Servicios adicionales de la misma visita, en el orden en que se hacen. */
  additionalServiceIds: z.array(idSchema).max(5).optional(),
  partySize: z.number().int().min(1).max(200).default(1),
  notes: z.string().max(2000).optional(),
  /** Campos adicionales definidos por la organización. */
  customFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /**
   * Respuestas de los formularios que pide el servicio. Van con la reserva y
   * no después para que no exista una cita sin el consentimiento que exigía.
   */
  formResponses: z.array(submitFormResponseSchema).max(10).optional(),
  /** Solo el personal puede reservar en nombre de otro cliente. */
  customerId: idSchema.optional(),
  guest: guestSchema.optional(),
  /** Identificador del hold obtenido en `POST /appointments/hold`. */
  holdId: idSchema.optional(),
  source: z.enum(BOOKING_SOURCES).optional(),
  /** Evita duplicados si el cliente reintenta la petición. */
  idempotencyKey: z.string().max(120).optional(),
});
export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

export const holdAppointmentSchema = createAppointmentSchema.pick({
  serviceId: true,
  locationId: true,
  resourceId: true,
  startsAt: true,
  durationMinutes: true,
  partySize: true,
});

export const rescheduleAppointmentSchema = z.object({
  startsAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  resourceId: idSchema.optional(),
  reason: z.string().max(500).optional(),
  notifyCustomer: z.boolean().default(true),
});

export const cancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional(),
  notifyCustomer: z.boolean().default(true),
  /** Solicita la devolución del pago asociado, si lo hubiera. */
  refund: z.boolean().default(false),
});

export const updateAppointmentSchema = z.object({
  status: z.enum(APPOINTMENT_STATUSES).optional(),
  notes: z.string().max(2000).optional(),
  internalNotes: z.string().max(2000).optional(),
  resourceId: idSchema.nullable().optional(),
  partySize: z.number().int().min(1).max(200).optional(),
  priceCents: z.number().int().min(0).optional(),
});

export const listAppointmentsSchema = paginationSchema.extend({
  from: z.string().optional(),
  to: z.string().optional(),
  status: z
    .union([z.enum(APPOINTMENT_STATUSES), z.array(z.enum(APPOINTMENT_STATUSES))])
    .optional(),
  locationId: idSchema.optional(),
  resourceId: idSchema.optional(),
  serviceId: idSchema.optional(),
  customerId: idSchema.optional(),
  search: z.string().max(120).optional(),
  /** Vista de agenda del día, ordenada por hora. */
  view: z.enum(['list', 'day', 'week', 'month']).default('list'),
  sort: z.enum(['startsAt', '-startsAt', 'createdAt', '-createdAt']).default('startsAt'),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsSchema>;

/* -------------------------------------------------------------------------- */
/* Citas recurrentes                                                           */
/* -------------------------------------------------------------------------- */

export const recurrenceSchema = z
  .object({
    /** Cada cuántas semanas se repite. */
    intervalWeeks: z.number().int().min(1).max(52).default(1),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    /** Fin por fecha o por número de repeticiones; hay que indicar uno. */
    until: isoDateSchema.nullable().optional(),
    count: z.number().int().min(1).max(200).nullable().optional(),
    /** Qué hacer si alguna repetición cae en un hueco ocupado. */
    onConflict: z.enum(['skip', 'fail']).default('skip'),
  })
  .refine((v) => v.until != null || v.count != null, {
    message: 'Indica una fecha final o un número de repeticiones',
    path: ['until'],
  });

export const createRecurringAppointmentSchema = createAppointmentSchema.extend({
  recurrence: recurrenceSchema,
});

/* -------------------------------------------------------------------------- */
/* Lista de espera                                                             */
/* -------------------------------------------------------------------------- */

export const joinWaitlistSchema = z.object({
  serviceId: idSchema,
  locationId: idSchema.optional(),
  resourceId: idSchema.optional(),
  /** Rango de fechas aceptable. */
  fromDate: isoDateSchema,
  toDate: isoDateSchema,
  /** Franjas horarias aceptables por día, en minutos desde medianoche. */
  earliestMinute: z.number().int().min(0).max(1440).default(0),
  latestMinute: z.number().int().min(0).max(1440).default(1440),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).optional(),
  partySize: z.number().int().min(1).max(200).default(1),
  notes: z.string().max(500).optional(),
});

/* -------------------------------------------------------------------------- */
/* Control de acceso                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Validación de acceso para integraciones físicas (puertas, tornos, lectores).
 * Se puede identificar por código de acceso, por cita, o por documento del
 * usuario. Devuelve siempre 200 con un veredicto explícito para que el
 * dispositivo no tenga que interpretar códigos de error HTTP.
 */
export const accessValidateSchema = z
  .object({
    /** Código impreso o del QR de la cita. */
    accessCode: z.string().min(4).max(120).optional(),
    appointmentId: idSchema.optional(),
    /** DNI/NIE del usuario, si el lector es un lector de documento. */
    nif: z.string().min(5).max(20).optional(),
    userId: idSchema.optional(),
    locationId: idSchema.optional(),
    resourceId: idSchema.optional(),
    /** Momento de la comprobación. Por defecto, ahora. */
    at: z.string().datetime({ offset: true }).optional(),
    /** Identificador del dispositivo lector, para la traza. */
    deviceId: z.string().max(120).optional(),
    /** Si es `true`, marca la cita como `checked_in` cuando el acceso se concede. */
    checkIn: z.boolean().default(true),
  })
  .refine((v) => v.accessCode || v.appointmentId || v.nif || v.userId, {
    message: 'Indica al menos accessCode, appointmentId, nif o userId',
  });
export type AccessValidateInput = z.infer<typeof accessValidateSchema>;

export const accessValidateResponseSchema = z.object({
  granted: z.boolean(),
  result: z.string(),
  reason: z.string(),
  checkedInAt: z.string().nullable(),
  appointment: z
    .object({
      id: idSchema,
      startsAt: z.string(),
      endsAt: z.string(),
      status: z.enum(APPOINTMENT_STATUSES),
      serviceName: z.string(),
      locationId: idSchema,
      locationName: z.string(),
      resourceId: idSchema.nullable(),
      resourceName: z.string().nullable(),
      customerName: z.string(),
      partySize: z.number().int(),
    })
    .nullable(),
});
export type AccessValidateResponse = z.infer<typeof accessValidateResponseSchema>;
