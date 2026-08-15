import type { Kysely } from 'kysely';
import { boolDefault, index, intDefault, strDefault, t, type } from './helpers.js';

/**
 * Bonos: series de sesiones prepagadas, lo habitual en gimnasios, piscinas o
 * cabinas de bronceado.
 *
 * Las tablas base (`credit_packs`, `credit_wallets`, `credit_ledger`) ya
 * existían desde la 003, pensadas solo para la compra por pasarela. Aquí se
 * completan para lo que faltaba:
 *
 * - un servicio puede exigir bono activo para poder reservarse,
 * - el administrador decide si un tipo de bono se vende por la web,
 * - un bono puede emitirlo el administrador a mano, y hay que saber quién,
 *   cuándo y por qué, además de poder anularlo,
 * - la cita recuerda de qué bono salió el crédito, para devolverlo al cancelar.
 */
export async function up(db: Kysely<any>): Promise<void> {
  /* ------------------------------------------------------------- servicios */
  await db.schema
    .alterTable('services')
    .addColumn('requires_credit_pack', type(t.bool()), boolDefault(false))
    .execute();

  /* --------------------------------------------------------- tipos de bono */
  // Se vende por la web. Desactivado, el bono solo lo puede emitir el centro.
  await db.schema
    .alterTable('credit_packs')
    .addColumn('online_purchase', type(t.bool()), boolDefault(true))
    .execute();
  await db.schema
    .alterTable('credit_packs')
    .addColumn('sort_order', type(t.int()), intDefault(0))
    .execute();

  /* -------------------------------------------------------- bonos emitidos */
  // `online` (comprado por el cliente) o `admin` (emitido desde el centro).
  await db.schema
    .alterTable('credit_wallets')
    .addColumn('source', type(t.str(16)), strDefault('online'))
    .execute();
  await db.schema.alterTable('credit_wallets').addColumn('granted_by', type(t.id())).execute();
  await db.schema.alterTable('credit_wallets').addColumn('payment_id', type(t.id())).execute();
  await db.schema.alterTable('credit_wallets').addColumn('note', type(t.str(300))).execute();
  // Anulación: no se borra la fila porque el histórico de consumos cuelga de ella.
  await db.schema.alterTable('credit_wallets').addColumn('cancelled_at', type(t.instant())).execute();
  await db.schema.alterTable('credit_wallets').addColumn('updated_at', type(t.instant())).execute();

  await index(db, 'credit_wallets', ['credit_pack_id']);

  /* ------------------------------------------------------------ movimientos */
  await db.schema.alterTable('credit_ledger').addColumn('created_by', type(t.id())).execute();
  await db.schema.alterTable('credit_ledger').addColumn('note', type(t.str(200))).execute();
  await index(db, 'credit_ledger', ['appointment_id']);

  /* ------------------------------------------------------------------ citas */
  // De qué bono salió el crédito de esta cita, para devolverlo al cancelar.
  await db.schema
    .alterTable('appointments')
    .addColumn('credit_wallet_id', type(t.id()))
    .execute();
  await index(db, 'appointments', ['credit_wallet_id']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('appointments').dropColumn('credit_wallet_id').execute();
  await db.schema.alterTable('credit_ledger').dropColumn('note').execute();
  await db.schema.alterTable('credit_ledger').dropColumn('created_by').execute();
  await db.schema.alterTable('credit_wallets').dropColumn('updated_at').execute();
  await db.schema.alterTable('credit_wallets').dropColumn('cancelled_at').execute();
  await db.schema.alterTable('credit_wallets').dropColumn('note').execute();
  await db.schema.alterTable('credit_wallets').dropColumn('payment_id').execute();
  await db.schema.alterTable('credit_wallets').dropColumn('granted_by').execute();
  await db.schema.alterTable('credit_wallets').dropColumn('source').execute();
  await db.schema.alterTable('credit_packs').dropColumn('sort_order').execute();
  await db.schema.alterTable('credit_packs').dropColumn('online_purchase').execute();
  await db.schema.alterTable('services').dropColumn('requires_credit_pack').execute();
}
