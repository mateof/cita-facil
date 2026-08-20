import type { Kysely } from 'kysely';
import { index, strDefault, t, type } from './helpers.js';

/**
 * Calendario del profesional, en los dos sentidos.
 *
 * **Hacia fuera**: cada agenda tiene una dirección `.ics` suscribible, para
 * verla en el calendario del móvil junto al resto de la vida de esa persona.
 * Va con un identificador secreto en la propia dirección porque los clientes de
 * calendario no saben iniciar sesión: piden la URL y ya está. Por eso se puede
 * rotar, que es lo que la anula si se comparte por error.
 *
 * **Hacia dentro**: una dirección de calendario externo cuya ocupación se
 * importa como ausencias. Es lo que evita la doble reserva cuando el
 * profesional se pone una cita del médico en su calendario personal.
 *
 * Lo importado se marca en `time_off.source` para poder reemplazarlo entero en
 * cada sincronización sin tocar las ausencias que puso alguien a mano.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('resources')
    /** Identificador secreto de la dirección `.ics` de esta agenda. */
    .addColumn('calendar_token', type(t.str(64)))
    .execute();

  await db.schema
    .alterTable('resources')
    /** Calendario externo del que se importa la ocupación. */
    .addColumn('calendar_url', type(t.str(500)))
    .execute();

  await db.schema
    .alterTable('resources')
    .addColumn('calendar_synced_at', type(t.instant()))
    .execute();

  await db.schema
    .alterTable('resources')
    /** Motivo del último fallo de sincronización, para poder enseñarlo. */
    .addColumn('calendar_error', type(t.str(300)))
    .execute();

  await index(db, 'resources', ['calendar_token']);

  await db.schema
    .alterTable('time_off')
    /** `manual` o `calendar`. Lo importado se reemplaza en cada sincronización. */
    .addColumn('source', type(t.str(12)), strDefault('manual'))
    .execute();

  await db.schema
    .alterTable('time_off')
    /** `UID` del evento en el calendario de origen. */
    .addColumn('external_uid', type(t.str(200)))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('time_off').dropColumn('external_uid').execute();
  await db.schema.alterTable('time_off').dropColumn('source').execute();
  await db.schema.alterTable('resources').dropColumn('calendar_error').execute();
  await db.schema.alterTable('resources').dropColumn('calendar_synced_at').execute();
  await db.schema.alterTable('resources').dropColumn('calendar_url').execute();
  await db.schema.alterTable('resources').dropColumn('calendar_token').execute();
}
