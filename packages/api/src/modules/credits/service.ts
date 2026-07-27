import type { Kysely, Transaction } from 'kysely';
import type {
  AdjustCreditWalletInput,
  CreateCreditPackInput,
  CreditBalance,
  CreditEligibility,
  CreditPack,
  CreditWallet,
  CreditWalletStatus,
  UpdateCreditPackInput,
} from '@cita-facil/shared';
import { fuzzySearch } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { recordAudit } from '../audit/service.js';
import { notify } from '../notifications/service.js';

/**
 * Bonos: series de sesiones prepagadas.
 *
 * Hay dos niveles. El *tipo de bono* (`credit_packs`) es lo que define el
 * centro: cuántas sesiones, a qué precio, para qué servicios y si se vende por
 * la web. El *bono emitido* (`credit_wallets`) es el que tiene una persona
 * concreta, con su saldo y su caducidad, venga de una compra o de que se lo
 * haya dado el centro a mano.
 *
 * Cada consumo y cada devolución dejan una fila en `credit_ledger`: el saldo se
 * podría recalcular a partir de ahí, pero se guarda también en el bono porque
 * el descuento tiene que ser atómico y una suma no se puede hacer atómica sin
 * bloquear la tabla entera.
 */

/* -------------------------------------------------------------------------- */
/* Lectura y mapeo                                                             */
/* -------------------------------------------------------------------------- */

function parseServiceIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

/** Nombres de los servicios de la organización, para no resolverlos en el cliente. */
async function serviceNames(organizationId: string): Promise<Map<string, string>> {
  const rows = await db()
    .selectFrom('services')
    .select(['id', 'name'])
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .execute();
  return new Map(rows.map((row) => [row.id, row.name]));
}

interface PackRow {
  id: string;
  name: string;
  description: string | null;
  credits: number;
  price_cents: number;
  currency: string;
  validity_days: number;
  service_ids_json: string | null;
  online_purchase: number;
  sort_order: number;
  active: number;
  image_url: string | null;
  icon: string | null;
  color: string | null;
}

function toPack(row: PackRow, names: Map<string, string>, issuedCount?: number): CreditPack {
  const serviceIds = parseServiceIds(row.service_ids_json);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    credits: row.credits,
    priceCents: row.price_cents,
    currency: row.currency,
    validityDays: row.validity_days,
    serviceIds,
    serviceNames: serviceIds.map((id) => names.get(id) ?? id),
    onlinePurchase: row.online_purchase === 1,
    sortOrder: row.sort_order,
    active: row.active === 1,
    imageUrl: row.image_url,
    icon: row.icon,
    color: row.color,
    ...(issuedCount === undefined ? {} : { issuedCount }),
  };
}

export function walletStatus(
  row: { credits_total: number; credits_used: number; expires_at: string | null; cancelled_at: string | null },
  now = isoNow(),
): CreditWalletStatus {
  if (row.cancelled_at) return 'cancelled';
  if (row.expires_at && row.expires_at <= now) return 'expired';
  if (row.credits_used >= row.credits_total) return 'exhausted';
  return 'active';
}

/* -------------------------------------------------------------------------- */
/* Tipos de bono                                                               */
/* -------------------------------------------------------------------------- */

export async function listPacks(
  organizationId: string,
  options: { onlyActive?: boolean; onlyOnline?: boolean; withCounts?: boolean } = {},
): Promise<CreditPack[]> {
  let query = db()
    .selectFrom('credit_packs')
    .selectAll()
    .where('organization_id', '=', organizationId);

  if (options.onlyActive) query = query.where('active', '=', 1);
  if (options.onlyOnline) query = query.where('online_purchase', '=', 1);

  const rows = await query.orderBy('sort_order', 'asc').orderBy('name', 'asc').execute();
  const names = await serviceNames(organizationId);

  if (!options.withCounts) return rows.map((row) => toPack(row, names));

  // Bonos vivos por tipo: lo que el panel necesita para avisar antes de borrar.
  const counts = await db()
    .selectFrom('credit_wallets')
    .select(['credit_pack_id', db().fn.count<number>('id').as('total')])
    .where('organization_id', '=', organizationId)
    .where('cancelled_at', 'is', null)
    .groupBy('credit_pack_id')
    .execute();
  const byPack = new Map(counts.map((row) => [row.credit_pack_id, Number(row.total)]));

  return rows.map((row) => toPack(row, names, byPack.get(row.id) ?? 0));
}

