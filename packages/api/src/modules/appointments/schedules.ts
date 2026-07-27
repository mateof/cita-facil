import type { ScheduleConflictMode } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { addDays, isoNow, localToInstant, weekdayOf } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { computeAvailability } from '../availability/engine.js';
import { recordAudit } from '../audit/service.js';
import { createAppointment } from './service.js';

/**
 * Programaciones semanales.
 *
 * Una programación dice "esta persona, este servicio, los martes a las 19:00" y
 * el sistema va creando la cita de cada semana con antelación (siete días por
 * defecto) hasta que alguien para la programación.
 *
 * No se generan todas las citas de golpe a propósito. Una serie cerrada de 200
 * citas ocupa la agenda un año entero, impide que nadie más reserve esas horas
 * y hay que rehacerla al cambiar cualquier cosa. Creando solo la de la semana
 * que viene, la agenda refleja lo que de verdad está comprometido.
 *
 * Cada fecha que se procesa queda anotada en `schedule_occurrences`, y eso es
 * lo que evita el problema clásico: si alguien cancela la cita del 18, esa
 * fecha ya está registrada y el generador no la vuelve a crear.
 */

export interface CreateScheduleInput {
  serviceId: string;
  customerId: string;
  locationId?: string | null;
  resourceId?: string | null;
  /** 1 = lunes ... 7 = domingo. */
  weekday: number;
  startMinute: number;
  durationMinutes?: number | null;
  notes?: string | null;
  onConflict?: ScheduleConflictMode;
  horizonDays?: number;
}

export interface ScheduleView {
  id: string;
  organizationId: string;
  serviceId: string;
  serviceName: string;
  customerId: string;
  customerName: string | null;
  locationId: string | null;
  resourceId: string | null;
  weekday: number;
  startMinute: number;
  durationMinutes: number | null;
  notes: string | null;
  onConflict: string;
  horizonDays: number;
  active: boolean;
  cancelledAt: string | null;
  createdAt: string;
  /** Últimas fechas procesadas, de la más reciente a la más antigua. */
  occurrences?: {
    date: string;
    status: string;
    reason: string | null;
    appointmentId: string | null;
  }[];
}

function toView(row: any): ScheduleView {
  return {
    id: row.id,
    organizationId: row.organization_id,
    serviceId: row.service_id,
    serviceName: row.service_name ?? '',
    customerId: row.customer_id,
    customerName: row.customer_name ?? null,
    locationId: row.location_id,
    resourceId: row.resource_id,
    weekday: row.weekday,
    startMinute: row.start_minute,
    durationMinutes: row.duration_minutes,
    notes: row.notes,
    onConflict: row.on_conflict,
    horizonDays: row.horizon_days,
    active: row.active === 1,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
  };
}

function baseQuery(organizationId: string) {
  return db()
    .selectFrom('appointment_schedules')
    .leftJoin('services', 'services.id', 'appointment_schedules.service_id')
    .leftJoin('users', 'users.id', 'appointment_schedules.customer_id')
    .selectAll('appointment_schedules')
    .select(['services.name as service_name', 'users.name as customer_name'])
    .where('appointment_schedules.organization_id', '=', organizationId);
}

export async function listSchedules(
  organizationId: string,
  filters: { customerId?: string; onlyActive?: boolean } = {},
): Promise<ScheduleView[]> {
  let query = baseQuery(organizationId);
  if (filters.customerId) {
    query = query.where('appointment_schedules.customer_id', '=', filters.customerId);
  }
  if (filters.onlyActive) query = query.where('appointment_schedules.active', '=', 1);

  const rows = await query.orderBy('appointment_schedules.created_at', 'desc').limit(500).execute();
  return rows.map(toView);
}

