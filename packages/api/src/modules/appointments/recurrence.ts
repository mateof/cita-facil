import type { CreateAppointmentInput } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { addDays, instantToLocal, isoNow, localToInstant, weekdayOf } from '../../lib/dates.js';
import { BadRequestError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { createAppointment, type ActorContext } from './service.js';
import type { AppointmentDetail } from './queries.js';

/**
 * Citas periódicas.
 *
 * No se guarda una regla que se expanda al vuelo, sino citas reales una a una.
 * Es más caro en filas y a cambio evita el problema clásico de las series: que
 * mover o cancelar una ocurrencia concreta obligue a mantener una lista de
 * excepciones. Aquí cada cita es independiente desde que se crea y solo
 * comparten el identificador de serie.
 *
 * La hora se recalcula en hora local para cada fecha, no sumando milisegundos:
 * una clase de los martes a las 19:00 sigue siendo a las 19:00 después del
 * cambio de hora, aunque el instante UTC cambie.
 */

export interface RecurrenceInput {
  intervalWeeks: number;
  weekdays: number[];
  until?: string | null;
  count?: number | null;
  onConflict: 'skip' | 'fail';
}

export interface RecurringResult {
  recurrenceId: string;
  created: AppointmentDetail[];
  skipped: { date: string; reason: string }[];
}

const MAX_OCCURRENCES = 200;

export async function createRecurringAppointments(
  organizationId: string,
  input: CreateAppointmentInput & { recurrence: RecurrenceInput },
  actor: ActorContext,
): Promise<RecurringResult> {
  const location = await resolveTimezone(organizationId, input);
  const first = instantToLocal(new Date(input.startsAt).toISOString(), location.timezone);

  const dates = expandDates({
    startDate: first.date,
    recurrence: input.recurrence,
  });

  if (dates.length === 0) {
    throw new BadRequestError('La recurrencia no genera ninguna fecha', 'empty_recurrence');
  }

  const recurrenceId = newId();
  await db()
    .insertInto('appointment_recurrences')
    .values({
      id: recurrenceId,
      organization_id: organizationId,
      interval_weeks: input.recurrence.intervalWeeks,
      weekdays_json: JSON.stringify(input.recurrence.weekdays),
      until_date: input.recurrence.until ?? null,
      occurrence_count: input.recurrence.count ?? null,
      created_by: actor.userId ?? null,
      created_at: isoNow(),
    })
    .execute();

  const created: AppointmentDetail[] = [];
  const skipped: { date: string; reason: string }[] = [];

  for (const date of dates) {
    const startsAt = localToInstant(date, first.minute, location.timezone);
    try {
      const result = await createAppointment(
        organizationId,
        { ...input, startsAt, holdId: undefined, idempotencyKey: undefined },
        actor,
      );
      await db()
        .updateTable('appointments')
        .set({ recurrence_id: recurrenceId })
        .where('id', '=', result.appointment.id)
        .execute();
      created.push({ ...result.appointment, recurrenceId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (input.recurrence.onConflict === 'fail') {
        // Se deshace lo creado para no dejar media serie a medias.
        for (const appointment of created) {
          await db().deleteFrom('appointments').where('id', '=', appointment.id).execute();
        }
        await db().deleteFrom('appointment_recurrences').where('id', '=', recurrenceId).execute();
        throw error;
      }
      logger.info({ date, reason }, 'Repetición omitida por conflicto');
      skipped.push({ date, reason });
    }
  }

  return { recurrenceId, created, skipped };
}

/** Genera las fechas locales de la serie respetando días e intervalo. */
export function expandDates(params: {
  startDate: string;
  recurrence: RecurrenceInput;
}): string[] {
  const { startDate, recurrence } = params;
  const weekdays = new Set(recurrence.weekdays);
  const limit = recurrence.count ?? MAX_OCCURRENCES;
  const until = recurrence.until ?? null;

  const dates: string[] = [];
  // El bucle avanza día a día desde el inicio; `weekIndex` cuenta semanas
  // completas para aplicar el intervalo (cada 2 semanas, cada 3, ...).
  const startWeekday = weekdayOf(startDate);
  const weekStart = addDays(startDate, -(startWeekday - 1));

  for (let offset = 0; offset < 366 * 2 && dates.length < Math.min(limit, MAX_OCCURRENCES); offset += 1) {
    const date = addDays(startDate, offset);
    if (until && date > until) break;

    if (!weekdays.has(weekdayOf(date))) continue;

    const weeksElapsed = Math.floor(diffDays(weekStart, date) / 7);
    if (weeksElapsed % recurrence.intervalWeeks !== 0) continue;

    dates.push(date);
  }

  return dates;
}

function diffDays(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000,
  );
}

async function resolveTimezone(
  organizationId: string,
  input: CreateAppointmentInput,
): Promise<{ timezone: string }> {
  if (input.locationId) {
    const location = await db()
      .selectFrom('locations')
      .select(['timezone'])
      .where('id', '=', input.locationId)
      .executeTakeFirst();
    if (location) return location;
  }

  const service = await db()
    .selectFrom('services')
    .select(['location_id'])
    .where('id', '=', input.serviceId)
    .executeTakeFirst();

  if (service?.location_id) {
    const location = await db()
      .selectFrom('locations')
      .select(['timezone'])
      .where('id', '=', service.location_id)
      .executeTakeFirst();
    if (location) return location;
  }

  const organization = await db()
    .selectFrom('organizations')
    .select(['timezone'])
    .where('id', '=', organizationId)
    .executeTakeFirstOrThrow();
  return organization;
}

/** Cancela todas las citas futuras de una serie. */
export async function cancelRecurrence(recurrenceId: string): Promise<number> {
  const result = await db()
    .updateTable('appointments')
    .set({
      status: 'cancelled',
      cancelled_at: isoNow(),
      cancelled_by: 'staff',
      updated_at: isoNow(),
    })
    .where('recurrence_id', '=', recurrenceId)
    .where('starts_at', '>=', isoNow())
    .where('status', 'in', ['pending', 'confirmed'])
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0);
}
