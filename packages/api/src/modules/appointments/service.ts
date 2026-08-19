import type { Transaction } from 'kysely';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  TERMINAL_APPOINTMENT_STATUSES,
  type AppointmentStatus,
  type BookingSource,
  type CreateAppointmentInput,
  type Locale,
} from '@cita-facil/shared';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { newId, shortCode } from '../../lib/ids.js';
import { hashToken } from '../../lib/crypto.js';
import { addMinutesToInstant, instantToLocal, isoNow } from '../../lib/dates.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SlotUnavailableError,
} from '../../lib/errors.js';
import {
  allocateResource,
  isSlotFree,
  organizationSettings,
  priceFor,
  resolveDuration,
} from '../availability/engine.js';
import { notify } from '../notifications/service.js';
import { consumeCredit, hasUsableCredit, refundCredit } from '../credits/service.js';
import { cancelDebtForAppointment, countPendingDebts, recordDebt } from '../credits/debts.js';
import { effectiveRules } from './rules.js';
import { pendingForms, saveFormResponse } from '../catalog/forms.js';
import { getAuthSettings } from '../settings/access-policy.js';
import { recordAudit } from '../audit/service.js';
import { dispatchWebhook } from '../integrations/webhooks.js';
import {
  getAppointmentDetail,
  requireAppointmentDetail,
  type AppointmentDetail,
} from './queries.js';
import { appointmentVars, cancelReminders, scheduleReminders } from './reminders.js';

/**
 * Ciclo de vida de las citas.
 *
 * La comprobación de disponibilidad se hace dos veces a propósito: una al
 * calcular los huecos que ve el cliente y otra, dentro de la transacción de
 * inserción, contra las citas que bloquean el mismo recurso. Entre que alguien
 * ve un hueco y pulsa "reservar" pueden pasar minutos, y sin la segunda
 * comprobación dos personas acabarían con la misma hora.
 */

export interface ActorContext {
  userId?: string | null;
  /** `true` si quien reserva es personal del establecimiento. */
  isStaff?: boolean;
  source?: BookingSource;
  ip?: string | null;
  userAgent?: string | null;
  locale?: string;
  /**
   * Reserva por encima del aforo.
   *
   * Solo lo usan las programaciones semanales cuyo negocio ha elegido "reservar
   * igualmente": es la única forma de meter dos citas en el mismo hueco, y por
   * eso no se expone en ningún endpoint.
   */
  skipCapacityCheck?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Comprobación de solapes                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Cuenta las plazas ya ocupadas en el intervalo. Se ejecuta dentro de la
 * transacción de creación, que es lo que convierte la comprobación en real: en
 * SQLite la escritura serializa, y en el resto de motores la fila que se
 * inserta después queda ordenada respecto a esta lectura.
 */
async function occupiedSeats(
  trx: Transaction<Database>,
  params: {
    organizationId: string;
    resourceId: string | null;
    serviceId: string;
    blockStartsAt: string;
    blockEndsAt: string;
    excludeAppointmentId?: string;
  },
): Promise<number> {
  let query = trx
    .selectFrom('appointments')
    .select(['party_size'])
    .where('organization_id', '=', params.organizationId)
    .where('block_starts_at', '<', params.blockEndsAt)
    .where('block_ends_at', '>', params.blockStartsAt)
    .where('status', 'in', [...BLOCKING_APPOINTMENT_STATUSES]);

  query = params.resourceId
    ? query.where('resource_id', '=', params.resourceId)
    : query.where('service_id', '=', params.serviceId).where('resource_id', 'is', null);

  if (params.excludeAppointmentId) {
    query = query.where('id', '!=', params.excludeAppointmentId);
  }

  const rows = await query.execute();
  return rows.reduce((total, row) => total + row.party_size, 0);
}

async function capacityFor(
  trx: Transaction<Database>,
  serviceId: string,
  resourceId: string | null,
): Promise<number> {
  const service = await trx
    .selectFrom('services')
    .select(['capacity'])
    .where('id', '=', serviceId)
    .executeTakeFirstOrThrow();

  if (!resourceId) return service.capacity;

  const resource = await trx
    .selectFrom('resources')
    .select(['capacity'])
    .where('id', '=', resourceId)
    .executeTakeFirstOrThrow();

  return Math.min(service.capacity, resource.capacity);
}

/* -------------------------------------------------------------------------- */
/* Creación                                                                    */
/* -------------------------------------------------------------------------- */

export interface CreateResult {
  appointment: AppointmentDetail;
  /** `true` si la petición ya se había procesado con la misma clave. */
  idempotentReplay: boolean;
}

export async function createAppointment(
  organizationId: string,
  input: CreateAppointmentInput,
  actor: ActorContext = {},
): Promise<CreateResult> {
  if (input.idempotencyKey) {
    const replay = await findIdempotentResponse(organizationId, input.idempotencyKey);
    if (replay) {
      const existing = await getAppointmentDetail(replay);
      if (existing) return { appointment: existing, idempotentReplay: true };
    }
  }

  const service = await db()
    .selectFrom('services')
    .selectAll()
    .where('id', '=', input.serviceId)
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!service) throw new NotFoundError('El servicio no existe', 'service_not_found');
  if (service.active !== 1) throw new BadRequestError('El servicio no está activo', 'service_inactive');

  if (!actor.isStaff) {
    if (service.staff_only === 1) {
      throw new ForbiddenError('Este servicio solo se reserva desde el centro', 'service_staff_only');
    }
    if (service.publicly_bookable !== 1) {
      throw new ForbiddenError('Este servicio no admite reserva online', 'service_not_bookable');
    }
  }

  await assertFormsAnswered(organizationId, service.id, input, actor);

