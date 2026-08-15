import { intlLocale } from '../i18n/index.ts';

/** Utilidades de presentación. Todas reciben el idioma activo explícitamente. */

export function formatMoney(amountCents: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: 'currency',
    currency,
    // Los importes redondos se ven mejor sin decimales en listados densos.
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
}

export function formatDate(
  value: string,
  locale: string,
  timezone?: string,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'full' },
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...options, timeZone: timezone }).format(
    new Date(value),
  );
}

export function formatTime(value: string, locale: string, timezone?: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
    hour12: false,
  }).format(new Date(value));
}

export function formatDateTime(value: string, locale: string, timezone?: string): string {
  return `${formatDate(value, locale, timezone, { dateStyle: 'medium' })} · ${formatTime(value, locale, timezone)}`;
}

/** `540` -> `09:00` */
export function minutesToTime(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function timeToMinutes(value: string): number {
  const [hh, mm] = value.split(':');
  return Number(hh ?? 0) * 60 + Number(mm ?? 0);
}

/** Duración legible: `90` -> `1 h 30 min`. */
export function formatDuration(minutes: number, locale: string): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourLabel = locale === 'en' ? 'h' : 'h';
  const minuteLabel = 'min';

  if (hours === 0) return `${rest} ${minuteLabel}`;
  if (rest === 0) return `${hours} ${hourLabel}`;
  return `${hours} ${hourLabel} ${rest} ${minuteLabel}`;
}

/** Antelación de un recordatorio en texto: `1440` -> `1 día antes`. */
export function formatLeadTime(minutes: number, locale: string): string {
  const dictionary = {
    es: { day: 'día', days: 'días', hour: 'hora', hours: 'horas', minute: 'minuto', minutes: 'minutos', before: 'antes' },
    gl: { day: 'día', days: 'días', hour: 'hora', hours: 'horas', minute: 'minuto', minutes: 'minutos', before: 'antes' },
    en: { day: 'day', days: 'days', hour: 'hour', hours: 'hours', minute: 'minute', minutes: 'minutes', before: 'before' },
  }[locale.slice(0, 2) as 'es' | 'gl' | 'en'] ?? {
    day: 'día',
    days: 'días',
    hour: 'hora',
    hours: 'horas',
    minute: 'minuto',
    minutes: 'minutos',
    before: 'antes',
  };

  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? dictionary.day : dictionary.days} ${dictionary.before}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? dictionary.hour : dictionary.hours} ${dictionary.before}`;
  }
  return `${minutes} ${minutes === 1 ? dictionary.minute : dictionary.minutes} ${dictionary.before}`;
}

/** Fecha local de hoy en formato `YYYY-MM-DD`, en la zona indicada. */
export function todayIso(timezone?: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

export function addDaysIso(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Color de estado para las etiquetas de la agenda. */
export function statusClass(status: string): string {
  switch (status) {
    case 'confirmed':
      return 'bg-emerald-100 text-emerald-800';
    case 'pending':
      return 'bg-amber-100 text-amber-800';
    case 'checked_in':
    case 'in_progress':
      return 'bg-blue-100 text-blue-800';
    case 'completed':
      return 'bg-slate-200 text-slate-700';
    case 'cancelled':
    case 'rejected':
    case 'expired':
      return 'bg-red-100 text-red-700';
    case 'no_show':
      return 'bg-orange-100 text-orange-800';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}
