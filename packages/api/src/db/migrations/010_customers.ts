import type { Kysely } from 'kysely';
import { createTable, index, notNull, pk, timestamps, t, type } from './helpers.js';

/**
 * Ficha de cliente.
 *
 * Todo lo que el panel enseña de una persona (citas, gasto, faltas, saldo de
 * bonos, deuda) ya está en otras tablas y se calcula al vuelo: duplicarlo aquí
 * obligaría a mantenerlo al día desde media docena de sitios y a la primera
 * incidencia enseñaría un número que no cuadra con el histórico.
 *
 * Lo único que no existe en ningún lado es lo que escribe el mostrador: las
 * notas internas sobre la persona y las etiquetas con las que la agrupa. Eso es
 * esta tabla, y va por organización: la misma cuenta puede ser clienta de la
 * peluquería y del gimnasio, y lo que uno anote no lo puede leer el otro.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await timestamps(
    pk(createTable(db, 'customer_profiles'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('user_id', type(t.id()), notNull)
      /** Notas del mostrador. Nunca se le enseñan al cliente. */
      .addColumn('notes', type(t.text()))
      /** Etiquetas libres del negocio: `["vip","alergia tinte"]`. */
      .addColumn('tags_json', type(t.json())),
  )
    .addForeignKeyConstraint('fk_customer_profiles_org', ['organization_id'], 'organizations', [
      'id',
    ])
    .execute();

  await index(db, 'customer_profiles', ['organization_id', 'user_id'], { unique: true });
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('customer_profiles').execute();
}