  const settings = await organizationSettings(organizationId);
  const locationId = input.locationId ?? service.location_id ?? (await defaultLocationId(organizationId));
  const location = await db()
    .selectFrom('locations')
    .selectAll()
    .where('id', '=', locationId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!location) throw new NotFoundError('La sede no existe', 'location_not_found');

  const duration = resolveDuration(service, input.durationMinutes);
  const partySize = input.partySize ?? 1;
  const customerId = resolveCustomerId(input, actor);

  if (!customerId && !input.guest) {
    throw new BadRequestError('Hay que indicar el cliente o los datos de contacto', 'customer_required');
  }

  // Reserva sin cuenta: tienen que permitirla la instalación y la organización.
  // El tope de la instalación manda, para que un administrador de plataforma
  // pueda cerrarla de golpe aunque una organización la tenga activada.
  if (!customerId && input.guest && !actor.isStaff) {
    const platform = await getAuthSettings();
    const organizationAllows = settings0(settings).allowGuestBooking === true;

    if (!platform.allowAnonymousBooking || !organizationAllows) {
      throw new ForbiddenError(
        'Es necesario tener cuenta para reservar',
        'guest_booking_disabled',
      );
    }
  }

  if (customerId && !actor.isStaff) {
    await assertCustomerCanBook(organizationId, customerId, settings);
  }

  // Servicios de bono: sin cuenta no hay a quién descontarle la sesión, y sin
  // saldo no se reserva. La comprobación se repite dentro de la transacción,
  // que es donde el descuento se hace de verdad.
  if (service.requires_credit_pack === 1 && !customerId) {
    throw new ForbiddenError(
      'Este servicio necesita un bono activo, y para eso hay que identificarse',
      'credit_pack_required',
    );
  }

  const startsAt = new Date(input.startsAt).toISOString();
  const endsAt = addMinutesToInstant(startsAt, duration);
  const blockStartsAt = addMinutesToInstant(startsAt, -service.buffer_before_minutes);
  const blockEndsAt = addMinutesToInstant(endsAt, service.buffer_after_minutes);
  const local = instantToLocal(startsAt, location.timezone);

  /* Disponibilidad según horarios, ausencias y reglas de antelación. */
  const availability = await isSlotFree({
    organizationId,
    serviceId: service.id,
    locationId,
    resourceId: input.resourceId,
    startsAt,
    durationMinutes: duration,
    partySize,
    ignoreAppointmentId: input.holdId,
    ignoreBookingRules: actor.isStaff === true,
  });

  // Con `skipCapacityCheck` la cita se crea aunque no quepa: es la opción
  // "reservar igualmente" de las programaciones semanales, que el negocio elige
  // sabiendo que después tendrá que cuadrarlo a mano.
  if (!availability.free && !actor.skipCapacityCheck) {
    throw new SlotUnavailableError('El horario solicitado ya no está disponible', {
      startsAt,
      durationMinutes: duration,
    });
  }

  const resourceId =
    input.resourceId ??
    (await allocateResource({
      organizationId,
      locationId,
      candidates: availability.resourceIds,
      startsAt: blockStartsAt,
      endsAt: blockEndsAt,
      strategy:
        (service.allocation_strategy as never) ?? settings0(settings).allocationStrategy ?? 'least_gap',
    }));

  const status: AppointmentStatus = service.requires_approval === 1 && !actor.isStaff ? 'pending' : 'confirmed';
  const priceCents = priceFor(service, duration, partySize);
  const id = newId();
  const now = isoNow();
  const usesCredit = service.requires_credit_pack === 1 && customerId !== null;
  const reglas = effectiveRules(service, settings0(settings) as never);
  let creditWalletId: string | null = null;