export async function getSchedule(organizationId: string, id: string): Promise<ScheduleView> {
  const row = await baseQuery(organizationId)
    .where('appointment_schedules.id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('La programación no existe', 'schedule_not_found');

  const occurrences = await db()
    .selectFrom('schedule_occurrences')
    .select(['date', 'status', 'reason', 'appointment_id'])
    .where('schedule_id', '=', id)
    .orderBy('date', 'desc')
    .limit(30)
    .execute();

  return {
    ...toView(row),
    occurrences: occurrences.map((entry) => ({
      date: entry.date,
      status: entry.status,
      reason: entry.reason,
      appointmentId: entry.appointment_id,
    })),
  };
}

export async function createSchedule(
  organizationId: string,
  input: CreateScheduleInput,
  actorId: string | null,
): Promise<ScheduleView> {
  if (input.weekday < 1 || input.weekday > 7) {
    throw new BadRequestError('El día de la semana va de 1 (lunes) a 7 (domingo)', 'invalid_weekday');
  }

  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('appointment_schedules')
    .values({
      id,
      organization_id: organizationId,
      service_id: input.serviceId,
      location_id: input.locationId ?? null,
      resource_id: input.resourceId ?? null,
      customer_id: input.customerId,
      weekday: input.weekday,
      start_minute: input.startMinute,
      duration_minutes: input.durationMinutes ?? null,
      notes: input.notes ?? null,
      on_conflict: input.onConflict ?? 'skip',
      horizon_days: input.horizonDays ?? 7,
      active: 1,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'schedule.create',
    entityType: 'appointment_schedule',
    entityId: id,
    changes: { serviceId: input.serviceId, customerId: input.customerId, weekday: input.weekday },
  });

  // La primera cita se crea ya, sin esperar a que pase el planificador.
  await runSchedule(id).catch((error) =>
    logger.warn({ err: error, scheduleId: id }, 'No se pudo generar la primera cita'),
  );

  return getSchedule(organizationId, id);
}

/**
 * Para una programación.
 *
 * Las citas ya creadas no se tocan: son citas normales y cancelarlas en bloque
 * sorprendería a quien las tenga apuntadas. Lo que se para es la generación de
 * las siguientes.
 */
export async function cancelSchedule(
  organizationId: string,
  id: string,
  actorId: string | null,
): Promise<ScheduleView> {
  await getSchedule(organizationId, id);

  await db()
    .updateTable('appointment_schedules')
    .set({ active: 0, cancelled_at: isoNow(), updated_at: isoNow() })
    .where('id', '=', id)
    .execute();

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'schedule.cancel',
    entityType: 'appointment_schedule',
    entityId: id,
  });

  return getSchedule(organizationId, id);
}

/**
 * Quita de la lista una programación ya parada.
 *
 * Solo se puede borrar lo que ya no genera nada: borrar una activa dejaría sus
 * citas futuras huérfanas sin que nadie lo hubiera decidido. Las citas ya
 * creadas se conservan; lo que desaparece es el registro de la programación y
 * su historial de fechas.
 */
export async function deleteSchedule(organizationId: string, id: string): Promise<void> {
  const schedule = await getSchedule(organizationId, id);
  if (schedule.active) {
    throw new BadRequestError('Primero hay que pararla', 'schedule_still_active');
  }

  await db().deleteFrom('schedule_occurrences').where('schedule_id', '=', id).execute();
  await db().deleteFrom('appointment_schedules').where('id', '=', id).execute();
}

/* -------------------------------------------------------------------------- */
/* Generación                                                                  */
/* -------------------------------------------------------------------------- */

/** Fechas que tocan entre hoy y el horizonte, según el día de la semana. */
function upcomingDates(weekday: number, horizonDays: number, today: string): string[] {
  const fechas: string[] = [];
  for (let salto = 0; salto <= horizonDays; salto += 1) {
    const fecha = addDays(today, salto);
    if (weekdayOf(fecha) === weekday) fechas.push(fecha);
  }
  return fechas;
}

/**
 * Genera lo que falte de una programación.
 *
 * Devuelve cuántas citas ha creado. Es idempotente: las fechas ya procesadas
 * están anotadas y se saltan, así que ejecutarlo dos veces seguidas no duplica
 * nada.
 */
export async function runSchedule(scheduleId: string, today = isoNow().slice(0, 10)): Promise<number> {
  const schedule = await db()
    .selectFrom('appointment_schedules')
    .selectAll()
    .where('id', '=', scheduleId)
    .executeTakeFirst();
  if (!schedule || schedule.active !== 1) return 0;

  const procesadas = await db()
    .selectFrom('schedule_occurrences')
    .select(['date'])
    .where('schedule_id', '=', scheduleId)
    .execute();
  const yaVistas = new Set(procesadas.map((row) => row.date));

  let creadas = 0;

  for (const fecha of upcomingDates(schedule.weekday, schedule.horizon_days, today)) {
    if (yaVistas.has(fecha)) continue;

    const resultado = await generarUna(schedule, fecha);
    await db()
      .insertInto('schedule_occurrences')
      .values({
        id: newId(),
        schedule_id: scheduleId,
        date: fecha,
        appointment_id: resultado.appointmentId,
        status: resultado.appointmentId ? 'created' : 'skipped',
        reason: resultado.reason,
        created_at: isoNow(),
      })
      .execute();

    if (resultado.appointmentId) creadas += 1;
  }

  return creadas;
}

