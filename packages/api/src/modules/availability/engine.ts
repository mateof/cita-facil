import type { Selectable } from 'kysely';
import {
  BLOCKING_APPOINTMENT_STATUSES,
  mergeIntervals,
  subtractIntervals,
  type AllocationStrategy,
  type Interval,
  type ServiceStartTimes,
} from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { effectiveRules, type EffectiveRules } from '../appointments/rules.js';
import type {
  AppointmentsTable,
  LocationsTable,
  ResourcesTable,
  ServicesTable,
} from '../../db/types.js';
import {
  addDays,
  currentMinuteIn,
  instantToLocal,
  localToInstant,
  minutesInLocalDay,
  todayIn,
  weekdayOf,
} from '../../lib/dates.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';

/**
 * Motor de disponibilidad.
 *
 * Razona siempre en minutos desde medianoche de la hora local de la sede, y
 * solo convierte a instante UTC al final. Un establecimiento abre "de 9 a 14"
 * en su zona horaria, no en UTC, y esa diferencia importa dos veces al año:
 * con el cambio de hora un día local tiene 23 o 25 horas, y `minutesInLocalDay`
 * lo tiene en cuenta para no inventar huecos que no existen ni perder una hora
 * de agenda.
 *
 * El cálculo por día es:
 *
 *   1. Ventanas de apertura de la sede (horario semanal + excepciones).
 *   2. Intersección con el horario del servicio, si lo tiene.
 *   3. Para cada recurso candidato: su horario, menos ausencias, menos citas.
 *   4. Rejilla de inicios posibles y comprobación de que la cita completa
 *      (con márgenes previo y posterior) cabe en un hueco libre.
 *   5. Aforo y reglas de antelación.
 */

export type ServiceRow = Selectable<ServicesTable>;
export type ResourceRow = Selectable<ResourcesTable>;
export type LocationRow = Selectable<LocationsTable>;
export type AppointmentRow = Selectable<AppointmentsTable>;

export interface AvailabilityRequest {
  organizationId: string;
  serviceId: string;
  locationId?: string;
  resourceId?: string;
  from: string;
  to?: string;
  durationMinutes?: number;
  /**
   * Servicios que se hacen en la misma visita. La cita ocupa la suma de todos
   * y solo la atienden los recursos que sepan hacerlos todos.
   */
  additionalServiceIds?: string[];
  partySize?: number;
  /** Rejilla de inicios. Por defecto, la de la organización. */
  granularityMinutes?: number;
  /** Instante de referencia para las reglas de antelación. */
  now?: Date;
  /** Incluye huecos ya pasados o fuera de las reglas. Solo para el panel. */
  ignoreBookingRules?: boolean;
  /**
   * Cita que no debe bloquear la agenda. Se usa al reprogramar: la cita que se
   * está moviendo no puede estorbarse a sí misma.
   */
  excludeAppointmentId?: string;
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  localDate: string;
  localStartMinute: number;
  durationMinutes: number;
  resourceIds: string[];
  remainingCapacity: number;
  priceCents: number;
  currency: string;
}

export interface DayAvailability {
  date: string;
  closed: boolean;
  slots: Slot[];
}

export interface AvailabilityResult {
  serviceId: string;
  timezone: string;
  durationMinutes: number;
  days: DayAvailability[];
}

/* -------------------------------------------------------------------------- */
/* Carga de datos                                                              */
/* -------------------------------------------------------------------------- */

interface ScheduleRuleRow {
  owner_type: string;
  owner_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
  valid_from: string | null;
  valid_to: string | null;
}

interface ExceptionRow {
  owner_type: string;
  owner_id: string;
  type: string;
  date: string;
  start_minute: number | null;
  end_minute: number | null;
}

