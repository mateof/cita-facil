/**
 * Lector de iCalendar.
 *
 * Se escribe a mano, como el resto de integraciones del proyecto. Lo que hace
 * falta es sacar de un calendario personal cuándo está ocupada una persona, no
 * implementar el RFC 5545 entero: no hay que pintar los eventos, ni saber su
 * color, ni respetar sus alarmas.
 *
 * Qué entiende:
 *
 * - `VEVENT` con `DTSTART`/`DTEND` en UTC (`...Z`), con `TZID` o de día
 *   completo (`VALUE=DATE`).
 * - Líneas partidas, que es como se guardan las descripciones largas.
 * - Repeticiones sencillas: `FREQ=DAILY` y `FREQ=WEEKLY`, con `INTERVAL`,
 *   `COUNT`, `UNTIL` y `BYDAY`.
 *
 * Qué no entiende, y hay que saberlo: repeticiones mensuales o anuales,
 * excepciones (`EXDATE`), modificaciones de una repetición concreta
 * (`RECURRENCE-ID`) y zonas horarias definidas dentro del propio fichero
 * (`VTIMEZONE`), de las que solo se usa el identificador. Una cita suelta y una
 * reunión semanal, que es el 95 % de un calendario personal, sí salen.
 */

import { DateTime } from '../../lib/dates.js';

export interface IcalEvent {
  uid: string;
  summary: string;
  /** Instante ISO-8601 en UTC. */
  startsAt: string;
  endsAt: string;
  /** `true` si el original marcaba la persona como disponible. */
  transparent: boolean;
}

/** Deshace el plegado de líneas del formato: una continuación empieza por espacio. */
function unfold(text: string): string[] {
  const lineas: string[] = [];
  for (const linea of text.replace(/\r\n/g, '\n').split('\n')) {
    if ((linea.startsWith(' ') || linea.startsWith('\t')) && lineas.length > 0) {
      lineas[lineas.length - 1] += linea.slice(1);
    } else {
      lineas.push(linea);
    }
  }
  return lineas;
}

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

function parseLine(linea: string): Prop | null {
  const separador = linea.indexOf(':');
  if (separador === -1) return null;

  const izquierda = linea.slice(0, separador);
  const value = linea.slice(separador + 1);
  const [name, ...partes] = izquierda.split(';');

  const params: Record<string, string> = {};
  for (const parte of partes) {
    const igual = parte.indexOf('=');
    if (igual > 0) params[parte.slice(0, igual).toUpperCase()] = parte.slice(igual + 1);
  }

  return { name: (name ?? '').toUpperCase(), params, value };
}

