import type { Locale } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { isoNow } from '../../lib/dates.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { notify } from '../notifications/service.js';
import { organizationSettings } from '../availability/engine.js';
import { recordAudit } from '../audit/service.js';
import { effectiveRules, isInherited } from './rules.js';
import { appointmentVars } from './reminders.js';
import { findByAccessCode, requireAppointmentDetail, type AppointmentDetail } from './queries.js';

/**
 * Confirmación de asistencia y cargo por falta.
 *
 * El recordatorio lleva dos enlaces: "voy" y "no puedo ir". El primero le
 * ahorra al mostrador la llamada de comprobación; el segundo libera el hueco a
 * tiempo, que es lo que de verdad recupera el dinero perdido, porque la
 * cancelación se lo ofrece a la lista de espera.
 *
 * Avisar siempre se puede, incluso fuera del plazo de cancelación. Cerrar esa
 * puerta empuja a no avisar, y una cita a la que nadie viene es peor para el
 * negocio que una cancelación tardía. Lo que sí cambia es el cargo: fuera de
 * plazo se cobra igual que una falta.
 *
 * El cargo se anota, no se cobra solo. La aplicación no guarda tarjetas, así
 * que cobrar sin nadie delante no es posible: lo que hay es una cantidad
 * pendiente en la cita, visible en el panel y en la ficha del cliente, y un
 * aviso a quien faltó.
 */

/** Los enlaces del recordatorio, que funcionan sin sesión iniciada. */
export function attendanceLinks(appointment: AppointmentDetail): {
  confirmar: string;
  cancelar: string;
} {
  const base = `${env.APP_URL}/consultar?c=${appointment.accessCode}`;
  return { confirmar: `${base}&accion=confirmar`, cancelar: `${base}&accion=cancelar` };
}

/**
 * Bloque de acciones que se añade al recordatorio.
 *
 * Va en el texto y no en la plantilla porque depende de un ajuste: si el
 * negocio no pide confirmación, el recordatorio no debe invitar a nada.
 */
export function attendanceActionsText(
  appointment: AppointmentDetail,
  locale: string,
): string {
  const { confirmar, cancelar } = attendanceLinks(appointment);
  const textos = {
    es: `Confirma que vas a ir: ${confirmar}\nSi no puedes acudir, avísanos: ${cancelar}`,
    gl: `Confirma que vas ir: ${confirmar}\nSe non podes acudir, avísanos: ${cancelar}`,
    en: `Confirm you are coming: ${confirmar}\nIf you cannot make it, let us know: ${cancelar}`,
  };
  return textos[locale.slice(0, 2) as keyof typeof textos] ?? textos.es;
}

async function requireOpenAppointment(code: string): Promise<AppointmentDetail> {
  const appointment = await findByAccessCode(code);
  if (!appointment) throw new NotFoundError('No hay ninguna cita con ese código');
  if (!['pending', 'confirmed'].includes(appointment.status)) {
    throw new ConflictError('Esta cita ya está cerrada', 'appointment_closed');
  }
  return appointment;
}

/** "Voy a ir". No cambia el estado: una cita confirmada ya lo estaba. */
export async function confirmAttendance(
  code: string,
  actor: { ip?: string | null; userAgent?: string | null } = {},
): Promise<AppointmentDetail> {
  const appointment = await requireOpenAppointment(code);

  await db()
    .updateTable('appointments')
    .set({ attendance_confirmed_at: isoNow(), updated_at: isoNow() })
    .where('id', '=', appointment.id)
    .execute();

  await recordAudit({
    organizationId: appointment.organizationId,
    actorId: appointment.customerId,
    actorType: 'customer',
    action: 'appointment.attendance_confirmed',
    entityType: 'appointment',
    entityId: appointment.id,
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });

  return requireAppointmentDetail(appointment.id);
}

/**
 * "No puedo ir". Cancela la cita aunque el plazo ya haya pasado, y en ese caso
 * aplica el cargo por falta si el negocio tiene uno.
 */
