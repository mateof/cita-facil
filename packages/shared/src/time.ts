/**
 * Utilidades de tiempo compartidas entre backend y frontend.
 *
 * Convenciones de almacenamiento del proyecto (ver docs/arquitectura.md):
 * - Los instantes se guardan como cadena ISO-8601 en UTC con milisegundos y
 *   sufijo `Z` (p. ej. `2026-07-25T09:30:00.000Z`). Al tener siempre el mismo
 *   formato, la comparación y la ordenación lexicográfica coinciden con la
 *   cronológica en los cinco motores de base de datos soportados.
 * - Las fechas locales se guardan como `YYYY-MM-DD`.
 * - Las horas locales se guardan como minutos desde medianoche (entero 0..1440).
 */

export const MINUTES_PER_DAY = 1440;

/** `2026-07-25` */
export type IsoDate = string;
/** `2026-07-25T09:30:00.000Z` */
export type IsoInstant = string;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function isIsoDate(value: string): value is IsoDate {
  return ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

export function isIsoInstant(value: string): value is IsoInstant {
  return ISO_INSTANT_RE.test(value) && !Number.isNaN(Date.parse(value));
}

/** Normaliza cualquier `Date` o cadena a la representación canónica del proyecto. */
export function toInstant(value: Date | string | number): IsoInstant {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Instante no válido: ${String(value)}`);
  }
  return date.toISOString();
}

export function nowInstant(): IsoInstant {
  return new Date().toISOString();
}

export function addMinutes(instant: IsoInstant, minutes: number): IsoInstant {
  return new Date(Date.parse(instant) + minutes * 60_000).toISOString();
}

export function diffMinutes(from: IsoInstant, to: IsoInstant): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60_000);
}

/** `540` -> `09:00` */
export function minutesToHhMm(minutes: number): string {
  const normalized = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hh = Math.floor(normalized / 60);
  const mm = normalized % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** `09:00` -> `540`. Acepta `24:00` como final de jornada. */
export function hhMmToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new TypeError(`Hora no válida: ${value}`);
  const hours = Number(match[1]);
  const mins = Number(match[2]);
  if (hours > 24 || mins > 59 || (hours === 24 && mins !== 0)) {
    throw new RangeError(`Hora fuera de rango: ${value}`);
  }
  return hours * 60 + mins;
}

/** Día ISO de la semana (1 = lunes ... 7 = domingo) de una fecha local. */
export function isoWeekday(date: IsoDate): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function addDaysToDate(date: IsoDate, days: number): IsoDate {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Lista inclusiva de fechas entre dos extremos. */
export function dateRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const total = daysBetween(from, to);
  if (total < 0) return [];
  return Array.from({ length: total + 1 }, (_, index) => addDaysToDate(from, index));
}

export interface Interval {
  /** Minuto de inicio, inclusive. */
  start: number;
  /** Minuto de fin, exclusive. */
  end: number;
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Une intervalos solapados o contiguos y los devuelve ordenados. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last && current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Resta a `base` todos los intervalos de `holes`. */
export function subtractIntervals(
  base: readonly Interval[],
  holes: readonly Interval[],
): Interval[] {
  const blocked = mergeIntervals(holes);
  let result = mergeIntervals(base);
  for (const hole of blocked) {
    const next: Interval[] = [];
    for (const segment of result) {
      if (!intervalsOverlap(segment, hole)) {
        next.push(segment);
        continue;
      }
      if (segment.start < hole.start) next.push({ start: segment.start, end: hole.start });
      if (hole.end < segment.end) next.push({ start: hole.end, end: segment.end });
    }
    result = next;
  }
  return result;
}

/** Formatea un instante en la zona horaria indicada usando `Intl`. */
export function formatInstant(
  instant: IsoInstant,
  timezone: string,
  locale: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'full', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(localeTag(locale), { ...options, timeZone: timezone }).format(
    new Date(instant),
  );
}

/** El gallego usa la etiqueta BCP-47 `gl-ES`; el resto se mapean a su región habitual. */
export function localeTag(locale: string): string {
  switch (locale) {
    case 'es':
      return 'es-ES';
    case 'gl':
      return 'gl-ES';
    case 'en':
      return 'en-GB';
    default:
      return locale;
  }
}

/** Formatea importes guardados en unidades menores (céntimos). */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(localeTag(locale), {
    style: 'currency',
    currency,
  }).format(amountMinor / 100);
}

/** Comprueba que una zona horaria IANA es válida en este runtime. */
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
