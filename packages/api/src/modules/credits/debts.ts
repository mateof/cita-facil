import type { Transaction } from 'kysely';
import { db } from '../../db/index.js';
import type { Database } from '../../db/types.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';

/**
 * Sesiones a deber.
 *
 * Cuando la organización lo permite, se puede reservar un servicio de bono sin
 * saldo: la cita se crea y queda anotada una deuda de una sesión. Al comprar o
 * recibir el siguiente bono, las deudas se saldan solas y esas sesiones se
 * descuentan sin que nadie tenga que acordarse.
 *
 * Se guardan en su propia tabla y no como un apunte negativo en el libro del
 * bono porque una deuda todavía no pertenece a ningún bono: nace precisamente
 * cuando no hay ninguno al que cargarla.
 */

type Executor = typeof db extends () => infer T ? T | Transaction<Database> : never;

/** Deudas vivas de una persona en una organización. */
export async function pendingDebts(
  organizationId: string,
  userId: string,
  executor: Executor = db(),
): Promise<{ id: string; appointmentId: string | null; createdAt: string }[]> {
  const rows = await executor
    .selectFrom('credit_debts')
    .select(['id', 'appointment_id', 'created_at'])
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .where('settled_at', 'is', null)
    .where('cancelled_at', 'is', null)
    .orderBy('created_at')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    appointmentId: row.appointment_id,
    createdAt: row.created_at,
  }));
}

export async function countPendingDebts(
  organizationId: string,
  userId: string,
  executor: Executor = db(),
): Promise<number> {
  return (await pendingDebts(organizationId, userId, executor)).length;
}

/** Anota que alguien se lleva una sesión que todavía no ha pagado. */
export async function recordDebt(
  executor: Executor,
  params: {
    organizationId: string;
    userId: string;
    appointmentId: string | null;
    serviceId: string | null;
  },
): Promise<string> {
  const id = newId();
  const now = isoNow();

  await executor
    .insertInto('credit_debts')
    .values({
      id,
      organization_id: params.organizationId,
      user_id: params.userId,
      appointment_id: params.appointmentId,
      service_id: params.serviceId,
      settled_wallet_id: null,
      settled_at: null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return id;
}

/**
 * Anula la deuda de una cita que se cancela antes de haberla saldado.
 *
 * No se cobra: la sesión no se llegó a prestar y el bono nunca se tocó.
 */
export async function cancelDebtForAppointment(appointmentId: string): Promise<number> {
  const result = await db()
    .updateTable('credit_debts')
    .set({ cancelled_at: isoNow(), updated_at: isoNow() })
    .where('appointment_id', '=', appointmentId)
    .where('settled_at', 'is', null)
    .where('cancelled_at', 'is', null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows ?? 0);
}

/**
 * Salda con un bono recién emitido todas las sesiones que se deban, hasta
 * donde llegue.
 *
 * El descuento va condicionado a que quede saldo en el propio `UPDATE`, igual
 * que el consumo normal: si dos bonos se emiten a la vez, no pueden pagar las
 * dos la misma deuda.
 */
export async function settleDebtsWithWallet(
  organizationId: string,
  userId: string,
  walletId: string,
): Promise<number> {
  const deudas = await pendingDebts(organizationId, userId);
  if (deudas.length === 0) return 0;

  let saldadas = 0;
  const now = isoNow();

  for (const deuda of deudas) {
    const consumido = await db()
      .updateTable('credit_wallets')
      .set((eb) => ({ credits_used: eb('credits_used', '+', 1), updated_at: now }))
      .where('id', '=', walletId)
      .where((eb) => eb('credits_used', '<', eb.ref('credits_total')))
      .where('cancelled_at', 'is', null)
      .executeTakeFirst();

    if (Number(consumido.numUpdatedRows ?? 0) === 0) break;

    await db()
      .updateTable('credit_debts')
      .set({ settled_wallet_id: walletId, settled_at: now, updated_at: now })
      .where('id', '=', deuda.id)
      .execute();

    await db()
      .insertInto('credit_ledger')
      .values({
        id: newId(),
        wallet_id: walletId,
        appointment_id: deuda.appointmentId,
        delta: -1,
        reason: 'debt_settlement',
        created_by: null,
        note: null,
        created_at: now,
      })
      .execute();

    saldadas += 1;
  }

  if (saldadas > 0) {
    logger.info({ organizationId, userId, walletId, saldadas }, 'Sesiones a deber saldadas');
  }
  return saldadas;
}

/** Lo que se debe en la organización, para el panel. */
export async function listDebts(
  organizationId: string,
  userId?: string,
): Promise<
  { id: string; userId: string; userName: string | null; appointmentId: string | null; createdAt: string }[]
> {
  let query = db()
    .selectFrom('credit_debts')
    .leftJoin('users', 'users.id', 'credit_debts.user_id')
    .select([
      'credit_debts.id',
      'credit_debts.user_id',
      'credit_debts.appointment_id',
      'credit_debts.created_at',
      'users.name as user_name',
    ])
    .where('credit_debts.organization_id', '=', organizationId)
    .where('credit_debts.settled_at', 'is', null)
    .where('credit_debts.cancelled_at', 'is', null);

  if (userId) query = query.where('credit_debts.user_id', '=', userId);

  const rows = await query.orderBy('credit_debts.created_at').limit(500).execute();
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    appointmentId: row.appointment_id,
    createdAt: row.created_at,
  }));
}
