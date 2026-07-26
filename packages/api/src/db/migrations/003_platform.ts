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
 * Notificaciones, pagos, bonos, integraciones y trazas.
 */
export async function up(db: Kysely<any>): Promise<void> {
  /* ------------------------------------------------- notification_preferences */
  await pk(createTable(db, 'notification_preferences'))
    .addColumn('user_id', type(t.id()))
    .addColumn('organization_id', type(t.id()))
    .addColumn('event', type(t.str(40)), notNull)
    .addColumn('channel', type(t.str(16)), notNull)
    .addColumn('enabled', type(t.bool()), boolDefault(true))
    .addColumn('updated_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'notification_preferences', ['user_id', 'event', 'channel'], {
    name: 'ix_notifpref_user',
  });
  await index(db, 'notification_preferences', ['organization_id', 'event', 'channel'], {
    name: 'ix_notifpref_org',
  });

  /* ---------------------------------------------------- notification_templates */
  await pk(createTable(db, 'notification_templates'))
    .addColumn('organization_id', type(t.id()))
    .addColumn('event', type(t.str(40)), notNull)
    .addColumn('channel', type(t.str(16)), notNull)
    .addColumn('locale', type(t.str(8)), notNull)
    .addColumn('subject', type(t.str(200)))
    .addColumn('body', type(t.text()), notNull)
    .addColumn('enabled', type(t.bool()), boolDefault(true))
    .addColumn('updated_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'notification_templates', ['organization_id', 'event', 'channel', 'locale'], {
    name: 'ix_notiftpl_lookup',
  });

  /* ----------------------------------------------------------- notifications */
  await pk(createTable(db, 'notifications'))
    .addColumn('organization_id', type(t.id()))
    .addColumn('user_id', type(t.id()))
    .addColumn('appointment_id', type(t.id()))
    .addColumn('event', type(t.str(40)), notNull)
    .addColumn('channel', type(t.str(16)), notNull)
    .addColumn('locale', type(t.str(8)), strDefault('es'))
    .addColumn('destination', type(t.str(400)), notNull)
    .addColumn('subject', type(t.str(400)))
    .addColumn('body', type(t.text()), notNull)
    .addColumn('payload_json', type(t.text()))
    .addColumn('status', type(t.str(16)), strDefault('scheduled'))
    .addColumn('attempts', type(t.int()), intDefault(0))
    .addColumn('last_error', type(t.str(1000)))
    .addColumn('scheduled_at', type(t.instant()), notNull)
    .addColumn('sent_at', type(t.instant()))
    .addColumn('group_key', type(t.str(80)))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  // La cola se consulta por estado y momento programado en cada tic del planificador.
  await index(db, 'notifications', ['status', 'scheduled_at'], { name: 'ix_notif_queue' });
  await index(db, 'notifications', ['appointment_id']);
  await index(db, 'notifications', ['group_key']);
  await index(db, 'notifications', ['user_id', 'created_at']);

  /* ---------------------------------------------------------- reminder_rules */
  await timestamps(
    pk(createTable(db, 'reminder_rules'))
      .addColumn('organization_id', type(t.id()))
      .addColumn('user_id', type(t.id()))
      .addColumn('service_id', type(t.id()))
      .addColumn('offset_minutes', type(t.int()), notNull)
      .addColumn('channels_json', type(t.str(200)), notNull)
      .addColumn('enabled', type(t.bool()), boolDefault(true)),
  ).execute();
  await index(db, 'reminder_rules', ['organization_id']);
  await index(db, 'reminder_rules', ['user_id']);

  /* ------------------------------------------------------------ push_devices */
  await pk(createTable(db, 'push_devices'))
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('provider', type(t.str(12)), notNull)
    .addColumn('token', type(t.str(2000)), notNull)
    .addColumn('keys_json', type(t.str(1000)))
    .addColumn('device_name', type(t.str(120)))
    .addColumn('locale', type(t.str(8)))
    .addColumn('last_used_at', type(t.instant()))
    .addColumn('failure_count', type(t.int()), intDefault(0))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'push_devices', ['user_id']);

  /* --------------------------------------------------------- messaging_links */
  await pk(createTable(db, 'messaging_links'))
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('channel', type(t.str(16)), notNull)
    .addColumn('external_id', type(t.str(120)), notNull)
    .addColumn('username', type(t.str(120)))
    .addColumn('verified', type(t.bool()), boolDefault(false))
    .addColumn('opt_out', type(t.bool()), boolDefault(false))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'messaging_links', ['channel', 'external_id'], {
    unique: true,
    name: 'ux_msglink_external',
  });
  await index(db, 'messaging_links', ['user_id']);

  /* ------------------------------------------------------------------ pagos */
  await timestamps(
    pk(createTable(db, 'payments'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('appointment_id', type(t.id()))
      .addColumn('credit_pack_id', type(t.id()))
      .addColumn('user_id', type(t.id()))
      .addColumn('provider', type(t.str(16)), notNull)
      .addColumn('amount_cents', type(t.int()), notNull)
      .addColumn('currency', type(t.str(3)), strDefault('EUR'))
      .addColumn('status', type(t.str(20)), strDefault('pending'))
      .addColumn('external_id', type(t.str(200)))
      .addColumn('external_reference', type(t.str(64)))
      .addColumn('refunded_cents', type(t.int()), intDefault(0))
      .addColumn('metadata_json', type(t.text()))
      .addColumn('paid_at', type(t.instant())),
  ).execute();
  await index(db, 'payments', ['organization_id', 'status']);
  await index(db, 'payments', ['appointment_id']);
  await index(db, 'payments', ['external_reference'], {
    unique: true,
    name: 'ux_payments_reference',
  });

  await timestamps(
    pk(createTable(db, 'credit_packs'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('name', type(t.str(140)), notNull)
      .addColumn('description', type(t.str(1000)))
      .addColumn('credits', type(t.int()), notNull)
      .addColumn('price_cents', type(t.int()), notNull)
      .addColumn('currency', type(t.str(3)), strDefault('EUR'))
      .addColumn('validity_days', type(t.int()), intDefault(365))
      .addColumn('service_ids_json', type(t.text()))
      .addColumn('active', type(t.bool()), boolDefault(true)),
  ).execute();
  await index(db, 'credit_packs', ['organization_id', 'active']);

  await pk(createTable(db, 'credit_wallets'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('credit_pack_id', type(t.id()))
    .addColumn('credits_total', type(t.int()), intDefault(0))
    .addColumn('credits_used', type(t.int()), intDefault(0))
    .addColumn('expires_at', type(t.instant()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'credit_wallets', ['organization_id', 'user_id']);

  await pk(createTable(db, 'credit_ledger'))
    .addColumn('wallet_id', type(t.id()), notNull)
    .addColumn('appointment_id', type(t.id()))
    .addColumn('delta', type(t.int()), notNull)
    .addColumn('reason', type(t.str(60)), notNull)
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'credit_ledger', ['wallet_id']);

  /* ---------------------------------------------------------------- api_keys */
  await pk(createTable(db, 'api_keys'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('name', type(t.str(120)), notNull)
    .addColumn('prefix', type(t.str(16)), notNull)
    .addColumn('key_hash', type(t.str(128)), notNull)
    .addColumn('scopes_json', type(t.str(1000)), notNull)
    .addColumn('ip_allowlist_json', type(t.str(1000)))
    .addColumn('last_used_at', type(t.instant()))
    .addColumn('expires_at', type(t.instant()))
    .addColumn('revoked_at', type(t.instant()))
    .addColumn('created_by', type(t.id()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'api_keys', ['prefix'], { name: 'ix_apikeys_prefix' });
  await index(db, 'api_keys', ['organization_id']);

  /* ------------------------------------------------------ webhooks salientes */
  await timestamps(
    pk(createTable(db, 'webhook_endpoints'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('url', type(t.str(500)), notNull)
      .addColumn('secret', type(t.str(120)), notNull)
      .addColumn('events_json', type(t.str(2000)), notNull)
      .addColumn('active', type(t.bool()), boolDefault(true))
      .addColumn('failure_count', type(t.int()), intDefault(0)),
  ).execute();
  await index(db, 'webhook_endpoints', ['organization_id']);

  await pk(createTable(db, 'webhook_deliveries'))
    .addColumn('endpoint_id', type(t.id()), notNull)
    .addColumn('event', type(t.str(60)), notNull)
    .addColumn('payload_json', type(t.text()), notNull)
    .addColumn('status', type(t.str(16)), strDefault('pending'))
    .addColumn('response_code', type(t.int()))
    .addColumn('attempts', type(t.int()), intDefault(0))
    .addColumn('last_error', type(t.str(1000)))
    .addColumn('next_attempt_at', type(t.instant()))
    .addColumn('delivered_at', type(t.instant()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'webhook_deliveries', ['status', 'next_attempt_at'], {
    name: 'ix_whdeliv_queue',
  });
  await index(db, 'webhook_deliveries', ['endpoint_id']);

  /* -------------------------------------------------------------- auditoría */
  await pk(createTable(db, 'audit_logs'))
    .addColumn('organization_id', type(t.id()))
    .addColumn('actor_id', type(t.id()))
    .addColumn('actor_type', type(t.str(20)), strDefault('user'))
    .addColumn('action', type(t.str(60)), notNull)
    .addColumn('entity_type', type(t.str(40)), notNull)
    .addColumn('entity_id', type(t.id()))
    .addColumn('changes_json', type(t.text()))
    .addColumn('ip', type(t.str(64)))
    .addColumn('user_agent', type(t.str(400)))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'audit_logs', ['organization_id', 'created_at'], { name: 'ix_audit_org' });
  await index(db, 'audit_logs', ['entity_type', 'entity_id'], { name: 'ix_audit_entity' });

  await pk(createTable(db, 'access_logs'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('location_id', type(t.id()))
    .addColumn('appointment_id', type(t.id()))
    .addColumn('user_id', type(t.id()))
    .addColumn('device_id', type(t.str(120)))
    .addColumn('presented_code', type(t.str(120)))
    .addColumn('result', type(t.str(30)), notNull)
    .addColumn('granted', type(t.bool()), boolDefault(false))
    .addColumn('reason', type(t.str(200)))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'access_logs', ['organization_id', 'created_at'], { name: 'ix_access_org' });
  await index(db, 'access_logs', ['appointment_id']);

  /* ---------------------------------------------------------------- backups */
  await pk(createTable(db, 'backups'))
    .addColumn('filename', type(t.str(255)), notNull)
    .addColumn('size_bytes', type(t.bigint()), intDefault(0))
    .addColumn('db_client', type(t.str(16)), notNull)
    .addColumn('format', type(t.str(16)), strDefault('json.gz'))
    .addColumn('encrypted', type(t.bool()), boolDefault(false))
    .addColumn('checksum', type(t.str(128)))
    .addColumn('trigger', type(t.str(16)), strDefault('manual'))
    .addColumn('status', type(t.str(16)), strDefault('running'))
    .addColumn('error', type(t.str(1000)))
    .addColumn('started_at', type(t.instant()), notNull)
    .addColumn('finished_at', type(t.instant()))
    .execute();
  await index(db, 'backups', ['started_at']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, [
    'backups',
    'access_logs',
    'audit_logs',
    'webhook_deliveries',
    'webhook_endpoints',
    'api_keys',
    'credit_ledger',
    'credit_wallets',
    'credit_packs',
    'payments',
    'messaging_links',
    'push_devices',
    'reminder_rules',
    'notifications',
    'notification_templates',
    'notification_preferences',
  ]);
}
