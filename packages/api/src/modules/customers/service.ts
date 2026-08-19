import {
  fuzzySearch,
  type CustomerDetail,
  type CustomerListQuery,
  type CustomerStats,
  type CustomerSummary,
  type UpdateCustomerProfileInput,
} from '@cita-facil/shared';
import { db } from '../../db/index.js';
import { fromDbJson } from '../../db/columns.js';
import { isoNow } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { NotFoundError } from '../../lib/errors.js';

/**
 * Ficha de cliente.
 *
 * Quién es cliente de un negocio no es una tabla: es quien ha reservado alguna
 * vez, quien tiene un bono o quien el mostrador ha anotado. Se resuelve por
 * unión de esas tres cosas, igual que ya hacía la búsqueda de personas para
 * entregar un bono.
 *
 * Las cifras se calculan al vuelo. Guardarlas como contadores obligaría a
 * mantenerlas al día desde la reserva, la cancelación, la falta, el pago, la
 * devolución y el bono, y a la primera incidencia enseñarían un número que no
 * cuadra con el histórico, que es justo lo que nadie sabría reparar.
 *
 * Las reservas sin cuenta no tienen ficha: no hay a quién agregarlas. Sus datos
 * viven en la propia cita (`guest_name`, `guest_email`).
 */

/**
 * Igual que en la búsqueda de personas: se traen hasta tantos clientes y se
 * ordena en memoria, porque ninguno de los cinco motores comparte función de
 * parecido. Un negocio con más sigue funcionando; lo que se pierde es la
 * tolerancia a erratas de los que queden fuera del conjunto.
 */
const CUSTOMER_POOL = 2000;

/** Citas que ocuparon agenda de verdad: ni borradores ni bajas. */
const REAL_STATUSES = ['pending', 'confirmed', 'checked_in', 'in_progress', 'completed', 'no_show'];

/** Estados en los que una cita futura sigue en pie. */
const UPCOMING_STATUSES = ['pending', 'confirmed', 'checked_in', 'in_progress'];

/** Una visita es una cita pasada a la que la persona no faltó. */
const VISIT_STATUSES = ['confirmed', 'checked_in', 'in_progress', 'completed'];

interface CustomerRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  nif: string | null;
  locale: string;
  avatar_url: string | null;
  icon: string | null;
  color: string | null;
  marketing_opt_in: number;
  created_at: string;
}

interface ProfileRow {
  notes: string | null;
  tags: string[];
}

/** Ids de todo el que es cliente de esta organización. */
async function customerIds(organizationId: string): Promise<string[]> {
  const rows = await db()
    .selectFrom('appointments')
    .select('customer_id as id')
    .where('organization_id', '=', organizationId)
    .where('customer_id', 'is not', null)
    .union(
      db()
        .selectFrom('credit_wallets')
        .select('user_id as id')
        .where('organization_id', '=', organizationId),
    )
    .union(
      db()
        .selectFrom('customer_profiles')
        .select('user_id as id')
        .where('organization_id', '=', organizationId),
    )
    .execute();

  return [...new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)))];
}

async function profilesOf(organizationId: string): Promise<Map<string, ProfileRow>> {
  const rows = await db()
    .selectFrom('customer_profiles')
    .select(['user_id', 'notes', 'tags_json'])
    .where('organization_id', '=', organizationId)
    .execute();

  return new Map(
    rows.map((row) => [
      row.user_id,
      { notes: row.notes, tags: fromDbJson<string[]>(row.tags_json, []) },
    ]),
  );
}

function emptyStats(currency: string): CustomerStats {
  return {
    appointments: 0,
    completed: 0,
    cancelled: 0,
    noShows: 0,
    upcoming: 0,
    firstVisitAt: null,
    lastVisitAt: null,
    nextAppointmentAt: null,
    spendCents: 0,
    currency,
    creditBalance: 0,
    creditDebt: 0,
  };
}

