import { db } from '../../db/index.js';

import { addDays, todayIn } from '../../lib/dates.js';

import { NotFoundError } from '../../lib/errors.js';

import { getOrganization } from '../catalog/service.js';



/**

 * Informes.

 *

 * Las agregaciones se hacen sobre `local_date`, la fecha local desnormalizada

 * que lleva cada cita. Agrupar por el instante UTC daría resultados

 * desplazados: una cita de las 00:30 en Madrid pertenece al día anterior en UTC

 * y aparecería en el informe equivocado.

 *

 * Todo vive aquí y no en la ruta porque los mismos números se sirven en dos

 * formatos, JSON para el panel y CSV para la gestoría, y no pueden salir de dos

 * consultas distintas: el día que una cambie, la otra enseñaría otra cosa.

 */



export interface ReportRange {

  from: string;

  to: string;

  timezone: string;

  currency: string;

  locationId?: string;

}



/** Estados que cuentan como trabajo hecho o comprometido. */

const ACTIVE_STATUSES = ['confirmed', 'checked_in', 'in_progress', 'completed'];



export async function resolveRange(

  organizationId: string,

  query: { from?: string; to?: string; locationId?: string },

): Promise<ReportRange> {

  const organization = await getOrganization(organizationId);

  if (!organization) throw new NotFoundError('La organización no existe');

  const today = todayIn(organization.timezone);



  return {

    from: query.from ?? addDays(today, -29),

    to: query.to ?? today,

    timezone: organization.timezone,

    currency: organization.currency,

    locationId: query.locationId,

  };

}



/** El mismo número de días, justo antes del rango pedido. */