/** `20260315T093000Z`, `20260315T093000` con `TZID`, o `20260315` de día completo. */
function toInstant(prop: Prop): string | null {
  const valor = prop.value.trim();

  if (/^\d{8}$/.test(valor)) {
    const fecha = `${valor.slice(0, 4)}-${valor.slice(4, 6)}-${valor.slice(6, 8)}`;
    const zona = prop.params.TZID ?? 'UTC';
    const dt = DateTime.fromISO(fecha, { zone: zona });
    return dt.isValid ? dt.toUTC().toISO() : null;
  }

  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(valor);
  if (!match) return null;

  const [, y, m, d, hh, mm, ss, utc] = match;
  const iso = `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  const zona = utc ? 'utc' : (prop.params.TZID ?? 'utc');
  const dt = DateTime.fromISO(iso, { zone: zona });
  return dt.isValid ? dt.toUTC().toISO() : null;
}

const DIAS: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

/**
 * Expande una repetición dentro de la ventana pedida.
 *
 * Se corta en `limit` ocurrencias aunque la regla no acabe nunca: un calendario
 * con una reunión diaria "para siempre" generaría ausencias hasta el infinito.
 */
function expand(
  base: IcalEvent,
  rrule: string,
  window: { from: string; to: string },
  limit = 400,
): IcalEvent[] {
  const reglas: Record<string, string> = {};
  for (const parte of rrule.split(';')) {
    const igual = parte.indexOf('=');
    if (igual > 0) reglas[parte.slice(0, igual).toUpperCase()] = parte.slice(igual + 1);
  }

  const freq = (reglas.FREQ ?? '').toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return [base];

  const interval = Math.max(1, Number(reglas.INTERVAL ?? 1));
  const count = reglas.COUNT ? Number(reglas.COUNT) : null;
  const until = reglas.UNTIL ? toInstant({ name: 'UNTIL', params: {}, value: reglas.UNTIL }) : null;
  const byday = (reglas.BYDAY ?? '')
    .split(',')
    .map((dia) => DIAS[dia.trim().toUpperCase().slice(-2)])
    .filter((dia): dia is number => Boolean(dia));

  const inicio = DateTime.fromISO(base.startsAt, { zone: 'utc' });
  const duracion = DateTime.fromISO(base.endsAt).toMillis() - inicio.toMillis();

  const eventos: IcalEvent[] = [];
  let cursor = inicio;
  let generados = 0;

  for (let vuelta = 0; vuelta < limit * 2 && generados < limit; vuelta += 1) {
    const iso = cursor.toISO();
    if (!iso) break;
    if (until && iso > until) break;
    if (count && generados >= count) break;
    if (iso > window.to) break;

    const encajaDia = byday.length === 0 || byday.includes(cursor.weekday);
    if (encajaDia && iso >= window.from) {
      eventos.push({
        ...base,
        uid: `${base.uid}-${iso.slice(0, 10)}`,
        startsAt: iso,
        endsAt: cursor.plus({ milliseconds: duracion }).toUTC().toISO() ?? base.endsAt,
      });
    }
    if (encajaDia) generados += 1;

    cursor =
      freq === 'DAILY'
        ? cursor.plus({ days: interval })
        : byday.length > 0
          ? cursor.plus({ days: 1 })
          : cursor.plus({ weeks: interval });
  }

  return eventos;
}

/** Eventos que ocupan tiempo dentro de la ventana pedida. */
export function parseIcalBusy(text: string, window: { from: string; to: string }): IcalEvent[] {
  const eventos: IcalEvent[] = [];
  let actual: Partial<IcalEvent> & { rrule?: string } = {};
  let dentro = false;

  for (const linea of unfold(text)) {
    if (linea.startsWith('BEGIN:VEVENT')) {
      dentro = true;
      actual = {};
      continue;
    }

    if (linea.startsWith('END:VEVENT')) {
      dentro = false;
      if (actual.startsAt && actual.endsAt && !actual.transparent) {
        const base: IcalEvent = {
          uid: actual.uid ?? `${actual.startsAt}-sin-uid`,
          summary: actual.summary ?? '',
          startsAt: actual.startsAt,
          endsAt: actual.endsAt,
          transparent: false,
        };
        const expandidos = actual.rrule ? expand(base, actual.rrule, window) : [base];
        for (const evento of expandidos) {
          if (evento.endsAt > window.from && evento.startsAt < window.to) eventos.push(evento);
        }
      }
      continue;
    }

    if (!dentro) continue;

    const prop = parseLine(linea);
    if (!prop) continue;

    switch (prop.name) {
      case 'UID':
        actual.uid = prop.value.trim();
        break;
      case 'SUMMARY':
        actual.summary = prop.value.replace(/\\,/g, ',').replace(/\\n/gi, ' ').trim();
        break;
      case 'DTSTART':
        actual.startsAt = toInstant(prop) ?? undefined;
        break;
      case 'DTEND':
        actual.endsAt = toInstant(prop) ?? undefined;
        break;
      case 'RRULE':
        actual.rrule = prop.value.trim();
        break;
      case 'TRANSP':
        // `TRANSPARENT` es "esto no me ocupa": una cita marcada así no bloquea.
        actual.transparent = prop.value.trim().toUpperCase() === 'TRANSPARENT';
        break;
      case 'STATUS':
        if (prop.value.trim().toUpperCase() === 'CANCELLED') actual.transparent = true;
        break;
      default:
        break;
    }
  }

  return eventos;
}
