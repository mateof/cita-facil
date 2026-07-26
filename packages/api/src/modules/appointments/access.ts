import type { AccessResult, AccessValidateInput } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { sign, verifySignature } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { organizationSettings } from '../availability/engine.js';
import { dispatchWebhook } from '../integrations/webhooks.js';
import { findByAccessCode, getAppointmentDetail, type AppointmentDetail } from './queries.js';

/**
 * Validación de acceso físico.
 *
 * Pensado para que un torno, una puerta o un lector lo llame directamente con
 * una clave de API: se le presenta un código (el del QR de la cita, el DNI del
 * usuario o el identificador de la cita) y responde si se le deja pasar.
 *
 * Devuelve siempre 200 con un veredicto explícito en el cuerpo, incluso cuando
 * deniega. Un dispositivo empotrado no debería tener que distinguir entre "no
 * tienes cita" (403) y "el servidor se ha caído" (500): con este contrato, todo
 * lo que no sea 200 es un problema de infraestructura y el dispositivo puede
 * aplicar su política de contingencia.
 */

export interface AccessDecision {
  granted: boolean;
  result: AccessResult;
  reason: string;
  checkedInAt: string | null;
  appointment: {
    id: string;
    startsAt: string;
    endsAt: string;
    status: string;
    serviceName: string;
    locationId: string;
    locationName: string;
    resourceId: string | null;
    resourceName: string | null;
    customerName: string;
    partySize: number;
  } | null;
}

const REASONS: Record<AccessResult, string> = {
  granted: 'Acceso concedido',
  denied_not_found: 'No hay ninguna cita que corresponda a esos datos',
  denied_wrong_time: 'La cita no es a esta hora',
  denied_wrong_location: 'La cita es en otra sede o con otro recurso',
  denied_status: 'La cita no está en un estado que permita el acceso',
  denied_already_used: 'El código ya se ha utilizado',
  denied_unpaid: 'La cita tiene un pago pendiente',
};

export async function validateAccess(
  organizationId: string,
  input: AccessValidateInput,
  context: { deviceId?: string | null } = {},
): Promise<AccessDecision> {
  const at = input.at ? new Date(input.at) : new Date();
  const appointment = await findCandidate(organizationId, input, at);

  if (!appointment) {
    return deny(organizationId, input, context, 'denied_not_found', null);
  }
  if (appointment.organizationId !== organizationId) {
    return deny(organizationId, input, context, 'denied_not_found', null);
  }

  if (input.locationId && appointment.locationId !== input.locationId) {
    return deny(organizationId, input, context, 'denied_wrong_location', appointment);
  }
  if (input.resourceId && appointment.resourceId && appointment.resourceId !== input.resourceId) {
    return deny(organizationId, input, context, 'denied_wrong_location', appointment);
  }

  if (!['confirmed', 'checked_in', 'in_progress'].includes(appointment.status)) {
    return deny(organizationId, input, context, 'denied_status', appointment);
  }

  const settings = (await organizationSettings(organizationId)) as Record<string, any>;
  const graceBefore = settings.accessGraceBeforeMinutes ?? 15;
  const graceAfter = settings.accessGraceAfterMinutes ?? 15;

  const windowStart = Date.parse(appointment.startsAt) - graceBefore * 60_000;
  const windowEnd = Date.parse(appointment.endsAt) + graceAfter * 60_000;

  if (at.getTime() < windowStart || at.getTime() > windowEnd) {
    return deny(organizationId, input, context, 'denied_wrong_time', appointment);
  }

  if (settings.accessSingleUse === true) {
    const uses = await db()
      .selectFrom('appointments')
      .select(['access_uses'])
      .where('id', '=', appointment.id)
      .executeTakeFirst();
    if ((uses?.access_uses ?? 0) > 0) {
      return deny(organizationId, input, context, 'denied_already_used', appointment);
    }
  }

  // Un depósito o pago pendiente bloquea el acceso solo si el servicio lo exige.
  const service = await db()
    .selectFrom('services')
    .select(['payment_required'])
    .where('id', '=', appointment.serviceId)
    .executeTakeFirst();

  if (
    service?.payment_required === 1 &&
    ['pending', 'failed'].includes(appointment.paymentStatus)
  ) {
    return deny(organizationId, input, context, 'denied_unpaid', appointment);
  }

  const checkedInAt = appointment.checkedInAt ?? isoNow();

  await db()
    .updateTable('appointments')
    .set((eb) => ({
      access_uses: eb('access_uses', '+', 1),
      ...(input.checkIn !== false && !appointment.checkedInAt
        ? { checked_in_at: checkedInAt, status: 'checked_in', updated_at: isoNow() }
        : {}),
    }))
    .where('id', '=', appointment.id)
    .execute();

  await logAccess({
    organizationId,
    locationId: appointment.locationId,
    appointmentId: appointment.id,
    userId: appointment.customerId,
    deviceId: context.deviceId ?? input.deviceId ?? null,
    presentedCode: input.accessCode ?? input.nif ?? null,
    result: 'granted',
    granted: true,
  });

  await dispatchWebhook(organizationId, 'access.granted', {
    appointmentId: appointment.id,
    at: at.toISOString(),
    deviceId: input.deviceId ?? null,
  });

  return {
    granted: true,
    result: 'granted',
    reason: REASONS.granted,
    checkedInAt,
    appointment: summarize(appointment),
  };
}