  await db()
    .transaction()
    .execute(async (trx) => {
      const capacity = await capacityFor(trx, service.id, resourceId);
      const taken = await occupiedSeats(trx, {
        organizationId,
        resourceId,
        serviceId: service.id,
        blockStartsAt,
        blockEndsAt,
        excludeAppointmentId: input.holdId,
      });

      if (taken + partySize > capacity && !actor.skipCapacityCheck) {
        throw new SlotUnavailableError('Alguien ha ocupado ese hueco mientras reservabas');
      }

      if (input.holdId) {
        await trx
          .deleteFrom('appointments')
          .where('id', '=', input.holdId)
          .where('status', '=', 'hold')
          .execute();
      }

      /*
       * Bono: se descuenta aquí solo si la regla es cobrar al reservar. Con
       * `completion` la sesión se cobra al dar la cita por hecha, así que aquí
       * únicamente se comprueba que haya con qué pagarla llegado el momento.
       */
      if (usesCredit && reglas.creditChargeMode === 'booking') {
        creditWalletId = await consumeCredit(trx, {
          organizationId,
          userId: customerId as string,
          serviceId: service.id,
          appointmentId: id,
        });
      }

      /*
       * Con cobro al completar no se descuenta nada ahora, pero sí se exige que
       * haya con qué pagar: dejar reservar a quien no tiene saldo ni permiso
       * para deber solo aplaza el problema al mostrador.
       */
      const cubierto =
        creditWalletId !== null ||
        (reglas.creditChargeMode === 'completion' &&
          (await hasUsableCredit(organizationId, customerId as string, service.id, trx)));

      if (usesCredit && !cubierto) {
        // Sin saldo: se admite quedar a deber si la organización lo permite y
        // no se ha pasado del tope.
        const ajustes = settings0(settings);
        const debidas = await countPendingDebts(organizationId, customerId as string, trx);
        const permitido = ajustes.allowCreditDebt === true && debidas < (ajustes.maxCreditDebt ?? 2);

        if (!permitido) {
          throw new ForbiddenError(
            'No te queda ninguna sesión de bono para este servicio',
            'no_credits',
          );
        }

        if (reglas.creditChargeMode === 'booking') {
          await recordDebt(trx, {
            organizationId,
            userId: customerId as string,
            appointmentId: id,
            serviceId: service.id,
          });
        }
      }

      await trx
        .insertInto('appointments')
        .values({
          id,
          organization_id: organizationId,
          location_id: locationId,
          service_id: service.id,
          resource_id: resourceId,
          customer_id: customerId,
          guest_name: customerId ? null : (input.guest?.name ?? null),
          guest_email: customerId ? null : (input.guest?.email ?? null),
          guest_phone: customerId ? null : (input.guest?.phone ?? null),
          guest_locale: customerId ? null : (input.guest?.locale ?? null),
          starts_at: startsAt,
          ends_at: endsAt,
          block_starts_at: blockStartsAt,
          block_ends_at: blockEndsAt,
          local_date: local.date,
          local_start_minute: local.minute,
          duration_minutes: duration,
          timezone: location.timezone,
          status,
          source: input.source ?? actor.source ?? 'web',
          party_size: partySize,
          price_cents: priceCents,
          currency: service.currency,
          credit_wallet_id: creditWalletId,
          // Con bono la cita queda pagada: la sesión ya se cobró al comprarlo.
          payment_status: usesCredit
            ? 'paid'
            : service.payment_required === 1 || service.deposit_cents > 0
              ? 'pending'
              : 'not_required',
          notes: input.notes ?? null,
          internal_notes: null,
          custom_fields_json: input.customFields ? JSON.stringify(input.customFields) : null,
          access_code: shortCode(10),
          access_uses: 0,
          attendance_confirmed_at: null,
          no_show_fee_cents: 0,
          checked_in_at: null,
          completed_at: null,
          cancelled_at: null,
          cancelled_by: null,
          cancellation_reason: null,
          recurrence_id: null,
          rescheduled_from: null,
          waitlist_entry_id: null,
          hold_expires_at: null,
          reminder_scheduled_at: null,
          created_by: actor.userId ?? null,
          created_at: now,
          updated_at: now,
        })
        .execute();
    });

  const appointment = await requireAppointmentDetail(id);

  for (const respuesta of input.formResponses ?? []) {
    await saveFormResponse(organizationId, respuesta, {
      appointmentId: id,
      customerId,
      guestName: customerId ? null : (input.guest?.name ?? null),
      ip: actor.ip ?? null,
    }).catch((error) =>
      // La cita ya existe: perder una respuesta no puede tumbar la reserva, y
      // lo que falte se ve en el panel como pendiente.
      logger.warn({ err: error, appointmentId: id }, 'No se pudo guardar el formulario'),
    );
  }

  if (input.idempotencyKey) {
    await storeIdempotentResponse(organizationId, input.idempotencyKey, id);
  }

  await afterBookingCreated(appointment, status);
  await recordAudit({
    organizationId,
    actorId: actor.userId ?? null,
    actorType: actor.isStaff ? 'staff' : 'customer',
    action: 'appointment.create',
    entityType: 'appointment',
    entityId: id,
    changes: { startsAt, serviceId: service.id, resourceId, status },
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });

  return { appointment, idempotentReplay: false };
}

/**
 * Sin el consentimiento obligatorio no hay cita.
 *
 * Se comprueba antes de tocar la agenda, no después: una cita creada a la que
 * le falta el papel que exige la ley es peor que una reserva que no llega a
 * hacerse, porque nadie la mira hasta que la persona está en la puerta.
 *
 * El mostrador sí puede saltárselo. En un centro real el consentimiento se
 * firma al llegar, con el papel delante, y bloquear el alta por teléfono
 * obligaría a inventarse una aceptación que nadie ha dado.
 */
async function assertFormsAnswered(
  organizationId: string,
  serviceId: string,
  input: CreateAppointmentInput,
  actor: ActorContext,
): Promise<void> {
  if (actor.isStaff) return;

  const customerId = input.customerId ?? actor.userId ?? null;
  const pendientes = await pendingForms(organizationId, serviceId, customerId);
  const obligatorios = pendientes.filter((form) => form.required);
  if (obligatorios.length === 0) return;

  const respondidos = new Set((input.formResponses ?? []).map((respuesta) => respuesta.formId));
  const falta = obligatorios.find((form) => !respondidos.has(form.id));
  if (falta) {
    throw new BadRequestError(
      `Falta responder "${falta.name}" antes de reservar`,
      'form_required',
    );
  }
}

/**
 * Los ajustes de la organización son un JSON abierto: el esquema define las
 * claves conocidas, pero se admiten más. Este acceso laxo evita repetir aserciones.
 */
function settings0(settings: unknown): Record<string, any> {
  return (settings ?? {}) as Record<string, any>;
}

async function afterBookingCreated(
  appointment: AppointmentDetail,
  status: AppointmentStatus,
): Promise<void> {
  const vars = appointmentVars(appointment);

  await notify({
    event: status === 'pending' ? 'appointment.created' : 'appointment.confirmed',
    userId: appointment.customerId,
    organizationId: appointment.organizationId,
    appointmentId: appointment.id,
    locale: appointment.locale as Locale,
    to: { email: appointment.customerEmail, phone: appointment.customerPhone },
    vars,
  });

  if (status === 'pending') {
    await notifyStaffPendingApproval(appointment);
  } else {
    await scheduleReminders(appointment);
  }

  await dispatchWebhook(appointment.organizationId, 'appointment.created', appointment);
}

