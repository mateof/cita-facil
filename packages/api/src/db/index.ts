import type { Kysely } from 'kysely';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createDb, optionsFromEnv, type DbConnectionOptions } from './dialect.js';
import { migrateToLatest } from './migrator.js';
import type { Database } from './types.js';

let instance: Kysely<Database> | null = null;

/** Devuelve la conexión activa. Lanza si todavía no se ha inicializado. */
export function db(): Kysely<Database> {
  if (!instance) {
    throw new Error('La base de datos no está inicializada. Llama antes a initDatabase().');
  }
  return instance;
}

export function isDatabaseReady(): boolean {
  return instance !== null;
}

export interface InitOptions {
  options?: DbConnectionOptions;
  migrate?: boolean;
}

/**
 * Abre la conexión y, si procede, aplica las migraciones pendientes. Esto es lo
 * que hace que arrancar contra una base de datos vacía funcione sin pasos
 * previos: si no hay tablas, se crean.
 */
export async function initDatabase(init: InitOptions = {}): Promise<Kysely<Database>> {
  if (instance) return instance;

  const options = init.options ?? optionsFromEnv();
  logger.info(
    { client: options.client, database: options.client === 'sqlite' ? options.file : options.database },
    'Conectando con la base de datos',
  );

  instance = await createDb(
    options,
    env.DB_LOG_QUERIES
      ? (event) => {
          if (event.level === 'query') {
            logger.debug(
              { sql: event.query.sql, durationMs: Math.round(event.queryDurationMillis) },
              'SQL',
            );
          } else {
            logger.error({ err: event.error, sql: event.query.sql }, 'Error de SQL');
          }
        }
      : undefined,
  );

  if (init.migrate ?? env.DB_AUTO_MIGRATE) {
    const applied = await migrateToLatest(instance);
    if (applied > 0) {
      logger.info({ applied }, 'Esquema actualizado');
    }
  }

  return instance;
}

export async function closeDatabase(): Promise<void> {
  if (!instance) return;
  await instance.destroy();
  instance = null;
}

/** Sustituye la conexión activa. Solo para pruebas. */
export function setDatabaseForTests(value: Kysely<Database> | null): void {
  instance = value;
}

export type { Database } from './types.js';
export * from './columns.js';
