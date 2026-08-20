import { createEvents, type EventAttributes } from 'ics';
import { db } from '../../db/index.js';
import { env } from '../../config/env.js';
import { DateTime, isoNow } from '../../lib/dates.js';
import { newId, shortCode } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { parseIcalBusy } from './ical.js';

/**
 * Calendario del profesional.
 *
 * Dos sentidos, y los dos hacen falta para que la agenda del negocio y la vida
 * de la persona no se pisen:
 *
 * - **Hacia fuera**: una dirección `.ics` suscribible con las citas de esa
 *   agenda, para verlas en el móvil junto a todo lo demás.
 * - **Hacia dentro**: la ocupación de un calendario externo se importa como
 *   ausencias, así que el hueco en el que esa persona tiene el médico deja de
 *   ofrecerse. Es la causa número uno de doble reserva.
 *
 * No se usa OAuth con Google ni con Microsoft a propósito. Una dirección `.ics`
 * la da cualquier calendario (Google, Outlook, Apple, Nextcloud) sin registrar
 * una aplicación, sin secretos que rotar y sin depender de que el negocio tenga
 * cuenta en ningún sitio.
 */

/** Cuántos días hacia adelante se publican y se importan. */
const HORIZON_DAYS = 90;

/* -------------------------------------------------------------------------- */
/* Hacia fuera: la agenda como calendario                                      */
/* -------------------------------------------------------------------------- */

/**
 * Crea o rota el identificador secreto de la dirección.
 *
 * Rotar es lo único que anula una dirección compartida por error: los clientes
 * de calendario no saben iniciar sesión, así que el secreto va en la propia
 * URL y no hay sesión que cerrar.
 */
export async function rotateCalendarToken(
  organizationId: string,
  resourceId: string,
): Promise<string> {
  const token = `${shortCode(12)}${shortCode(12)}`.toLowerCase();

  const actualizados = await db()
    .updateTable('resources')
    .set({ calendar_token: token, updated_at: isoNow() })
    .where('id', '=', resourceId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();

  if (Number(actualizados.numUpdatedRows ?? 0) === 0) {
    throw new NotFoundError('El recurso no existe', 'resource_not_found');
  }

  return token;
}

export function calendarFeedUrl(token: string): string {
  return `${env.APP_URL}/api/v1/public/calendar/${token}.ics`;
}

/** Las citas de una agenda en formato iCalendar, para suscribirse desde el móvil. */
export async function feedForToken(token: string): Promise<string> {
  const resource = await db()
    .selectFrom('resources')
    .select(['id', 'name', 'organization_id'])
    .where('calendar_token', '=', token)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!resource) throw new NotFoundError('No hay ninguna agenda con esa dirección');

  const desde = DateTime.utc().minus({ days: 7 }).toISO() ?? isoNow();
  const hasta = DateTime.utc().plus({ days: HORIZON_DAYS }).toISO() ?? isoNow();

  const citas = await db()
    .selectFrom('appointments')
    .innerJoin('services', 'services.id', 'appointments.service_id')
    .leftJoin('users', 'users.id', 'appointments.customer_id')
    .leftJoin('locations', 'locations.id', 'appointments.location_id')
    .select([
      'appointments.id',
      'appointments.starts_at',
      'appointments.ends_at',
      'appointments.status',
      'appointments.guest_name',
      'services.name as service_name',
      'users.name as customer_name',
      'locations.name as location_name',
      'locations.address_line as location_address',
    ])
    .where('appointments.resource_id', '=', resource.id)
    .where('appointments.starts_at', '>=', desde)
    .where('appointments.starts_at', '<=', hasta)
    .where('appointments.status', 'in', ['pending', 'confirmed', 'checked_in', 'in_progress'])
    .orderBy('appointments.starts_at')
    .execute();

  const eventos: EventAttributes[] = citas.map((cita) => {
    const inicio = DateTime.fromISO(cita.starts_at, { zone: 'utc' });
    const fin = DateTime.fromISO(cita.ends_at, { zone: 'utc' });
    const cliente = cita.customer_name ?? cita.guest_name ?? '';

    return {
      start: [inicio.year, inicio.month, inicio.day, inicio.hour, inicio.minute],
      end: [fin.year, fin.month, fin.day, fin.hour, fin.minute],
      startInputType: 'utc',
      endInputType: 'utc',
      title: cliente ? `${cita.service_name} · ${cliente}` : cita.service_name,
      location: [cita.location_name, cita.location_address].filter(Boolean).join(', '),
      uid: `${cita.id}@cita-facil`,
      productId: env.APP_NAME,
      status: cita.status === 'pending' ? 'TENTATIVE' : 'CONFIRMED',
    };
  });

  // Un calendario vacío también es una respuesta válida: la agenda existe y no
  // tiene nada. Devolver un error dejaría al cliente de calendario avisando.
  const { error, value } = createEvents(eventos.length > 0 ? eventos : []);
  if (error || !value) {
    throw error ?? new Error('No se pudo generar el calendario');
  }

  return value.replace('PRODID:-//Adam Gibbons//ics//EN', `PRODID:-//${env.APP_NAME}//ES`);
}

