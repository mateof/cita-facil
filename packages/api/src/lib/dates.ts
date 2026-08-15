import { DateTime } from 'luxon';
import type { IsoDate, IsoInstant } from '@cita-facil/shared';

/**
 * Conversiones entre el instante UTC que se guarda y la hora local de la sede.
 *
 * Toda la lógica de agenda razona en hora local (una peluquería abre "de 9 a
 * 14" en su zona, no en UTC), pero se persiste en UTC para poder comparar y
 * ordenar entre sedes con zonas distintas. Luxon resuelve los cambios de hora:
 * en el salto de primavera hay minutos locales que no existen y en el de otoño
 * hay minutos que ocurren dos veces.
 */

export interface LocalMoment {
  date: IsoDate;
  minute: number;
}

/** Convierte fecha local + minuto del día en el instante UTC correspondiente. */
export function localToInstant(date: IsoDate, minute: number, timezone: string): IsoInstant {
  const dt = DateTime.fromISO(date, { zone: timezone })
    .startOf('day')
    .plus({ minutes: minute });
  if (!dt.isValid) {
    throw new Error(`Fecha u hora local no válida: ${date} +${minute}min (${timezone})`);
  }
  return dt.toUTC().toISO({ suppressMilliseconds: false })!.replace(/[+-]\d{2}:\d{2}$/, 'Z');
}

/** Convierte un instante UTC en fecha local y minuto del día de esa zona. */
export function instantToLocal(instant: IsoInstant, timezone: string): LocalMoment {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(timezone);
  if (!dt.isValid) throw new Error(`Instante no válido: ${instant}`);
  return {
    date: dt.toISODate()!,
    minute: dt.hour * 60 + dt.minute,
  };
}

/** Fecha local de hoy en la zona indicada. */
export function todayIn(timezone: string, at: Date = new Date()): IsoDate {
  return DateTime.fromJSDate(at, { zone: timezone }).toISODate()!;
}

/** Minuto del día actual en la zona indicada. */
export function currentMinuteIn(timezone: string, at: Date = new Date()): number {
  const dt = DateTime.fromJSDate(at, { zone: timezone });
  return dt.hour * 60 + dt.minute;
}

/**
 * Duración real de un día local en minutos. Normalmente 1440, pero 1380 o 1500
 * en los días de cambio de hora. La agenda lo necesita para no generar huecos
 * inexistentes ni perder una hora de disponibilidad.
 */
export function minutesInLocalDay(date: IsoDate, timezone: string): number {
  const start = DateTime.fromISO(date, { zone: timezone }).startOf('day');
  const next = start.plus({ days: 1 });
  return Math.round(next.diff(start, 'minutes').minutes);
}

/** Día ISO de la semana (1 = lunes ... 7 = domingo) de una fecha local. */
export function weekdayOf(date: IsoDate): number {
  return DateTime.fromISO(date).weekday;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return DateTime.fromISO(date).plus({ days }).toISODate()!;
}

export function isoNow(): IsoInstant {
  return new Date().toISOString();
}

export function addMinutesToInstant(instant: IsoInstant, minutes: number): IsoInstant {
  return new Date(Date.parse(instant) + minutes * 60_000).toISOString();
}

export function instantIsBefore(a: IsoInstant, b: IsoInstant): boolean {
  return Date.parse(a) < Date.parse(b);
}

/** Formatea un instante para mostrarlo en una notificación. */
export function formatForHumans(
  instant: IsoInstant,
  timezone: string,
  locale: string,
  format: 'full' | 'short' | 'time' | 'date' = 'full',
): string {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(timezone).setLocale(locale);
  switch (format) {
    case 'time':
      return dt.toFormat('HH:mm');
    case 'date':
      return dt.toLocaleString(DateTime.DATE_FULL);
    case 'short':
      return dt.toFormat("dd/MM/yyyy 'a las' HH:mm");
    case 'full':
    default:
      return `${dt.toLocaleString(DateTime.DATE_FULL)}, ${dt.toFormat('HH:mm')}`;
  }
}

/** Comprueba que la zona horaria existe en este runtime. */
export function assertTimezone(timezone: string): string {
  if (!DateTime.local().setZone(timezone).isValid) {
    throw new Error(`Zona horaria no reconocida: ${timezone}`);
  }
  return timezone;
}

export { DateTime };
