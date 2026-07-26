import type { Kysely } from 'kysely';
import {
  boolDefault,
  createTable,
  dropTables,
  index,
  intDefault,
  notNull,
  pk,
  strDefault,
  t,
  timestamps,
  type,
} from './helpers.js';

/**
 * Páginas de contenido de cada organización: contacto, sobre nosotros y las que
 * hagan falta más adelante.
 *
 * Es una tabla y no un campo más en los ajustes porque el contenido es largo,
 * está traducido a varios idiomas y va a crecer en número de páginas. Meterlo
 * en el JSON de ajustes obligaría a leer y reescribir toda la configuración de
 * la organización para tocar un párrafo.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await timestamps(
    pk(createTable(db, 'organization_pages'))
      .addColumn('organization_id', type(t.id()), notNull)
      // `contact`, `about`, y lo que venga después.
      .addColumn('key', type(t.str(32)), notNull)
      // `markdown` o `html`. El contenido se guarda tal cual se escribió.
      .addColumn('format', type(t.str(10)), strDefault('markdown'))
      .addColumn('title_i18n_json', type(t.json()))
      .addColumn('body_i18n_json', type(t.text()))
      // Publicada: aparece en el pie de la página pública. Sin publicar se
      // puede ir redactando sin que la vea nadie.
      .addColumn('published', type(t.bool()), boolDefault(false))
      .addColumn('sort_order', type(t.int()), intDefault(0))
      .addColumn('updated_by', type(t.id())),
  )
    .addForeignKeyConstraint('fk_org_pages_org', ['organization_id'], 'organizations', ['id'])
    .execute();

  await index(db, 'organization_pages', ['organization_id', 'key'], {
    unique: true,
    name: 'ux_org_pages_key',
  });
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, ['organization_pages']);
}