/* -------------------------------------------------------------------------- */
/* Hacia dentro: la ocupación externa                                          */
/* -------------------------------------------------------------------------- */

/**
 * Comprueba que la dirección es razonable antes de pedirla.
 *
 * El servidor va a hacer una petición a donde diga esta cadena, así que un
 * `http://localhost:6379` o un `http://169.254.169.254` la convertirían en una
 * ventana a la red interna. Se admite solo http y https y se descartan los
 * nombres que apuntan a la propia máquina o a rangos privados.
 *
 * No cubre un DNS que resuelva a una dirección interna, que haría falta atajar
 * en la capa de red. Es la misma línea que ya se traza con el certificado de
 * Alexa: comprobar lo que se puede comprobar sin montar un proxy.
 */
const PRIVADAS =
  /^(localhost$|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local$)/i;

export function assertSafeCalendarUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url.replace(/^webcal:/i, 'https:'));
  } catch {
    throw new BadRequestError('La dirección del calendario no es válida', 'calendar_url_invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestError('Solo se admiten direcciones http o https', 'calendar_url_invalid');
  }
  if (PRIVADAS.test(parsed.hostname)) {
    throw new BadRequestError(
      'Esa dirección apunta a la red interna del servidor',
      'calendar_url_forbidden',
    );
  }

  return parsed;
}

/** Tope de descarga: un calendario personal no pesa más y así no se llena la memoria. */
const MAX_BYTES = 2 * 1024 * 1024;

async function download(url: URL): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'text/calendar, text/plain' },
      redirect: 'follow',
    });
    if (!response.ok) {
      throw new BadRequestError(
        `El calendario respondió ${response.status}`,
        'calendar_fetch_failed',
      );
    }

    const texto = await response.text();
    if (texto.length > MAX_BYTES) {
      throw new BadRequestError('El calendario es demasiado grande', 'calendar_too_large');
    }
    return texto;
  } finally {
    clearTimeout(timeout);
  }
}

export interface SyncResult {
  imported: number;
  syncedAt: string;
}

/**
 * Trae la ocupación del calendario externo de una agenda.
 *
 * Se borra lo importado antes y se vuelve a escribir entero. Es más simple que
 * cuadrar altas, bajas y cambios de cada evento, y con noventa días de horizonte
 * son unas pocas decenas de filas. Lo que puso alguien a mano no se toca, que es
 * para lo que existe la columna `source`.
 */
