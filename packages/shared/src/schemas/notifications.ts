import { z } from 'zod';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS } from '../enums.js';
import { idSchema, localeSchema } from './common.js';

export const channelSchema = z.enum(NOTIFICATION_CHANNELS);
export const eventSchema = z.enum(NOTIFICATION_EVENTS);

/**
 * Preferencias de notificación. Existen en tres niveles y se resuelven en
 * cascada: valores por defecto del sistema, ajustes de la organización y
 * ajustes del usuario. El nivel más específico gana.
 */
export const notificationPreferenceSchema = z.object({
  event: eventSchema,
  channel: channelSchema,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const updateNotificationPreferencesSchema = z.object({
  preferences: z.array(notificationPreferenceSchema).max(200),
  /** No molestar: franja en la que no se envían avisos no urgentes. */
  quietHoursStart: z.number().int().min(0).max(1440).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(1440).nullable().optional(),
});

/**
 * Regla de recordatorio. `offsetMinutes` son los minutos ANTES del inicio de la
 * cita: 1440 = un día antes, 60 = una hora antes. El usuario puede crear las
 * suyas propias con cualquier valor.
 */
export const reminderRuleSchema = z.object({
  offsetMinutes: z.number().int().min(0).max(43_200),
  channels: z.array(channelSchema).min(1).max(6),
  enabled: z.boolean().default(true),
  /** Restringe la regla a un servicio concreto. */
  serviceId: idSchema.nullable().optional(),
});
export type ReminderRule = z.infer<typeof reminderRuleSchema>;

export const setReminderRulesSchema = z.object({
  rules: z.array(reminderRuleSchema).max(20),
});

/** Valores por defecto: un día antes y una hora antes, por email. */
export const DEFAULT_REMINDER_RULES: ReminderRule[] = [
  { offsetMinutes: 1440, channels: ['email'], enabled: true },
  { offsetMinutes: 60, channels: ['email', 'push'], enabled: true },
];

export const notificationTemplateSchema = z.object({
  event: eventSchema,
  channel: channelSchema,
  locale: localeSchema,
  subject: z.string().max(200).nullable().optional(),
  body: z.string().max(20_000),
  enabled: z.boolean().default(true),
});
export type NotificationTemplateInput = z.infer<typeof notificationTemplateSchema>;

export const registerPushDeviceSchema = z.object({
  provider: z.enum(['fcm', 'webpush']),
  /** Token de FCM o `endpoint` de Web Push. */
  token: z.string().min(10).max(2000),
  /** Claves de Web Push (`p256dh` y `auth`). */
  keys: z.object({ p256dh: z.string(), auth: z.string() }).optional(),
  deviceName: z.string().max(120).optional(),
  locale: localeSchema.optional(),
});

export const linkTelegramSchema = z.object({
  /** Código de un solo uso que el usuario envía al bot. */
  code: z.string().min(6).max(32),
});

export const linkWhatsappSchema = z.object({
  phone: z.string().min(6).max(24),
});

export const sendTestNotificationSchema = z.object({
  channel: channelSchema,
  event: eventSchema.default('appointment.reminder'),
  locale: localeSchema.optional(),
});

/** Difusión manual desde el panel a un conjunto de clientes. */
export const broadcastSchema = z.object({
  channels: z.array(channelSchema).min(1),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(10_000),
  audience: z.enum(['all_customers', 'upcoming_appointments', 'location', 'service']),
  locationId: idSchema.optional(),
  serviceId: idSchema.optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
});
