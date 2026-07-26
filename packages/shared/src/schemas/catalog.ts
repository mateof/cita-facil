import { z } from 'zod';
import {
  ALLOCATION_STRATEGIES,
  DURATION_MODES,
  EXCEPTION_TYPES,
  PRICE_MODES,
  RESOURCE_TYPES,
  WEEKDAYS,
} from '../enums.js';
import {
  colorSchema,
  currencySchema,
  emailSchema,
  i18nTextSchema,
  idSchema,
  isoDateSchema,
  localeSchema,
  minuteOfDaySchema,
  moneySchema,
  phoneSchema,
  slugSchema,
  timezoneSchema,
} from './common.js';

/* -------------------------------------------------------------------------- */
/* Organización                                                               */
/* -------------------------------------------------------------------------- */

export const organizationSettingsSchema = z
  .object({
    /** Minutos que se mantiene bloqueado un hueco mientras el cliente reserva. */
    holdMinutes: z.number().int().min(1).max(60).default(10),
    /** Permite reservar sin cuenta, dejando nombre, email y teléfono. */
    allowGuestBooking: z.boolean().default(false),
    /** Exige verificar el email antes de poder reservar. */
    requireVerifiedEmail: z.boolean().default(true),
    /** Máximo de citas futuras simultáneas por cliente (0 = sin límite). */
    maxActiveAppointmentsPerCustomer: z.number().int().min(0).max(500).default(0),
    /** Nº de faltas sin avisar tras el que se bloquea la reserva online. */
    noShowBlockThreshold: z.number().int().min(0).max(50).default(0),
    /** Estrategia por defecto de asignación de recurso. */
    allocationStrategy: z.enum(ALLOCATION_STRATEGIES).default('least_gap'),
    /** Rejilla de la agenda pública, en minutos. */
    slotGranularityMinutes: z.number().int().min(5).max(120).default(15),
    /** Página pública de reservas activa. */
    publicBookingEnabled: z.boolean().default(true),
    /** Mostrar el nombre del profesional en la agenda pública. */
    showResourceNames: z.boolean().default(true),
    /** Pedir valoración tras completar la cita. */
    reviewsEnabled: z.boolean().default(true),
    /** Lista de espera activa. */
    waitlistEnabled: z.boolean().default(true),
    /** Minutos de validez de una oferta de lista de espera. */
    waitlistOfferMinutes: z.number().int().min(5).max(1440).default(60),
    /** Tolerancia, en minutos, del control de acceso antes y después de la cita. */
    accessGraceBeforeMinutes: z.number().int().min(0).max(720).default(15),
    accessGraceAfterMinutes: z.number().int().min(0).max(720).default(15),
    /** Un mismo código de acceso solo se puede usar una vez. */
    accessSingleUse: z.boolean().default(false),
    /** Marca automáticamente como falta las citas no atendidas pasados N minutos. */
    autoNoShowAfterMinutes: z.number().int().min(0).max(1440).default(0),
    brandColor: colorSchema.default('#2563eb'),
    logoUrl: z.string().url().max(500).nullable().default(null),
    termsUrl: z.string().url().max(500).nullable().default(null),
    privacyUrl: z.string().url().max(500).nullable().default(null),
  })
  .partial()
  .default({});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().min(2).max(140).trim(),
  slug: slugSchema.optional(),
  timezone: timezoneSchema.default('Europe/Madrid'),
  locale: localeSchema.default('es'),
  currency: currencySchema,
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  taxId: z.string().max(32).optional(),
  settings: organizationSettingsSchema.optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = createOrganizationSchema.partial();

/* -------------------------------------------------------------------------- */
/* Sede                                                                        */
/* -------------------------------------------------------------------------- */