interface Context {
  service: ServiceRow;
  /** Servicios añadidos, en el orden en que se hacen. */
  extras: ServiceRow[];
  location: LocationRow;
  resources: ResourceRow[];
  /** `true` si el servicio necesita asignar recurso. */
  requiresResource: boolean;
  schedules: ScheduleRuleRow[];
  exceptions: ExceptionRow[];
  timeOff: { resource_id: string | null; location_id: string | null; starts_at: string; ends_at: string }[];
  appointments: AppointmentRow[];
  granularity: number;
  /** `true` si la rejilla la impuso quien llama y manda sobre la del servicio. */
  granularityForced: boolean;
  allocationStrategy: AllocationStrategy;
  /** Plazos ya resueltos entre el servicio y su organización. */
  rules: EffectiveRules;
}

async function loadContext(request: AvailabilityRequest): Promise<Context> {
  const service = await db()
    .selectFrom('services')
    .selectAll()
    .where('id', '=', request.serviceId)
    .where('organization_id', '=', request.organizationId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!service) throw new NotFoundError('El servicio no existe', 'service_not_found');
  if (service.active !== 1) throw new BadRequestError('El servicio no está activo', 'service_inactive');

  const locationId = request.locationId ?? service.location_id;
  const location = locationId
    ? await db()
        .selectFrom('locations')
        .selectAll()
        .where('id', '=', locationId)
        .where('organization_id', '=', request.organizationId)
        .executeTakeFirst()
    : await db()
        .selectFrom('locations')
        .selectAll()
        .where('organization_id', '=', request.organizationId)
        .where('active', '=', 1)
        .where('deleted_at', 'is', null)
        .orderBy('sort_order')
        .executeTakeFirst();

  if (!location) throw new NotFoundError('La sede no existe', 'location_not_found');

  /*
   * Servicios añadidos. Se comprueba aquí y no al reservar porque la
   * disponibilidad tiene que salir ya con la suma: ofrecer un hueco donde solo
   * cabe el primero es peor que no ofrecer ninguno.
   */
  const extraIds = [...new Set(request.additionalServiceIds ?? [])].filter(
    (id) => id !== service.id,
  );
  const extras =
    extraIds.length > 0
      ? await db()
          .selectFrom('services')
          .selectAll()
          .where('organization_id', '=', request.organizationId)
          .where('deleted_at', 'is', null)
          .where('id', 'in', extraIds)
          .execute()
      : [];

  if (extras.length !== extraIds.length) {
    throw new NotFoundError('Alguno de los servicios no existe', 'service_not_found');
  }
  for (const extra of extras) {
    if (extra.active !== 1) {
      throw new BadRequestError('Alguno de los servicios no está activo', 'service_inactive');
    }
    if (extra.duration_mode === 'flexible') {
      // La duración ajustable es del servicio principal: dos ajustables en la
      // misma visita no tendrían una respuesta única.
      throw new BadRequestError(
        'Un servicio de duración ajustable no se puede combinar con otros',
        'service_not_combinable',
      );
    }
  }

  const links = await db()
    .selectFrom('service_resources')
    .select(['resource_id'])
    .where('service_id', '=', service.id)
    .execute();

  /*
   * Con servicios añadidos solo valen los recursos que sepan hacerlos todos:
   * una cita la atiende una persona de principio a fin.
   */
  let allowedResourceIds = links.map((link) => link.resource_id);
  for (const extra of extras) {
    const extraLinks = await db()
      .selectFrom('service_resources')
      .select(['resource_id'])
      .where('service_id', '=', extra.id)
      .execute();
    if (extraLinks.length === 0) continue;
    const permitidos = new Set(extraLinks.map((link) => link.resource_id));
    allowedResourceIds = allowedResourceIds.filter((id) => permitidos.has(id));
  }

  const requiresResource = links.length > 0;
  let resources: ResourceRow[] = [];

  if (requiresResource) {
    let query = db()
      .selectFrom('resources')
      .selectAll()
      .where('organization_id', '=', request.organizationId)
      .where('location_id', '=', location.id)
      .where('active', '=', 1)
      .where('deleted_at', 'is', null)
      .where('id', 'in', allowedResourceIds.length > 0 ? allowedResourceIds : ['']);
    if (request.resourceId) query = query.where('id', '=', request.resourceId);
    resources = await query.orderBy('sort_order').execute();

    if (resources.length === 0) {
      // Sin recursos disponibles no hay nada que ofrecer, pero no es un error:
      // el día simplemente sale cerrado.
      resources = [];
    }
  }

  const from = request.from;
  const to = request.to ?? request.from;
  const ownerIds = [location.id, service.id, ...resources.map((r) => r.id)];

  const schedules = await db()
    .selectFrom('schedules')
    .select([
      'owner_type',
      'owner_id',
      'weekday',
      'start_minute',
      'end_minute',
      'valid_from',
      'valid_to',
    ])
    .where('organization_id', '=', request.organizationId)
    .where('owner_id', 'in', ownerIds)
    .execute();

  const exceptions = await db()
    .selectFrom('schedule_exceptions')
    .select(['owner_type', 'owner_id', 'type', 'date', 'start_minute', 'end_minute'])
    .where('organization_id', '=', request.organizationId)
    .where('owner_id', 'in', ownerIds)
    .where('date', '>=', from)
    .where('date', '<=', to)
    .execute();

  // El rango en UTC se amplía un día por cada lado para cubrir cualquier zona.
  const rangeStart = localToInstant(addDays(from, -1), 0, location.timezone);
  const rangeEnd = localToInstant(addDays(to, 2), 0, location.timezone);

  const timeOff = await db()
    .selectFrom('time_off')
    .select(['resource_id', 'location_id', 'starts_at', 'ends_at'])
    .where('organization_id', '=', request.organizationId)
    .where('starts_at', '<', rangeEnd)
    .where('ends_at', '>', rangeStart)
    .execute();

  let appointmentQuery = db()
    .selectFrom('appointments')
    .selectAll()
    .where('organization_id', '=', request.organizationId)
    .where('location_id', '=', location.id)
    .where('block_starts_at', '<', rangeEnd)
    .where('block_ends_at', '>', rangeStart)
    .where('status', 'in', [...BLOCKING_APPOINTMENT_STATUSES]);
  if (request.excludeAppointmentId) {
    appointmentQuery = appointmentQuery.where('id', '!=', request.excludeAppointmentId);
  }
  const appointments = await appointmentQuery.execute();

  const settings = await organizationSettings(request.organizationId);

  return {
    service,
    extras,
    location,
    resources,
    requiresResource,
    schedules,
    exceptions,
    timeOff,
    appointments,
    granularity:
      request.granularityMinutes ?? settings.slotGranularityMinutes ?? 15,
    // Quien pide una rejilla concreta manda sobre la del servicio. Lo usa
    // `isSlotFree` con granularidad 1 para no rechazar una hora que está libre
    // pero no cae en la cuadrícula: una cita movida a mano por el personal.
    granularityForced: request.granularityMinutes !== undefined,
    rules: effectiveRules(service, settings),
    allocationStrategy:
      (service.allocation_strategy as AllocationStrategy | null) ??
      settings.allocationStrategy ??
      'least_gap',
  };
}

