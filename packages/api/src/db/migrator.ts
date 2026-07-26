import type { Kysely } from 'kysely';
// Kysely 0.29 sacó las migraciones del punto de entrada principal para que no
// carguen en quien solo consulta.
import { Migrator, type MigrationResultSet } from 'kysely/migration';
import type { Database } from './types.js';
import { StaticMigrationProvider, migrations } from './migrations/index.js';
import { logger } from '../lib/logger.js';

function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new StaticMigrationProvider(),
    migrationTableName: 'cf_migrations',
    migrationLockTableName: 'cf_migrations_lock',
  });
}

function report(results: MigrationResultSet, direction: 'up' | 'down'): void {
  for (const result of results.results ?? []) {
    if (result.status === 'Success') {
      logger.info({ migration: result.migrationName, direction }, 'Migración aplicada');
    } else if (result.status === 'Error') {
      logger.error({ migration: result.migrationName, direction }, 'Migración fallida');
    }
  }
  if (results.error) throw results.error;
}

/**
 * Aplica todas las migraciones pendientes. Si la base de datos está vacía crea
 * el esquema completo; si ya existe, solo ejecuta lo que falte. Es la operación
 * que se lanza al arrancar cuando `DB_AUTO_MIGRATE` está activo.
 */
export async function migrateToLatest(db: Kysely<Database>): Promise<number> {
  const migrator = createMigrator(db);
  const results = await migrator.migrateToLatest();
  report(results, 'up');
  return results.results?.filter((r) => r.status === 'Success').length ?? 0;
}

export async function migrateDown(db: Kysely<Database>): Promise<void> {
  const migrator = createMigrator(db);
  report(await migrator.migrateDown(), 'down');
}

export interface MigrationStatus {
  name: string;
  executedAt: string | null;
}

export async function migrationStatus(db: Kysely<Database>): Promise<MigrationStatus[]> {
  const migrator = createMigrator(db);
  const list = await migrator.getMigrations();
  return list.map((item) => ({
    name: item.name,
    executedAt: item.executedAt ? new Date(item.executedAt).toISOString() : null,
  }));
}

export async function hasPendingMigrations(db: Kysely<Database>): Promise<boolean> {
  const status = await migrationStatus(db);
  return status.some((item) => item.executedAt === null);
}

export const knownMigrationNames = Object.keys(migrations);
