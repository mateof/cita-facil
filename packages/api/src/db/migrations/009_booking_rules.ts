import type { Kysely } from 'kysely';
import {
  boolDefault,
  createTable,
  index,
  intDefault,
  notNull,
  pk,
  strDefault,
  t,
  timestamps,
  type,
} from './helpers.js';

/**
 * Tres cosas que cambian cuándo y cómo se reserva:
 *
 * 1. **Cuándo se descuenta la sesión del bono**: al reservar (como hasta ahora)
 *    o al dar la cita por completada. Se decide por servicio, con el valor de
 *    la organización como respaldo.
 * 2. **Sesiones a deber**: reservar sin saldo y saldar la deuda sola cuando se
 *    compra el siguiente bono.
 * 3. **Programaciones semanales**: una cita que se repite cada semana y que el
 *    sistema va creando con antelación hasta que alguien la para.
 *
 * Los plazos de antelación (para reservar y para cancelar) ya existían por
 * servicio; lo que se añade es poder heredarlos de la organización, y para eso
 * las columnas pasan a admitir NULL con el sentido de "lo que diga la
 * organización". Cero sigue queriendo decir "sin límite", que no es lo mismo.
 */
export async function up(db: Kysely<any>): Promise<void> {
  /* ------------------------------------------------ cuándo se cobra el bono */
  // `inherit`, `booking` o `completion`.
  await db.schema
    .alterTable('services')
    .addColumn('credit_charge_mode', type(t.str(12)), strDefault('inherit'))
    .execute();

  /*
   * Los servicios que ya existen tienen cero en los dos plazos, pero ese cero
   * no lo eligió nadie: era el valor por defecto. Se marcan como heredados para que
   * hereden lo que diga su organización, que es lo que se espera al configurar
   * un plazo general. Quien quiera "sin límite" ahora lo dice poniendo cero a
   * mano, y entonces sí se respeta.
   */
  await db
    .updateTable('services')
    .set({ min_advance_minutes: -1 })
    .where('min_advance_minutes', '=', 0)
    .execute();
  await db
    .updateTable('services')
    .set({ cancellation_cutoff_minutes: -1 })
    .where('cancellation_cutoff_minutes', '=', 0)
    .execute();

  /* ------------------------------------------------------ sesiones a deber */
  await timestamps(
    pk(createTable(db, 'credit_debts'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('user_id', type(t.id()), notNull)
      /** La cita que la generó. Se conserva aunque la cita se borre. */
      .addColumn('appointment_id', type(t.id()))
      .addColumn('service_id', type(t.id()))
      /** Bono con el que se saldó, si ya se saldó. */
      .addColumn('settled_wallet_id', type(t.id()))
      .addColumn('settled_at', type(t.instant()))
      /** Anulada sin cobrar: la cita se canceló antes de saldarla. */
      .addColumn('cancelled_at', type(t.instant())),
  )
    .addForeignKeyConstraint('fk_debts_org', ['organization_id'], 'organizations', ['id'])
    .execute();

  await index(db, 'credit_debts', ['organization_id', 'user_id']);
  await index(db, 'credit_debts', ['appointment_id']);

  /* ------------------------------------------------ programaciones semanales */
  await timestamps(
    pk(createTable(db, 'appointment_schedules'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('service_id', type(t.id()), notNull)
      .addColumn('location_id', type(t.id()))
      .addColumn('resource_id', type(t.id()))
      .addColumn('customer_id', type(t.id()), notNull)
      /** 1 = lunes ... 7 = domingo, como el resto de la aplicación. */
      .addColumn('weekday', type(t.int()), notNull)
      /** Hora local en minutos desde medianoche. */
      .addColumn('start_minute', type(t.int()), notNull)
      .addColumn('duration_minutes', type(t.int()))
      .addColumn('notes', type(t.str(500)))
      /** `skip`, `nearest` o `force`: qué hacer si esa semana no hay hueco. */
      .addColumn('on_conflict', type(t.str(10)), strDefault('skip'))
      /** Con cuántos días de antelación se crea cada cita. */
      .addColumn('horizon_days', type(t.int()), intDefault(7))
      .addColumn('active', type(t.bool()), boolDefault(true))
      .addColumn('cancelled_at', type(t.instant())),
  )
    .addForeignKeyConstraint('fk_schedules_org', ['organization_id'], 'organizations', ['id'])
    .addForeignKeyConstraint('fk_schedules_service', ['service_id'], 'services', ['id'])
    .execute();

  await index(db, 'appointment_schedules', ['organization_id', 'active']);
  await index(db, 'appointment_schedules', ['customer_id']);

  /**
   * Qué se hizo con cada fecha de una programación.
   *
   * Es lo que evita que una cita cancelada a mano se vuelva a crear sola: la
   * fecha ya está anotada y el generador no la vuelve a mirar. También deja el
   * historial de las semanas que se saltaron y por qué.
   */
  await pk(createTable(db, 'schedule_occurrences'))
    .addColumn('schedule_id', type(t.id()), notNull)
    /** Fecha local `YYYY-MM-DD` de la ocurrencia. */
    .addColumn('date', type(t.str(10)), notNull)
    .addColumn('appointment_id', type(t.id()))
    /** `created`, `skipped` o `cancelled`. */
    .addColumn('status', type(t.str(12)), strDefault('created'))
    .addColumn('reason', type(t.str(120)))
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_occurrences_schedule', ['schedule_id'], 'appointment_schedules', [
      'id',
    ])
    .execute();

  await index(db, 'schedule_occurrences', ['schedule_id', 'date'], { unique: true });
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('schedule_occurrences').execute();
  await db.schema.dropTable('appointment_schedules').execute();
  await db.schema.dropTable('credit_debts').execute();
  await db.schema.alterTable('services').dropColumn('credit_charge_mode').execute();
}