interface OrgSettings {
  minAdvanceMinutes?: number;
  cancellationCutoffMinutes?: number;
  creditChargeMode?: 'booking' | 'completion';
  slotGranularityMinutes?: number;
  allocationStrategy?: AllocationStrategy;
  holdMinutes?: number;
}

export async function organizationSettings(organizationId: string): Promise<OrgSettings> {
  const row = await db()
    .selectFrom('organizations')
    .select(['settings_json'])
    .where('id', '=', organizationId)
    .executeTakeFirst();
  if (!row?.settings_json) return {};
  try {
    return JSON.parse(row.settings_json) as OrgSettings;
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------------- */
/* Cálculo                                                                     */
/* -------------------------------------------------------------------------- */

function rulesFor(
  schedules: ScheduleRuleRow[],
  ownerType: string,
  ownerId: string,
  date: string,
  weekday: number,
): Interval[] {
  return schedules
    .filter(
      (rule) =>
        rule.owner_type === ownerType &&
        rule.owner_id === ownerId &&
        rule.weekday === weekday &&
        (!rule.valid_from || rule.valid_from <= date) &&
        (!rule.valid_to || rule.valid_to >= date),
    )
    .map((rule) => ({ start: rule.start_minute, end: rule.end_minute }));
}

/** Aplica las excepciones del día: los cierres restan y las aperturas suman. */
function applyExceptions(
  base: Interval[],
  exceptions: ExceptionRow[],
  ownerType: string,
  ownerId: string,
  date: string,
  dayLength: number,
): Interval[] {
  const own = exceptions.filter(
    (item) => item.owner_type === ownerType && item.owner_id === ownerId && item.date === date,
  );
  if (own.length === 0) return base;

  let result = base;

  const closures = own
    .filter((item) => item.type === 'closed')
    .map((item) => ({
      start: item.start_minute ?? 0,
      end: item.end_minute ?? dayLength,
    }));
  if (closures.length > 0) result = subtractIntervals(result, closures);

  const openings = own
    .filter((item) => item.type === 'open' && item.start_minute != null && item.end_minute != null)
    .map((item) => ({ start: item.start_minute!, end: item.end_minute! }));
  if (openings.length > 0) result = mergeIntervals([...result, ...openings]);

  return result;
}

/** Convierte un intervalo de instantes UTC a minutos locales de un día concreto. */
function instantRangeToLocalInterval(
  startsAt: string,
  endsAt: string,
  date: string,
  timezone: string,
  dayLength: number,
): Interval | null {
  const dayStart = Date.parse(localToInstant(date, 0, timezone));
  const dayEnd = Date.parse(localToInstant(addDays(date, 1), 0, timezone));
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);
  if (end <= dayStart || start >= dayEnd) return null;

  return {
    start: Math.max(0, Math.round((start - dayStart) / 60_000)),
    end: Math.min(dayLength, Math.round((end - dayStart) / 60_000)),
  };
}

export function resolveDuration(service: ServiceRow, requested?: number): number {
  if (service.duration_mode !== 'flexible') return service.duration_minutes;
  if (requested == null) return service.duration_minutes;

  const min = service.min_duration_minutes ?? service.duration_minutes;
  const max = service.max_duration_minutes ?? service.duration_minutes;
  const step = service.duration_step_minutes ?? 5;

  if (requested < min || requested > max) {
    throw new BadRequestError(
      `La duración debe estar entre ${min} y ${max} minutos`,
      'invalid_duration',
    );
  }
  if ((requested - min) % step !== 0) {
    throw new BadRequestError(
      `La duración debe ir en tramos de ${step} minutos a partir de ${min}`,
      'invalid_duration_step',
    );
  }
  return requested;
}

export function priceFor(service: ServiceRow, durationMinutes: number, partySize: number): number {
  switch (service.price_mode) {
    case 'free':
      return 0;
    case 'per_minute':
      return (service.price_per_minute_cents ?? 0) * durationMinutes;
    case 'per_person':
      return service.price_cents * partySize;
    case 'fixed':
    default:
      return service.price_cents;
  }
}

/**
 * Horas a las que puede empezar una cita dentro de un tramo libre.
 *
 * Devuelve el minuto de inicio de la **cita**, no el del bloque: cuando el
 * negocio dice "en punto" se refiere a la hora que ve el cliente, y el margen
 * previo queda por delante. Por eso se comprueba que el bloque entero quepa,
 * desde `inicio - margen previo` hasta `fin + margen posterior`.
 *
 * Los cuatro modos están en `SERVICE_START_MODES`; el reparto entre ellos vive
 * aquí y en ningún otro sitio, para que la hora que se ofrece y la que se
 * acepta al reservar salgan siempre del mismo cálculo.
 */
/** Las horas fijas guardadas, o ninguna si el JSON está mal. */
function horasFijas(service: ServiceRow): ServiceStartTimes[] {
  if (!service.start_times_json) return [];
  try {
    const leido = JSON.parse(service.start_times_json) as ServiceStartTimes[];
    return Array.isArray(leido) ? leido : [];
  } catch {
    return [];
  }
}

export function startMinutesIn(params: {
  interval: Interval;
  service: ServiceRow;
  /** Duración de la cita, ya con los servicios añadidos sumados. */
  duration: number;
  /** Rejilla de la organización, o la que haya impuesto quien llama. */
  grid: number;
  /** `true` si la rejilla la impuso quien llama y manda sobre la del servicio. */
  gridForced: boolean;
  weekday: number;
}): number[] {
  const { interval, service, duration, grid, gridForced, weekday } = params;
  const antes = service.buffer_before_minutes;
  const despues = service.buffer_after_minutes;

  /** El bloque entero, con sus márgenes, tiene que caber en el tramo libre. */
  const cabe = (inicio: number) =>
    inicio - antes >= interval.start && inicio + duration + despues <= interval.end;

  const modo = gridForced ? 'inherit' : (service.start_mode ?? 'inherit');

  if (modo === 'fixed') {
    const grupos = horasFijas(service);
    const horas = new Set<number>();
    for (const grupo of grupos) {
      // Sin días marcados, la hora vale todos los días de la semana.
      const dias: number[] = grupo.weekdays;
      if (dias.length > 0 && !dias.includes(weekday)) continue;
      for (const minuto of grupo.minutes) horas.add(minuto);
    }
    return [...horas].filter(cabe).sort((a, b) => a - b);
  }

  if (modo === 'sequence') {
    // Encadenadas desde que abre el tramo: la primera nada más abrir y cada
    // siguiente cuando termina la anterior, márgenes incluidos.
    const paso = antes + duration + despues;
    if (paso <= 0) return [];
    const horas: number[] = [];
    for (let inicio = interval.start + antes; cabe(inicio); inicio += paso) horas.push(inicio);
    return horas;
  }

  const paso =
    modo === 'interval' ? (service.start_interval_minutes ?? grid) : grid;
  if (paso <= 0) return [];
  const desfase = modo === 'interval' ? service.start_offset_minutes % paso : 0;

  // La rejilla se ancla a medianoche, no a la apertura: es lo que hace que "en
  // punto" salga en punto aunque la sede abra a las 9:30.
  const minimo = interval.start + antes;
  const primera = Math.ceil((minimo - desfase) / paso) * paso + desfase;

  const horas: number[] = [];
  for (let inicio = primera; cabe(inicio); inicio += paso) horas.push(inicio);
  return horas;
}

export async function computeAvailability(
  request: AvailabilityRequest,
): Promise<AvailabilityResult> {
  const context = await loadContext(request);
  const { service, location } = context;
  const timezone = location.timezone;
  const duration =
    resolveDuration(service, request.durationMinutes) +
    context.extras.reduce((total, extra) => total + extra.duration_minutes, 0);
  const partySize = request.partySize ?? 1;
  const extrasDuration = context.extras.reduce(
    (total, extra) => total + extra.duration_minutes,
    0,
  );
  const now = request.now ?? new Date();

  const from = request.from;
  const to = request.to ?? request.from;

  const days: DayAvailability[] = [];
  const maxDate = addDays(todayIn(timezone, now), service.max_advance_days);
  const today = todayIn(timezone, now);
  const currentMinute = currentMinuteIn(timezone, now);

  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (!request.ignoreBookingRules && (date < today || date > maxDate)) {
      days.push({ date, closed: true, slots: [] });
      continue;
    }

    const dayLength = minutesInLocalDay(date, timezone);
    const weekday = weekdayOf(date);

    /* 1. Apertura de la sede. */
    let open = mergeIntervals(
      rulesFor(context.schedules, 'location', location.id, date, weekday),
    );
    open = applyExceptions(open, context.exceptions, 'location', location.id, date, dayLength);

    /* 2. Horario propio del servicio, si lo tiene. */
    const serviceRules = rulesFor(context.schedules, 'service', service.id, date, weekday);
    if (serviceRules.length > 0) {
      open = intersect(open, mergeIntervals(serviceRules));
    }
    open = applyExceptions(open, context.exceptions, 'service', service.id, date, dayLength);

    if (open.length === 0) {
      days.push({ date, closed: true, slots: [] });
      continue;
    }

    /* 3. Disponibilidad por recurso. */
    const freeByResource = new Map<string, Interval[]>();

    if (context.requiresResource) {
      for (const resource of context.resources) {
        const ownRules = rulesFor(context.schedules, 'resource', resource.id, date, weekday);
        let free = ownRules.length > 0 ? intersect(open, mergeIntervals(ownRules)) : [...open];
        free = applyExceptions(
          free,
          context.exceptions,
          'resource',
          resource.id,
          date,
          dayLength,
        );

        const busy: Interval[] = [];

        for (const off of context.timeOff) {
          const affectsResource = off.resource_id === resource.id;
          const affectsLocation = off.resource_id === null && off.location_id === location.id;
          if (!affectsResource && !affectsLocation) continue;
          const interval = instantRangeToLocalInterval(
            off.starts_at,
            off.ends_at,
            date,
            timezone,
            dayLength,
          );
          if (interval) busy.push(interval);
        }

        for (const appointment of context.appointments) {
          if (appointment.resource_id !== resource.id) continue;
          const interval = instantRangeToLocalInterval(
            appointment.block_starts_at,
            appointment.block_ends_at,
            date,
            timezone,
            dayLength,
          );
          // Con recursos de aforo mayor que uno, una cita no bloquea el hueco
          // entero: solo consume plaza, que se calcula más abajo.
          if (interval && resource.capacity <= 1) busy.push(interval);
        }

        freeByResource.set(resource.id, subtractIntervals(free, busy));
      }

      if (freeByResource.size === 0) {
        days.push({ date, closed: true, slots: [] });
        continue;
      }
    } else {
      // Servicio sin recurso: la disponibilidad es la de la sede, y el aforo lo
      // controla el propio servicio.
      const busy: Interval[] = [];
      for (const off of context.timeOff) {
        if (off.resource_id !== null || off.location_id !== location.id) continue;
        const interval = instantRangeToLocalInterval(
          off.starts_at,
          off.ends_at,
          date,
          timezone,
          dayLength,
        );
        if (interval) busy.push(interval);
      }
      freeByResource.set('', subtractIntervals(open, busy));
    }

    /* 4 y 5. Horas de inicio, márgenes y aforo. */
    const slots: Slot[] = [];

    const candidateStarts = new Set<number>();
    for (const intervals of freeByResource.values()) {
      for (const interval of intervals) {
        for (const minute of startMinutesIn({
          interval,
          service,
          duration,
          grid: context.granularity,
          gridForced: context.granularityForced,
          weekday,
        })) {
          candidateStarts.add(minute);
        }
      }
    }

    for (const startMinute of [...candidateStarts].sort((a, b) => a - b)) {
      const blockStart = startMinute - service.buffer_before_minutes;
      const blockEnd = startMinute + duration + service.buffer_after_minutes;

      if (!request.ignoreBookingRules) {
        const minutesFromNow =
          date === today
            ? startMinute - currentMinute
            : (Date.parse(localToInstant(date, startMinute, timezone)) - now.getTime()) / 60_000;
        // El servicio puede heredar el plazo de su organización.
        if (minutesFromNow < context.rules.minAdvanceMinutes) continue;
      }

      const availableResources: string[] = [];
      for (const [resourceId, intervals] of freeByResource) {
        if (intervals.some((i) => i.start <= blockStart && blockEnd <= i.end)) {
          availableResources.push(resourceId);
        }
      }
      if (availableResources.length === 0) continue;

      const remaining = remainingCapacity({
        context,
        date,
        timezone,
        startMinute,
        duration,
        availableResources,
      });
      if (remaining < partySize) continue;

      slots.push({
        startsAt: localToInstant(date, startMinute, timezone),
        endsAt: localToInstant(date, startMinute + duration, timezone),
        localDate: date,
        localStartMinute: startMinute,
        durationMinutes: duration,
        resourceIds: availableResources.filter(Boolean),
        remainingCapacity: remaining,
        priceCents:
          priceFor(service, duration - extrasDuration, partySize) +
          context.extras.reduce(
            (total, extra) => total + priceFor(extra, extra.duration_minutes, partySize),
            0,
          ),
        currency: service.currency,
      });
    }

    days.push({ date, closed: slots.length === 0, slots });
  }

  return { serviceId: service.id, timezone, durationMinutes: duration, days };
}