/**
 * Cifras de todos los clientes de la organización, en cinco consultas
 * agrupadas.
 *
 * Se agrupa en el servidor de base de datos y no cliente a cliente porque una
 * lista de doscientas personas serían mil consultas. Como no se filtra por
 * identificadores, tampoco hay listas de parámetros que puedan pasarse del
 * límite de ninguno de los motores.
 */
async function statsByCustomer(
  organizationId: string,
  currency: string,
): Promise<Map<string, CustomerStats>> {
  const now = isoNow();
  const stats = new Map<string, CustomerStats>();

  const of = (id: string): CustomerStats => {
    let entry = stats.get(id);
    if (!entry) {
      entry = emptyStats(currency);
      stats.set(id, entry);
    }
    return entry;
  };

  /* Citas por cliente y estado. */
  const byStatus = await db()
    .selectFrom('appointments')
    .select((eb) => ['customer_id', 'status', eb.fn.countAll<number>().as('total')])
    .where('organization_id', '=', organizationId)
    .where('customer_id', 'is not', null)
    .where('status', '!=', 'hold')
    .groupBy(['customer_id', 'status'])
    .execute();

  for (const row of byStatus) {
    if (!row.customer_id) continue;
    const entry = of(row.customer_id);
    const total = Number(row.total ?? 0);

    if (REAL_STATUSES.includes(row.status)) entry.appointments += total;
    if (row.status === 'completed') entry.completed += total;
    if (row.status === 'cancelled') entry.cancelled += total;
    if (row.status === 'no_show') entry.noShows += total;
  }

  /* Primera y última visita: citas ya pasadas a las que no faltó. */
  const visits = await db()
    .selectFrom('appointments')
    .select((eb) => [
      'customer_id',
      eb.fn.min<string>('starts_at').as('first_at'),
      eb.fn.max<string>('starts_at').as('last_at'),
    ])
    .where('organization_id', '=', organizationId)
    .where('customer_id', 'is not', null)
    .where('status', 'in', VISIT_STATUSES)
    .where('starts_at', '<', now)
    .groupBy('customer_id')
    .execute();

  for (const row of visits) {
    if (!row.customer_id) continue;
    const entry = of(row.customer_id);
    entry.firstVisitAt = row.first_at ?? null;
    entry.lastVisitAt = row.last_at ?? null;
  }

  /* Lo que tiene por delante. */
  const upcoming = await db()
    .selectFrom('appointments')
    .select((eb) => [
      'customer_id',
      eb.fn.countAll<number>().as('total'),
      eb.fn.min<string>('starts_at').as('next_at'),
    ])
    .where('organization_id', '=', organizationId)
    .where('customer_id', 'is not', null)
    .where('status', 'in', UPCOMING_STATUSES)
    .where('starts_at', '>=', now)
    .groupBy('customer_id')
    .execute();

  for (const row of upcoming) {
    if (!row.customer_id) continue;
    const entry = of(row.customer_id);
    entry.upcoming = Number(row.total ?? 0);
    entry.nextAppointmentAt = row.next_at ?? null;
  }

  /*
   * Gasto. Las citas pagadas llevan su importe, tanto si se cobró por la
   * pasarela como si se marcó a mano en el mostrador. Se dejan fuera las que se
   * pagaron con bono, porque ese dinero ya entró al comprar el bono y contarlo
   * en los dos sitios doblaría el gasto de quien compra series de sesiones.
   */
  const paidAppointments = await db()
    .selectFrom('appointments')
    .select((eb) => ['customer_id', eb.fn.sum<number>('price_cents').as('total')])
    .where('organization_id', '=', organizationId)
    .where('customer_id', 'is not', null)
    .where('payment_status', '=', 'paid')
    .where('credit_wallet_id', 'is', null)
    .groupBy('customer_id')
    .execute();

  for (const row of paidAppointments) {
    if (!row.customer_id) continue;
    of(row.customer_id).spendCents += Number(row.total ?? 0);
  }

  const packPurchases = await db()
    .selectFrom('payments')
    .select((eb) => [
      'user_id',
      eb.fn.sum<number>('amount_cents').as('total'),
      eb.fn.sum<number>('refunded_cents').as('refunded'),
    ])
    .where('organization_id', '=', organizationId)
    .where('user_id', 'is not', null)
    .where('credit_pack_id', 'is not', null)
    .where('paid_at', 'is not', null)
    .groupBy('user_id')
    .execute();

  for (const row of packPurchases) {
    if (!row.user_id) continue;
    of(row.user_id).spendCents += Number(row.total ?? 0) - Number(row.refunded ?? 0);
  }

  /*
   * Saldo de bonos. Se traen las filas en lugar de sumarlas en SQL porque un
   * bono caducado o anulado no cuenta, y esas dos condiciones son más claras
   * aquí que repartidas en un `case` que además cambia de sintaxis por motor.
   */
  const wallets = await db()
    .selectFrom('credit_wallets')
    .select(['user_id', 'credits_total', 'credits_used', 'expires_at', 'cancelled_at'])
    .where('organization_id', '=', organizationId)
    .execute();

  for (const wallet of wallets) {
    if (wallet.cancelled_at) continue;
    if (wallet.expires_at && wallet.expires_at <= now) continue;
    const remaining = wallet.credits_total - wallet.credits_used;
    if (remaining > 0) of(wallet.user_id).creditBalance += remaining;
  }

  /* Sesiones a deber: ni saldadas ni anuladas. */
  const debts = await db()
    .selectFrom('credit_debts')
    .select((eb) => ['user_id', eb.fn.countAll<number>().as('total')])
    .where('organization_id', '=', organizationId)
    .where('settled_at', 'is', null)
    .where('cancelled_at', 'is', null)
    .groupBy('user_id')
    .execute();

  for (const row of debts) {
    of(row.user_id).creditDebt = Number(row.total ?? 0);
  }

  return stats;
}

