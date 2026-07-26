import type { Kysely } from 'kysely';
import {
  boolDefault,
  createTable,
  dropTables,
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
 * Catálogo reservable (servicios y recursos), calendarios y citas.
 */
export async function up(db: Kysely<any>): Promise<void> {
  /* ------------------------------------------------------- service_categories */
  await timestamps(
    pk(createTable(db, 'service_categories'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('name', type(t.str(120)), notNull)
      .addColumn('name_i18n_json', type(t.json()))
      .addColumn('color', type(t.str(9)))
      .addColumn('sort_order', type(t.int()), intDefault(0)),
  )
    .addForeignKeyConstraint('fk_categories_org', ['organization_id'], 'organizations', ['id'])
    .execute();
  await index(db, 'service_categories', ['organization_id']);

  /* --------------------------------------------------------------- resources */
  await timestamps(
    pk(createTable(db, 'resources'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('location_id', type(t.id()), notNull)
      .addColumn('user_id', type(t.id()))
      .addColumn('name', type(t.str(140)), notNull)
      .addColumn('type', type(t.str(20)), strDefault('staff'))
      .addColumn('description_json', type(t.json()))
      .addColumn('capacity', type(t.int()), intDefault(1))
      .addColumn('color', type(t.str(9)))
      .addColumn('image_url', type(t.str(500)))
      .addColumn('bookable_directly', type(t.bool()), boolDefault(true))
      .addColumn('sort_order', type(t.int()), intDefault(0))
      .addColumn('active', type(t.bool()), boolDefault(true)),
  )
    .addColumn('deleted_at', type(t.instant()))
    .addForeignKeyConstraint('fk_resources_org', ['organization_id'], 'organizations', ['id'])
    .addForeignKeyConstraint('fk_resources_loc', ['location_id'], 'locations', ['id'])
    .execute();
  await index(db, 'resources', ['organization_id', 'location_id', 'active']);
  await index(db, 'resources', ['user_id']);

  /* ---------------------------------------------------------------- services */
  await timestamps(
    pk(createTable(db, 'services'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('location_id', type(t.id()))
      .addColumn('category_id', type(t.id()))
      .addColumn('name', type(t.str(140)), notNull)
      .addColumn('name_i18n_json', type(t.json()))
      .addColumn('description_json', type(t.json()))
      .addColumn('color', type(t.str(9)))
      .addColumn('image_url', type(t.str(500)))

      .addColumn('duration_mode', type(t.str(12)), strDefault('fixed'))
      .addColumn('duration_minutes', type(t.int()), intDefault(30))
      .addColumn('min_duration_minutes', type(t.int()))
      .addColumn('max_duration_minutes', type(t.int()))
      .addColumn('duration_step_minutes', type(t.int()))

      .addColumn('buffer_before_minutes', type(t.int()), intDefault(0))
      .addColumn('buffer_after_minutes', type(t.int()), intDefault(0))

      .addColumn('price_mode', type(t.str(12)), strDefault('fixed'))
      .addColumn('price_cents', type(t.int()), intDefault(0))
      .addColumn('price_per_minute_cents', type(t.int()))
      .addColumn('currency', type(t.str(3)), strDefault('EUR'))
      .addColumn('deposit_cents', type(t.int()), intDefault(0))
      .addColumn('payment_required', type(t.bool()), boolDefault(false))

      .addColumn('capacity', type(t.int()), intDefault(1))
      .addColumn('requires_approval', type(t.bool()), boolDefault(false))
      .addColumn('min_advance_minutes', type(t.int()), intDefault(0))
      .addColumn('max_advance_days', type(t.int()), intDefault(90))
      .addColumn('cancellation_cutoff_minutes', type(t.int()), intDefault(0))
      .addColumn('reschedule_cutoff_minutes', type(t.int()), intDefault(0))
      .addColumn('allocation_strategy', type(t.str(20)))
      .addColumn('allow_resource_selection', type(t.bool()), boolDefault(true))
      .addColumn('publicly_bookable', type(t.bool()), boolDefault(true))
      .addColumn('staff_only', type(t.bool()), boolDefault(false))
      .addColumn('custom_fields_json', type(t.json()))
      .addColumn('sort_order', type(t.int()), intDefault(0))
      .addColumn('active', type(t.bool()), boolDefault(true)),
  )
    .addColumn('deleted_at', type(t.instant()))
    .addForeignKeyConstraint('fk_services_org', ['organization_id'], 'organizations', ['id'])
    .execute();
  await index(db, 'services', ['organization_id', 'active']);
  await index(db, 'services', ['organization_id', 'location_id']);

  await createTable(db, 'service_resources')
    .addColumn('service_id', type(t.id()), notNull)
    .addColumn('resource_id', type(t.id()), notNull)
    .addColumn('duration_minutes', type(t.int()))
    .addColumn('price_cents', type(t.int()))
    .addPrimaryKeyConstraint('pk_service_resources', ['service_id', 'resource_id'])
    .execute();
  await index(db, 'service_resources', ['resource_id']);

  /* --------------------------------------------------------------- schedules */
  await pk(createTable(db, 'schedules'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('owner_type', type(t.str(12)), notNull)
    .addColumn('owner_id', type(t.id()), notNull)
    .addColumn('weekday', type(t.int()), notNull)
    .addColumn('start_minute', type(t.int()), notNull)
    .addColumn('end_minute', type(t.int()), notNull)
    .addColumn('valid_from', type(t.date()))
    .addColumn('valid_to', type(t.date()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'schedules', ['owner_type', 'owner_id', 'weekday'], {
    name: 'ix_schedules_owner',
  });
  await index(db, 'schedules', ['organization_id']);

  await pk(createTable(db, 'schedule_exceptions'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('owner_type', type(t.str(12)), notNull)
    .addColumn('owner_id', type(t.id()), notNull)
    .addColumn('type', type(t.str(10)), notNull)
    .addColumn('date', type(t.date()), notNull)
    .addColumn('start_minute', type(t.int()))
    .addColumn('end_minute', type(t.int()))
    .addColumn('reason', type(t.str(200)))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'schedule_exceptions', ['owner_type', 'owner_id', 'date'], {
    name: 'ix_sched_exc_owner',
  });
  await index(db, 'schedule_exceptions', ['organization_id', 'date']);

  await pk(createTable(db, 'time_off'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('location_id', type(t.id()))
    .addColumn('resource_id', type(t.id()))
    .addColumn('starts_at', type(t.instant()), notNull)
    .addColumn('ends_at', type(t.instant()), notNull)
    .addColumn('reason', type(t.str(200)))
    .addColumn('created_by', type(t.id()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'time_off', ['organization_id', 'starts_at', 'ends_at'], {
    name: 'ix_timeoff_range',
  });
  await index(db, 'time_off', ['resource_id']);

  /* ------------------------------------------------- appointment_recurrences */
  await pk(createTable(db, 'appointment_recurrences'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('interval_weeks', type(t.int()), intDefault(1))
    .addColumn('weekdays_json', type(t.str(40)), notNull)
    .addColumn('until_date', type(t.date()))
    .addColumn('occurrence_count', type(t.int()))
    .addColumn('created_by', type(t.id()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();

  /* ------------------------------------------------------------- appointments */
  await timestamps(
    pk(createTable(db, 'appointments'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('location_id', type(t.id()), notNull)
      .addColumn('service_id', type(t.id()), notNull)
      .addColumn('resource_id', type(t.id()))
      .addColumn('customer_id', type(t.id()))

      .addColumn('guest_name', type(t.str(140)))
      .addColumn('guest_email', type(t.str(255)))
      .addColumn('guest_phone', type(t.str(32)))
      .addColumn('guest_locale', type(t.str(8)))

      .addColumn('starts_at', type(t.instant()), notNull)
      .addColumn('ends_at', type(t.instant()), notNull)
      .addColumn('block_starts_at', type(t.instant()), notNull)
      .addColumn('block_ends_at', type(t.instant()), notNull)
      .addColumn('local_date', type(t.date()), notNull)
      .addColumn('local_start_minute', type(t.int()), notNull)
      .addColumn('duration_minutes', type(t.int()), notNull)
      .addColumn('timezone', type(t.str(64)), strDefault('Europe/Madrid'))

      .addColumn('status', type(t.str(16)), strDefault('confirmed'))
      .addColumn('source', type(t.str(20)), strDefault('web'))
      .addColumn('party_size', type(t.int()), intDefault(1))

      .addColumn('price_cents', type(t.int()), intDefault(0))
      .addColumn('currency', type(t.str(3)), strDefault('EUR'))
      .addColumn('payment_status', type(t.str(20)), strDefault('not_required'))

      .addColumn('notes', type(t.text()))
      .addColumn('internal_notes', type(t.text()))
      .addColumn('custom_fields_json', type(t.json()))

      .addColumn('access_code', type(t.str(40)), notNull)
      .addColumn('access_uses', type(t.int()), intDefault(0))
      .addColumn('checked_in_at', type(t.instant()))
      .addColumn('completed_at', type(t.instant()))

      .addColumn('cancelled_at', type(t.instant()))
      .addColumn('cancelled_by', type(t.str(16)))
      .addColumn('cancellation_reason', type(t.str(500)))

      .addColumn('recurrence_id', type(t.id()))
      .addColumn('rescheduled_from', type(t.id()))
      .addColumn('waitlist_entry_id', type(t.id()))

      .addColumn('hold_expires_at', type(t.instant()))
      .addColumn('reminder_scheduled_at', type(t.instant()))

      .addColumn('created_by', type(t.id())),
  )
    .addForeignKeyConstraint('fk_appointments_org', ['organization_id'], 'organizations', ['id'])
    .addForeignKeyConstraint('fk_appointments_loc', ['location_id'], 'locations', ['id'])
    .addForeignKeyConstraint('fk_appointments_svc', ['service_id'], 'services', ['id'])
    .execute();
  // Índice principal de la agenda: consultas por organización y rango temporal.
  await index(db, 'appointments', ['organization_id', 'block_starts_at', 'block_ends_at'], {
    name: 'ix_appt_org_range',
  });
  await index(db, 'appointments', ['resource_id', 'block_starts_at'], {
    name: 'ix_appt_resource_range',
  });
  await index(db, 'appointments', ['location_id', 'local_date'], { name: 'ix_appt_loc_date' });
  await index(db, 'appointments', ['customer_id', 'starts_at'], { name: 'ix_appt_customer' });
  await index(db, 'appointments', ['access_code'], { unique: true, name: 'ux_appt_access_code' });
  await index(db, 'appointments', ['status', 'hold_expires_at'], { name: 'ix_appt_holds' });
  await index(db, 'appointments', ['status', 'starts_at'], { name: 'ix_appt_status_starts' });
  await index(db, 'appointments', ['recurrence_id']);

  /* ---------------------------------------------------------- waitlist_entries */
  await timestamps(
    pk(createTable(db, 'waitlist_entries'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('location_id', type(t.id()))
      .addColumn('service_id', type(t.id()), notNull)
      .addColumn('resource_id', type(t.id()))
      .addColumn('customer_id', type(t.id()))
      .addColumn('guest_name', type(t.str(140)))
      .addColumn('guest_email', type(t.str(255)))
      .addColumn('guest_phone', type(t.str(32)))
      .addColumn('from_date', type(t.date()), notNull)
      .addColumn('to_date', type(t.date()), notNull)
      .addColumn('earliest_minute', type(t.int()), intDefault(0))
      .addColumn('latest_minute', type(t.int()), intDefault(1440))
      .addColumn('weekdays_json', type(t.str(40)))
      .addColumn('party_size', type(t.int()), intDefault(1))
      .addColumn('notes', type(t.str(500)))
      .addColumn('status', type(t.str(16)), strDefault('waiting'))
      .addColumn('offered_appointment_id', type(t.id()))
      .addColumn('offer_expires_at', type(t.instant())),
  ).execute();
  await index(db, 'waitlist_entries', ['organization_id', 'service_id', 'status'], {
    name: 'ix_waitlist_lookup',
  });

  /* ----------------------------------------------------------------- reviews */
  await pk(createTable(db, 'reviews'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('appointment_id', type(t.id()), notNull)
    .addColumn('customer_id', type(t.id()))
    .addColumn('resource_id', type(t.id()))
    .addColumn('service_id', type(t.id()), notNull)
    .addColumn('rating', type(t.int()), notNull)
    .addColumn('comment', type(t.text()))
    .addColumn('published', type(t.bool()), boolDefault(true))
    .addColumn('reply', type(t.text()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'reviews', ['appointment_id'], { unique: true, name: 'ux_reviews_appt' });
  await index(db, 'reviews', ['organization_id', 'service_id']);

  /* -------------------------------------------------------- idempotency_keys */
  await pk(createTable(db, 'idempotency_keys'))
    .addColumn('scope', type(t.str(60)), notNull)
    .addColumn('key_hash', type(t.str(128)), notNull)
    .addColumn('response_json', type(t.text()))
    .addColumn('created_at', type(t.instant()), notNull)
    .addColumn('expires_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'idempotency_keys', ['scope', 'key_hash'], {
    unique: true,
    name: 'ux_idempotency',
  });
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, [
    'idempotency_keys',
    'reviews',
    'waitlist_entries',
    'appointments',
    'appointment_recurrences',
    'time_off',
    'schedule_exceptions',
    'schedules',
    'service_resources',
    'services',
    'resources',
    'service_categories',
  ]);
}