export async function getPack(organizationId: string, id: string): Promise<CreditPack> {
  const row = await db()
    .selectFrom('credit_packs')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('El bono no existe', 'credit_pack_not_found');
  return toPack(row, await serviceNames(organizationId));
}

/** Comprueba que los servicios indicados son de esta organización. */
async function assertServicesBelong(organizationId: string, serviceIds: string[]): Promise<void> {
  if (serviceIds.length === 0) return;
  const rows = await db()
    .selectFrom('services')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .where('id', 'in', serviceIds)
    .execute();
  if (rows.length !== new Set(serviceIds).size) {
    throw new BadRequestError('Algún servicio no existe en esta organización', 'service_not_found');
  }
}

export async function createPack(
  organizationId: string,
  input: CreateCreditPackInput,
  actorId: string | null,
): Promise<CreditPack> {
  await assertServicesBelong(organizationId, input.serviceIds);

  const id = newId();
  const now = isoNow();
  await db()
    .insertInto('credit_packs')
    .values({
      id,
      organization_id: organizationId,
      name: input.name,
      description: input.description ?? null,
      credits: input.credits,
      price_cents: input.priceCents,
      currency: input.currency,
      validity_days: input.validityDays,
      service_ids_json: JSON.stringify(input.serviceIds),
      online_purchase: input.onlinePurchase ? 1 : 0,
      sort_order: input.sortOrder,
      active: input.active ? 1 : 0,
      image_url: input.imageUrl ?? null,
      icon: input.icon ?? null,
      color: input.color ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'credit_pack.create',
    entityType: 'credit_pack',
    entityId: id,
    changes: { name: input.name, credits: input.credits, priceCents: input.priceCents },
  });

  return getPack(organizationId, id);
}

export async function updatePack(
  organizationId: string,
  id: string,
  input: UpdateCreditPackInput,
  actorId: string | null,
): Promise<CreditPack> {
  await getPack(organizationId, id);
  if (input.serviceIds) await assertServicesBelong(organizationId, input.serviceIds);

  const changes: Record<string, unknown> = { updated_at: isoNow() };
  if (input.name !== undefined) changes.name = input.name;
  if (input.description !== undefined) changes.description = input.description ?? null;
  if (input.credits !== undefined) changes.credits = input.credits;
  if (input.priceCents !== undefined) changes.price_cents = input.priceCents;
  if (input.currency !== undefined) changes.currency = input.currency;
  if (input.validityDays !== undefined) changes.validity_days = input.validityDays;
  if (input.serviceIds !== undefined) changes.service_ids_json = JSON.stringify(input.serviceIds);
  if (input.onlinePurchase !== undefined) changes.online_purchase = input.onlinePurchase ? 1 : 0;
  if (input.sortOrder !== undefined) changes.sort_order = input.sortOrder;
  if (input.active !== undefined) changes.active = input.active ? 1 : 0;
  if (input.imageUrl !== undefined) changes.image_url = input.imageUrl;
  if (input.icon !== undefined) changes.icon = input.icon;
  if (input.color !== undefined) changes.color = input.color;

  await db().updateTable('credit_packs').set(changes).where('id', '=', id).execute();

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'credit_pack.update',
    entityType: 'credit_pack',
    entityId: id,
    changes: input as Record<string, unknown>,
  });

  return getPack(organizationId, id);
}

/**
 * Borra un tipo de bono. Si ya se ha emitido alguno se desactiva en lugar de
 * borrarse: los bonos vivos siguen siendo válidos y su histórico cuelga de aquí.
 */