export async function declineAttendance(
  code: string,
  options: { reason?: string; ip?: string | null; userAgent?: string | null } = {},
): Promise<{ appointment: AppointmentDetail; late: boolean; feeCents: number }> {
  const appointment = await requireOpenAppointment(code);
  const late = await isLateNotice(appointment);

  const { cancelAppointment } = await import('./service.js');
  const cancelled = await cancelAppointment(appointment.id, {
    reason: options.reason ?? 'El cliente avisó de que no podía acudir',
    notifyCustomer: true,
    actor: { isStaff: false, ip: options.ip, userAgent: options.userAgent },
    // Avisar siempre se puede: el plazo decide si se cobra, no si se admite.
    ignoreCutoff: true,
  });

  const feeCents = late ? await applyNoShowFee(cancelled, 'late_cancellation') : 0;

  return { appointment: await requireAppointmentDetail(appointment.id), late, feeCents };
}

/** ¿El aviso llega fuera del plazo de cancelación que rige esa cita? */
export async function isLateNotice(appointment: AppointmentDetail): Promise<boolean> {
  const service = await db()
    .selectFrom('services')
    .select(['min_advance_minutes', 'cancellation_cutoff_minutes', 'credit_charge_mode'])
    .where('id', '=', appointment.serviceId)
    .executeTakeFirst();
  if (!service) return false;

  const settings = await organizationSettings(appointment.organizationId);
  const cutoff = effectiveRules(service, settings as never).cancellationCutoffMinutes;
  if (cutoff <= 0) return false;

  return (Date.parse(appointment.startsAt) - Date.now()) / 60_000 < cutoff;
}

/**
 * Cargo que le corresponde a esta cita: el del servicio, y si el servicio
 * hereda, el de la organización. Cero es una decisión válida del servicio y se
 * respeta aunque su organización cobre.
 */
export async function noShowFeeFor(appointment: AppointmentDetail): Promise<number> {
  const service = await db()
    .selectFrom('services')
    .select(['no_show_fee_cents'])
    .where('id', '=', appointment.serviceId)
    .executeTakeFirst();

  if (service && !isInherited(service.no_show_fee_cents)) return service.no_show_fee_cents;

  const settings = (await organizationSettings(appointment.organizationId)) as {
    noShowFeeCents?: number;
  };
  return settings.noShowFeeCents ?? 0;
}

/**
 * Anota el cargo en la cita y avisa a quien lo debe.
 *
 * Si la cita ya estaba cobrada no se anota nada: la señal que se pagó por
 * adelantado es justamente lo que cubre la falta, y sumar un cargo encima
 * cobraría dos veces por el mismo hueco.
 */
export async function applyNoShowFee(
  appointment: AppointmentDetail,
  reason: 'no_show' | 'late_cancellation',
): Promise<number> {
  if (appointment.paymentStatus === 'paid') return 0;
  if (appointment.creditWalletId) return 0;

  const feeCents = await noShowFeeFor(appointment);
  if (feeCents <= 0) return 0;

  await db()
    .updateTable('appointments')
    .set({ no_show_fee_cents: feeCents, payment_status: 'pending', updated_at: isoNow() })
    .where('id', '=', appointment.id)
    .execute();

  const updated = await requireAppointmentDetail(appointment.id);
  const importe = new Intl.NumberFormat(
    updated.locale === 'gl' ? 'gl-ES' : updated.locale === 'en' ? 'en-GB' : 'es-ES',
    { style: 'currency', currency: updated.currency },
  ).format(feeCents / 100);

  await notify({
    event: 'appointment.fee_charged',
    userId: updated.customerId,
    organizationId: updated.organizationId,
    appointmentId: updated.id,
    locale: updated.locale as Locale,
    to: { email: updated.customerEmail, phone: updated.customerPhone },
    vars: appointmentVars(updated, { importe, motivo: reason }),
  });

  await recordAudit({
    organizationId: updated.organizationId,
    actorId: null,
    actorType: 'system',
    action: 'appointment.fee_charged',
    entityType: 'appointment',
    entityId: updated.id,
    changes: { feeCents, reason },
  });

  return feeCents;
}