function toSummary(
  row: CustomerRow,
  profile: ProfileRow | undefined,
  stats: CustomerStats,
): CustomerSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    imageUrl: row.avatar_url,
    icon: row.icon,
    color: row.color,
    tags: profile?.tags ?? [],
    hasNotes: Boolean(profile?.notes?.trim()),
    stats,
  };
}

async function currencyOf(organizationId: string): Promise<string> {
  const row = await db()
    .selectFrom('organizations')
    .select(['currency'])
    .where('id', '=', organizationId)
    .executeTakeFirst();
  return row?.currency ?? 'EUR';
}

async function loadCustomers(organizationId: string): Promise<CustomerRow[]> {
  const ids = await customerIds(organizationId);
  if (ids.length === 0) return [];

  const rows: CustomerRow[] = [];
  // Se trocea la lista de identificadores porque SQLite limita el número de
  // parámetros de una sentencia y una organización grande se pasaría.
  for (let start = 0; start < ids.length; start += 500) {
    const lote = await db()
      .selectFrom('users')
      .select([
        'id',
        'name',
        'email',
        'phone',
        'nif',
        'locale',
        'avatar_url',
        'icon',
        'color',
        'marketing_opt_in',
        'created_at',
      ])
      .where('deleted_at', 'is', null)
      .where('id', 'in', ids.slice(start, start + 500))
      .execute();
    rows.push(...lote);
  }

  return rows.slice(0, CUSTOMER_POOL);
}

