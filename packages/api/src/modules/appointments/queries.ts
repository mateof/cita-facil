import type { AppointmentStatus, PaymentStatus } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Vista enriquecida de una cita: la fila más los nombres de servicio, sede,
 * recurso y cliente. Es lo que consumen el panel, las plantillas de aviso y la
 * API pública, así que se resuelve en una sola consulta con `join` en vez de
 * pedir cada nombre por separado.
 */
export interface AppointmentDetail {
  id: string;
  organizationId: string;
  organizationName: string;
  locationId: string;
  locationName: string;
  locationAddress: string | null;
  serviceId: string;
  serviceName: string;
  resourceId: string | null;
  resourceName: string | null;
  customerId: string | null;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  locale: string;
  startsAt: string;
  endsAt: string;
  localDate: string;
  localStartMinute: number;
  durationMinutes: number;
  timezone: string;
  status: AppointmentStatus;
  source: string;
  partySize: number;
  priceCents: number;
  currency: string;
  paymentStatus: PaymentStatus;
  /** Bono del que salió la sesión, si ya se cobró. */
  creditWalletId: string | null;
  notes: string | null;
  internalNotes: string | null;
  customFields: Record<string, unknown> | null;
  accessCode: string;
  /** Cuándo dijo el cliente que iba a venir, si el negocio lo pide. */
  attendanceConfirmedAt: string | null;
  /** Cargo anotado por faltar o por avisar fuera de plazo. */
  noShowFeeCents: number;
  checkedInAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancellationReason: string | null;
  recurrenceId: string | null;
  holdExpiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const DETAIL_SELECTION = [
  'appointments.id',
  'appointments.organization_id',
  'appointments.location_id',
  'appointments.service_id',
  'appointments.resource_id',
  'appointments.customer_id',
  'appointments.guest_name',
  'appointments.guest_email',
  'appointments.guest_phone',
  'appointments.guest_locale',
  'appointments.starts_at',
  'appointments.ends_at',
  'appointments.local_date',
  'appointments.local_start_minute',
  'appointments.duration_minutes',
  'appointments.timezone',
  'appointments.status',
  'appointments.source',
  'appointments.party_size',
  'appointments.price_cents',
  'appointments.currency',
  'appointments.payment_status',
  'appointments.credit_wallet_id',
  'appointments.notes',
  'appointments.internal_notes',
  'appointments.custom_fields_json',
  'appointments.access_code',
  'appointments.attendance_confirmed_at',
  'appointments.no_show_fee_cents',
  'appointments.checked_in_at',
  'appointments.completed_at',
  'appointments.cancelled_at',
  'appointments.cancelled_by',
  'appointments.cancellation_reason',
  'appointments.recurrence_id',
  'appointments.hold_expires_at',
  'appointments.created_by',
  'appointments.created_at',
  'appointments.updated_at',
] as const;

function baseQuery() {
  return db()
    .selectFrom('appointments')
    .innerJoin('organizations', 'organizations.id', 'appointments.organization_id')
    .innerJoin('locations', 'locations.id', 'appointments.location_id')
    .innerJoin('services', 'services.id', 'appointments.service_id')
    .leftJoin('resources', 'resources.id', 'appointments.resource_id')
    .leftJoin('users', 'users.id', 'appointments.customer_id')
    .select([
      ...DETAIL_SELECTION,
      'organizations.name as organization_name',
      'locations.name as location_name',
      'locations.address_line as location_address',
      'services.name as service_name',
      'resources.name as resource_name',
      'users.name as user_name',
      'users.email as user_email',
      'users.phone as user_phone',
      'users.locale as user_locale',
    ]);
}

type Row = Awaited<ReturnType<ReturnType<typeof baseQuery>['execute']>>[number];

export function mapAppointment(row: Row): AppointmentDetail {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    locationId: row.location_id,
    locationName: row.location_name,
    locationAddress: row.location_address,
    serviceId: row.service_id,
    serviceName: row.service_name,
    resourceId: row.resource_id,
    resourceName: row.resource_name,
    customerId: row.customer_id,
    customerName: row.user_name ?? row.guest_name ?? 'Cliente',
    customerEmail: row.user_email ?? row.guest_email,
    customerPhone: row.user_phone ?? row.guest_phone,
    locale: row.user_locale ?? row.guest_locale ?? 'es',
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    localDate: row.local_date,
    localStartMinute: row.local_start_minute,
    durationMinutes: row.duration_minutes,
    timezone: row.timezone,
    status: row.status as AppointmentStatus,
    source: row.source,
    partySize: row.party_size,
    priceCents: row.price_cents,
    currency: row.currency,
    paymentStatus: row.payment_status as PaymentStatus,
    creditWalletId: row.credit_wallet_id ?? null,
    notes: row.notes,
    internalNotes: row.internal_notes,
    customFields: row.custom_fields_json
      ? (JSON.parse(row.custom_fields_json) as Record<string, unknown>)
      : null,
    accessCode: row.access_code,
    attendanceConfirmedAt: row.attendance_confirmed_at,
    noShowFeeCents: row.no_show_fee_cents,
    checkedInAt: row.checked_in_at,
    completedAt: row.completed_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
    recurrenceId: row.recurrence_id,
    holdExpiresAt: row.hold_expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getAppointmentDetail(id: string): Promise<AppointmentDetail | null> {
  const row = await baseQuery().where('appointments.id', '=', id).executeTakeFirst();
  return row ? mapAppointment(row) : null;
}

export async function requireAppointmentDetail(id: string): Promise<AppointmentDetail> {
  const detail = await getAppointmentDetail(id);
  if (!detail) throw new NotFoundError('La cita no existe', 'appointment_not_found');
  return detail;
}

export async function findByAccessCode(code: string): Promise<AppointmentDetail | null> {
  const row = await baseQuery()
    .where('appointments.access_code', '=', code.trim().toUpperCase())
    .executeTakeFirst();
  return row ? mapAppointment(row) : null;
}

export interface ListFilters {
  organizationId: string;
  from?: string;
  to?: string;
  status?: string[];
  locationId?: string;
  resourceId?: string;
  serviceId?: string;
  customerId?: string;
  search?: string;
  /** Restringe a las sedes accesibles por el usuario. */
  allowedLocationIds?: string[];
  sort?: 'startsAt' | '-startsAt' | 'createdAt' | '-createdAt';
  page: number;
  pageSize: number;
}

export interface PagedAppointments {
  items: AppointmentDetail[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listAppointments(filters: ListFilters): Promise<PagedAppointments> {
  const applyFilters = <T extends { where: any }>(query: T): T => {
    let next: any = query;
    next = next.where('appointments.organization_id', '=', filters.organizationId);
    if (filters.from) next = next.where('appointments.starts_at', '>=', filters.from);
    if (filters.to) next = next.where('appointments.starts_at', '<=', filters.to);
    if (filters.status?.length) next = next.where('appointments.status', 'in', filters.status);
    if (filters.locationId) next = next.where('appointments.location_id', '=', filters.locationId);
    if (filters.resourceId) next = next.where('appointments.resource_id', '=', filters.resourceId);
    if (filters.serviceId) next = next.where('appointments.service_id', '=', filters.serviceId);
    if (filters.customerId) next = next.where('appointments.customer_id', '=', filters.customerId);
    if (filters.allowedLocationIds?.length) {
      next = next.where('appointments.location_id', 'in', filters.allowedLocationIds);
    }
    if (filters.search) {
      const term = `%${filters.search.toLowerCase()}%`;
      next = next.where((eb: any) =>
        eb.or([
          eb('users.name', 'like', term),
          eb('users.email', 'like', term),
          eb('appointments.guest_name', 'like', term),
          eb('appointments.guest_email', 'like', term),
          eb('appointments.access_code', 'like', term),
        ]),
      );
    }
    return next as T;
  };

  const countRow = await applyFilters(
    db()
      .selectFrom('appointments')
      .leftJoin('users', 'users.id', 'appointments.customer_id')
      .select((eb) => eb.fn.countAll<number>().as('total')),
  ).executeTakeFirst();

  const total = Number(countRow?.total ?? 0);

  const sort = filters.sort ?? 'startsAt';
  const column = sort.includes('createdAt') ? 'appointments.created_at' : 'appointments.starts_at';
  const direction = sort.startsWith('-') ? 'desc' : 'asc';

  const rows = await applyFilters(baseQuery())
    .orderBy(column as never, direction)
    // El desempate por id evita que dos citas a la misma hora bailen entre
    // páginas: `id` es UUID v7, así que ordena por creación.
    .orderBy('appointments.id')
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize)
    .execute();

  return {
    items: rows.map(mapAppointment),
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
  };
}

/** Citas de un cliente concreto, para el portal del usuario. */
export async function listCustomerAppointments(params: {
  customerId: string;
  upcoming?: boolean;
  page: number;
  pageSize: number;
}): Promise<PagedAppointments> {
  const now = new Date().toISOString();
  let query = baseQuery().where('appointments.customer_id', '=', params.customerId);
  let countQuery = db()
    .selectFrom('appointments')
    .select((eb) => eb.fn.countAll<number>().as('total'))
    .where('customer_id', '=', params.customerId);

  if (params.upcoming === true) {
    query = query.where('appointments.starts_at', '>=', now);
    countQuery = countQuery.where('starts_at', '>=', now);
  } else if (params.upcoming === false) {
    query = query.where('appointments.starts_at', '<', now);
    countQuery = countQuery.where('starts_at', '<', now);
  }
  query = query.where('appointments.status', '!=', 'hold');
  countQuery = countQuery.where('status', '!=', 'hold');

  const total = Number((await countQuery.executeTakeFirst())?.total ?? 0);
  const rows = await query
    .orderBy('appointments.starts_at', params.upcoming === false ? 'desc' : 'asc')
    .orderBy('appointments.id')
    .limit(params.pageSize)
    .offset((params.page - 1) * params.pageSize)
    .execute();

  return {
    items: rows.map(mapAppointment),
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