/** Crea la cita de una fecha concreta, resolviendo el conflicto como se pidió. */
async function generarUna(
  schedule: {
    id: string;
    organization_id: string;
    service_id: string;
    location_id: string | null;
    resource_id: string | null;
    customer_id: string;
    start_minute: number;
    duration_minutes: number | null;
    notes: string | null;
    on_conflict: string;
  },
  fecha: string,
): Promise<{ appointmentId: string | null; reason: string | null }> {
  const organizacion = await db()
    .selectFrom('locations')
    .select(['timezone'])
    .where('organization_id', '=', schedule.organization_id)
    .$if(Boolean(schedule.location_id), (qb) => qb.where('id', '=', schedule.location_id as string))
    .executeTakeFirst();

  const timezone = organizacion?.timezone ?? 'Europe/Madrid';
  const modo = schedule.on_conflict as ScheduleConflictMode;

  /** Intenta reservar a una hora concreta del día. */
  const intentar = async (minuto: number, saltarReglas: boolean) => {
    try {
      const { appointment } = await createAppointment(
        schedule.organization_id,
        {
          serviceId: schedule.service_id,
          locationId: schedule.location_id ?? undefined,
          resourceId: schedule.resource_id ?? undefined,
          customerId: schedule.customer_id,
          startsAt: localToInstant(fecha, minuto, timezone),
          durationMinutes: schedule.duration_minutes ?? undefined,
          notes: schedule.notes ?? undefined,
          source: 'admin',
        } as never,
        { isStaff: true, source: 'admin', skipCapacityCheck: saltarReglas },
      );
      return appointment.id;
    } catch (error) {
      logger.debug({ err: error, scheduleId: schedule.id, fecha }, 'Intento de reserva fallido');
      return null;
    }
  };

  const aLaHora = await intentar(schedule.start_minute, false);
  if (aLaHora) return { appointmentId: aLaHora, reason: null };

  if (modo === 'force') {
    // Se reserva igualmente, por encima del aforo. Lo pidió el negocio.
    const forzada = await intentar(schedule.start_minute, true);
    return forzada
      ? { appointmentId: forzada, reason: 'forzada' }
      : { appointmentId: null, reason: 'no se pudo reservar' };
  }

  if (modo === 'nearest') {
    const huecos = await huecosDelDia(schedule, fecha);
    for (const minuto of huecos) {
      if (minuto === schedule.start_minute) continue;
      const cercana = await intentar(minuto, false);
      if (cercana) return { appointmentId: cercana, reason: `movida a ${minuto}` };
    }
  }

  return { appointmentId: null, reason: 'sin hueco' };
}

/** Minutos libres de ese día, ordenados por cercanía a la hora pedida. */
async function huecosDelDia(
  schedule: { organization_id: string; service_id: string; location_id: string | null; start_minute: number },
  fecha: string,
): Promise<number[]> {
  const disponibilidad = await computeAvailability({
    organizationId: schedule.organization_id,
    serviceId: schedule.service_id,
    locationId: schedule.location_id ?? undefined,
    from: fecha,
    to: fecha,
  });

  const dia = disponibilidad.days.find((entry) => entry.date === fecha);
  return (dia?.slots ?? [])
    .map((slot) => slot.localStartMinute)
    .sort(
      (a, b) => Math.abs(a - schedule.start_minute) - Math.abs(b - schedule.start_minute),
    );
}

/** Recorre todas las programaciones activas. Lo llama el planificador. */
export async function runAllSchedules(): Promise<number> {
  const activas = await db()
    .selectFrom('appointment_schedules')
    .select(['id'])
    .where('active', '=', 1)
    .execute();

  let total = 0;
  for (const schedule of activas) {
    total += await runSchedule(schedule.id).catch((error) => {
      logger.warn({ err: error, scheduleId: schedule.id }, 'Programación fallida');
      return 0;
    });
  }

  if (total > 0) logger.info({ creadas: total }, 'Citas periódicas generadas');
  return total;
}
