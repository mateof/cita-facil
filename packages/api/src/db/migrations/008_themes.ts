import type { Kysely } from 'kysely';
import { boolDefault, createTable, index, notNull, pk, t, timestamps, type } from './helpers.js';

/**
 * Temas de cada organización.
 *
 * Es una tabla y no un campo más en los ajustes porque una organización tiene
 * varios: los va probando, guarda el que le gusta y vuelve al anterior si se
 * arrepiente. Con un único bloque de configuración habría que sobrescribir el
 * tema en uso cada vez que se quisiera probar otro.
 *
 * `active` marca el que se aplica en la página pública. Se garantiza que solo
 * hay uno activo por organización desde el servicio, no con un índice único:
 * un índice sobre `(organization_id, active)` obligaría a guardar `active` como
 * NULL en los inactivos para que SQL Server no los considere duplicados, y eso
 * complica las consultas más de lo que ayuda.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await timestamps(
    pk(createTable(db, 'themes'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('name', type(t.str(80)), notNull)
      .addColumn('description', type(t.str(300)))
      /** Los ajustes con nombre, tal cual los guarda el editor. */
      .addColumn('tokens_json', type(t.json()))
      /** Hoja propia, ya saneada al guardar. */
      .addColumn('custom_css', type(t.text()))
      /** Marca de la cabecera: nombre corto, largo y su estilo. */
      .addColumn('header_json', type(t.json()))
      .addColumn('active', type(t.bool()), boolDefault(false)),
  )
    .addForeignKeyConstraint('fk_themes_org', ['organization_id'], 'organizations', ['id'])
    .execute();

  await index(db, 'themes', ['organization_id']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('themes').execute();
}