export interface CustomerList {
  items: CustomerSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export async function listCustomers(
  organizationId: string,
  filters: CustomerListQuery,
): Promise<CustomerList> {
  const currency = await currencyOf(organizationId);
  const [rows, profiles, stats] = await Promise.all([
    loadCustomers(organizationId),
    profilesOf(organizationId),
    statsByCustomer(organizationId, currency),
  ]);

  const term = filters.query?.trim() ?? '';
  const candidatos =
    term.length >= 2
      ? fuzzySearch(rows, term, { fields: (row) => [row.name, row.email, row.phone] })
      : rows;

  const inactiveBefore = filters.inactiveDays
    ? new Date(Date.now() - filters.inactiveDays * 86_400_000).toISOString()
    : null;

  const items = candidatos
    .map((row) => toSummary(row, profiles.get(row.id), stats.get(row.id) ?? emptyStats(currency)))
    .filter((customer) => {
      if (filters.tag && !customer.tags.includes(filters.tag)) return false;
      if (filters.withUpcoming && customer.stats.upcoming === 0) return false;
      if (filters.withDebt && customer.stats.creditDebt === 0) return false;
      if (inactiveBefore) {
        // Quien nunca ha venido también está inactivo: no hay última visita que
        // sea posterior a la fecha de corte.
        if (customer.stats.lastVisitAt && customer.stats.lastVisitAt >= inactiveBefore) return false;
        if (customer.stats.upcoming > 0) return false;
      }
      return true;
    });

  // El desempate por nombre deja el orden estable entre páginas cuando dos
  // personas empatan a citas o a gasto.
  const ordered = [...items].sort((a, b) => {
    switch (filters.sort) {
      case 'recent':
        return (b.stats.lastVisitAt ?? '').localeCompare(a.stats.lastVisitAt ?? '') ||
          a.name.localeCompare(b.name);
      case 'appointments':
        return b.stats.appointments - a.stats.appointments || a.name.localeCompare(b.name);
      case 'spend':
        return b.stats.spendCents - a.stats.spendCents || a.name.localeCompare(b.name);
      default:
        return a.name.localeCompare(b.name);
    }
  });

  // La búsqueda aproximada ya viene ordenada por parecido y ese orden manda
  // sobre el criterio de la lista: quien busca "peña" espera a Peña arriba.
  const final = term.length >= 2 && filters.sort === 'name' ? items : ordered;

  const start = (filters.page - 1) * filters.pageSize;
  return {
    items: final.slice(start, start + filters.pageSize),
    page: filters.page,
    pageSize: filters.pageSize,
    total: final.length,
    totalPages: Math.max(1, Math.ceil(final.length / filters.pageSize)),
  };
}

/** Etiquetas ya usadas en la organización, para ofrecerlas al filtrar. */
export async function listCustomerTags(organizationId: string): Promise<string[]> {
  const profiles = await profilesOf(organizationId);
  const tags = new Set<string>();
  for (const profile of profiles.values()) {
    for (const tag of profile.tags) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

/**
 * Comprueba que esa persona es cliente de esta organización.
 *
 * Sin esta comprobación, la ficha sería un endpoint para leer el nombre y el
 * teléfono de cualquier cuenta de la instalación probando identificadores, que
 * es exactamente lo que evita que la búsqueda no salga de la organización.
 */
async function requireCustomer(organizationId: string, userId: string): Promise<CustomerRow> {
  const ids = await customerIds(organizationId);
  if (!ids.includes(userId)) {
    throw new NotFoundError('Esa persona no es clienta de esta organización', 'customer_not_found');
  }

  const row = await db()
    .selectFrom('users')
    .select([
      'id',
      'name',
      'email',
      'phone',
      'nif',
      'locale',
      'avatar_url',
      'icon',
      'color',
      'marketing_opt_in',
      'created_at',
    ])
    .where('id', '=', userId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  if (!row) throw new NotFoundError('La persona no existe', 'customer_not_found');
  return row;
}

const RECENT_APPOINTMENTS = 20;

export async function getCustomerDetail(
  organizationId: string,
  userId: string,
): Promise<CustomerDetail> {
  const row = await requireCustomer(organizationId, userId);
  const currency = await currencyOf(organizationId);
  const [profiles, stats] = await Promise.all([
    profilesOf(organizationId),
    statsByCustomer(organizationId, currency),
  ]);

  const appointments = await db()
    .selectFrom('appointments')
    .innerJoin('services', 'services.id', 'appointments.service_id')
    .leftJoin('resources', 'resources.id', 'appointments.resource_id')
    .select([
      'appointments.id',
      'appointments.starts_at',
      'appointments.status',
      'appointments.price_cents',
      'appointments.payment_status',
      'services.name as service_name',
      'resources.name as resource_name',
    ])
    .where('appointments.organization_id', '=', organizationId)
    .where('appointments.customer_id', '=', userId)
    .where('appointments.status', '!=', 'hold')
    .orderBy('appointments.starts_at', 'desc')
    .limit(RECENT_APPOINTMENTS)
    .execute();

  const wallets = await db()
    .selectFrom('credit_wallets')
    .leftJoin('credit_packs', 'credit_packs.id', 'credit_wallets.credit_pack_id')
    .select([
      'credit_wallets.id',
      'credit_wallets.credits_total',
      'credit_wallets.credits_used',
      'credit_wallets.expires_at',
      'credit_wallets.cancelled_at',
      'credit_packs.name as pack_name',
    ])
    .where('credit_wallets.organization_id', '=', organizationId)
    .where('credit_wallets.user_id', '=', userId)
    .orderBy('credit_wallets.created_at', 'desc')
    .execute();

  const now = isoNow();
  const reviews = await db()
    .selectFrom('reviews')
    .leftJoin('services', 'services.id', 'reviews.service_id')
    .select([
      'reviews.id',
      'reviews.rating',
      'reviews.comment',
      'reviews.created_at',
      'services.name as service_name',
    ])
    .where('reviews.organization_id', '=', organizationId)
    .where('reviews.customer_id', '=', userId)
    .orderBy('reviews.created_at', 'desc')
    .limit(10)
    .execute();

  const profile = profiles.get(userId);

  return {
    ...toSummary(row, profile, stats.get(userId) ?? emptyStats(currency)),
    nif: row.nif,
    locale: row.locale,
    notes: profile?.notes ?? null,
    marketingOptIn: row.marketing_opt_in === 1,
    customerSince: row.created_at,
    appointments: appointments.map((cita) => ({
      id: cita.id,
      startsAt: cita.starts_at,
      serviceName: cita.service_name,
      resourceName: cita.resource_name,
      status: cita.status,
      priceCents: cita.price_cents,
      paymentStatus: cita.payment_status,
    })),
    wallets: wallets
      .filter((wallet) => !wallet.cancelled_at)
      .filter((wallet) => !wallet.expires_at || wallet.expires_at > now)
      .map((wallet) => ({
        id: wallet.id,
        packName: wallet.pack_name ?? '',
        remaining: wallet.credits_total - wallet.credits_used,
        total: wallet.credits_total,
        expiresAt: wallet.expires_at,
      })),
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      serviceName: review.service_name,
      createdAt: review.created_at,
    })),
  };
}

/** Guarda lo que anota el mostrador. Solo toca la fila del perfil, nunca la cuenta. */
export async function updateCustomerProfile(
  organizationId: string,
  userId: string,
  input: UpdateCustomerProfileInput,
): Promise<CustomerDetail> {
  await requireCustomer(organizationId, userId);

  const existing = await db()
    .selectFrom('customer_profiles')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const now = isoNow();
  const notes = input.notes === undefined ? undefined : (input.notes?.trim() || null);
  const tags =
    input.tags === undefined
      ? undefined
      : JSON.stringify([...new Set(input.tags.map((tag) => tag.trim()).filter(Boolean))]);

  if (existing) {
    await db()
      .updateTable('customer_profiles')
      .set({
        ...(notes === undefined ? {} : { notes }),
        ...(tags === undefined ? {} : { tags_json: tags }),
        updated_at: now,
      })
      .where('id', '=', existing.id)
      .execute();
  } else {
    await db()
      .insertInto('customer_profiles')
      .values({
        id: newId(),
        organization_id: organizationId,
        user_id: userId,
        notes: notes ?? null,
        tags_json: tags ?? null,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  return getCustomerDetail(organizationId, userId);
}