/** Avisa a quien pueda aprobar la cita en la organización. */
async function notifyStaffPendingApproval(appointment: AppointmentDetail): Promise<void> {
  const staff = await db()
    .selectFrom('memberships')
    .innerJoin('users', 'users.id', 'memberships.user_id')
    .select(['users.id', 'users.locale'])
    .where('memberships.organization_id', '=', appointment.organizationId)
    .where('memberships.active', '=', 1)
    .where('memberships.role', 'in', ['owner', 'admin', 'manager'])
    .execute();

  for (const member of staff) {
    await notify({
      event: 'appointment.approval_required',
      userId: member.id,
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      locale: member.locale as Locale,
      vars: appointmentVars(appointment, {
        enlace: `${env.APP_URL}/admin/citas/${appointment.id}`,
      }),
    });
  }
}

function resolveCustomerId(input: CreateAppointmentInput, actor: ActorContext): string | null {
  if (actor.isStaff && input.customerId) return input.customerId;
  // El personal apuntando a alguien que viene de paso: la cita es de esa
  // persona, no de quien la escribe. Sin esto, toda cita dada de alta en el
  // mostrador quedaba a nombre de quien atendía.
  if (actor.isStaff && input.guest) return null;
  if (input.guest && !actor.userId) return null;
  return actor.userId ?? input.customerId ?? null;
}

async function defaultLocationId(organizationId: string): Promise<string> {
  const location = await db()
    .selectFrom('locations')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('active', '=', 1)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .executeTakeFirst();
  if (!location) throw new NotFoundError('La organización no tiene sedes activas', 'no_locations');
  return location.id;
}

/**
 * Políticas anti abuso: número máximo de citas futuras y bloqueo por faltas
 * repetidas sin avisar. Ambas se desactivan poniendo el valor a cero.
 */
