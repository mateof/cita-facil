import type { Locale, NotificationChannel } from '@cita-facil/shared';
import { DEFAULT_REMINDER_RULES } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { formatForHumans, isoNow } from '../../lib/dates.js';
import { cancelGroup, notify } from '../notifications/service.js';
import { organizationSettings } from '../availability/engine.js';
import type { AppointmentDetail } from './queries.js';

/**
 * Recordatorios de cita.
 *
 * Las reglas se resuelven en cascada: las del usuario mandan sobre las de la
 * organización, y si no hay ninguna se usan las de fábrica (un día antes y una
 * hora antes). Cada regla es un desfase en minutos respecto al inicio de la
 * cita, así que "cuando el usuario quiera" no necesita ningún caso especial:
 * 1440 es un día, 60 es una hora y 15 son quince minutos.
 */

export interface ResolvedReminderRule {
  offsetMinutes: number;
  channels: NotificationChannel[];
}

export async function reminderRulesFor(params: {
  organizationId: string;
  userId?: string | null;
  serviceId?: string | null;
}): Promise<ResolvedReminderRule[]> {
  const rows = await db()
    .selectFrom('reminder_rules')
    .selectAll()
    .where('enabled', '=', 1)
    .where((eb) =>
      eb.or([
        eb('organization_id', '=', params.organizationId),
        params.userId ? eb('user_id', '=', params.userId) : eb('user_id', 'is', null),
      ]),
    )
    .execute();

  const applicable = rows.filter(
    (row) => !row.service_id || row.service_id === params.serviceId,
  );

  const userRules = applicable.filter((row) => row.user_id === params.userId && params.userId);
  const orgRules = applicable.filter((row) => row.organization_id && !row.user_id);
  const chosen = userRules.length > 0 ? userRules : orgRules;

  if (chosen.length === 0) {
    return DEFAULT_REMINDER_RULES.filter((rule) => rule.enabled).map((rule) => ({
      offsetMinutes: rule.offsetMinutes,
      channels: rule.channels,
    }));
  }

  return chosen.map((row) => ({
    offsetMinutes: row.offset_minutes,
    channels: JSON.parse(row.channels_json) as NotificationChannel[],
  }));
}

export function reminderGroupKey(appointmentId: string): string {
  return `reminder:${appointmentId}`;
}

/**
 * Programa los recordatorios de una cita. Los que caerían en el pasado se
 * descartan: si alguien reserva para dentro de media hora no tiene sentido
 * mandarle el aviso "de un día antes".
 */
export async function scheduleReminders(appointment: AppointmentDetail): Promise<number> {
  await cancelGroup(reminderGroupKey(appointment.id));

  if (!['confirmed', 'pending'].includes(appointment.status)) return 0;

  const rules = await reminderRulesFor({
    organizationId: appointment.organizationId,
    userId: appointment.customerId,
    serviceId: appointment.serviceId,
  });

  /*
   * Los enlaces de "voy" y "no puedo ir" solo se ofrecen si el negocio pide
   * confirmación. Si no, el recordatorio no debe invitar a nada, así que la
   * variable viaja vacía y la plantilla no enseña esa línea.
   */
  const settings = (await organizationSettings(appointment.organizationId)) as {
    attendanceConfirmationEnabled?: boolean;
  };
  const { attendanceActionsText } = await import('./attendance.js');
  const acciones = settings.attendanceConfirmationEnabled
    ? attendanceActionsText(appointment, appointment.locale)
    : '';

  const startsAt = Date.parse(appointment.startsAt);
  const now = Date.now();
  let scheduled = 0;

  for (const rule of rules) {
    const when = startsAt - rule.offsetMinutes * 60_000;
    if (when <= now) continue;

    await notify({
      event: 'appointment.reminder',
      userId: appointment.customerId,
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      locale: appointment.locale as Locale,
      channels: rule.channels,
      to: { email: appointment.customerEmail, phone: appointment.customerPhone },
      scheduledAt: new Date(when).toISOString(),
      groupKey: reminderGroupKey(appointment.id),
      vars: appointmentVars(appointment, { acciones }),
    });
    scheduled += 1;
  }

  await db()
    .updateTable('appointments')
    .set({ reminder_scheduled_at: isoNow() })
    .where('id', '=', appointment.id)
    .execute();

  logger.debug({ appointmentId: appointment.id, scheduled }, 'Recordatorios programados');
  return scheduled;
}

export async function cancelReminders(appointmentId: string): Promise<void> {
  await cancelGroup(reminderGroupKey(appointmentId));
}

/** Variables comunes a todas las plantillas relacionadas con una cita. */
export function appointmentVars(
  appointment: AppointmentDetail,
  extra: Record<string, string | number | null> = {},
): Record<string, string | number | null> {
  const locale = appointment.locale;
  return {
    usuario: appointment.customerName,
    cliente: appointment.customerName,
    organizacion: appointment.organizationName,
    servicio: appointment.serviceName,
    sede: appointment.locationName,
    profesional: appointment.resourceName ?? '',
    fecha: formatForHumans(appointment.startsAt, appointment.timezone, locale, 'date'),
    hora: formatForHumans(appointment.startsAt, appointment.timezone, locale, 'time'),
    fechaHora: formatForHumans(appointment.startsAt, appointment.timezone, locale, 'full'),
    duracion: appointment.durationMinutes,
    precio:
      appointment.priceCents > 0
        ? new Intl.NumberFormat(locale === 'gl' ? 'gl-ES' : locale === 'en' ? 'en-GB' : 'es-ES', {
            style: 'currency',
            currency: appointment.currency,
          }).format(appointment.priceCents / 100)
        : '',
    codigo: appointment.accessCode,
    // Solo el recordatorio la rellena; en el resto de avisos queda vacía.
    acciones: '',
    enlace: `${env.APP_URL}/citas/${appointment.id}?c=${appointment.accessCode}`,
    ...extra,
  };
}