export async function deletePack(
  organizationId: string,
  id: string,
  actorId: string | null,
): Promise<{ deleted: boolean }> {
  await getPack(organizationId, id);

  const issued = await db()
    .selectFrom('credit_wallets')
    .select('id')
    .where('credit_pack_id', '=', id)
    .limit(1)
    .executeTakeFirst();

  if (issued) {
    await updatePack(organizationId, id, { active: false }, actorId);
    return { deleted: false };
  }

  await db().deleteFrom('credit_packs').where('id', '=', id).execute();
  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'credit_pack.delete',
    entityType: 'credit_pack',
    entityId: id,
    changes: {},
  });
  return { deleted: true };
}

/* -------------------------------------------------------------------------- */
/* Bonos emitidos                                                              */
/* -------------------------------------------------------------------------- */

interface WalletRow {
  id: string;
  credit_pack_id: string | null;
  user_id: string;
  credits_total: number;
  credits_used: number;
  expires_at: string | null;
  cancelled_at: string | null;
  source: string;
  note: string | null;
  created_at: string;
  pack_name: string | null;
  pack_service_ids: string | null;
  user_name: string | null;
  user_email: string | null;
}

function toWallet(row: WalletRow, names: Map<string, string>, now: string): CreditWallet {
  const serviceIds = parseServiceIds(row.pack_service_ids);
  return {
    id: row.id,
    packId: row.credit_pack_id,
    packName: row.pack_name ?? 'Bono',
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    total: row.credits_total,
    used: row.credits_used,
    remaining: Math.max(row.credits_total - row.credits_used, 0),
    expiresAt: row.expires_at,
    status: walletStatus(row, now),
    source: row.source,
    note: row.note,
    serviceIds,
    serviceNames: serviceIds.map((id) => names.get(id) ?? id),
    createdAt: row.created_at,
  };
}

/**
 * Ejecutor de las consultas: la conexión normal o la transacción en curso.
 *
 * Importa más de lo que parece. El dialecto de SQLite serializa el acceso a la
 * conexión, así que una lectura hecha con `db()` desde dentro de una
 * transacción se queda esperando a que esa misma transacción termine, y la
 * transacción esperando a la lectura. Todo lo que se use durante el consumo de
 * una sesión tiene que ir por el mismo ejecutor.
 */
type Executor = Kysely<Database> | Transaction<Database>;

function walletQuery(organizationId: string, executor: Executor = db()) {
  return executor
    .selectFrom('credit_wallets')
    .leftJoin('credit_packs', 'credit_packs.id', 'credit_wallets.credit_pack_id')
    .leftJoin('users', 'users.id', 'credit_wallets.user_id')
    .select([
      'credit_wallets.id',
      'credit_wallets.credit_pack_id',
      'credit_wallets.user_id',
      'credit_wallets.credits_total',
      'credit_wallets.credits_used',
      'credit_wallets.expires_at',
      'credit_wallets.cancelled_at',
      'credit_wallets.source',
      'credit_wallets.note',
      'credit_wallets.created_at',
      'credit_packs.name as pack_name',
      'credit_packs.service_ids_json as pack_service_ids',
      'users.name as user_name',
      'users.email as user_email',
    ])
    .where('credit_wallets.organization_id', '=', organizationId);
}

export async function listWallets(
  organizationId: string,
  filters: {
    userId?: string;
    packId?: string;
    status?: CreditWalletStatus;
    query?: string;
  } = {},
): Promise<CreditWallet[]> {
  let query = walletQuery(organizationId);
  if (filters.userId) query = query.where('credit_wallets.user_id', '=', filters.userId);
  if (filters.packId) query = query.where('credit_wallets.credit_pack_id', '=', filters.packId);

  const rows = await query.orderBy('credit_wallets.created_at', 'desc').limit(500).execute();
  const names = await serviceNames(organizationId);
  const now = isoNow();
  let wallets = rows.map((row) => toWallet(row, names, now));

  if (filters.status) wallets = wallets.filter((wallet) => wallet.status === filters.status);

  // El texto se filtra aquí y no en SQL: así encuentra con acentos, sin ellos y
  // con erratas, igual que el resto de buscadores de la aplicación.
  if (filters.query?.trim()) {
    wallets = fuzzySearch(wallets, filters.query, {
      fields: (wallet) => [wallet.userName, wallet.userEmail, wallet.packName, wallet.note],
      limit: wallets.length,
    });
  }

  return wallets;
}

