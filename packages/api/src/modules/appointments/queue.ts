import type { JoinQueueInput, Locale, QueueEntry, QueueStatus, QueueView } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { isoNow, todayIn } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { notify } from '../notifications/service.js';
import { organizationSettings } from '../availability/engine.js';
import { getOrganization } from '../catalog/service.js';

/**
 * Cola sin cita previa.
 *
 * El orden es el de llegada y no se negocia: lo que decide el turno es
 * `ticket_number`, un contador que se reinicia cada día y por sede. Ordenar por
 * la hora de creación habría bastado, pero el número es lo que se canta en la
 * sala y lo que la gente compara entre sí, así que tiene que existir de verdad
 * y no calcularse en cada pantalla.
 *
 * La espera estimada es una cuenta honesta y aproximada: los turnos que hay
 * delante por lo que dura cada uno, repartido entre los profesionales que
 * atienden. No promete una hora, orienta.
 */

const OPEN_STATUSES: QueueStatus[] = ['waiting', 'called', 'serving'];

interface QueueSettings {
  walkInQueueEnabled: boolean;
  walkInPublicJoin: boolean;
  walkInDefaultMinutes: number;
}

export async function queueSettings(organizationId: string): Promise<QueueSettings> {
  const settings = (await organizationSettings(organizationId)) as Partial<QueueSettings>;
  return {
    walkInQueueEnabled: settings.walkInQueueEnabled === true,
    walkInPublicJoin: settings.walkInPublicJoin === true,
    walkInDefaultMinutes: settings.walkInDefaultMinutes ?? 20,
  };
}

async function requireEnabled(organizationId: string): Promise<QueueSettings> {
  const settings = await queueSettings(organizationId);
  if (!settings.walkInQueueEnabled) {
    throw new BadRequestError('La cola sin cita no está activa', 'queue_disabled');
  }
  return settings;
}

async function defaultLocation(organizationId: string): Promise<string> {
  const row = await db()
    .selectFrom('locations')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('active', '=', 1)
    .where('deleted_at', 'is', null)
    .orderBy('sort_order')
    .executeTakeFirst();
  if (!row) throw new NotFoundError('La organización no tiene sedes', 'location_not_found');
  return row.id;
}

/** Fecha local de la sede: es la que reinicia la numeración. */
async function localDate(organizationId: string, locationId: string): Promise<string> {
  const location = await db()
    .selectFrom('locations')
    .select(['timezone'])
    .where('id', '=', locationId)
    .executeTakeFirst();
  const organization = await getOrganization(organizationId);
  return todayIn(location?.timezone ?? organization?.timezone ?? 'Europe/Madrid');
}

type Row = {
  id: string;
  ticket_number: number;
  status: string;
  guest_name: string | null;
  guest_phone: string | null;
  service_id: string | null;
  resource_id: string | null;
  party_size: number;
  note: string | null;
  source: string;
  created_at: string;
  called_at: string | null;
  served_at: string | null;
  closed_at: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  service_name?: string | null;
  resource_name?: string | null;
  service_minutes?: number | null;
};

function baseQuery(organizationId: string, date: string, locationId: string) {
  return db()
    .selectFrom('queue_entries')
    .leftJoin('users', 'users.id', 'queue_entries.customer_id')
    .leftJoin('services', 'services.id', 'queue_entries.service_id')
    .leftJoin('resources', 'resources.id', 'queue_entries.resource_id')
    .select([
      'queue_entries.id',
      'queue_entries.ticket_number',
      'queue_entries.status',
      'queue_entries.guest_name',
      'queue_entries.guest_phone',
      'queue_entries.service_id',
      'queue_entries.resource_id',
      'queue_entries.party_size',
      'queue_entries.note',
      'queue_entries.source',
      'queue_entries.created_at',
      'queue_entries.called_at',
      'queue_entries.served_at',
      'queue_entries.closed_at',
      'users.name as customer_name',
      'users.phone as customer_phone',
      'services.name as service_name',
      'services.duration_minutes as service_minutes',
      'resources.name as resource_name',
    ])
    .where('queue_entries.organization_id', '=', organizationId)
    .where('queue_entries.local_date', '=', date)
    .where('queue_entries.location_id', '=', locationId)
    .orderBy('queue_entries.ticket_number');
}

