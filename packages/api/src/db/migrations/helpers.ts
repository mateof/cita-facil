import { sql, type ColumnDefinitionBuilder, type Kysely } from 'kysely';
import { columnTypes } from '../columns.js';
import { env } from '../../config/env.js';

/** Tipos de columna del motor activo. */
export const t = columnTypes(env.DB_CLIENT);

/**
 * Kysely tipa `addColumn` con una lista cerrada de tipos conocidos. Como aquí
 * los tipos se calculan por motor (`nvarchar(max)`, `tinyint`, ...), se pasan
 * como SQL en crudo.
 */
export function type(literal: string) {
  return sql.raw(literal);
}

/** Constructor de tabla con tipado laxo: las migraciones no necesitan el tipado fino. */
export type TableBuilder = {
  addColumn(name: string, dataType: unknown, build?: (c: ColumnDefinitionBuilder) => unknown): TableBuilder;
  addPrimaryKeyConstraint(name: string, columns: string[]): TableBuilder;
  addForeignKeyConstraint(
    name: string,
    columns: string[],
    targetTable: string,
    targetColumns: string[],
  ): TableBuilder;
  addUniqueConstraint(name: string, columns: string[]): TableBuilder;
  execute(): Promise<void>;
};

export function createTable(db: Kysely<any>, name: string): TableBuilder {
  return db.schema.createTable(name) as unknown as TableBuilder;
}

/** Columna de clave primaria en texto (UUID v7). */
export function pk(builder: TableBuilder): TableBuilder {
  return builder.addColumn('id', type(t.id()), (c) => c.primaryKey().notNull());
}

/** Par `created_at` / `updated_at` con el formato de instante del proyecto. */
export function timestamps(builder: TableBuilder, withUpdated = true): TableBuilder {
  let next = builder.addColumn('created_at', type(t.instant()), (c) => c.notNull());
  if (withUpdated) {
    next = next.addColumn('updated_at', type(t.instant()), (c) => c.notNull());
  }
  return next;
}

export const notNull = (c: ColumnDefinitionBuilder) => c.notNull();
export const boolDefault = (value: boolean) => (c: ColumnDefinitionBuilder) =>
  c.notNull().defaultTo(value ? 1 : 0);
export const intDefault = (value: number) => (c: ColumnDefinitionBuilder) =>
  c.notNull().defaultTo(value);
export const strDefault = (value: string) => (c: ColumnDefinitionBuilder) =>
  c.notNull().defaultTo(value);

/**
 * Crea un índice. Los nombres se prefijan con la tabla porque en PostgreSQL y
 * SQL Server el espacio de nombres de índices es del esquema, no de la tabla.
 */
export async function index(
  db: Kysely<any>,
  table: string,
  columns: string[],
  options: { unique?: boolean; name?: string } = {},
): Promise<void> {
  const name = (options.name ?? `ix_${table}_${columns.join('_')}`).slice(0, 60);
  let builder = db.schema.createIndex(name).on(table).columns(columns);
  if (options.unique) builder = builder.unique();
  await builder.execute();
}

export async function dropTables(db: Kysely<any>, tables: string[]): Promise<void> {
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