export async function getWallet(organizationId: string, id: string): Promise<CreditWallet> {
  const row = await walletQuery(organizationId).where('credit_wallets.id', '=', id).executeTakeFirst();
  if (!row) throw new NotFoundError('El bono no existe', 'credit_wallet_not_found');
  return toWallet(row, await serviceNames(organizationId), isoNow());
}

export async function walletMovements(organizationId: string, walletId: string) {
  await getWallet(organizationId, walletId);
  const rows = await db()
    .selectFrom('credit_ledger')
    .selectAll()
    .where('wallet_id', '=', walletId)
    .orderBy('created_at', 'desc')
    .limit(200)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    appointmentId: row.appointment_id,
    note: row.note,
    createdAt: row.created_at,
  }));
}

/**
 * Cuánta gente de la organización se trae para puntuar en memoria.
 *
 * El filtrado aproximado no se puede hacer en SQL de forma portable entre los
 * cinco motores, así que se traen los clientes de la organización y se ordenan
 * aquí. Un negocio con más clientes que esto sigue funcionando: lo que se
 * pierde es la tolerancia a erratas de los que queden fuera, no la búsqueda.
 */
const CUSTOMER_POOL = 2000;

/**
 * Busca a quién entregarle un bono.
 *
 * Devuelve gente de esta organización: quien ya ha reservado alguna vez o quien
 * ya tiene un bono, ordenada por parecido y tolerando acentos y erratas. Además
 * admite un correo exacto, para poder entregar un bono a alguien que acaba de
 * registrarse y todavía no ha pisado el centro.
 *
 * No se buscan cuentas sueltas de la instalación por nombre parcial: eso
 * dejaría a cualquier responsable ir sacando los clientes de los demás
 * negocios letra a letra. El correo entero hay que saberlo de antemano.
 */
export async function searchCustomers(
  organizationId: string,
  query: string,
): Promise<{ id: string; name: string; email: string | null }[]> {
  const term = query.trim();
  if (term.length < 2) return [];

  // Gente de esta organización: quien ha reservado, quien ya tiene un bono y el
  // propio personal, que también puede recibir uno.
  const knownIds = await db()
    .selectFrom('appointments')
    .select('customer_id')
    .where('organization_id', '=', organizationId)
    .where('customer_id', 'is not', null)
    .union(
      db()
        .selectFrom('credit_wallets')
        .select('user_id as customer_id')
        .where('organization_id', '=', organizationId),
    )
    .union(
      db()
        .selectFrom('memberships')
        .select('user_id as customer_id')
        .where('organization_id', '=', organizationId)
        .where('active', '=', 1),
    )
    .execute();

  const ids = knownIds.map((row) => row.customer_id).filter((id): id is string => Boolean(id));

  const clientes =
    ids.length > 0
      ? await db()
          .selectFrom('users')
          .select(['id', 'name', 'email'])
          .where('deleted_at', 'is', null)
          .where('id', 'in', ids)
          .orderBy('name')
          .limit(CUSTOMER_POOL)
          .execute()
      : [];

  const encontrados = fuzzySearch(clientes, term, {
    fields: (usuario) => [usuario.name, usuario.email],
  });

  // El correo exacto entra aunque quien lo tenga no sea cliente todavía.
  const porCorreo = await db()
    .selectFrom('users')
    .select(['id', 'name', 'email'])
    .where('deleted_at', 'is', null)
    .where('email_key', '=', term.toLowerCase())
    .executeTakeFirst();

  const resultado = [...encontrados];
  if (porCorreo && !resultado.some((usuario) => usuario.id === porCorreo.id)) {
    resultado.unshift(porCorreo);
  }

  return resultado.slice(0, 20).map((row) => ({ id: row.id, name: row.name, email: row.email }));
}