export function previousRange(range: ReportRange): ReportRange {

  const dias = Math.round(

    (Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`)) / 86_400_000,

  );

  return { ...range, from: addDays(range.from, -(dias + 1)), to: addDays(range.from, -1) };

}



function baseQuery(organizationId: string, range: ReportRange) {

  let query = db()

    .selectFrom('appointments')

    .where('organization_id', '=', organizationId)

    .where('local_date', '>=', range.from)

    .where('local_date', '<=', range.to)

    .where('status', '!=', 'hold');

  if (range.locationId) query = query.where('location_id', '=', range.locationId);

  return query;

}



export interface SummaryTotals {

  total: number;

  completed: number;

  cancelled: number;

  noShows: number;

  cancellationRate: number;

  noShowRate: number;

  revenueCents: number;

  expectedRevenueCents: number;

  averageTicketCents: number;

  bookedMinutes: number;

  byStatus: Record<string, number>;

  bySource: Record<string, number>;

}



async function totalsFor(organizationId: string, range: ReportRange): Promise<SummaryTotals> {

  const rows = await baseQuery(organizationId, range)

    .select(['status', 'price_cents', 'payment_status', 'duration_minutes', 'source'])

    .execute();



  const total = rows.length;

  const completed = rows.filter((row) => row.status === 'completed');

  const cancelled = rows.filter((row) => row.status === 'cancelled').length;

  const noShows = rows.filter((row) => row.status === 'no_show').length;



  const revenueCents = rows

    .filter((row) => row.payment_status === 'paid')

    .reduce((sum, row) => sum + row.price_cents, 0);



  return {

    total,

    completed: completed.length,

    cancelled,

    noShows,

    cancellationRate: total > 0 ? round1((cancelled / total) * 100) : 0,

    noShowRate: total > 0 ? round1((noShows / total) * 100) : 0,

    revenueCents,

    expectedRevenueCents: rows

      .filter((row) => ACTIVE_STATUSES.includes(row.status))

      .reduce((sum, row) => sum + row.price_cents, 0),

    averageTicketCents: completed.length > 0 ? Math.round(revenueCents / completed.length) : 0,

    bookedMinutes: rows

      .filter((row) => !['cancelled', 'rejected', 'expired'].includes(row.status))

      .reduce((sum, row) => sum + row.duration_minutes, 0),

    byStatus: countBy(rows, (row) => row.status),

    bySource: countBy(rows, (row) => row.source),

  };

}



/**

 * Resumen del periodo con el periodo anterior al lado.

 *

 * La comparativa es la mitad del informe: "1.200 euros" no dice nada sin saber

 * si el mes pasado fueron 900 o 1.500. Se compara con el mismo número de días

 * justo antes, no con el mes natural anterior, porque el rango lo elige quien

 * mira y puede ser de once días.

 */

export async function summary(organizationId: string, range: ReportRange) {

  const anterior = previousRange(range);

  const [actual, previo] = await Promise.all([

    totalsFor(organizationId, range),

    totalsFor(organizationId, anterior),

  ]);



  return {

    range: { from: range.from, to: range.to },

    currency: range.currency,

    ...actual,

    previous: {

      range: { from: anterior.from, to: anterior.to },

      total: previo.total,

      completed: previo.completed,

      revenueCents: previo.revenueCents,

      noShowRate: previo.noShowRate,

      cancellationRate: previo.cancellationRate,

      bookedMinutes: previo.bookedMinutes,

    },

  };

}



export async function daily(organizationId: string, range: ReportRange) {

  let query = db()

    .selectFrom('appointments')

    .select((eb) => [

      'local_date',

      eb.fn.countAll<number>().as('total'),

      eb.fn.sum<number>('price_cents').as('revenue_cents'),

      eb.fn.sum<number>('duration_minutes').as('minutes'),

    ])

    .where('organization_id', '=', organizationId)

    .where('local_date', '>=', range.from)

    .where('local_date', '<=', range.to)

    .where('status', 'in', ACTIVE_STATUSES)

    .groupBy('local_date')

    .orderBy('local_date');



  if (range.locationId) query = query.where('location_id', '=', range.locationId);



  const rows = await query.execute();

  const byDate = new Map(rows.map((row) => [row.local_date, row]));



  // Se rellenan los días sin citas para que la gráfica no tenga huecos.

  const series = [];

  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {

    const row = byDate.get(date);

    series.push({

      date,

      total: Number(row?.total ?? 0),

      revenueCents: Number(row?.revenue_cents ?? 0),

      minutes: Number(row?.minutes ?? 0),

    });

  }



  return { series, currency: range.currency };

}



export async function services(organizationId: string, range: ReportRange) {

  let query = db()

    .selectFrom('appointments')

    .innerJoin('services', 'services.id', 'appointments.service_id')

    .select((eb) => [

      'services.id',

      'services.name',

      eb.fn.countAll<number>().as('total'),

      eb.fn.sum<number>('appointments.price_cents').as('revenue_cents'),

    ])

    .where('appointments.organization_id', '=', organizationId)

    .where('appointments.local_date', '>=', range.from)

    .where('appointments.local_date', '<=', range.to)

    .where('appointments.status', 'in', ['confirmed', 'checked_in', 'completed'])

    .groupBy(['services.id', 'services.name'])

    .orderBy('total', 'desc')

    .limit(50);



  if (range.locationId) query = query.where('appointments.location_id', '=', range.locationId);



  const rows = await query.execute();

  return rows.map((row) => ({

    serviceId: row.id,

    name: row.name,

    total: Number(row.total),

    revenueCents: Number(row.revenue_cents ?? 0),

  }));

}



export async function resources(organizationId: string, range: ReportRange) {

  let booked = db()

    .selectFrom('appointments')

    .innerJoin('resources', 'resources.id', 'appointments.resource_id')

    .select((eb) => [

      'resources.id',

      'resources.name',

      eb.fn.countAll<number>().as('total'),

      eb.fn.sum<number>('appointments.duration_minutes').as('minutes'),

      eb.fn.sum<number>('appointments.price_cents').as('revenue_cents'),

    ])

    .where('appointments.organization_id', '=', organizationId)

    .where('appointments.local_date', '>=', range.from)

    .where('appointments.local_date', '<=', range.to)

    .where('appointments.status', 'in', ACTIVE_STATUSES)

    .groupBy(['resources.id', 'resources.name']);



  if (range.locationId) booked = booked.where('appointments.location_id', '=', range.locationId);



  const reservado = await booked.execute();



  // Minutos de apertura: se suman las reglas de horario de cada recurso (o de

  // su sede si no tiene propio) por cada día del rango.

  const schedules = await db()

    .selectFrom('schedules')

    .select(['owner_type', 'owner_id', 'weekday', 'start_minute', 'end_minute'])

    .where('organization_id', '=', organizationId)

    .execute();



  let resourceQuery = db()

    .selectFrom('resources')

    .select(['id', 'name', 'location_id', 'commission_bp'])

    .where('organization_id', '=', organizationId)

    .where('active', '=', 1)

    .where('deleted_at', 'is', null);

  if (range.locationId) resourceQuery = resourceQuery.where('location_id', '=', range.locationId);



  const list = await resourceQuery.execute();



  const days: number[] = [];

  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {

    days.push(new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7);

  }



  return list.map((resource) => {

    const own = schedules.filter(

      (rule) => rule.owner_type === 'resource' && rule.owner_id === resource.id,

    );

    const inherited = schedules.filter(

      (rule) => rule.owner_type === 'location' && rule.owner_id === resource.location_id,

    );

    const rules = own.length > 0 ? own : inherited;



    const availableMinutes = days.reduce(

      (sum, weekday) =>

        sum +

        rules

          .filter((rule) => rule.weekday === weekday)

          .reduce((total, rule) => total + (rule.end_minute - rule.start_minute), 0),

      0,

    );



    const stats = reservado.find((row) => row.id === resource.id);

    const bookedMinutes = Number(stats?.minutes ?? 0);



    return {

      resourceId: resource.id,

      name: resource.name,

      appointments: Number(stats?.total ?? 0),

      bookedMinutes,

      availableMinutes,

      occupancyRate: availableMinutes > 0 ? round1((bookedMinutes / availableMinutes) * 100) : 0,

      revenueCents: Number(stats?.revenue_cents ?? 0),

    };

  });

}



export async function hours(organizationId: string, range: ReportRange) {

  const rows = await baseQuery(organizationId, range)

    .select(['local_start_minute'])

    .where('status', 'in', ['confirmed', 'checked_in', 'completed'])

    .execute();



  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0 }));

  for (const row of rows) {

    const hour = Math.floor(row.local_start_minute / 60);

    if (buckets[hour]) buckets[hour].total += 1;

  }

  return buckets;

}



/**

 * Reparto por profesional.

 *

 * Lo que factura cada agenda y lo que le corresponde de comisión. Se cuenta lo

 * **cobrado**, no lo agendado: una comisión sobre dinero que todavía no ha

 * entrado es un pagaré, no un reparto. Al lado va lo comprometido, para que se

 * vea lo que falta por cobrar.

 */

export async function staff(organizationId: string, range: ReportRange) {

  let query = db()

    .selectFrom('appointments')

    .innerJoin('resources', 'resources.id', 'appointments.resource_id')

    .leftJoin('users', 'users.id', 'resources.user_id')

    .select([

      'resources.id',

      'resources.name',

      'resources.commission_bp',

      'users.name as user_name',

      'appointments.status',

      'appointments.payment_status',

      'appointments.price_cents',

      'appointments.duration_minutes',

    ])

    .where('appointments.organization_id', '=', organizationId)

    .where('appointments.local_date', '>=', range.from)

    .where('appointments.local_date', '<=', range.to)

    .where('appointments.status', 'in', ACTIVE_STATUSES);



  if (range.locationId) query = query.where('appointments.location_id', '=', range.locationId);



  const rows = await query.execute();



  const porRecurso = new Map<

    string,

    {

      resourceId: string;

      name: string;

      staffName: string | null;

      commissionPercent: number;

      appointments: number;

      minutes: number;

      billedCents: number;

      collectedCents: number;

      commissionCents: number;

    }

  >();



  for (const row of rows) {

    const entrada = porRecurso.get(row.id) ?? {

      resourceId: row.id,

      name: row.name,

      staffName: row.user_name,

      commissionPercent: (row.commission_bp ?? 0) / 100,

      appointments: 0,

      minutes: 0,

      billedCents: 0,

      collectedCents: 0,

      commissionCents: 0,

    };



    entrada.appointments += 1;

    entrada.minutes += row.duration_minutes;

    entrada.billedCents += row.price_cents;

    if (row.payment_status === 'paid') entrada.collectedCents += row.price_cents;



    porRecurso.set(row.id, entrada);

  }



  const items = [...porRecurso.values()].map((entrada) => ({

    ...entrada,

    commissionCents: Math.round((entrada.collectedCents * entrada.commissionPercent) / 100),

  }));



  items.sort((a, b) => b.collectedCents - a.collectedCents || a.name.localeCompare(b.name));

  return { items, currency: range.currency };

}



/* -------------------------------------------------------------------------- */

/* Exportación                                                                 */

/* -------------------------------------------------------------------------- */



export const EXPORT_TYPES = ['daily', 'services', 'resources', 'hours', 'staff'] as const;

export type ExportType = (typeof EXPORT_TYPES)[number];



/**

 * CSV para la hoja de cálculo de la gestoría.

 *

 * Separador punto y coma y decimales con coma: es lo que espera Excel con la

 * configuración regional española, que es donde va a acabar esto. Con comas

 * como separador, un importe de "1.234,50" parte la fila en dos columnas.

 *

 * Lleva marca de orden de bytes al principio porque, sin ella, Excel abre el

 * fichero como ANSI y los acentos salen rotos.

 */

const BOM = '\uFEFF';



export function toCsv(rows: Record<string, string | number>[]): string {

  if (rows.length === 0) return BOM;



  const columnas = Object.keys(rows[0]!);

  const escapar = (valor: string | number): string => {

    const texto = typeof valor === 'number' ? String(valor).replace('.', ',') : valor;

    return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;

  };



  const lineas = [

    columnas.join(';'),

    ...rows.map((row) => columnas.map((columna) => escapar(row[columna] ?? '')).join(';')),

  ];



  return `\uFEFF${lineas.join('\r\n')}\r\n`;

}



/** Los céntimos se exportan como importe, que es lo que se va a sumar en la hoja. */

function euros(cents: number): number {

  return Math.round(cents) / 100;

}



export async function exportReport(

  organizationId: string,

  type: ExportType,

  range: ReportRange,

): Promise<string> {

  switch (type) {

    case 'daily': {

      const { series } = await daily(organizationId, range);

      return toCsv(

        series.map((row) => ({

          fecha: row.date,

          citas: row.total,

          importe: euros(row.revenueCents),

          minutos: row.minutes,

        })),

      );

    }

    case 'services': {

      const rows = await services(organizationId, range);

      return toCsv(

        rows.map((row) => ({

          servicio: row.name,

          citas: row.total,

          importe: euros(row.revenueCents),

        })),

      );

    }

    case 'resources': {

      const rows = await resources(organizationId, range);

      return toCsv(

        rows.map((row) => ({

          recurso: row.name,

          citas: row.appointments,

          minutos_reservados: row.bookedMinutes,

          minutos_disponibles: row.availableMinutes,

          ocupacion: row.occupancyRate,

          importe: euros(row.revenueCents),

        })),

      );

    }

    case 'hours': {

      const rows = await hours(organizationId, range);

      return toCsv(rows.map((row) => ({ hora: row.hour, citas: row.total })));

    }

    case 'staff': {

      const { items } = await staff(organizationId, range);

      return toCsv(

        items.map((row) => ({

          profesional: row.staffName ?? row.name,

          agenda: row.name,

          citas: row.appointments,

          minutos: row.minutes,

          facturado: euros(row.billedCents),

          cobrado: euros(row.collectedCents),

          comision_porcentaje: row.commissionPercent,

          comision: euros(row.commissionCents),

        })),

      );

    }

  }

}



function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {

  const result: Record<string, number> = {};

  for (const item of items) {

    const value = key(item);

    result[value] = (result[value] ?? 0) + 1;

  }

  return result;

}



function round1(value: number): number {

  return Math.round(value * 10) / 10;

}

