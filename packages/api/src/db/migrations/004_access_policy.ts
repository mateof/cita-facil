import type { Kysely } from 'kysely';
import { createTable, dropTables, index, notNull, pk, strDefault, t, type } from './helpers.js';

/**
 * Lista de personas autorizadas a darse de alta cuando el registro no es
 * abierto.
 *
 * Es una tabla y no un ajuste en JSON porque hace falta buscar por valor en
 * cada intento de alta, dejar constancia de cuándo se usó cada entrada y
 * permitir listas largas sin releer un documento entero.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await pk(createTable(db, 'access_allowlist'))
    // `email`, `nif` o `domain`.
    .addColumn('type', type(t.str(10)), notNull)
    // Valor normalizado: correo en minúsculas, NIF en mayúsculas sin separadores,
    // dominio en minúsculas y sin la arroba.
    .addColumn('value', type(t.str(255)), notNull)
    .addColumn('note', type(t.str(200)))
    // Rol que se concede al darse de alta con esta entrada.
    .addColumn('platform_role', type(t.str(20)), strDefault('user'))
    // Organización a la que se une automáticamente, si procede.
    .addColumn('organization_id', type(t.id()))
    .addColumn('organization_role', type(t.str(20)))
    .addColumn('created_by', type(t.id()))
    .addColumn('used_at', type(t.instant()))
    .addColumn('used_by', type(t.id()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();

  await index(db, 'access_allowlist', ['type', 'value'], {
    unique: true,
    name: 'ux_allowlist_value',
  });
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, ['access_allowlist']);
}