/**
 * Cuántos profesionales están atendiendo.
 *
 * Se cuentan los recursos activos de la sede que se pueden elegir. Sin ninguno
 * se toma uno: dividir por cero daría una espera infinita, y lo que hay que
 * enseñar es una estimación pobre, no un absurdo.
 */
async function activeResources(organizationId: string, locationId: string): Promise<number> {
  const rows = await db()
    .selectFrom('resources')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('location_id', '=', locationId)
    .where('active', '=', 1)
    .where('deleted_at', 'is', null)
    .execute();
  return Math.max(1, rows.length);
}

function mapEntry(
  row: Row,
  options: { ahead: number; estimatedWaitMinutes: number },
): QueueEntry {
  return {
    id: row.id,
    ticketNumber: row.ticket_number,
    status: row.status as QueueStatus,
    name: row.customer_name ?? row.guest_name ?? 'Sin nombre',
    phone: row.customer_phone ?? row.guest_phone,
    serviceId: row.service_id,
    serviceName: row.service_name ?? null,
    resourceId: row.resource_id,
    resourceName: row.resource_name ?? null,
    partySize: row.party_size,
    note: row.note,
    source: row.source,
    ahead: options.ahead,
    estimatedWaitMinutes: options.estimatedWaitMinutes,
    joinedAt: row.created_at,
    calledAt: row.called_at,
    servedAt: row.served_at,
    closedAt: row.closed_at,
  };
}

/** La cola del día, con la espera ya calculada para cada turno que sigue vivo. */
export async function queueOf(
  organizationId: string,
  options: { locationId?: string; date?: string } = {},
): Promise<QueueView> {
  const settings = await queueSettings(organizationId);
  const locationId = options.locationId ?? (await defaultLocation(organizationId));
  const date = options.date ?? (await localDate(organizationId, locationId));

  const rows = (await baseQuery(organizationId, date, locationId).execute()) as Row[];
  const puestos = await activeResources(organizationId, locationId);

  const esperando = rows.filter((row) => row.status === 'waiting');

  /**
   * Minutos que hay por delante de cada uno: la suma de lo que dura lo que
   * vienen a hacer los que llegaron antes, repartida entre los profesionales.
   */
  const espera = new Map<string, { ahead: number; estimatedWaitMinutes: number }>();
  let acumulado = 0;
  esperando.forEach((row, indice) => {
    espera.set(row.id, {
      ahead: indice,
      estimatedWaitMinutes: Math.round(acumulado / puestos),
    });
    acumulado += row.service_minutes ?? settings.walkInDefaultMinutes;
  });

  const vacio = { ahead: 0, estimatedWaitMinutes: 0 };
  const porEstado = (status: QueueStatus) =>
    rows
      .filter((row) => row.status === status)
      .map((row) => mapEntry(row, espera.get(row.id) ?? vacio));

  return {
    date,
    locationId,
    waiting: porEstado('waiting'),
    called: porEstado('called'),
    serving: porEstado('serving'),
    closed: rows
      .filter((row) => row.status === 'done' || row.status === 'left')
      .map((row) => mapEntry(row, vacio)),
  };
}

/**
 * Apunta a alguien en la cola.
 *
 * El número de turno se calcula como el mayor del día más uno. Dos personas
 * llegando a la vez podrían pelearse por el mismo número; se acepta a
 * propósito, porque la alternativa (una tabla de contadores con su bloqueo) es
 * mucha máquina para una cola de mostrador, y un número repetido se arregla
 * llamando por nombre.
 */
