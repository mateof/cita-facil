import type { DbClient } from '@cita-facil/shared';

/**
 * Tipos de columna portables.
 *
 * Cada motor nombra los tipos a su manera y el constructor de esquemas de
 * Kysely los pasa tal cual. Estas funciones traducen un tipo lógico al literal
 * concreto del motor activo, de forma que una sola migración vale para SQLite,
 * PostgreSQL, MySQL/MariaDB y SQL Server.
 *
 * Decisiones de representación (ver docs/base-de-datos.md):
 * - Los booleanos se guardan como entero 0/1 en todos los motores. Evita las
 *   diferencias entre `boolean`, `tinyint(1)` y `bit`, y hace que el valor que
 *   devuelve el driver sea siempre el mismo.
 * - Los instantes se guardan como texto ISO-8601 UTC (`2026-07-25T09:30:00.000Z`).
 *   Con formato fijo, el orden lexicográfico coincide con el cronológico.
 * - Los importes se guardan como enteros en unidades menores (céntimos).
 * - Los objetos se guardan como JSON serializado en texto.
 */
export interface ColumnTypes {
  id(): string;
  str(length: number): string;
  text(): string;
  int(): string;
  bigint(): string;
  /** Entero 0/1. */
  bool(): string;
  json(): string;
  /** `2026-07-25T09:30:00.000Z` */
  instant(): string;
  /** `2026-07-25` */
  date(): string;
  /** Binario para claves públicas y firmas. */
  blob(): string;
}

export function columnTypes(client: DbClient): ColumnTypes {
  switch (client) {
    case 'mssql':
      return {
        id: () => 'varchar(36)',
        str: (n) => `nvarchar(${n})`,
        text: () => 'nvarchar(max)',
        int: () => 'int',
        bigint: () => 'bigint',
        bool: () => 'tinyint',
        json: () => 'nvarchar(max)',
        instant: () => 'varchar(24)',
        date: () => 'varchar(10)',
        blob: () => 'varbinary(max)',
      };
    case 'mysql':
    case 'mariadb':
      return {
        id: () => 'varchar(36)',
        str: (n) => `varchar(${n})`,
        text: () => 'text',
        int: () => 'int',
        bigint: () => 'bigint',
        bool: () => 'tinyint',
        json: () => 'text',
        instant: () => 'varchar(24)',
        date: () => 'varchar(10)',
        blob: () => 'blob',
      };
    case 'postgres':
      return {
        id: () => 'varchar(36)',
        str: (n) => `varchar(${n})`,
        text: () => 'text',
        int: () => 'integer',
        bigint: () => 'bigint',
        bool: () => 'smallint',
        json: () => 'text',
        instant: () => 'varchar(24)',
        date: () => 'varchar(10)',
        blob: () => 'bytea',
      };
    case 'sqlite':
    default:
      return {
        id: () => 'varchar(36)',
        str: (n) => `varchar(${n})`,
        text: () => 'text',
        int: () => 'integer',
        bigint: () => 'integer',
        bool: () => 'integer',
        json: () => 'text',
        instant: () => 'varchar(24)',
        date: () => 'varchar(10)',
        blob: () => 'blob',
      };
  }
}

/** Convierte un booleano de dominio al entero que se guarda. */
export function toDbBool(value: boolean | null | undefined): number | null {
  if (value == null) return null;
  return value ? 1 : 0;
}

/** Convierte lo que devuelve el driver a booleano. */
export function fromDbBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
  if (value instanceof Buffer) return value.length > 0 && value[0] !== 0;
  return false;
}

/** Serializa un objeto a la columna JSON. */
export function toDbJson(value: unknown): string | null {
  if (value == null) return null;
  return JSON.stringify(value);
}

/** Lee una columna JSON con degradación segura. */
export function fromDbJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string' || value.length === 0) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
