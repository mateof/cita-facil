import type { Migration, MigrationProvider } from 'kysely/migration';
import * as m001 from './001_core.js';
import * as m002 from './002_booking.js';
import * as m003 from './003_platform.js';
import * as m004 from './004_access_policy.js';
import * as m005 from './005_credits.js';
import * as m006 from './006_pages.js';
import * as m007 from './007_avatars.js';
import * as m008 from './008_themes.js';
import * as m009 from './009_booking_rules.js';
import * as m010 from './010_customers.js';
import * as m011 from './011_attendance.js';
import * as m012 from './012_commissions.js';

/**
 * Las migraciones se registran en un objeto estático en lugar de leerse del
 * disco: así funcionan igual ejecutando el TypeScript en desarrollo, el
 * JavaScript compilado en producción y dentro de un contenedor, sin depender
 * de rutas ni de la extensión de los ficheros.
 */
export const migrations: Record<string, Migration> = {
  '001_core': m001,
  '002_booking': m002,
  '003_platform': m003,
  '004_access_policy': m004,
  '005_credits': m005,
  '006_pages': m006,
  '007_avatars': m007,
  '008_themes': m008,
  '009_booking_rules': m009,
  '010_customers': m010,
  '011_attendance': m011,
  '012_commissions': m012,
};

export class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return migrations;
  }
}
