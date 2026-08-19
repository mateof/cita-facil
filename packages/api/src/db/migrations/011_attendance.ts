import type { Kysely } from 'kysely';
import { intDefault, t, type } from './helpers.js';

/**
 * Confirmación de asistencia y política de faltas.
 *
 * Dos cosas que van juntas porque atacan el mismo problema, el hueco que se
 * pierde:
 *
 * 1. **Confirmar**: el recordatorio lleva un enlace para decir "voy" o "no
 *    puedo". Quien avisa a tiempo libera el hueco, que se ofrece a la lista de
 *    espera; quien confirma le ahorra al mostrador la llamada de comprobación.
 * 2. **Cargo por falta**: lo que el negocio cobra a quien no aparece o avisa
 *    fuera de plazo. Se anota en la cita, no se cobra solo: no se guardan
 *    tarjetas, así que cobrarlo sin que nadie esté delante no es posible.
 *
 * El cargo del servicio usa el mismo centinela `-1` que los plazos: es "lo que
 * diga la organización", que no es lo mismo que cero, que es "este servicio no
 * cobra faltas aunque la organización sí".
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('appointments')
    /** Cuándo dijo el cliente que iba a venir. */
    .addColumn('attendance_confirmed_at', type(t.instant()))
    .execute();

  await db.schema
    .alterTable('appointments')
    /** Cargo aplicado por faltar o por avisar fuera de plazo. */
    .addColumn('no_show_fee_cents', type(t.int()), intDefault(0))
    .execute();

  await db.schema
    .alterTable('services')
    .addColumn('no_show_fee_cents', type(t.int()), intDefault(-1))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('services').dropColumn('no_show_fee_cents').execute();
  await db.schema.alterTable('appointments').dropColumn('no_show_fee_cents').execute();
  await db.schema.alterTable('appointments').dropColumn('attendance_confirmed_at').execute();
}
