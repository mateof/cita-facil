import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  Kysely,
  MssqlDialect,
  MysqlDialect,
  PostgresDialect,
  SqliteDialect,
  type Dialect,
  type LogEvent,
} from 'kysely';
import type { DbClient } from '@cita-facil/shared';
import { env } from '../config/env.js';
import type { Database } from './types.js';

export interface DbConnectionOptions {
  client: DbClient;
  file?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean;
  sslRejectUnauthorized?: boolean;
  poolMin?: number;
  poolMax?: number;
}

/** Puerto por defecto de cada motor cuando no se indica uno. */
const DEFAULT_PORTS: Record<DbClient, number> = {
  sqlite: 0,
  postgres: 5432,
  mysql: 3306,
  mariadb: 3306,
  mssql: 1433,
};

export function optionsFromEnv(): DbConnectionOptions {
  return {
    client: env.DB_CLIENT,
    file: env.DB_FILE,
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    ssl: env.DB_SSL,
    sslRejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED,
    poolMin: env.DB_POOL_MIN,
    poolMax: env.DB_POOL_MAX,
  };
}

function requireValue<T>(value: T | undefined | null, name: string): T {
  if (value == null || value === '') {
    throw new Error(`Falta la variable ${name}, obligatoria para el motor seleccionado`);
  }
  return value;
}

async function createDialect(options: DbConnectionOptions): Promise<Dialect> {
  const port = options.port ?? DEFAULT_PORTS[options.client];

  switch (options.client) {
    case 'sqlite': {
      const { default: SQLite } = await import('better-sqlite3');
      const configured = options.file ?? './data/cita-facil.sqlite';
      // `:memory:` es un nombre especial de SQLite, no una ruta: resolverlo
      // crearía un fichero con ese nombre (y en Windows fallaría).
      const file = configured === ':memory:' ? configured : resolve(configured);
      if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
      const database = new SQLite(file);
      // WAL mejora mucho la concurrencia de lecturas mientras se escribe, y
      // `busy_timeout` evita errores SQLITE_BUSY en picos de escritura.
      database.pragma('journal_mode = WAL');
      database.pragma('synchronous = NORMAL');
      database.pragma('foreign_keys = ON');
      database.pragma('busy_timeout = 5000');
      return new SqliteDialect({ database });
    }

    case 'postgres': {
      const pg = await import('pg');
      const Pool = pg.default?.Pool ?? (pg as unknown as { Pool: typeof pg.Pool }).Pool;
      // `pg` devuelve los enteros de 8 bytes como texto para no perder precisión;
      // aquí no se usan valores tan grandes, así que se convierten a número.
      const types = pg.default?.types ?? pg.types;
      types.setTypeParser(20, (value: string) => Number(value));
      types.setTypeParser(1700, (value: string) => Number(value));
      return new PostgresDialect({
        pool: new Pool({
          host: requireValue(options.host, 'DB_HOST'),
          port,
          database: requireValue(options.database, 'DB_NAME'),
          user: requireValue(options.user, 'DB_USER'),
          password: options.password,
          max: options.poolMax ?? 10,
          min: options.poolMin ?? 0,
          ssl: options.ssl
            ? { rejectUnauthorized: options.sslRejectUnauthorized ?? true }
            : undefined,
        }),
      });
    }

    case 'mysql':
    case 'mariadb': {
      const mysql = await import('mysql2');
      const createPool = mysql.default?.createPool ?? mysql.createPool;
      // Los tipos de `mysql2` y los que espera Kysely difieren en detalles de
      // las firmas de callback, pero el objeto es el correcto en tiempo de
      // ejecución: es la integración documentada por el propio Kysely.
      return new MysqlDialect({
        pool: createPool({
          host: requireValue(options.host, 'DB_HOST'),
          port,
          database: requireValue(options.database, 'DB_NAME'),
          user: requireValue(options.user, 'DB_USER'),
          password: options.password,
          connectionLimit: options.poolMax ?? 10,
          // Sin esto, MySQL devuelve DECIMAL y BIGINT como texto.
          supportBigNumbers: true,
          bigNumberStrings: false,
          dateStrings: true,
          ssl: options.ssl
            ? { rejectUnauthorized: options.sslRejectUnauthorized ?? true }
            : undefined,
        }) as never,
      });
    }

    case 'mssql': {
      const tedious = await import('tedious');
      const tarn = await import('tarn');
      return new MssqlDialect({
        tarn: {
          ...tarn,
          options: {
            min: options.poolMin ?? 0,
            max: options.poolMax ?? 10,
          },
        },
        tedious: {
          ...tedious,
          connectionFactory: () =>
            new tedious.Connection({
              server: requireValue(options.host, 'DB_HOST'),
              options: {
                port,
                database: requireValue(options.database, 'DB_NAME'),
                trustServerCertificate: !(options.sslRejectUnauthorized ?? true),
                encrypt: options.ssl ?? true,
                // Sin esto, tedious devuelve los valores como objetos con metadatos.
                useColumnNames: false,
                rowCollectionOnRequestCompletion: false,
              },
              authentication: {
                type: 'default',
                options: {
                  userName: requireValue(options.user, 'DB_USER'),
                  password: options.password ?? '',
                },
              },
            }),
        },
      });
    }

    default: {
      const exhaustive: never = options.client;
      throw new Error(`Motor de base de datos no soportado: ${String(exhaustive)}`);
    }
  }
}

export async function createDb(
  options: DbConnectionOptions = optionsFromEnv(),
  onQuery?: (event: LogEvent) => void,
): Promise<Kysely<Database>> {
  const dialect = await createDialect(options);
  return new Kysely<Database>({
    dialect,
    log: onQuery ? (event) => onQuery(event) : undefined,
  });
}

/** Motores donde `LIMIT ... OFFSET` no existe y hay que usar `OFFSET ... FETCH`. */
export function usesOffsetFetch(client: DbClient): boolean {
  return client === 'mssql';
}