async function assertCustomerCanBook(
  organizationId: string,
  customerId: string,
  settings: unknown,
): Promise<void> {
  const config = settings0(settings);

  if (config.maxActiveAppointmentsPerCustomer > 0) {
    const row = await db()
      .selectFrom('appointments')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('organization_id', '=', organizationId)
      .where('customer_id', '=', customerId)
      .where('starts_at', '>=', isoNow())
      .where('status', 'in', ['pending', 'confirmed'])
      .executeTakeFirst();

    if (Number(row?.total ?? 0) >= config.maxActiveAppointmentsPerCustomer) {
      throw new ForbiddenError(
        `No puedes tener más de ${config.maxActiveAppointmentsPerCustomer} citas activas`,
        'too_many_active_appointments',
      );
    }
  }

  if (config.noShowBlockThreshold > 0) {
    const row = await db()
      .selectFrom('appointments')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('organization_id', '=', organizationId)
      .where('customer_id', '=', customerId)
      .where('status', '=', 'no_show')
      .executeTakeFirst();

    if (Number(row?.total ?? 0) >= config.noShowBlockThreshold) {
      throw new ForbiddenError(
        'La reserva online está bloqueada por faltas sin avisar. Ponte en contacto con el centro.',
        'blocked_by_no_shows',
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Reserva temporal (hold)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Bloquea el hueco unos minutos mientras el cliente rellena sus datos o paga.
 * Sin esto, dos personas que empiezan a reservar a la vez llegan las dos al
 * final del proceso y una se lleva un error después de pagar.
 */
export async function holdSlot(
  organizationId: string,
  input: {
    serviceId: string;
    locationId?: string;
    resourceId?: string;
    startsAt: string;
    durationMinutes?: number;
    partySize?: number;
  },
  actor: ActorContext = {},
): Promise<{ holdId: string; expiresAt: string }> {
  const service = await db()
    .selectFrom('services')
    .selectAll()
    .where('id', '=', input.serviceId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirstOrThrow(() => new NotFoundError('El servicio no existe', 'service_not_found'));

  const settings = settings0(await organizationSettings(organizationId));
  const holdMinutes = settings.holdMinutes ?? 10;
  const duration = resolveDuration(service, input.durationMinutes);
  const partySize = input.partySize ?? 1;
  const locationId =
    input.locationId ?? service.location_id ?? (await defaultLocationId(organizationId));

  const location = await db()
    .selectFrom('locations')
    .select(['timezone'])
    .where('id', '=', locationId)
    .executeTakeFirstOrThrow(() => new NotFoundError('La sede no existe', 'location_not_found'));

  const availability = await isSlotFree({
    organizationId,
    serviceId: service.id,
    locationId,
    resourceId: input.resourceId,
    startsAt: input.startsAt,
    durationMinutes: duration,
    partySize,
    ignoreBookingRules: actor.isStaff === true,
  });
  if (!availability.free) throw new SlotUnavailableError();

  const resourceId =
    input.resourceId ??
    (await allocateResource({
      organizationId,
      locationId,
      candidates: availability.resourceIds,
      startsAt: input.startsAt,
      endsAt: addMinutesToInstant(input.startsAt, duration),
      strategy: settings.allocationStrategy ?? 'least_gap',
    }));

  const startsAt = new Date(input.startsAt).toISOString();
  const endsAt = addMinutesToInstant(startsAt, duration);
  const local = instantToLocal(startsAt, location.timezone);
  const id = newId();
  const expiresAt = new Date(Date.now() + holdMinutes * 60_000).toISOString();
  const now = isoNow();

  await db()
    .insertInto('appointments')
    .values({
      id,
      organization_id: organizationId,
      location_id: locationId,
      service_id: service.id,
      resource_id: resourceId,
      customer_id: actor.userId ?? null,
      guest_name: null,
      guest_email: null,
      guest_phone: null,
      guest_locale: null,
      starts_at: startsAt,
      ends_at: endsAt,
      block_starts_at: addMinutesToInstant(startsAt, -service.buffer_before_minutes),
      block_ends_at: addMinutesToInstant(endsAt, service.buffer_after_minutes),
      local_date: local.date,
      local_start_minute: local.minute,
      duration_minutes: duration,
      timezone: location.timezone,
      status: 'hold',
      source: actor.source ?? 'web',
      party_size: partySize,
      price_cents: priceFor(service, duration, partySize),
      currency: service.currency,
      payment_status: 'not_required',
      notes: null,
      internal_notes: null,
      custom_fields_json: null,
      access_code: shortCode(10),
      access_uses: 0,
      attendance_confirmed_at: null,
      no_show_fee_cents: 0,
      checked_in_at: null,
      completed_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
      recurrence_id: null,
      rescheduled_from: null,
      waitlist_entry_id: null,
      hold_expires_at: expiresAt,
      reminder_scheduled_at: null,
      created_by: actor.userId ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return { holdId: id, expiresAt };
}

export async function releaseHold(holdId: string): Promise<void> {
  await db()
    .deleteFrom('appointments')
    .where('id', '=', holdId)
    .where('status', '=', 'hold')
    .execute();
}

/** Limpia los bloqueos caducados. Lo llama el planificador cada minuto. */
export async function expireHolds(): Promise<number> {
  const result = await db()
    .deleteFrom('appointments')
    .where('status', '=', 'hold')
    .where('hold_expires_at', '<', isoNow())
    .executeTakeFirst();
  const removed = Number(result.numDeletedRows ?? 0);
  if (removed > 0) logger.debug({ removed }, 'Bloqueos temporales caducados');
  return removed;
}

/* -------------------------------------------------------------------------- */
/* Cambios de estado                                                           */
/* -------------------------------------------------------------------------- */

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  hold: ['confirmed', 'expired', 'cancelled'],
  pending: ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['checked_in', 'in_progress', 'completed', 'cancelled', 'no_show'],
  checked_in: ['in_progress', 'completed', 'no_show', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: ['completed'],
  rejected: [],
  expired: [],
};

export async function changeStatus(
  appointmentId: string,
  next: AppointmentStatus,
  actor: ActorContext = {},
): Promise<AppointmentDetail> {
  const appointment = await requireAppointmentDetail(appointmentId);
  const allowed = ALLOWED_TRANSITIONS[appointment.status] ?? [];

  if (appointment.status === next) return appointment;
  if (!allowed.includes(next)) {
    throw new ConflictError(
      `No se puede pasar de "${appointment.status}" a "${next}"`,
      'invalid_status_transition',
    );
  }

  const patch: Record<string, unknown> = { status: next, updated_at: isoNow() };
  if (next === 'completed') patch.completed_at = isoNow();
  if (next === 'checked_in' && !appointment.checkedInAt) patch.checked_in_at = isoNow();
  if (next === 'cancelled' || next === 'rejected') {
    patch.cancelled_at = isoNow();
    patch.cancelled_by = actor.isStaff ? 'staff' : 'customer';
  }

  await db().updateTable('appointments').set(patch).where('id', '=', appointmentId).execute();

  /*
   * Bono con cobro al completar.
   *
   * También se cobra al marcar una falta: la plaza se ocupó igual y no
   * presentarse no puede salir más barato que venir. Es la misma norma que ya
   * regía las devoluciones.
   */
  if ((next === 'completed' || next === 'no_show') && !appointment.creditWalletId) {
    await chargeCreditOnCompletion(appointment);
  }

  if (next === 'no_show' && appointment.customerId) {
    await db()
      .updateTable('users')
      .set((eb) => ({ no_show_count: eb('no_show_count', '+', 1) }))
      .where('id', '=', appointment.customerId)
      .execute();
  }

  /*
   * Cargo por falta. La importación va aquí dentro porque el módulo de
   * asistencia necesita cancelar citas y acabaría importando este fichero.
   */
  if (next === 'no_show') {
    const { applyNoShowFee } = await import('./attendance.js');
    await applyNoShowFee(appointment, 'no_show').catch((error) =>
      logger.warn({ err: error, appointmentId }, 'No se pudo anotar el cargo por falta'),
    );
  }

  const updated = await requireAppointmentDetail(appointmentId);

  if (next === 'confirmed') {
    await notify({
      event: 'appointment.confirmed',
      userId: updated.customerId,
      organizationId: updated.organizationId,
      appointmentId: updated.id,
      locale: updated.locale as Locale,
      to: { email: updated.customerEmail, phone: updated.customerPhone },
      vars: appointmentVars(updated),
    });
    await scheduleReminders(updated);
  }

  if (TERMINAL_APPOINTMENT_STATUSES.includes(next)) {
    await cancelReminders(appointmentId);
  }

  if (next === 'no_show') {
    await notify({
      event: 'appointment.no_show',
      userId: updated.customerId,
      organizationId: updated.organizationId,
      appointmentId: updated.id,
      locale: updated.locale as Locale,
      to: { email: updated.customerEmail },
      vars: appointmentVars(updated),
    });
  }

  await recordAudit({
    organizationId: appointment.organizationId,
    actorId: actor.userId ?? null,
    actorType: actor.isStaff ? 'staff' : 'customer',
    action: `appointment.${next}`,
    entityType: 'appointment',
    entityId: appointmentId,
    changes: { from: appointment.status, to: next },
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });

  await dispatchWebhook(appointment.organizationId, `appointment.${next}`, updated);
  return updated;
}

/* -------------------------------------------------------------------------- */
/* Cancelación y reprogramación                                                */
/* -------------------------------------------------------------------------- */

export async function cancelAppointment(
  appointmentId: string,
  options: {
    reason?: string;
    notifyCustomer?: boolean;
    actor?: ActorContext;
    /**
     * Cancela aunque el plazo haya pasado. Solo lo usa el enlace de "no puedo
     * ir" del recordatorio: avisar tarde es mejor que no avisar, y lo que
     * decide el plazo es si se cobra la falta, no si se admite el aviso.
     */
    ignoreCutoff?: boolean;
  } = {},
): Promise<AppointmentDetail> {
  const appointment = await requireAppointmentDetail(appointmentId);
  const actor = options.actor ?? {};

  if (TERMINAL_APPOINTMENT_STATUSES.includes(appointment.status)) {
    throw new ConflictError('La cita ya está cerrada', 'appointment_closed');
  }

  if (!actor.isStaff && !options.ignoreCutoff) {
    await assertWithinCutoff(appointment, 'cancellation_cutoff_minutes', 'cancellation_too_late');
  }

  await db()
    .updateTable('appointments')
    .set({
      status: 'cancelled',
      cancelled_at: isoNow(),
      cancelled_by: actor.isStaff ? 'staff' : 'customer',
      cancellation_reason: options.reason ?? null,
      updated_at: isoNow(),
    })
    .where('id', '=', appointmentId)
    .execute();

  await cancelReminders(appointmentId);
  // La sesión del bono vuelve al saldo. Las faltas sin avisar no la devuelven:
  // eso se decide en `changeStatus`, no aquí.
  await refundCredit(appointmentId, 'cancel');
  // Si la sesión estaba a deber, se anula: no se llegó a prestar.
  await cancelDebtForAppointment(appointmentId);
  const updated = await requireAppointmentDetail(appointmentId);

  if (options.notifyCustomer !== false) {
    await notify({
      event: 'appointment.cancelled',
      userId: updated.customerId,
      organizationId: updated.organizationId,
      appointmentId: updated.id,
      locale: updated.locale as Locale,
      to: { email: updated.customerEmail, phone: updated.customerPhone },
      vars: appointmentVars(updated, {
        motivo: options.reason ? `Motivo: ${options.reason}` : '',
      }),
    });
  }

  await recordAudit({
    organizationId: appointment.organizationId,
    actorId: actor.userId ?? null,
    actorType: actor.isStaff ? 'staff' : 'customer',
    action: 'appointment.cancel',
    entityType: 'appointment',
    entityId: appointmentId,
    changes: { reason: options.reason ?? null },
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });

  await dispatchWebhook(appointment.organizationId, 'appointment.cancelled', updated);

  // El hueco liberado puede interesar a alguien de la lista de espera.
  const { offerFreedSlot } = await import('./waitlist.js');
  await offerFreedSlot(updated).catch((error) =>
    logger.warn({ err: error, appointmentId }, 'No se pudo ofrecer el hueco liberado'),
  );

  return updated;
}

export async function rescheduleAppointment(
  appointmentId: string,
  input: {
    startsAt: string;
    durationMinutes?: number;
    resourceId?: string;
    reason?: string;
    notifyCustomer?: boolean;
  },
  actor: ActorContext = {},
): Promise<AppointmentDetail> {
  const appointment = await requireAppointmentDetail(appointmentId);

  if (TERMINAL_APPOINTMENT_STATUSES.includes(appointment.status)) {
    throw new ConflictError('La cita ya está cerrada', 'appointment_closed');
  }
  if (!actor.isStaff) {
    await assertWithinCutoff(appointment, 'reschedule_cutoff_minutes', 'reschedule_too_late');
  }

  const service = await db()
    .selectFrom('services')
    .selectAll()
    .where('id', '=', appointment.serviceId)
    .executeTakeFirstOrThrow();

  const duration = resolveDuration(service, input.durationMinutes ?? appointment.durationMinutes);
  const startsAt = new Date(input.startsAt).toISOString();
  const endsAt = addMinutesToInstant(startsAt, duration);
  const blockStartsAt = addMinutesToInstant(startsAt, -service.buffer_before_minutes);
  const blockEndsAt = addMinutesToInstant(endsAt, service.buffer_after_minutes);

  const availability = await isSlotFree({
    organizationId: appointment.organizationId,
    serviceId: appointment.serviceId,
    locationId: appointment.locationId,
    resourceId: input.resourceId ?? appointment.resourceId ?? undefined,
    startsAt,
    durationMinutes: duration,
    partySize: appointment.partySize,
    ignoreAppointmentId: appointmentId,
    ignoreBookingRules: actor.isStaff === true,
  });
  if (!availability.free) throw new SlotUnavailableError();

  const resourceId =
    input.resourceId ??
    (availability.resourceIds.includes(appointment.resourceId ?? '')
      ? appointment.resourceId
      : (availability.resourceIds[0] ?? null));

  const local = instantToLocal(startsAt, appointment.timezone);

  await db()
    .transaction()
    .execute(async (trx) => {
      const capacity = await capacityFor(trx, appointment.serviceId, resourceId);
      const taken = await occupiedSeats(trx, {
        organizationId: appointment.organizationId,
        resourceId,
        serviceId: appointment.serviceId,
        blockStartsAt,
        blockEndsAt,
        excludeAppointmentId: appointmentId,
      });
      if (taken + appointment.partySize > capacity) {
        throw new SlotUnavailableError('Alguien ha ocupado ese hueco mientras cambiabas la cita');
      }

      await trx
        .updateTable('appointments')
        .set({
          starts_at: startsAt,
          ends_at: endsAt,
          block_starts_at: blockStartsAt,
          block_ends_at: blockEndsAt,
          local_date: local.date,
          local_start_minute: local.minute,
          duration_minutes: duration,
          resource_id: resourceId,
          price_cents: priceFor(service, duration, appointment.partySize),
          updated_at: isoNow(),
        })
        .where('id', '=', appointmentId)
        .execute();
    });

  const updated = await requireAppointmentDetail(appointmentId);
  await scheduleReminders(updated);

  if (input.notifyCustomer !== false) {
    await notify({
      event: 'appointment.rescheduled',
      userId: updated.customerId,
      organizationId: updated.organizationId,
      appointmentId: updated.id,
      locale: updated.locale as Locale,
      to: { email: updated.customerEmail, phone: updated.customerPhone },
      vars: appointmentVars(updated, {
        motivo: input.reason ? `Motivo: ${input.reason}` : '',
      }),
    });
  }

  await recordAudit({
    organizationId: appointment.organizationId,
    actorId: actor.userId ?? null,
    actorType: actor.isStaff ? 'staff' : 'customer',
    action: 'appointment.reschedule',
    entityType: 'appointment',
    entityId: appointmentId,
    changes: { from: appointment.startsAt, to: startsAt },
    ip: actor.ip ?? null,
  });

  await dispatchWebhook(appointment.organizationId, 'appointment.rescheduled', updated);
  return updated;
}

/**
 * Cuánto queda para que se cierre el plazo de cancelación.
 *
 * La interfaz la usa para no ofrecer un botón que el servidor va a rechazar; la
 * decisión de verdad se sigue tomando al cancelar.
 */
export async function cancellationWindow(
  organizationId: string,
  appointmentId: string,
): Promise<{ cancellable: boolean; cutoffMinutes: number; minutesLeft: number }> {
  const appointment = await requireAppointmentDetail(appointmentId);
  const service = await db()
    .selectFrom('services')
    .select(['min_advance_minutes', 'cancellation_cutoff_minutes', 'credit_charge_mode'])
    .where('id', '=', appointment.serviceId)
    .executeTakeFirst();

  const settings = settings0(await organizationSettings(organizationId));
  const cutoff = service
    ? effectiveRules(service, settings as never).cancellationCutoffMinutes
    : 0;
  const minutesLeft = Math.floor((Date.parse(appointment.startsAt) - Date.now()) / 60_000);

  return {
    cancellable: cutoff <= 0 || minutesLeft >= cutoff,
    cutoffMinutes: cutoff,
    minutesLeft,
  };
}

/**
 * Cobra la sesión de una cita que se cobra al completarse.
 *
 * Si no queda saldo se anota como sesión a deber cuando la organización lo
 * permite; si no lo permite, la cita se queda sin cobrar y se registra en el
 * historial. No se impide completar la cita: el servicio ya se ha prestado y
 * negarlo aquí solo dejaría la agenda sin cerrar.
 */
async function chargeCreditOnCompletion(appointment: AppointmentDetail): Promise<void> {
  const service = await db()
    .selectFrom('services')
    .select(['id', 'requires_credit_pack', 'credit_charge_mode', 'min_advance_minutes', 'cancellation_cutoff_minutes'])
    .where('id', '=', appointment.serviceId)
    .executeTakeFirst();
  if (!service || service.requires_credit_pack !== 1 || !appointment.customerId) return;

  const settings = settings0(await organizationSettings(appointment.organizationId));
  if (effectiveRules(service, settings as never).creditChargeMode !== 'completion') return;

  const walletId = await db()
    .transaction()
    .execute((trx) =>
      consumeCredit(trx, {
        organizationId: appointment.organizationId,
        userId: appointment.customerId as string,
        serviceId: appointment.serviceId,
        appointmentId: appointment.id,
      }),
    );

  if (walletId) {
    await db()
      .updateTable('appointments')
      .set({ credit_wallet_id: walletId, payment_status: 'paid', updated_at: isoNow() })
      .where('id', '=', appointment.id)
      .execute();
    return;
  }

  if (settings.allowCreditDebt === true) {
    await recordDebt(db(), {
      organizationId: appointment.organizationId,
      userId: appointment.customerId,
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
    });
    return;
  }

  logger.warn(
    { appointmentId: appointment.id },
    'Cita completada sin saldo y sin deuda permitida: queda sin cobrar',
  );
}

/** Comprueba el plazo mínimo para cancelar o cambiar, definido en el servicio. */
async function assertWithinCutoff(
  appointment: AppointmentDetail,
  column: 'cancellation_cutoff_minutes' | 'reschedule_cutoff_minutes',
  errorCode: string,
): Promise<void> {
  const service = await db()
    .selectFrom('services')
    .select([column, 'min_advance_minutes', 'cancellation_cutoff_minutes', 'credit_charge_mode'])
    .where('id', '=', appointment.serviceId)
    .executeTakeFirst();
  if (!service) return;

  // El plazo de cancelación puede venir de la organización; el de cambio de
  // fecha sigue siendo solo del servicio.
  const settings = settings0(await organizationSettings(appointment.organizationId));
  const cutoff =
    column === 'cancellation_cutoff_minutes'
      ? effectiveRules(service, settings as never).cancellationCutoffMinutes
      : ((service[column] as number | null) ?? 0);
  if (cutoff <= 0) return;

  const minutesLeft = (Date.parse(appointment.startsAt) - Date.now()) / 60_000;
  if (minutesLeft < cutoff) {
    throw new ForbiddenError(
      `Este cambio solo se admite con al menos ${cutoff} minutos de antelación`,
      errorCode,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Actualización de datos                                                      */
/* -------------------------------------------------------------------------- */

export async function updateAppointment(
  appointmentId: string,
  patch: {
    notes?: string;
    internalNotes?: string;
    resourceId?: string | null;
    partySize?: number;
    priceCents?: number;
    status?: AppointmentStatus;
  },
  actor: ActorContext = {},
): Promise<AppointmentDetail> {
  const appointment = await requireAppointmentDetail(appointmentId);
  const update: Record<string, unknown> = { updated_at: isoNow() };

  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.internalNotes !== undefined) update.internal_notes = patch.internalNotes;
  if (patch.partySize !== undefined) update.party_size = patch.partySize;
  if (patch.priceCents !== undefined) update.price_cents = patch.priceCents;

  if (patch.resourceId !== undefined && patch.resourceId !== appointment.resourceId) {
    const free = await db()
      .selectFrom('appointments')
      .select(['id'])
      .where('organization_id', '=', appointment.organizationId)
      .where('resource_id', '=', patch.resourceId)
      .where('id', '!=', appointmentId)
      .where('block_starts_at', '<', appointment.endsAt)
      .where('block_ends_at', '>', appointment.startsAt)
      .where('status', 'in', [...BLOCKING_APPOINTMENT_STATUSES])
      .executeTakeFirst();
    if (free) throw new SlotUnavailableError('Ese recurso ya está ocupado a esa hora');
    update.resource_id = patch.resourceId;
  }

  if (Object.keys(update).length > 1) {
    await db().updateTable('appointments').set(update).where('id', '=', appointmentId).execute();
  }

  if (patch.status && patch.status !== appointment.status) {
    return changeStatus(appointmentId, patch.status, actor);
  }

  await recordAudit({
    organizationId: appointment.organizationId,
    actorId: actor.userId ?? null,
    actorType: 'staff',
    action: 'appointment.update',
    entityType: 'appointment',
    entityId: appointmentId,
    changes: patch,
    ip: actor.ip ?? null,
  });

  return requireAppointmentDetail(appointmentId);
}

/* -------------------------------------------------------------------------- */
/* Tareas automáticas                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Marca como falta las citas confirmadas que ya han pasado y a las que nadie
 * hizo el registro de entrada. Solo actúa si la organización lo ha activado.
 */
export async function autoMarkNoShows(): Promise<number> {
  const organizations = await db()
    .selectFrom('organizations')
    .select(['id', 'settings_json'])
    .where('status', '=', 'active')
    .execute();

  let marked = 0;
  for (const organization of organizations) {
    const settings = organization.settings_json
      ? (JSON.parse(organization.settings_json) as Record<string, number>)
      : {};
    const delay = settings.autoNoShowAfterMinutes ?? 0;
    if (delay <= 0) continue;

    const cutoff = new Date(Date.now() - delay * 60_000).toISOString();
    const candidates = await db()
      .selectFrom('appointments')
      .select(['id'])
      .where('organization_id', '=', organization.id)
      .where('status', '=', 'confirmed')
      .where('checked_in_at', 'is', null)
      .where('ends_at', '<', cutoff)
      .limit(200)
      .execute();

    for (const candidate of candidates) {
      await changeStatus(candidate.id, 'no_show', { isStaff: true }).catch((error) =>
        logger.warn({ err: error, id: candidate.id }, 'No se pudo marcar la falta'),
      );
      marked += 1;
    }
  }
  return marked;
}

/** Pide valoración a quien ha completado una cita en las últimas horas. */
export async function requestPendingReviews(): Promise<number> {
  const from = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const to = new Date(Date.now() - 2 * 3_600_000).toISOString();

  const rows = await db()
    .selectFrom('appointments')
    .leftJoin('reviews', 'reviews.appointment_id', 'appointments.id')
    .select(['appointments.id'])
    .where('appointments.status', '=', 'completed')
    .where('appointments.completed_at', '>=', from)
    .where('appointments.completed_at', '<=', to)
    .where('appointments.customer_id', 'is not', null)
    .where('reviews.id', 'is', null)
    .limit(100)
    .execute();

  let sent = 0;
  for (const row of rows) {
    const appointment = await getAppointmentDetail(row.id);
    if (!appointment) continue;

    const settings = settings0(await organizationSettings(appointment.organizationId));
    if (settings.reviewsEnabled === false) continue;

    const already = await db()
      .selectFrom('notifications')
      .select(['id'])
      .where('appointment_id', '=', row.id)
      .where('event', '=', 'appointment.followup')
      .executeTakeFirst();
    if (already) continue;

    await notify({
      event: 'appointment.followup',
      userId: appointment.customerId,
      organizationId: appointment.organizationId,
      appointmentId: appointment.id,
      locale: appointment.locale as Locale,
      to: { email: appointment.customerEmail },
      vars: appointmentVars(appointment, {
        enlace: `${env.APP_URL}/citas/${appointment.id}/valorar?c=${appointment.accessCode}`,
      }),
    });
    sent += 1;
  }
  return sent;
}

/* -------------------------------------------------------------------------- */
/* Idempotencia                                                                */
/* -------------------------------------------------------------------------- */

async function findIdempotentResponse(scope: string, key: string): Promise<string | null> {
  const row = await db()
    .selectFrom('idempotency_keys')
    .select(['response_json', 'expires_at'])
    .where('scope', '=', `appointment:${scope}`)
    .where('key_hash', '=', hashToken(key, 'idempotency'))
    .executeTakeFirst();

  if (!row || row.expires_at <= isoNow() || !row.response_json) return null;
  return (JSON.parse(row.response_json) as { appointmentId: string }).appointmentId;
}

async function storeIdempotentResponse(
  scope: string,
  key: string,
  appointmentId: string,
): Promise<void> {
  await db()
    .insertInto('idempotency_keys')
    .values({
      id: newId(),
      scope: `appointment:${scope}`,
      key_hash: hashToken(key, 'idempotency'),
      response_json: JSON.stringify({ appointmentId }),
      created_at: isoNow(),
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    })
    .execute()
    .catch(() => undefined);
}