function expiryFor(validityDays: number, from = Date.now()): string | null {
  return validityDays > 0 ? new Date(from + validityDays * 86_400_000).toISOString() : null;
}

/**
 * Emite un bono a una persona. Es la misma función para la compra por la web y
 * para la asignación desde el panel: solo cambian `source` y el pago asociado.
 */
export async function grantPack(params: {
  organizationId: string;
  userId: string;
  packId: string;
  credits?: number;
  expiresAt?: string | null;
  note?: string | null;
  source: 'online' | 'admin';
  grantedBy?: string | null;
  paymentId?: string | null;
  silent?: boolean;
}): Promise<CreditWallet> {
  const pack = await db()
    .selectFrom('credit_packs')
    .selectAll()
    .where('id', '=', params.packId)
    .where('organization_id', '=', params.organizationId)
    .executeTakeFirst();
  if (!pack) throw new NotFoundError('El bono no existe', 'credit_pack_not_found');

  const user = await db()
    .selectFrom('users')
    .select(['id', 'name', 'email', 'locale'])
    .where('id', '=', params.userId)
    .executeTakeFirst();
  if (!user) throw new NotFoundError('El usuario no existe', 'user_not_found');

  const id = newId();
  const now = isoNow();
  const credits = params.credits ?? pack.credits;
  const expiresAt =
    params.expiresAt !== undefined ? params.expiresAt : expiryFor(pack.validity_days);

  await db()
    .insertInto('credit_wallets')
    .values({
      id,
      organization_id: params.organizationId,
      user_id: params.userId,
      credit_pack_id: pack.id,
      credits_total: credits,
      credits_used: 0,
      expires_at: expiresAt,
      source: params.source,
      granted_by: params.grantedBy ?? null,
      payment_id: params.paymentId ?? null,
      note: params.note ?? null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db()
    .insertInto('credit_ledger')
    .values({
      id: newId(),
      wallet_id: id,
      appointment_id: null,
      delta: credits,
      reason: params.source === 'online' ? 'purchase' : 'grant',
      created_by: params.grantedBy ?? null,
      note: params.note ?? null,
      created_at: now,
    })
    .execute();

  await recordAudit({
    organizationId: params.organizationId,
    actorId: params.grantedBy ?? null,
    actorType: params.source === 'admin' ? 'staff' : 'customer',
    action: 'credit_wallet.grant',
    entityType: 'credit_wallet',
    entityId: id,
    changes: { userId: params.userId, packId: pack.id, credits, expiresAt },
  });

  if (!params.silent) {
    await notify({
      organizationId: params.organizationId,
      userId: params.userId,
      event: 'credit.granted',
      locale: (user.locale ?? undefined) as never,
      vars: {
        usuario: user.name ?? user.email ?? '',
        bono: pack.name,
        sesiones: String(credits),
        caducidad: expiresAt ? expiresAt.slice(0, 10) : 'sin caducidad',
      },
    }).catch(() => undefined);
  }

  return getWallet(params.organizationId, id);
}

/**
 * Ajusta un bono emitido: añade o retira sesiones, cambia la caducidad o lo
 * anula. Retirar sesiones nunca deja el saldo por debajo de lo ya consumido.
 */
export async function adjustWallet(
  organizationId: string,
  id: string,
  input: AdjustCreditWalletInput,
  actorId: string | null,
): Promise<CreditWallet> {
  const current = await db()
    .selectFrom('credit_wallets')
    .selectAll()
    .where('id', '=', id)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!current) throw new NotFoundError('El bono no existe', 'credit_wallet_not_found');

  const now = isoNow();
  const changes: Record<string, unknown> = { updated_at: now };

  // Se admiten las dos formas de cambiar el saldo: la diferencia (los botones
  // de +1 del listado) y el total (el formulario de edición). El asiento del
  // libro siempre se escribe como diferencia.
  const delta =
    input.total !== undefined ? input.total - current.credits_total : (input.delta ?? 0);

  if (delta !== 0) {
    const total = current.credits_total + delta;
    if (total < current.credits_used) {
      throw new ConflictError(
        'No se pueden retirar sesiones ya consumidas',
        'credits_already_used',
      );
    }
    changes.credits_total = total;
  }
  if (input.expiresAt !== undefined) changes.expires_at = input.expiresAt;
  if (input.cancelled !== undefined) changes.cancelled_at = input.cancelled ? now : null;
  if (input.note !== undefined) changes.note = input.note;

  await db().updateTable('credit_wallets').set(changes).where('id', '=', id).execute();

  if (delta !== 0) {
    await db()
      .insertInto('credit_ledger')
      .values({
        id: newId(),
        wallet_id: id,
        appointment_id: null,
        delta,
        reason: 'adjustment',
        created_by: actorId,
        note: input.note ?? null,
        created_at: now,
      })
      .execute();
  }

  await recordAudit({
    organizationId,
    actorId,
    actorType: 'staff',
    action: 'credit_wallet.adjust',
    entityType: 'credit_wallet',
    entityId: id,
    changes: input as Record<string, unknown>,
  });

  return getWallet(organizationId, id);
}

/* -------------------------------------------------------------------------- */
/* Saldo y elegibilidad                                                        */
/* -------------------------------------------------------------------------- */

/** Bonos vivos de una persona, del que antes caduca al que más tarde. */
async function usableWallets(
  organizationId: string,
  userId: string,
  serviceId?: string,
  executor: Executor = db(),
): Promise<WalletRow[]> {
  const rows = await walletQuery(organizationId, executor)
    .where('credit_wallets.user_id', '=', userId)
    .where('credit_wallets.cancelled_at', 'is', null)
    .execute();

  const now = isoNow();
  return rows
    .filter((row) => walletStatus(row, now) === 'active')
    .filter((row) => {
      if (!serviceId) return true;
      const ids = parseServiceIds(row.pack_service_ids);
      // Lista vacía significa "cualquier servicio de la organización".
      return ids.length === 0 || ids.includes(serviceId);
    })
    .sort((a, b) => (a.expires_at ?? '9999').localeCompare(b.expires_at ?? '9999'));
}

export async function balanceFor(
  organizationId: string,
  userId: string,
): Promise<CreditBalance> {
  const rows = await walletQuery(organizationId)
    .where('credit_wallets.user_id', '=', userId)
    .orderBy('credit_wallets.created_at', 'desc')
    .execute();

  const names = await serviceNames(organizationId);
  const now = isoNow();
  const wallets = rows.map((row) => toWallet(row, names, now));

  return {
    available: wallets
      .filter((wallet) => wallet.status === 'active')
      .reduce((total, wallet) => total + wallet.remaining, 0),
    wallets,
    packsForSale: await listPacks(organizationId, { onlyActive: true, onlyOnline: true }),
  };
}

/**
 * ¿Puede esta persona reservar este servicio? Solo dice que no cuando el
 * servicio exige bono: el resto de reglas de reserva se comprueban aparte.
 */
export async function eligibilityFor(
  organizationId: string,
  userId: string | null,
  serviceId: string,
): Promise<CreditEligibility> {
  const service = await db()
    .selectFrom('services')
    .select(['id', 'requires_credit_pack'])
    .where('id', '=', serviceId)
    .where('organization_id', '=', organizationId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!service) throw new NotFoundError('El servicio no existe', 'service_not_found');

  const packsForSale = (await listPacks(organizationId, { onlyActive: true, onlyOnline: true }))
    .filter((pack) => pack.serviceIds.length === 0 || pack.serviceIds.includes(serviceId));

  if (service.requires_credit_pack !== 1) {
    return { required: false, allowed: true, available: 0, reason: 'not_required', packsForSale };
  }
  if (!userId) {
    return { required: true, allowed: false, available: 0, reason: 'anonymous', packsForSale };
  }

  const wallets = await usableWallets(organizationId, userId, serviceId);
  const available = wallets.reduce(
    (total, row) => total + Math.max(row.credits_total - row.credits_used, 0),
    0,
  );

  return {
    required: true,
    allowed: available > 0,
    available,
    reason: available > 0 ? 'ok' : 'no_credits',
    packsForSale,
  };
}

/* -------------------------------------------------------------------------- */
/* Consumo y devolución                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Descuenta una sesión dentro de la transacción de la reserva y devuelve el
 * bono usado.
 *
 * El descuento es un `UPDATE` condicionado a que quede saldo, no un `SELECT`
 * seguido de un `UPDATE`: así dos reservas simultáneas del mismo cliente no
 * pueden gastar la misma sesión, sin necesidad de bloqueos explícitos, que no
 * están disponibles en los cinco motores soportados.
 */
export async function consumeCredit(
  trx: Transaction<Database>,
  params: {
    organizationId: string;
    userId: string;
    serviceId: string;
    appointmentId: string;
  },
): Promise<string | null> {
  const candidates = await usableWallets(
    params.organizationId,
    params.userId,
    params.serviceId,
    trx,
  );
  const now = isoNow();

  for (const candidate of candidates) {
    const result = await trx
      .updateTable('credit_wallets')
      .set((eb) => ({ credits_used: eb('credits_used', '+', 1), updated_at: now }))
      .where('id', '=', candidate.id)
      .where((eb) => eb('credits_used', '<', eb.ref('credits_total')))
      .where('cancelled_at', 'is', null)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows ?? 0) === 0) continue;

    await trx
      .insertInto('credit_ledger')
      .values({
        id: newId(),
        wallet_id: candidate.id,
        appointment_id: params.appointmentId,
        delta: -1,
        reason: 'appointment',
        created_by: null,
        note: null,
        created_at: now,
      })
      .execute();

    return candidate.id;
  }

  return null;
}