export async function joinQueue(
  organizationId: string,
  input: JoinQueueInput,
  actor: { userId?: string | null; isStaff?: boolean } = {},
): Promise<QueueEntry> {
  const settings = await requireEnabled(organizationId);
  if (!actor.isStaff && !settings.walkInPublicJoin) {
    throw new BadRequestError('El turno solo se coge en el mostrador', 'queue_staff_only');
  }

  const locationId = input.locationId ?? (await defaultLocation(organizationId));
  const date = await localDate(organizationId, locationId);
  const customerId = actor.isStaff ? (input.customerId ?? null) : (actor.userId ?? null);

  if (!customerId && !input.name) {
    throw new BadRequestError('Hace falta un nombre para llamar al turno', 'queue_name_required');
  }

  // Una misma persona no puede tener dos turnos abiertos: apuntarse dos veces
  // adelanta el sitio de nadie y descuadra la espera de los demás.
  if (customerId) {
    const abierto = await db()
      .selectFrom('queue_entries')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .where('local_date', '=', date)
      .where('customer_id', '=', customerId)
      .where('status', 'in', OPEN_STATUSES)
      .executeTakeFirst();
    if (abierto) throw new ConflictError('Ya tienes un turno en la cola', 'queue_already_joined');
  }

  const ultimo = await db()
    .selectFrom('queue_entries')
    .select(['ticket_number'])
    .where('location_id', '=', locationId)
    .where('local_date', '=', date)
    .orderBy('ticket_number', 'desc')
    .executeTakeFirst();

  const id = newId();
  const now = isoNow();

  await db()
    .insertInto('queue_entries')
    .values({
      id,
      organization_id: organizationId,
      location_id: locationId,
      service_id: input.serviceId ?? null,
      resource_id: input.resourceId ?? null,
      customer_id: customerId,
      guest_name: input.name ?? null,
      guest_phone: input.phone ?? null,
      ticket_number: (ultimo?.ticket_number ?? 0) + 1,
      local_date: date,
      party_size: input.partySize,
      status: 'waiting',
      note: input.note ?? null,
      source: actor.isStaff ? 'staff' : 'online',
      called_at: null,
      served_at: null,
      closed_at: null,
      appointment_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const cola = await queueOf(organizationId, { locationId, date });
  const mio = cola.waiting.find((entry) => entry.id === id);
  if (!mio) throw new NotFoundError('El turno no se ha podido crear', 'queue_entry_not_found');
  return mio;
}

/** El siguiente de la cola, que es simplemente el que lleva más esperando. */
export async function callNext(
  organizationId: string,
  options: { locationId?: string } = {},
): Promise<QueueEntry | null> {
  await requireEnabled(organizationId);
  const locationId = options.locationId ?? (await defaultLocation(organizationId));
  const date = await localDate(organizationId, locationId);

  const siguiente = await db()
    .selectFrom('queue_entries')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('location_id', '=', locationId)
    .where('local_date', '=', date)
    .where('status', '=', 'waiting')
    .orderBy('ticket_number')
    .executeTakeFirst();

  if (!siguiente) return null;
  return changeQueueStatus(organizationId, siguiente.id, 'called');
}

export async function changeQueueStatus(
  organizationId: string,
  entryId: string,
  status: QueueStatus,
): Promise<QueueEntry> {
  const entry = await db()
    .selectFrom('queue_entries')
    .selectAll()
    .where('id', '=', entryId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!entry) throw new NotFoundError('El turno no existe', 'queue_entry_not_found');

  const now = isoNow();
  await db()
    .updateTable('queue_entries')
    .set({
      status,
      called_at: status === 'called' && !entry.called_at ? now : entry.called_at,
      served_at: status === 'serving' && !entry.served_at ? now : entry.served_at,
      closed_at: status === 'done' || status === 'left' ? now : null,
      updated_at: now,
    })
    .where('id', '=', entryId)
    .execute();

  if (status === 'called') await notifyCalled(organizationId, entryId);

  const cola = await queueOf(organizationId, {
    locationId: entry.location_id,
    date: entry.local_date,
  });
  const todos = [...cola.waiting, ...cola.called, ...cola.serving, ...cola.closed];
  const actualizado = todos.find((item) => item.id === entryId);
  if (!actualizado) throw new NotFoundError('El turno no existe', 'queue_entry_not_found');
  return actualizado;
}

/**
 * Avisa a quien le toca.
 *
 * Es la mitad del valor de la cola: la gente se va a dar una vuelta y vuelve
 * cuando le avisan, en lugar de quedarse de pie en la puerta. Si no dejó
 * ningún contacto, no hay nada que mandar y se canta el número en la sala.
 */
async function notifyCalled(organizationId: string, entryId: string): Promise<void> {
  const entry = await db()
    .selectFrom('queue_entries')
    .leftJoin('users', 'users.id', 'queue_entries.customer_id')
    .leftJoin('organizations', 'organizations.id', 'queue_entries.organization_id')
    .select([
      'queue_entries.customer_id',
      'queue_entries.guest_phone',
      'queue_entries.guest_name',
      'queue_entries.ticket_number',
      'users.name as customer_name',
      'users.email as customer_email',
      'users.phone as customer_phone',
      'users.locale as customer_locale',
      'organizations.name as organization_name',
      'organizations.locale as organization_locale',
    ])
    .where('queue_entries.id', '=', entryId)
    .executeTakeFirst();
  if (!entry) return;

  const telefono = entry.customer_phone ?? entry.guest_phone;
  if (!entry.customer_id && !telefono) return;

  await notify({
    event: 'queue.called',
    userId: entry.customer_id,
    organizationId,
    locale: (entry.customer_locale ?? entry.organization_locale ?? 'es') as Locale,
    to: { email: entry.customer_email, phone: telefono },
    vars: {
      usuario: entry.customer_name ?? entry.guest_name ?? '',
      organizacion: entry.organization_name ?? '',
      turno: entry.ticket_number,
    },
  }).catch((error) => logger.warn({ err: error, entryId }, 'No se pudo avisar del turno'));
}

/** Lo que ve el cliente de su propio turno. No enseña nada de los demás. */
export async function ticketStatus(
  organizationId: string,
  entryId: string,
): Promise<{
  ticketNumber: number;
  status: QueueStatus;
  ahead: number;
  estimatedWaitMinutes: number;
  organizationName: string;
  locationName: string;
}> {
  const entry = await db()
    .selectFrom('queue_entries')
    .innerJoin('locations', 'locations.id', 'queue_entries.location_id')
    .innerJoin('organizations', 'organizations.id', 'queue_entries.organization_id')
    .select([
      'queue_entries.id',
      'queue_entries.location_id',
      'queue_entries.local_date',
      'locations.name as location_name',
      'organizations.name as organization_name',
    ])
    .where('queue_entries.id', '=', entryId)
    .where('queue_entries.organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!entry) throw new NotFoundError('El turno no existe', 'queue_entry_not_found');

  const cola = await queueOf(organizationId, {
    locationId: entry.location_id,
    date: entry.local_date,
  });
  const mio = [...cola.waiting, ...cola.called, ...cola.serving, ...cola.closed].find(
    (item) => item.id === entryId,
  );
  if (!mio) throw new NotFoundError('El turno no existe', 'queue_entry_not_found');

  return {
    ticketNumber: mio.ticketNumber,
    status: mio.status,
    ahead: mio.ahead,
    estimatedWaitMinutes: mio.estimatedWaitMinutes,
    organizationName: entry.organization_name,
    locationName: entry.location_name,
  };
}

/**
 * Pantalla de sala: a quién se está llamando y quién va después.
 *
 * Solo el número y el nombre de pila. Una pantalla colgada en la pared la ve
 * todo el mundo, incluido quien pasa por la calle.
 */
export async function displayBoard(
  organizationId: string,
  options: { locationId?: string } = {},
): Promise<{
  organizationName: string;
  locationName: string;
  calling: { ticketNumber: number; name: string; resourceName: string | null }[];
  next: { ticketNumber: number; name: string }[];
}> {
  const locationId = options.locationId ?? (await defaultLocation(organizationId));
  const cola = await queueOf(organizationId, { locationId });

  const location = await db()
    .selectFrom('locations')
    .select(['name'])
    .where('id', '=', locationId)
    .executeTakeFirst();
  const organization = await getOrganization(organizationId);

  const nombreCorto = (nombre: string): string => nombre.trim().split(/\s+/)[0] ?? '';

  return {
    organizationName: organization?.name ?? '',
    locationName: location?.name ?? '',
    calling: [...cola.called, ...cola.serving].map((entry) => ({
      ticketNumber: entry.ticketNumber,
      name: nombreCorto(entry.name),
      resourceName: entry.resourceName,
    })),
    next: cola.waiting.slice(0, 5).map((entry) => ({
      ticketNumber: entry.ticketNumber,
      name: nombreCorto(entry.name),
    })),
  };
}
