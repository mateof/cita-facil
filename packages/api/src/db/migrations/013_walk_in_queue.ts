import type { Kysely } from 'kysely';
import { createTable, index, intDefault, notNull, pk, strDefault, t, timestamps, type } from './helpers.js';

/**
 * Cola sin cita previa.
 *
 * Hay negocios que trabajan por orden de llegada: barberías, talleres,
 * ventanillas. Para ellos la agenda no es el problema, lo es la cola: quién ha
 * llegado antes, cuánto le queda y a quién le toca ahora.
 *
 * Es deliberadamente **otra cosa que una cita**. Una cita ocupa un hueco
 * concreto y bloquea disponibilidad; un turno no ocupa nada hasta que alguien
 * lo llama. Meterlo en `appointments` habría obligado a inventar una hora falsa
 * para cada llegada y a que el motor de disponibilidad la contara.
 *
 * Cuando el turno se atiende sí se puede dejar constancia como cita, y para eso
 * está `appointment_id`: el histórico del cliente y los informes siguen
 * saliendo de un único sitio.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await timestamps(
    pk(createTable(db, 'queue_entries'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('location_id', type(t.id()), notNull)
      /** Qué venía a hacer, si lo dijo. Sirve para estimar la espera. */
      .addColumn('service_id', type(t.id()))
      /** Profesional pedido, si pidió uno. */
      .addColumn('resource_id', type(t.id()))
      .addColumn('customer_id', type(t.id()))
      .addColumn('guest_name', type(t.str(120)))
      .addColumn('guest_phone', type(t.str(40)))
      /** Número visible en la pantalla de sala. Se reinicia cada día. */
      .addColumn('ticket_number', type(t.int()), notNull)
      /** Fecha local `YYYY-MM-DD`: es lo que hace que el número se reinicie. */
      .addColumn('local_date', type(t.date()), notNull)
      .addColumn('party_size', type(t.int()), intDefault(1))
      /** `waiting`, `called`, `serving`, `done`, `left`. */
      .addColumn('status', type(t.str(12)), strDefault('waiting'))
      .addColumn('note', type(t.str(500)))
      /** Quién lo apuntó: `staff` o `online`. */
      .addColumn('source', type(t.str(12)), strDefault('staff'))
      .addColumn('called_at', type(t.instant()))
      .addColumn('served_at', type(t.instant()))
      .addColumn('closed_at', type(t.instant()))
      /** Cita creada al atender el turno, si se dejó constancia. */
      .addColumn('appointment_id', type(t.id())),
  )
    .addForeignKeyConstraint('fk_queue_org', ['organization_id'], 'organizations', ['id'])
    .execute();

  await index(db, 'queue_entries', ['organization_id', 'local_date', 'status']);
  await index(db, 'queue_entries', ['location_id', 'local_date', 'ticket_number']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('queue_entries').execute();
}
