import type { Kysely } from 'kysely';
import { intDefault, strDefault, t, type } from './helpers.js';

/**
 * A qué horas puede empezar una cita, por servicio.
 *
 * Hasta ahora la rejilla de inicios era una sola para toda la organización
 * (`slotGranularityMinutes`), y eso no llega: en el mismo negocio conviven la
 * consulta que se da a cualquier hora libre, el tratamiento que solo empieza en
 * punto y la clase que es martes y jueves a las 12:00. Con una rejilla única
 * hay que elegir la más fina y confiar en que nadie reserve a deshora.
 *
 * Cuatro modos, en `start_mode`:
 *
 * - `inherit`: lo de siempre, la rejilla de la organización. Es lo que se pone
 *   a todos los servicios que ya existen, así que nada cambia al migrar.
 * - `interval`: rejilla propia pegada al reloj, con desfase opcional.
 * - `sequence`: encadenadas desde que abre el tramo, sumando la duración
 *   entera. Evita los huecos muertos que deja una rejilla pegada al reloj
 *   cuando la duración no divide a la hora.
 * - `fixed`: solo a las horas de `start_times_json`, por día de la semana.
 *
 * Las horas van en minutos desde medianoche y el grupo en JSON de texto, que es
 * lo portable entre los cinco motores. Ver los invariantes de tipos.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('services')
    .addColumn('start_mode', type(t.str(12)), strDefault('inherit'))
    .execute();

  await db.schema
    .alterTable('services')
    .addColumn('start_interval_minutes', type(t.int()))
    .execute();

  await db.schema
    .alterTable('services')
    .addColumn('start_offset_minutes', type(t.int()), intDefault(0))
    .execute();

  await db.schema
    .alterTable('services')
    .addColumn('start_times_json', type(t.text()))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const column of [
    'start_mode',
    'start_interval_minutes',
    'start_offset_minutes',
    'start_times_json',
  ]) {
    await db.schema.alterTable('services').dropColumn(column).execute();
  }
}