/** Localiza la cita a partir de lo que presente el lector. */
async function findCandidate(
  organizationId: string,
  input: AccessValidateInput,
  at: Date,
): Promise<AppointmentDetail | null> {
  if (input.appointmentId) {
    return getAppointmentDetail(input.appointmentId);
  }

  if (input.accessCode) {
    // Se admite tanto el código simple como el token firmado del QR.
    const code = input.accessCode.includes('.')
      ? parseSignedCode(input.accessCode)
      : input.accessCode;
    if (!code) return null;
    return findByAccessCode(code);
  }

  const userId = input.userId ?? (await userIdFromNif(input.nif));
  if (!userId) return null;

  // Sin código, se busca la cita del usuario más cercana al momento actual.
  const from = new Date(at.getTime() - 6 * 3_600_000).toISOString();
  const to = new Date(at.getTime() + 6 * 3_600_000).toISOString();

  const row = await db()
    .selectFrom('appointments')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('customer_id', '=', userId)
    .where('status', 'in', ['confirmed', 'checked_in', 'in_progress'])
    .where('starts_at', '>=', from)
    .where('starts_at', '<=', to)
    .orderBy('starts_at')
    .executeTakeFirst();

  return row ? getAppointmentDetail(row.id) : null;
}

async function userIdFromNif(nif?: string): Promise<string | null> {
  if (!nif) return null;
  const user = await db()
    .selectFrom('users')
    .select(['id'])
    .where('nif_key', '=', nif.trim().toUpperCase())
    .executeTakeFirst();
  return user?.id ?? null;
}

async function deny(
  organizationId: string,
  input: AccessValidateInput,
  context: { deviceId?: string | null },
  result: AccessResult,
  appointment: AppointmentDetail | null,
): Promise<AccessDecision> {
  await logAccess({
    organizationId,
    locationId: appointment?.locationId ?? input.locationId ?? null,
    appointmentId: appointment?.id ?? null,
    userId: appointment?.customerId ?? null,
    deviceId: context.deviceId ?? input.deviceId ?? null,
    presentedCode: input.accessCode ?? input.nif ?? null,
    result,
    granted: false,
  });

  await dispatchWebhook(organizationId, 'access.denied', {
    result,
    appointmentId: appointment?.id ?? null,
    deviceId: input.deviceId ?? null,
  });

  return {
    granted: false,
    result,
    reason: REASONS[result],
    checkedInAt: null,
    appointment: appointment ? summarize(appointment) : null,
  };
}

function summarize(appointment: AppointmentDetail): NonNullable<AccessDecision['appointment']> {
  return {
    id: appointment.id,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    status: appointment.status,
    serviceName: appointment.serviceName,
    locationId: appointment.locationId,
    locationName: appointment.locationName,
    resourceId: appointment.resourceId,
    resourceName: appointment.resourceName,
    customerName: appointment.customerName,
    partySize: appointment.partySize,
  };
}

async function logAccess(entry: {
  organizationId: string;
  locationId: string | null;
  appointmentId: string | null;
  userId: string | null;
  deviceId: string | null;
  presentedCode: string | null;
  result: AccessResult;
  granted: boolean;
}): Promise<void> {
  try {
    await db()
      .insertInto('access_logs')
      .values({
        id: newId(),
        organization_id: entry.organizationId,
        location_id: entry.locationId,
        appointment_id: entry.appointmentId,
        user_id: entry.userId,
        device_id: entry.deviceId,
        presented_code: entry.presentedCode?.slice(0, 120) ?? null,
        result: entry.result,
        granted: entry.granted ? 1 : 0,
        reason: REASONS[entry.result],
        created_at: isoNow(),
      })
      .execute();
  } catch (error) {
    logger.warn({ err: error }, 'No se pudo registrar el intento de acceso');
  }
}

/* -------------------------------------------------------------------------- */
/* Códigos firmados para el QR                                                 */
/* -------------------------------------------------------------------------- */

/**
 * El QR lleva `<código>.<firma>` en lugar del código a secas. Así, alguien que
 * ve un código impreso no puede fabricar otros válidos por prueba y error, y el
 * lector puede descartar los falsos sin consultar la base de datos.
 */
export function signedAccessCode(accessCode: string): string {
  return `${accessCode}.${sign(accessCode, 'access')}`;
}

export function parseSignedCode(value: string): string | null {
  const separator = value.lastIndexOf('.');
  if (separator === -1) return null;
  const code = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  return verifySignature(code, signature, 'access') ? code : null;
}

/* -------------------------------------------------------------------------- */
/* Consulta de registros                                                       */
/* -------------------------------------------------------------------------- */

export async function listAccessLogs(params: {
  organizationId: string;
  locationId?: string;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}) {
  let query = db()
    .selectFrom('access_logs')
    .leftJoin('users', 'users.id', 'access_logs.user_id')
    .select([
      'access_logs.id',
      'access_logs.location_id',
      'access_logs.appointment_id',
      'access_logs.device_id',
      'access_logs.result',
      'access_logs.granted',
      'access_logs.reason',
      'access_logs.created_at',
      'users.name as user_name',
    ])
    .where('access_logs.organization_id', '=', params.organizationId);

  if (params.locationId) query = query.where('access_logs.location_id', '=', params.locationId);
  if (params.from) query = query.where('access_logs.created_at', '>=', params.from);
  if (params.to) query = query.where('access_logs.created_at', '<=', params.to);

  const rows = await query
    .orderBy('access_logs.created_at', 'desc')
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    locationId: row.location_id,
    appointmentId: row.appointment_id,
    deviceId: row.device_id,
    result: row.result,
    granted: row.granted === 1,
    reason: row.reason,
    userName: row.user_name,
    createdAt: row.created_at,
  }));
}