export const createLocationSchema = z.object({
  name: z.string().min(2).max(140).trim(),
  slug: slugSchema.optional(),
  timezone: timezoneSchema.optional(),
  addressLine: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  region: z.string().max(100).optional(),
  country: z.string().length(2).toUpperCase().default('ES'),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  description: i18nTextSchema.optional(),
  active: z.boolean().default(true),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export const updateLocationSchema = createLocationSchema.partial();

/* -------------------------------------------------------------------------- */
/* Recurso                                                                     */
/* -------------------------------------------------------------------------- */

export const createResourceSchema = z.object({
  locationId: idSchema,
  name: z.string().min(1).max(140).trim(),
  type: z.enum(RESOURCE_TYPES).default('staff'),
  description: i18nTextSchema.optional(),
  /** Personas que pueden usar el recurso a la vez (clases, pistas compartidas). */
  capacity: z.number().int().min(1).max(1000).default(1),
  color: colorSchema.optional(),
  imageUrl: z.string().url().max(500).optional(),
  /** Usuario del personal asociado, si el recurso es una persona. */
  userId: idSchema.nullable().optional(),
  /** Se puede reservar directamente eligiéndolo. */
  bookableDirectly: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  active: z.boolean().default(true),
});
export type CreateResourceInput = z.infer<typeof createResourceSchema>;
export const updateResourceSchema = createResourceSchema.partial();

/* -------------------------------------------------------------------------- */
/* Servicio (trabajo o tarea reservable)                                       */
/* -------------------------------------------------------------------------- */

export const createServiceSchema = z
  .object({
    /** `null` significa que el servicio está disponible en todas las sedes. */
    locationId: idSchema.nullable().optional(),
    name: z.string().min(1).max(140).trim(),
    nameI18n: i18nTextSchema.optional(),
    description: i18nTextSchema.optional(),
    categoryId: idSchema.nullable().optional(),
    color: colorSchema.optional(),
    imageUrl: z.string().url().max(500).optional(),

    /* Duración */
    durationMode: z.enum(DURATION_MODES).default('fixed'),
    durationMinutes: z.number().int().min(1).max(1440),
    /** Solo con `durationMode: 'flexible'`. */
    minDurationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    maxDurationMinutes: z.number().int().min(1).max(1440).nullable().optional(),
    durationStepMinutes: z.number().int().min(1).max(240).nullable().optional(),

    /* Márgenes */
    bufferBeforeMinutes: z.number().int().min(0).max(480).default(0),
    bufferAfterMinutes: z.number().int().min(0).max(480).default(0),

    /* Precio */
    priceMode: z.enum(PRICE_MODES).default('fixed'),
    priceCents: moneySchema.default(0),
    /** Solo con `priceMode: 'per_minute'`. */
    pricePerMinuteCents: moneySchema.nullable().optional(),
    currency: currencySchema,
    /** Importe a pagar por adelantado para confirmar. 0 = no se exige. */
    depositCents: moneySchema.default(0),
    paymentRequired: z.boolean().default(false),
    /**
     * Solo se puede reservar con un bono activo que cubra este servicio. Es lo
     * habitual en gimnasios o cabinas: se compra la serie de sesiones y cada
     * reserva descuenta una.
     */
    requiresCreditPack: z.boolean().default(false),

    /* Aforo y reglas */
    capacity: z.number().int().min(1).max(1000).default(1),
    requiresApproval: z.boolean().default(false),
    minAdvanceMinutes: z.number().int().min(0).max(525_600).default(0),
    maxAdvanceDays: z.number().int().min(0).max(730).default(90),
    cancellationCutoffMinutes: z.number().int().min(0).max(525_600).default(0),
    rescheduleCutoffMinutes: z.number().int().min(0).max(525_600).default(0),
    allocationStrategy: z.enum(ALLOCATION_STRATEGIES).nullable().optional(),
    /** Recursos que pueden prestar el servicio. Vacío = todos los de la sede. */
    resourceIds: z.array(idSchema).max(500).optional(),
    /** El cliente puede elegir profesional o recurso concreto. */
    allowResourceSelection: z.boolean().default(true),
    /** Visible en la página pública de reservas. */
    publiclyBookable: z.boolean().default(true),
    /** Solo lo puede crear el personal desde el panel. */
    staffOnly: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10_000).default(0),
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.durationMode !== 'flexible') return;
    const min = value.minDurationMinutes ?? value.durationMinutes;
    const max = value.maxDurationMinutes ?? value.durationMinutes;
    if (min > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['minDurationMinutes'],
        message: 'La duración mínima no puede superar a la máxima',
      });
    }
    if (value.durationMinutes < min || value.durationMinutes > max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['durationMinutes'],
        message: 'La duración por defecto debe estar entre la mínima y la máxima',
      });
    }
  });
export type CreateServiceInput = z.infer<typeof createServiceSchema>;

/** Versión parcial para PATCH. `superRefine` se aplica de nuevo en el servicio. */
export const updateServiceSchema = createServiceSchema.innerType().partial();

export const createServiceCategorySchema = z.object({
  name: z.string().min(1).max(120),
  nameI18n: i18nTextSchema.optional(),
  color: colorSchema.optional(),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});

/* -------------------------------------------------------------------------- */
/* Horarios                                                                    */
/* -------------------------------------------------------------------------- */

export const scheduleOwnerSchema = z.enum(['location', 'resource', 'service']);

export const scheduleRuleSchema = z
  .object({
    weekday: z.union([
      z.literal(WEEKDAYS[0]),
      z.literal(WEEKDAYS[1]),
      z.literal(WEEKDAYS[2]),
      z.literal(WEEKDAYS[3]),
      z.literal(WEEKDAYS[4]),
      z.literal(WEEKDAYS[5]),
      z.literal(WEEKDAYS[6]),
    ]),
    startMinute: minuteOfDaySchema,
    endMinute: minuteOfDaySchema,
    validFrom: isoDateSchema.nullable().optional(),
    validTo: isoDateSchema.nullable().optional(),
  })
  .refine((v) => v.endMinute > v.startMinute, {
    message: 'La hora de fin debe ser posterior a la de inicio',
    path: ['endMinute'],
  });
export type ScheduleRule = z.infer<typeof scheduleRuleSchema>;

export const setScheduleSchema = z.object({
  ownerType: scheduleOwnerSchema,
  ownerId: idSchema,
  rules: z.array(scheduleRuleSchema).max(100),
});

export const scheduleExceptionSchema = z
  .object({
    ownerType: scheduleOwnerSchema,
    ownerId: idSchema,
    type: z.enum(EXCEPTION_TYPES),
    date: isoDateSchema,
    /** Requeridos si `type: 'open'`; opcionales si `type: 'closed'` (día completo). */
    startMinute: minuteOfDaySchema.nullable().optional(),
    endMinute: minuteOfDaySchema.nullable().optional(),
    reason: z.string().max(200).optional(),
  })
  .refine(
    (v) => v.type !== 'open' || (v.startMinute != null && v.endMinute != null),
    { message: 'Una apertura extraordinaria necesita hora de inicio y fin', path: ['startMinute'] },
  );
export type ScheduleExceptionInput = z.infer<typeof scheduleExceptionSchema>;

/** Cierre puntual de un recurso: vacaciones, baja, mantenimiento. */
export const createTimeOffSchema = z
  .object({
    resourceId: idSchema.nullable().optional(),
    locationId: idSchema.nullable().optional(),
    startsAt: z.string().datetime({ offset: true }),
    endsAt: z.string().datetime({ offset: true }),
    reason: z.string().max(200).optional(),
  })
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    message: 'El fin debe ser posterior al inicio',
    path: ['endsAt'],
  });
