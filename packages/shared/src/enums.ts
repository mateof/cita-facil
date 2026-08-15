/**
 * Enumerados del dominio.
 *
 * Se declaran como objetos `as const` en lugar de `enum` de TypeScript para que
 * el paquete pueda consumirse igual desde el backend (Node) que desde el
 * navegador sin necesidad de transpilación adicional, y para que los valores
 * viajen tal cual a la base de datos y a la API.
 */

export const LOCALES = ['es', 'gl', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'es';

/** Roles dentro de una organización, de mayor a menor privilegio. */
export const ORG_ROLES = ['owner', 'admin', 'manager', 'staff'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Rol global de la instalación. `superadmin` administra todas las organizaciones. */
export const PLATFORM_ROLES = ['superadmin', 'user'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const USER_STATUSES = ['active', 'pending', 'blocked', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Proveedores de identidad soportados. */
export const IDENTITY_PROVIDERS = [
  'password',
  'passkey',
  'certificate',
  'oidc',
  'clave',
  'google',
  'microsoft',
] as const;
export type IdentityProvider = (typeof IDENTITY_PROVIDERS)[number];

/** Segundos factores soportados. */
export const MFA_METHODS = ['totp', 'email', 'webauthn', 'recovery_code'] as const;
export type MfaMethod = (typeof MFA_METHODS)[number];

/** Tipos de recurso reservable. Es una taxonomía orientativa: el sistema es genérico. */
export const RESOURCE_TYPES = [
  'staff', // peluquero, fisioterapeuta, monitor
  'room', // sala, box, cabina
  'seat', // silla, puesto
  'court', // pista deportiva
  'lane', // calle de piscina
  'equipment', // máquina, bicicleta, tabla
  'table', // mesa
  'vehicle',
  'other',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * Modo de duración de un servicio.
 * - `fixed`: la duración la fija el administrador y el usuario no puede tocarla.
 * - `flexible`: el administrador activa el botón de duración ajustable y el
 *   usuario elige cuánto tiempo quiere estar, dentro de [min, max] y en
 *   múltiplos de `durationStepMinutes`.
 */
export const DURATION_MODES = ['fixed', 'flexible'] as const;
export type DurationMode = (typeof DURATION_MODES)[number];

/** Cómo se calcula el precio de una cita. */
export const PRICE_MODES = ['free', 'fixed', 'per_minute', 'per_person'] as const;
export type PriceMode = (typeof PRICE_MODES)[number];

/** Estrategia de asignación automática de recurso cuando el usuario no elige uno. */
export const ALLOCATION_STRATEGIES = [
  'least_gap', // minimiza huecos muertos en la agenda
  'least_busy', // reparte carga
  'round_robin',
  'first_available',
] as const;
export type AllocationStrategy = (typeof ALLOCATION_STRATEGIES)[number];

/** Ciclo de vida de una cita. */
export const APPOINTMENT_STATUSES = [
  'hold', // reserva temporal mientras el usuario completa el proceso
  'pending', // requiere aprobación del establecimiento
  'confirmed',
  'checked_in', // el cliente ha llegado / ha pasado el control de acceso
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
  'rejected',
  'expired', // hold caducado
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Estados en los que la cita ocupa agenda y bloquea disponibilidad. */
export const BLOCKING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'hold',
  'pending',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
];

/** Estados terminales: no admiten transición. */
export const TERMINAL_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'completed',
  'cancelled',
  'no_show',
  'rejected',
  'expired',
];

/** Origen de la reserva, útil para analítica y para trazabilidad. */
export const BOOKING_SOURCES = [
  'web',
  'admin',
  'api',
  'alexa',
  'google_assistant',
  'mcp',
  'phone',
  'walk_in',
  'recurrence',
  'waitlist',
] as const;
export type BookingSource = (typeof BOOKING_SOURCES)[number];

/** Quién cancela una cita. */
export const CANCELLED_BY = ['customer', 'staff', 'system'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

/** Tipos de bloqueo/excepción de calendario. */
export const EXCEPTION_TYPES = ['closed', 'open'] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

/** Canales de notificación. */
export const NOTIFICATION_CHANNELS = [
  'email',
  'push', // Firebase Cloud Messaging / Web Push
  'telegram',
  'whatsapp',
  'sms',
  'webhook',
  'inapp',
] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** Eventos que disparan notificaciones. Cada uno tiene plantilla por canal e idioma. */
export const NOTIFICATION_EVENTS = [
  'appointment.created',
  'appointment.confirmed',
  'appointment.rescheduled',
  'appointment.cancelled',
  'appointment.reminder',
  'appointment.receipt', // resguardo de cita
  'appointment.followup', // encuesta / valoración posterior
  'appointment.no_show',
  'appointment.approval_required',
  'waitlist.slot_available',
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
  'auth.verify_email',
  'auth.reset_password',
  'auth.activate_account',
  'auth.mfa_code',
  'auth.new_device',
  'account.welcome',
  'credit.granted', // bono emitido o comprado
  'backup.failed',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_STATUSES = [
  'scheduled',
  'queued',
  'sending',
  'sent',
  'failed',
  'cancelled',
  'skipped',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Pasarelas de pago con adaptador incluido. */
export const PAYMENT_PROVIDERS = ['stripe', 'redsys', 'manual', 'credit_pack'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = [
  'not_required',
  'pending',
  'authorized',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
  'cancelled',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Motores de base de datos soportados. */
export const DB_CLIENTS = ['sqlite', 'postgres', 'mysql', 'mariadb', 'mssql'] as const;
export type DbClient = (typeof DB_CLIENTS)[number];

/** Resultado de la validación de acceso (puertas, tornos, control físico). */
export const ACCESS_RESULTS = [
  'granted',
  'denied_not_found',
  'denied_wrong_time',
  'denied_wrong_location',
  'denied_status',
  'denied_already_used',
  'denied_unpaid',
] as const;
export type AccessResult = (typeof ACCESS_RESULTS)[number];

export const WAITLIST_STATUSES = ['waiting', 'offered', 'converted', 'expired', 'cancelled'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

/** Días de la semana en notación ISO: 1 = lunes ... 7 = domingo. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Cuándo se descuenta la sesión del bono.
 *
 * `booking` es lo que se ha hecho siempre: la plaza se ocupa al reservar y la
 * sesión también. `completion` la cobra al dar la cita por hecha, que encaja
 * cuando el servicio a veces no se llega a prestar.
 */
export const CREDIT_CHARGE_MODES = ['booking', 'completion'] as const;
export type CreditChargeMode = (typeof CREDIT_CHARGE_MODES)[number];

/** Lo mismo, más la opción de seguir lo que diga la organización. */
export const SERVICE_CREDIT_CHARGE_MODES = ['inherit', 'booking', 'completion'] as const;
export type ServiceCreditChargeMode = (typeof SERVICE_CREDIT_CHARGE_MODES)[number];

/** Qué hacer cuando una programación semanal no encuentra hueco. */
export const SCHEDULE_CONFLICT_MODES = ['skip', 'nearest', 'force'] as const;
export type ScheduleConflictMode = (typeof SCHEDULE_CONFLICT_MODES)[number];