/**
 * Plazas libres en un momento dado. Para servicios de aforo (clases, pistas
 * compartidas, carriles de piscina) se cuenta cuánta gente hay ya apuntada a
 * citas que se solapan con la franja pedida.
 */
function remainingCapacity(params: {
  context: Context;
  date: string;
  timezone: string;
  startMinute: number;
  duration: number;
  availableResources: string[];
}): number {
  const { context, date, timezone, startMinute, duration } = params;
  const capacityPerResource = context.requiresResource
    ? Math.max(
        ...context.resources
          .filter((resource) => params.availableResources.includes(resource.id))
          .map((resource) => Math.min(resource.capacity, context.service.capacity)),
        0,
      )
    : context.service.capacity;

  if (capacityPerResource <= 1) return 1;

  const startsAt = Date.parse(localToInstant(date, startMinute, timezone));
  const endsAt = Date.parse(localToInstant(date, startMinute + duration, timezone));

  let taken = 0;
  for (const appointment of context.appointments) {
    if (appointment.service_id !== context.service.id) continue;
    if (
      context.requiresResource &&
      appointment.resource_id &&
      !params.availableResources.includes(appointment.resource_id)
    ) {
      continue;
    }
    const overlaps =
      Date.parse(appointment.starts_at) < endsAt && Date.parse(appointment.ends_at) > startsAt;
    if (overlaps) taken += appointment.party_size;
  }

  return Math.max(0, capacityPerResource - taken);
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(left.start, right.start);
      const end = Math.min(left.end, right.end);
      if (end > start) result.push({ start, end });
    }
  }
  return mergeIntervals(result);
}