/**
 * Devuelve la sesión de una cita cancelada. Es idempotente: si ya se devolvió,
 * no vuelve a sumar.
 */
export async function refundCredit(
  appointmentId: string,
  reason: 'cancel' | 'reschedule' = 'cancel',
): Promise<boolean> {
  const appointment = await db()
    .selectFrom('appointments')
    .select(['id', 'credit_wallet_id'])
    .where('id', '=', appointmentId)
    .executeTakeFirst();
  if (!appointment?.credit_wallet_id) return false;

  const alreadyRefunded = await db()
    .selectFrom('credit_ledger')
    .select('id')
    .where('appointment_id', '=', appointmentId)
    .where('delta', '>', 0)
    .executeTakeFirst();
  if (alreadyRefunded) return false;

  const now = isoNow();
  const result = await db()
    .updateTable('credit_wallets')
    .set((eb) => ({ credits_used: eb('credits_used', '-', 1), updated_at: now }))
    .where('id', '=', appointment.credit_wallet_id)
    .where('credits_used', '>', 0)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows ?? 0) === 0) return false;

  await db()
    .insertInto('credit_ledger')
    .values({
      id: newId(),
      wallet_id: appointment.credit_wallet_id,
      appointment_id: appointmentId,
      delta: 1,
      reason,
      created_by: null,
      note: null,
      created_at: now,
    })
    .execute();

  return true;
}

/**
 * Paga con bono una cita que ya existe. Sirve para servicios que no exigen
 * bono pero que el cliente quiere canjear igualmente.
 */
export async function payAppointmentWithCredit(
  organizationId: string,
  userId: string,
  appointmentId: string,
): Promise<boolean> {
  const appointment = await db()
    .selectFrom('appointments')
    .select(['id', 'service_id', 'credit_wallet_id'])
    .where('id', '=', appointmentId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!appointment) throw new NotFoundError('La cita no existe', 'appointment_not_found');
  if (appointment.credit_wallet_id) return true;

  const walletId = await db()
    .transaction()
    .execute((trx) =>
      consumeCredit(trx, {
        organizationId,
        userId,
        serviceId: appointment.service_id,
        appointmentId,
      }),
    );
  if (!walletId) return false;

  await db()
    .updateTable('appointments')
    .set({ credit_wallet_id: walletId, payment_status: 'paid', updated_at: isoNow() })
    .where('id', '=', appointmentId)
    .execute();

  return true;
}
