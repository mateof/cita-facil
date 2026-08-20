import type { Kysely } from 'kysely';
import { createTable, index, intDefault, notNull, pk, t, type } from './helpers.js';

/**
 * Varios servicios en una misma cita.
 *
 * Corte y color, o revisión y limpieza: una sola visita que ocupa la suma de
 * los dos y se paga junta. Hasta ahora había que reservar dos veces y confiar
 * en que la agenda dejara las horas seguidas.
 *
 * La cita **conserva su `service_id`**, que sigue siendo el principal. Los
 * añadidos van en esta tabla. Podría haberse normalizado del todo, moviendo
 * también el primero, pero eso obligaría a reescribir todas las consultas que
 * hoy hacen `join` con `services` (agenda, informes, avisos, ficha de cliente,
 * exportaciones) y a mantener dos formas de leer lo mismo durante la migración.
 * Con el principal donde estaba, lo que ya funcionaba sigue funcionando y lo
 * nuevo se lee solo cuando hace falta.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await pk(createTable(db, 'appointment_services'))
    .addColumn('appointment_id', type(t.id()), notNull)
    .addColumn('service_id', type(t.id()), notNull)
    /** Orden en el que se hacen, que es el orden en el que se eligieron. */
    .addColumn('sort_order', type(t.int()), intDefault(0))
    /** Duración y precio congelados: el servicio puede cambiar de tarifa después. */
    .addColumn('duration_minutes', type(t.int()), notNull)
    .addColumn('price_cents', type(t.int()), intDefault(0))
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_appointment_services_service', ['service_id'], 'services', ['id'])
    .execute();

  await index(db, 'appointment_services', ['appointment_id']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('appointment_services').execute();
}