/* -------------------------------------------------------------------------- */
/* Asignación de recurso                                                       */
/* -------------------------------------------------------------------------- */

export interface AllocationInput {
  organizationId: string;
  locationId: string;
  candidates: string[];
  startsAt: string;
  endsAt: string;
  strategy: AllocationStrategy;
}

/**
 * Elige qué recurso se lleva la cita cuando el cliente no ha pedido uno.
 *
 * `least_gap` es el valor por defecto porque es lo que hace un recepcionista
 * con experiencia: encajar la cita pegada a algo que ya hay en la agenda de ese
 * profesional, en lugar de repartir y dejar la mañana llena de huecos de veinte
 * minutos donde ya no cabe nada.
 */
export async function allocateResource(input: AllocationInput): Promise<string | null> {
  if (input.candidates.length === 0) return null;
  if (input.candidates.length === 1) return input.candidates[0]!;

  const dayStart = new Date(Date.parse(input.startsAt) - 12 * 3_600_000).toISOString();
  const dayEnd = new Date(Date.parse(input.endsAt) + 12 * 3_600_000).toISOString();

  const neighbours = await db()
    .selectFrom('appointments')
    .select(['resource_id', 'block_starts_at', 'block_ends_at'])
    .where('organization_id', '=', input.organizationId)
    .where('location_id', '=', input.locationId)
    .where('resource_id', 'in', input.candidates)
    .where('block_starts_at', '<', dayEnd)
    .where('block_ends_at', '>', dayStart)
    .where('status', 'in', [...BLOCKING_APPOINTMENT_STATUSES])
    .execute();

  const start = Date.parse(input.startsAt);
  const end = Date.parse(input.endsAt);

  switch (input.strategy) {
    case 'first_available':
      return input.candidates[0]!;

    case 'least_busy': {
      const load = new Map(input.candidates.map((id) => [id, 0]));
      for (const item of neighbours) {
        if (!item.resource_id) continue;
        const minutes = (Date.parse(item.block_ends_at) - Date.parse(item.block_starts_at)) / 60_000;
        load.set(item.resource_id, (load.get(item.resource_id) ?? 0) + minutes);
      }
      return [...load.entries()].sort((a, b) => a[1] - b[1])[0]![0];
    }

    case 'round_robin': {
      // Reparto por antigüedad del último uso: el que lleva más tiempo sin cita.
      const lastUse = new Map(input.candidates.map((id) => [id, 0]));
      for (const item of neighbours) {
        if (!item.resource_id) continue;
        const value = Date.parse(item.block_ends_at);
        if (value > (lastUse.get(item.resource_id) ?? 0)) lastUse.set(item.resource_id, value);
      }
      return [...lastUse.entries()].sort((a, b) => a[1] - b[1])[0]![0];
    }

    case 'least_gap':
    default: {
      let best = input.candidates[0]!;
      let bestGap = Number.POSITIVE_INFINITY;

      for (const candidate of input.candidates) {
        let gap = Number.POSITIVE_INFINITY;
        for (const item of neighbours) {
          if (item.resource_id !== candidate) continue;
          const itemStart = Date.parse(item.block_starts_at);
          const itemEnd = Date.parse(item.block_ends_at);
          if (itemEnd <= start) gap = Math.min(gap, start - itemEnd);
          if (itemStart >= end) gap = Math.min(gap, itemStart - end);
        }
        if (gap < bestGap) {
          bestGap = gap;
          best = candidate;
        }
      }
      return best;
    }
  }
}

