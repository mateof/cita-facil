import type { Kysely } from 'kysely';
import { t, type } from './helpers.js';

/**
 * Imagen, icono y color para las entidades que se enseñan en una lista.
 *
 * Tres formas de representar lo mismo, con la misma precedencia en todas: si
 * hay imagen se enseña la imagen; si no, el icono; y si tampoco, las iniciales
 * del nombre sobre un color. Las iniciales no se guardan, se calculan, y el
 * color de respaldo también sale del nombre, así que una entidad sin configurar
 * nada ya se ve distinta de las demás.
 *
 * `image_url` guarda una ruta relativa servida por el propio API
 * (`/api/v1/uploads/...`), no una dirección externa: los ficheros viven en el
 * volumen de datos, junto a la base de datos, y entran en las copias.
 *
 * `services` y `resources` ya tenían `image_url` y `color` desde el principio,
 * aunque sin nada que los rellenara.
 */
export async function up(db: Kysely<any>): Promise<void> {
  /* --------------------------------------------------------- organizaciones */
  await db.schema.alterTable('organizations').addColumn('image_url', type(t.str(500))).execute();
  await db.schema.alterTable('organizations').addColumn('icon', type(t.str(64))).execute();
  await db.schema.alterTable('organizations').addColumn('color', type(t.str(9))).execute();

  /* ------------------------------------------------------------------ sedes */
  await db.schema.alterTable('locations').addColumn('image_url', type(t.str(500))).execute();
  await db.schema.alterTable('locations').addColumn('icon', type(t.str(64))).execute();
  await db.schema.alterTable('locations').addColumn('color', type(t.str(9))).execute();

  /* -------------------------------------------------- servicios y recursos */
  await db.schema.alterTable('services').addColumn('icon', type(t.str(64))).execute();
  await db.schema.alterTable('resources').addColumn('icon', type(t.str(64))).execute();

  /* -------------------------------------------------------------- catálogo */
  await db.schema.alterTable('service_categories').addColumn('image_url', type(t.str(500))).execute();
  await db.schema.alterTable('service_categories').addColumn('icon', type(t.str(64))).execute();
  await db.schema.alterTable('credit_packs').addColumn('image_url', type(t.str(500))).execute();
  await db.schema.alterTable('credit_packs').addColumn('icon', type(t.str(64))).execute();
  await db.schema.alterTable('credit_packs').addColumn('color', type(t.str(9))).execute();

  /* -------------------------------------------------------------- personas */
  // `avatar_url` ya existía. El icono es para quien prefiera uno a su foto.
  await db.schema.alterTable('users').addColumn('icon', type(t.str(64))).execute();
  await db.schema.alterTable('users').addColumn('color', type(t.str(9))).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const [tabla, columnas] of [
    ['organizations', ['image_url', 'icon', 'color']],
    ['locations', ['image_url', 'icon', 'color']],
    ['services', ['icon']],
    ['resources', ['icon']],
    ['service_categories', ['image_url', 'icon']],
    ['credit_packs', ['image_url', 'icon', 'color']],
    ['users', ['icon', 'color']],
  ] as [string, string[]][]) {
    for (const columna of columnas) {
      await db.schema.alterTable(tabla).dropColumn(columna).execute();
    }
  }
}
