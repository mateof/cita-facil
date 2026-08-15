import type { Locale } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { newId } from '../../lib/ids.js';
import { formatForHumans, instantToLocal, isoNow } from '../../lib/dates.js';
import { NotFoundError } from '../../lib/errors.js';
import { notify } from '../notifications/service.js';
import { organizationSettings } from '../availability/engine.js';
import { dispatchWebhook } from '../integrations/webhooks.js';
import type { AppointmentDetail } from './queries.js';

/**
 * Lista de espera.
 *
 * Cuando alguien cancela, el hueco se ofrece a quien lo estaba esperando en vez
 * de quedarse vacío. La oferta no reserva automáticamente: se avisa al primero
 * de la cola y se le da una ventana (una hora por defecto) para confirmar. Es
 * deliberado, porque asignar sin preguntar acaba generando faltas de gente que
 * no vio el aviso.
 */

export interface JoinWaitlistInput {
  serviceId: string;
  locationId?: string;
  resourceId?: string;
  fromDate: string;
  toDate: string;
  earliestMinute?: number;
  latestMinute?: number;
  weekdays?: number[];
  partySize?: number;
  notes?: string;
  guest?: { name: string; email?: string; phone?: string };
}

export async function joinWaitlist(
  organizationId: string,
  input: JoinWaitlistInput,
  customerId: string | null,
): Promise<{ id: string }> {
  const settings = (await organizationSettings(organizationId)) as Record<string, unknown>;
  if (settings.waitlistEnabled === false) {
    throw new NotFoundError('La lista de espera no está activa', 'waitlist_disabled');
  }

  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('waitlist_entries')
    .values({
      id,
      organization_id: organizationId,
      location_id: input.locationId ?? null,
      service_id: input.serviceId,
      resource_id: input.resourceId ?? null,
      customer_id: customerId,
      guest_name: customerId ? null : (input.guest?.name ?? null),
      guest_email: customerId ? null : (input.guest?.email ?? null),
      guest_phone: customerId ? null : (input.guest?.phone ?? null),
      from_date: input.fromDate,
      to_date: input.toDate,
      earliest_minute: input.earliestMinute ?? 0,
      latest_minute: input.latestMinute ?? 1440,
      weekdays_json: input.weekdays?.length ? JSON.stringify(input.weekdays) : null,
      party_size: input.partySize ?? 1,
      notes: input.notes ?? null,
      status: 'waiting',
      offered_appointment_id: null,
      offer_expires_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return { id };
}

export async function leaveWaitlist(id: string, customerId: string | null): Promise<void> {
  let query = db()
    .updateTable('waitlist_entries')
    .set({ status: 'cancelled', updated_at: isoNow() })
    .where('id', '=', id);
  if (customerId) query = query.where('customer_id', '=', customerId);
  await query.execute();
}

export async function listWaitlist(organizationId: string, serviceId?: string) {
  let query = db()
    .selectFrom('waitlist_entries')
    .leftJoin('users', 'users.id', 'waitlist_entries.customer_id')
    .leftJoin('services', 'services.id', 'waitlist_entries.service_id')
    .select([
      'waitlist_entries.id',
      'waitlist_entries.service_id',
      'waitlist_entries.location_id',
      'waitlist_entries.from_date',
      'waitlist_entries.to_date',
      'waitlist_entries.earliest_minute',
      'waitlist_entries.latest_minute',
      'waitlist_entries.party_size',
      'waitlist_entries.status',
      'waitlist_entries.notes',
      'waitlist_entries.offer_expires_at',
      'waitlist_entries.created_at',
      'users.name as customer_name',
      'users.email as customer_email',
      'waitlist_entries.guest_name',
      'waitlist_entries.guest_email',
      'services.name as service_name',
    ])
    .where('waitlist_entries.organization_id', '=', organizationId)
    .where('waitlist_entries.status', 'in', ['waiting', 'offered']);

  if (serviceId) query = query.where('waitlist_entries.service_id', '=', serviceId);

  const rows = await query.orderBy('waitlist_entries.created_at').limit(500).execute();
  return rows.map((row) => ({
    id: row.id,
    serviceId: row.service_id,
    serviceName: row.service_name,
    locationId: row.location_id,
    fromDate: row.from_date,
    toDate: row.to_date,
    earliestMinute: row.earliest_minute,
    latestMinute: row.latest_minute,
    partySize: row.party_size,
    status: row.status,
    notes: row.notes,
    offerExpiresAt: row.offer_expires_at,
    createdAt: row.created_at,
    customerName: row.customer_name ?? row.guest_name,
    customerEmail: row.customer_email ?? row.guest_email,
  }));
}

/**
 * Ofrece un hueco que acaba de quedar libre. Se avisa por orden de llegada al
 * primero cuyo rango de fechas, franja horaria y días de la semana encajen.
 */
export async function offerFreedSlot(freed: AppointmentDetail): Promise<number> {
  const settings = (await organizationSettings(freed.organizationId)) as Record<string, any>;
  if (settings.waitlistEnabled === false) return 0;

  // La página pública se sirve por el slug de la organización, no por su id.
  const organizacion = await db()
    .selectFrom('organizations')
    .select('slug')
    .where('id', '=', freed.organizationId)
    .executeTakeFirst();
  if (!organizacion) return 0;

  const local = instantToLocal(freed.startsAt, freed.timezone);
  const weekday = new Date(`${local.date}T00:00:00.000Z`).getUTCDay() || 7;

  const candidates = await db()
    .selectFrom('waitlist_entries')
    .selectAll()
    .where('organization_id', '=', freed.organizationId)
    .where('service_id', '=', freed.serviceId)
    .where('status', '=', 'waiting')
    .where('from_date', '<=', local.date)
    .where('to_date', '>=', local.date)
    .where('earliest_minute', '<=', local.minute)
    .where('latest_minute', '>=', local.minute)
    .where('party_size', '<=', freed.partySize)
    .orderBy('created_at')
    .limit(20)
    .execute();

  for (const candidate of candidates) {
    if (candidate.location_id && candidate.location_id !== freed.locationId) continue;
    if (candidate.resource_id && candidate.resource_id !== freed.resourceId) continue;
    if (candidate.weekdays_json) {
      const weekdays = JSON.parse(candidate.weekdays_json) as number[];
      if (!weekdays.includes(weekday)) continue;
    }

    const expiresAt = new Date(
      Date.now() + (settings.waitlistOfferMinutes ?? 60) * 60_000,
    ).toISOString();

    await db()
      .updateTable('waitlist_entries')
      .set({
        status: 'offered',
        offered_appointment_id: freed.id,
        offer_expires_at: expiresAt,
        updated_at: isoNow(),
      })
      .where('id', '=', candidate.id)
      .execute();

    const locale = (candidate.customer_id ? freed.locale : 'es') as Locale;
    await notify({
      event: 'waitlist.slot_available',
      userId: candidate.customer_id,
      organizationId: freed.organizationId,
      locale,
      to: { email: candidate.guest_email, phone: candidate.guest_phone },
      vars: {
        usuario: candidate.guest_name ?? 'Hola',
        organizacion: freed.organizationName,
        servicio: freed.serviceName,
        sede: freed.locationName,
        fechaHora: formatForHumans(freed.startsAt, freed.timezone, locale, 'full'),
        enlace: `${env.APP_URL}/${organizacion.slug}?servicio=${freed.serviceId}&fecha=${local.date}&hora=${local.minute}&espera=${candidate.id}`,
      },
    });

    await dispatchWebhook(freed.organizationId, 'waitlist.matched', {
      waitlistEntryId: candidate.id,
      appointmentId: freed.id,
      startsAt: freed.startsAt,
    });

    logger.info({ waitlistEntryId: candidate.id, appointmentId: freed.id }, 'Hueco ofrecido');
    return 1;
  }

  return 0;
}

/** Devuelve a la cola las ofertas que nadie ha aceptado a tiempo. */
export async function expireWaitlistOffers(): Promise<number> {
  const result = await db()
    .updateTable('waitlist_entries')
    .set({
      status: 'waiting',
      offered_appointment_id: null,
      offer_expires_at: null,
      updated_at: isoNow(),
    })
    .where('status', '=', 'offered')
    .where('offer_expires_at', '<', isoNow())
    .executeTakeFirst();

  const count = Number(result.numUpdatedRows ?? 0);

  // Las entradas cuyo rango de fechas ya pasó dejan de tener sentido.
  await db()
    .updateTable('waitlist_entries')
    .set({ status: 'expired', updated_at: isoNow() })
    .where('status', 'in', ['waiting', 'offered'])
    .where('to_date', '<', isoNow().slice(0, 10))
    .execute();

  return count;
}

export async function markWaitlistConverted(id: string, appointmentId: string): Promise<void> {
  await db()
    .updateTable('waitlist_entries')
    .set({
      status: 'converted',
      offered_appointment_id: appointmentId,
      updated_at: isoNow(),
    })
    .where('id', '=', id)
    .execute();
}