export async function syncResourceCalendar(
  organizationId: string,
  resourceId: string,
): Promise<SyncResult> {
  const resource = await db()
    .selectFrom('resources')
    .select(['id', 'calendar_url', 'location_id'])
    .where('id', '=', resourceId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!resource) throw new NotFoundError('El recurso no existe', 'resource_not_found');
  if (!resource.calendar_url) {
    throw new BadRequestError('Esta agenda no tiene calendario externo', 'calendar_url_missing');
  }

  const ventana = {
    from: DateTime.utc().startOf('day').toISO() ?? isoNow(),
    to: DateTime.utc().plus({ days: HORIZON_DAYS }).toISO() ?? isoNow(),
  };

  try {
    const texto = await download(assertSafeCalendarUrl(resource.calendar_url));
    const eventos = parseIcalBusy(texto, ventana);

    await db()
      .deleteFrom('time_off')
      .where('organization_id', '=', organizationId)
      .where('resource_id', '=', resourceId)
      .where('source', '=', 'calendar')
      .execute();

    if (eventos.length > 0) {
      const now = isoNow();
      await db()
        .insertInto('time_off')
        .values(
          eventos.map((evento) => ({
            id: newId(),
            organization_id: organizationId,
            location_id: resource.location_id,
            resource_id: resourceId,
            starts_at: evento.startsAt,
            ends_at: evento.endsAt,
            // El asunto del evento personal no se guarda: en la agenda del
            // negocio no pinta nada que alguien vaya al dentista.
            reason: 'Calendario personal',
            source: 'calendar',
            external_uid: evento.uid.slice(0, 200),
            created_by: null,
            created_at: now,
          })),
        )
        .execute();
    }

    const syncedAt = isoNow();
    await db()
      .updateTable('resources')
      .set({ calendar_synced_at: syncedAt, calendar_error: null, updated_at: syncedAt })
      .where('id', '=', resourceId)
      .execute();

    return { imported: eventos.length, syncedAt };
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error desconocido';
    await db()
      .updateTable('resources')
      .set({ calendar_error: mensaje.slice(0, 300), updated_at: isoNow() })
      .where('id', '=', resourceId)
      .execute();
    throw error;
  }
}

/**
 * Guarda (o quita) el calendario externo de una agenda.
 *
 * Quitarlo borra lo importado: dejar las ausencias de un calendario que ya no
 * se consulta significa bloquear huecos para siempre por un motivo que nadie
 * puede revisar.
 */
export async function setExternalCalendar(
  organizationId: string,
  resourceId: string,
  url: string | null,
): Promise<{ url: string | null; imported: number }> {
  if (url) assertSafeCalendarUrl(url);

  const actualizados = await db()
    .updateTable('resources')
    .set({
      calendar_url: url,
      calendar_error: null,
      calendar_synced_at: null,
      updated_at: isoNow(),
    })
    .where('id', '=', resourceId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();

  if (Number(actualizados.numUpdatedRows ?? 0) === 0) {
    throw new NotFoundError('El recurso no existe', 'resource_not_found');
  }

  if (!url) {
    await db()
      .deleteFrom('time_off')
      .where('organization_id', '=', organizationId)
      .where('resource_id', '=', resourceId)
      .where('source', '=', 'calendar')
      .execute();
    return { url: null, imported: 0 };
  }

  const resultado = await syncResourceCalendar(organizationId, resourceId);
  return { url, imported: resultado.imported };
}

/** Sincroniza todas las agendas que tengan calendario externo. Lo llama el planificador. */
export async function syncAllCalendars(): Promise<number> {
  const recursos = await db()
    .selectFrom('resources')
    .select(['id', 'organization_id'])
    .where('calendar_url', 'is not', null)
    .where('active', '=', 1)
    .where('deleted_at', 'is', null)
    .execute();

  let sincronizados = 0;
  for (const recurso of recursos) {
    try {
      await syncResourceCalendar(recurso.organization_id, recurso.id);
      sincronizados += 1;
    } catch (error) {
      // Un calendario que ya no existe no puede parar los de los demás: el
      // motivo queda anotado en el recurso y se ve en el panel.
      logger.warn({ err: error, resourceId: recurso.id }, 'No se pudo sincronizar el calendario');
    }
  }

  return sincronizados;
}
