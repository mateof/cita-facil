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
 * Núcleo: organizaciones, sedes, ajustes, usuarios, identidades, sesiones y
 * pertenencias. Todo lo demás cuelga de aquí.
 */
export async function up(db: Kysely<any>): Promise<void> {
  /* ----------------------------------------------------------- organizations */
  await timestamps(
    pk(createTable(db, 'organizations'))
      .addColumn('slug', type(t.str(64)), notNull)
      .addColumn('name', type(t.str(140)), notNull)
      .addColumn('timezone', type(t.str(64)), strDefault('Europe/Madrid'))
      .addColumn('locale', type(t.str(8)), strDefault('es'))
      .addColumn('currency', type(t.str(3)), strDefault('EUR'))
      .addColumn('email', type(t.str(255)))
      .addColumn('phone', type(t.str(32)))
      .addColumn('tax_id', type(t.str(32)))
      .addColumn('settings_json', type(t.json()))
      .addColumn('status', type(t.str(20)), strDefault('active')),
  )
    .addColumn('deleted_at', type(t.instant()))
    .execute();
  await index(db, 'organizations', ['slug'], { unique: true });
  await index(db, 'organizations', ['status']);

  /* --------------------------------------------------------------- locations */
  await timestamps(
    pk(createTable(db, 'locations'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('slug', type(t.str(64)), notNull)
      .addColumn('name', type(t.str(140)), notNull)
      .addColumn('timezone', type(t.str(64)), strDefault('Europe/Madrid'))
      .addColumn('address_line', type(t.str(200)))
      .addColumn('city', type(t.str(100)))
      .addColumn('postal_code', type(t.str(20)))
      .addColumn('region', type(t.str(100)))
      .addColumn('country', type(t.str(2)), strDefault('ES'))
      .addColumn('latitude', type(t.str(24)))
      .addColumn('longitude', type(t.str(24)))
      .addColumn('phone', type(t.str(32)))
      .addColumn('email', type(t.str(255)))
      .addColumn('description_json', type(t.json()))
      .addColumn('active', type(t.bool()), boolDefault(true))
      .addColumn('sort_order', type(t.int()), intDefault(0)),
  )
    .addColumn('deleted_at', type(t.instant()))
    .addForeignKeyConstraint('fk_locations_org', ['organization_id'], 'organizations', ['id'])
    .execute();
  await index(db, 'locations', ['organization_id', 'slug'], { unique: true });
  await index(db, 'locations', ['organization_id', 'active']);

  /* ---------------------------------------------------------------- settings */
  await pk(createTable(db, 'settings'))
    .addColumn('organization_id', type(t.id()))
    .addColumn('namespace', type(t.str(60)), notNull)
    .addColumn('key', type(t.str(80)), notNull)
    .addColumn('value_json', type(t.text()))
    .addColumn('encrypted', type(t.bool()), boolDefault(false))
    .addColumn('updated_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'settings', ['organization_id', 'namespace', 'key'], {
    unique: true,
    name: 'ux_settings_scope',
  });

  /* ------------------------------------------------------------------- users */
  await timestamps(
    pk(createTable(db, 'users'))
      .addColumn('email', type(t.str(255)))
      .addColumn('email_key', type(t.str(255)), notNull)
      .addColumn('email_verified', type(t.bool()), boolDefault(false))
      .addColumn('phone', type(t.str(32)))
      .addColumn('phone_verified', type(t.bool()), boolDefault(false))
      .addColumn('password_hash', type(t.str(255)))
      .addColumn('name', type(t.str(140)), notNull)
      .addColumn('given_name', type(t.str(80)))
      .addColumn('family_name', type(t.str(120)))
      .addColumn('nif', type(t.str(20)))
      .addColumn('nif_key', type(t.str(40)), notNull)
      .addColumn('locale', type(t.str(8)), strDefault('es'))
      .addColumn('timezone', type(t.str(64)), strDefault('Europe/Madrid'))
      .addColumn('avatar_url', type(t.str(500)))
      .addColumn('platform_role', type(t.str(20)), strDefault('user'))
      .addColumn('status', type(t.str(20)), strDefault('active'))
      .addColumn('mfa_enabled', type(t.bool()), boolDefault(false))
      .addColumn('mfa_totp_secret', type(t.str(255)))
      .addColumn('mfa_recovery_codes', type(t.text()))
      .addColumn('quiet_hours_start', type(t.int()))
      .addColumn('quiet_hours_end', type(t.int()))
      .addColumn('no_show_count', type(t.int()), intDefault(0))
      .addColumn('last_login_at', type(t.instant()))
      .addColumn('failed_login_count', type(t.int()), intDefault(0))
      .addColumn('locked_until', type(t.instant()))
      .addColumn('marketing_opt_in', type(t.bool()), boolDefault(false)),
  )
    .addColumn('deleted_at', type(t.instant()))
    .execute();
  await index(db, 'users', ['email_key'], { unique: true, name: 'ux_users_email' });
  await index(db, 'users', ['nif_key'], { unique: true, name: 'ux_users_nif' });
  await index(db, 'users', ['status']);

  /* -------------------------------------------------------------- identities */
  await pk(createTable(db, 'identities'))
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('provider', type(t.str(30)), notNull)
    .addColumn('subject', type(t.str(255)), notNull)
    .addColumn('issuer', type(t.str(255)))
    .addColumn('metadata_json', type(t.json()))
    .addColumn('last_used_at', type(t.instant()))
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_identities_user', ['user_id'], 'users', ['id'])
    .execute();
  await index(db, 'identities', ['provider', 'subject'], {
    unique: true,
    name: 'ux_identities_subject',
  });
  await index(db, 'identities', ['user_id']);

  /* --------------------------------------------------- webauthn_credentials */
  await pk(createTable(db, 'webauthn_credentials'))
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('credential_id', type(t.str(400)), notNull)
    .addColumn('public_key', type(t.text()), notNull)
    .addColumn('counter', type(t.int()), intDefault(0))
    .addColumn('transports', type(t.str(120)))
    .addColumn('device_type', type(t.str(32)))
    .addColumn('backed_up', type(t.bool()), boolDefault(false))
    .addColumn('device_name', type(t.str(120)))
    .addColumn('last_used_at', type(t.instant()))
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_webauthn_user', ['user_id'], 'users', ['id'])
    .execute();
  // El identificador de credencial es base64url largo; se indexa un prefijo
  // suficiente para discriminar y la comparación exacta la hace la consulta.
  await index(db, 'webauthn_credentials', ['user_id']);

  /* ---------------------------------------------------------------- sessions */
  await pk(createTable(db, 'sessions'))
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('refresh_token_hash', type(t.str(128)), notNull)
    .addColumn('user_agent', type(t.str(400)))
    .addColumn('ip', type(t.str(64)))
    .addColumn('auth_method', type(t.str(30)), strDefault('password'))
    .addColumn('mfa_satisfied', type(t.bool()), boolDefault(false))
    .addColumn('expires_at', type(t.instant()), notNull)
    .addColumn('revoked_at', type(t.instant()))
    .addColumn('last_used_at', type(t.instant()), notNull)
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_sessions_user', ['user_id'], 'users', ['id'])
    .execute();
  await index(db, 'sessions', ['refresh_token_hash'], { unique: true, name: 'ux_sessions_token' });
  await index(db, 'sessions', ['user_id', 'expires_at']);

  /* -------------------------------------------------------- auth_challenges */
  await pk(createTable(db, 'auth_challenges'))
    .addColumn('user_id', type(t.id()))
    .addColumn('kind', type(t.str(40)), notNull)
    .addColumn('payload_json', type(t.text()))
    .addColumn('code_hash', type(t.str(128)))
    .addColumn('attempts', type(t.int()), intDefault(0))
    .addColumn('expires_at', type(t.instant()), notNull)
    .addColumn('consumed_at', type(t.instant()))
    .addColumn('created_at', type(t.instant()), notNull)
    .execute();
  await index(db, 'auth_challenges', ['expires_at']);
  await index(db, 'auth_challenges', ['user_id', 'kind']);

  /* --------------------------------------------------------- trusted_devices */
  await pk(createTable(db, 'trusted_devices'))
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('token_hash', type(t.str(128)), notNull)
    .addColumn('label', type(t.str(120)))
    .addColumn('expires_at', type(t.instant()), notNull)
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_trusted_user', ['user_id'], 'users', ['id'])
    .execute();
  await index(db, 'trusted_devices', ['token_hash'], { unique: true, name: 'ux_trusted_token' });

  /* ----------------------------------------------------- verification_tokens */
  await pk(createTable(db, 'verification_tokens'))
    .addColumn('user_id', type(t.id()), notNull)
    .addColumn('purpose', type(t.str(40)), notNull)
    .addColumn('token_hash', type(t.str(128)), notNull)
    .addColumn('expires_at', type(t.instant()), notNull)
    .addColumn('consumed_at', type(t.instant()))
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_verif_user', ['user_id'], 'users', ['id'])
    .execute();
  await index(db, 'verification_tokens', ['token_hash'], {
    unique: true,
    name: 'ux_verif_token',
  });

  /* ------------------------------------------------------------- memberships */
  await timestamps(
    pk(createTable(db, 'memberships'))
      .addColumn('organization_id', type(t.id()), notNull)
      .addColumn('user_id', type(t.id()), notNull)
      .addColumn('role', type(t.str(20)), strDefault('staff'))
      .addColumn('job_title', type(t.str(120)))
      .addColumn('bookable', type(t.bool()), boolDefault(false))
      .addColumn('active', type(t.bool()), boolDefault(true)),
  )
    .addForeignKeyConstraint('fk_memberships_org', ['organization_id'], 'organizations', ['id'])
    .addForeignKeyConstraint('fk_memberships_user', ['user_id'], 'users', ['id'])
    .execute();
  await index(db, 'memberships', ['organization_id', 'user_id'], {
    unique: true,
    name: 'ux_memberships',
  });
  await index(db, 'memberships', ['user_id']);

  await createTable(db, 'membership_locations')
    .addColumn('membership_id', type(t.id()), notNull)
    .addColumn('location_id', type(t.id()), notNull)
    .addPrimaryKeyConstraint('pk_membership_locations', ['membership_id', 'location_id'])
    .execute();

  /* ------------------------------------------------------------- invitations */
  await pk(createTable(db, 'invitations'))
    .addColumn('organization_id', type(t.id()), notNull)
    .addColumn('email', type(t.str(255)), notNull)
    .addColumn('role', type(t.str(20)), strDefault('staff'))
    .addColumn('token_hash', type(t.str(128)), notNull)
    .addColumn('invited_by', type(t.id()))
    .addColumn('location_ids_json', type(t.json()))
    .addColumn('expires_at', type(t.instant()), notNull)
    .addColumn('accepted_at', type(t.instant()))
    .addColumn('created_at', type(t.instant()), notNull)
    .addForeignKeyConstraint('fk_invitations_org', ['organization_id'], 'organizations', ['id'])
    .execute();
  await index(db, 'invitations', ['token_hash'], { unique: true, name: 'ux_invitations_token' });
  await index(db, 'invitations', ['organization_id', 'email']);
}

export async function down(db: Kysely<any>): Promise<void> {
  await dropTables(db, [
    'invitations',
    'membership_locations',
    'memberships',
    'verification_tokens',
    'trusted_devices',
    'auth_challenges',
    'sessions',
    'webauthn_credentials',
    'identities',
    'users',
    'settings',
    'locations',
    'organizations',
  ]);
}