/**
 * Comprueba que un hueco concreto sigue libre. Se llama justo antes de
 * insertar la cita: la consulta de disponibilidad puede haber quedado obsoleta
 * en los segundos que el cliente tarda en confirmar.
 */
export async function isSlotFree(params: {
  organizationId: string;
  serviceId: string;
  locationId?: string;
  resourceId?: string;
  startsAt: string;
  /** Duración del servicio principal; los añadidos suman por su cuenta. */
  durationMinutes: number;
  additionalServiceIds?: string[];
  partySize: number;
  ignoreAppointmentId?: string;
  now?: Date;
  ignoreBookingRules?: boolean;
}): Promise<{ free: boolean; resourceIds: string[]; slot: Slot | null }> {
  const location = await db()
    .selectFrom('locations')
    .select(['timezone'])
    .where('id', '=', params.locationId ?? '')
    .executeTakeFirst();

  const timezone =
    location?.timezone ??
    (
      await db()
        .selectFrom('organizations')
        .select(['timezone'])
        .where('id', '=', params.organizationId)
        .executeTakeFirst()
    )?.timezone ??
    'Europe/Madrid';

  const local = instantToLocal(params.startsAt, timezone);

  const availability = await computeAvailability({
    organizationId: params.organizationId,
    serviceId: params.serviceId,
    locationId: params.locationId,
    resourceId: params.resourceId,
    from: local.date,
    to: local.date,
    durationMinutes: params.durationMinutes,
    additionalServiceIds: params.additionalServiceIds,
    partySize: params.partySize,
    now: params.now,
    ignoreBookingRules: params.ignoreBookingRules,
    excludeAppointmentId: params.ignoreAppointmentId,
    // La rejilla se ajusta al minuto exacto pedido para no rechazar horas que
    // no caen en la cuadrícula pero sí están libres (citas movidas a mano).
    granularityMinutes: 1,
  });

  const slot = availability.days[0]?.slots.find(
    (candidate) => candidate.localStartMinute === local.minute,
  );

  if (!slot) return { free: false, resourceIds: [], slot: null };
  if (params.resourceId && !slot.resourceIds.includes(params.resourceId)) {
    return { free: false, resourceIds: slot.resourceIds, slot };
  }
  return { free: true, resourceIds: slot.resourceIds, slot };
}
