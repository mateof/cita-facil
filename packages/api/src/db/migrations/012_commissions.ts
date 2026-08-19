import type { Kysely } from 'kysely';
import { intDefault, t, type } from './helpers.js';

/**
 * Comisión del profesional.
 *
 * Cuelga del recurso y no de la pertenencia al equipo porque es la agenda la
 * que factura: las citas se apuntan a un recurso, y hay recursos que no son
 * personas (una sala, una pista) y personas que atienden en dos sitios. Con la
 * comisión en el recurso, el informe sale de un `join` que ya existía.
 *
 * Se guarda en puntos básicos (1000 = 10 %) y no en porcentaje entero porque
 * el 12,5 % es un reparto perfectamente normal y con un entero de porcentaje
 * habría que redondearlo.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('resources')
    .addColumn('commission_bp', type(t.int()), intDefault(0))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('resources').dropColumn('commission_bp').execute();
}
