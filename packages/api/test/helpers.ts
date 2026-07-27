process.env.NODE_ENV = 'test';
process.env.DB_CLIENT = 'sqlite';
process.env.DB_FILE = ':memory:';
process.env.DB_AUTO_MIGRATE = 'false';
process.env.MAIL_TRANSPORT = 'none';
process.env.SCHEDULER_ENABLED = 'false';
process.env.SERVE_WEB = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.APP_SECRET = 'clave-de-pruebas-suficientemente-larga-0123456789';

import type { Kysely } from 'kysely';
import { createDb } from '../src/db/dialect.ts';
import { setDatabaseForTests } from '../src/db/index.ts';
import { migrateToLatest } from '../src/db/migrator.ts';
import type { Database } from '../src/db/types.ts';
import { newId, shortCode } from '../src/lib/ids.ts';
import { isoNow } from '../src/lib/dates.ts';

/**
 * Utilidades de prueba.
 *
 * Cada test abre su propia base SQLite en memoria y aplica el esquema real
 * mediante las migraciones. Es más lento que usar dobles, y a cambio lo que se
 * verifica es el comportamiento contra el esquema que se va a desplegar,
 * incluidos índices y restricciones.
 */
export async function createTestDatabase(): Promise<Kysely<Database>> {
  const db = await createDb({ client: 'sqlite', file: ':memory:' });
  await migrateToLatest(db);
  setDatabaseForTests(db);
  return db;
}

export async function closeTestDatabase(db: Kysely<Database>): Promise<void> {
  setDatabaseForTests(null);
  await db.destroy();
}

export interface Fixture {
  organizationId: string;
  locationId: string;
  resourceId: string;
  serviceId: string;
  flexibleServiceId: string;
  /** Servicio que solo se puede reservar con bono. */
  creditServiceId: string;
  customerId: string;
  timezone: string;
}

/**
 * Crea un escenario mínimo pero realista: una organización con una sede que
 * abre de lunes a viernes de 9 a 14, un recurso y dos servicios, uno de
 * duración fija y otro ajustable.
 */
export async function seedFixture(db: Kysely<Database>): Promise<Fixture> {
  const now = isoNow();
  const organizationId = newId();
  const locationId = newId();
  const resourceId = newId();
  const serviceId = newId();
  const flexibleServiceId = newId();
  const creditServiceId = newId();
  const customerId = newId();
  const timezone = 'Europe/Madrid';

  await db
    .insertInto('organizations')
    .values({
      id: organizationId,
      slug: `org-${shortCode(6).toLowerCase()}`,
      name: 'Centro de pruebas',
      timezone,
      locale: 'es',
      currency: 'EUR',
      email: null,
      phone: null,
      tax_id: null,
      settings_json: JSON.stringify({ slotGranularityMinutes: 30, holdMinutes: 10 }),
      status: 'active',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  await db
    .insertInto('locations')
    .values({
      id: locationId,
      organization_id: organizationId,
      slug: `sede-${shortCode(6).toLowerCase()}`,
      name: 'Sede única',
      timezone,
      address_line: null,
      city: null,
      postal_code: null,
      region: null,
      country: 'ES',
      latitude: null,
      longitude: null,
      phone: null,
      email: null,
      description_json: null,
      active: 1,
      sort_order: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  await db
    .insertInto('resources')
    .values({
      id: resourceId,
      organization_id: organizationId,
      location_id: locationId,
      user_id: null,
      name: 'Sala 1',
      type: 'room',
      description_json: null,
      capacity: 1,
      color: null,
      image_url: null,
      bookable_directly: 1,
      sort_order: 0,
      active: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  const baseService = {
    organization_id: organizationId,
    location_id: locationId,
    category_id: null,
    name_i18n_json: null,
    description_json: null,
    color: null,
    image_url: null,
    buffer_before_minutes: 0,
    buffer_after_minutes: 0,
    price_mode: 'fixed',
    price_cents: 1000,
    price_per_minute_cents: null,
    currency: 'EUR',
    deposit_cents: 0,
    payment_required: 0,
    requires_credit_pack: 0,
    capacity: 1,
    requires_approval: 0,
    // `-1` = hereda el plazo de la organización.
    min_advance_minutes: -1,
    max_advance_days: 365,
    cancellation_cutoff_minutes: -1,
    reschedule_cutoff_minutes: 0,
    allocation_strategy: null,
    allow_resource_selection: 1,
    publicly_bookable: 1,
    staff_only: 0,
    custom_fields_json: null,
    sort_order: 0,
    active: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await db
    .insertInto('services')
    .values([
      {
        ...baseService,
        id: serviceId,
        name: 'Consulta',
        duration_mode: 'fixed',
        duration_minutes: 60,
        min_duration_minutes: null,
        max_duration_minutes: null,
        duration_step_minutes: null,
      },
      {
        ...baseService,
        id: flexibleServiceId,
        name: 'Alquiler de sala',
        duration_mode: 'flexible',
        duration_minutes: 60,
        min_duration_minutes: 30,
        max_duration_minutes: 120,
        duration_step_minutes: 30,
        price_mode: 'per_minute',
        price_cents: 0,
        price_per_minute_cents: 20,
      },
      {
        ...baseService,
        id: creditServiceId,
        name: 'Sesión de bono',
        duration_mode: 'fixed',
        duration_minutes: 60,
        min_duration_minutes: null,
        max_duration_minutes: null,
        duration_step_minutes: null,
        price_cents: 0,
        requires_credit_pack: 1,
      },
    ])
    .execute();

  await db
    .insertInto('service_resources')
    .values([
      { service_id: serviceId, resource_id: resourceId, duration_minutes: null, price_cents: null },
      {
        service_id: flexibleServiceId,
        resource_id: resourceId,
        duration_minutes: null,
        price_cents: null,
      },
      {
        service_id: creditServiceId,
        resource_id: resourceId,
        duration_minutes: null,
        price_cents: null,
      },
    ])
    .execute();

  // Lunes a viernes, de 9 a 14.
  await db
    .insertInto('schedules')
    .values(
      [1, 2, 3, 4, 5].map((weekday) => ({
        id: newId(),
        organization_id: organizationId,
        owner_type: 'location',
        owner_id: locationId,
        weekday,
        start_minute: 9 * 60,
        end_minute: 14 * 60,
        valid_from: null,
        valid_to: null,
        created_at: now,
      })),
    )
    .execute();

  await db
    .insertInto('users')
    .values({
      id: customerId,
      email: `cliente-${shortCode(6).toLowerCase()}@ejemplo.es`,
      email_key: `cliente-${customerId}@ejemplo.es`,
      email_verified: 1,
      phone: null,
      phone_verified: 0,
      password_hash: null,
      name: 'Cliente de pruebas',
      given_name: null,
      family_name: null,
      nif: null,
      nif_key: customerId,
      locale: 'es',
      timezone,
      avatar_url: null,
      platform_role: 'user',
      status: 'active',
      mfa_enabled: 0,
      mfa_totp_secret: null,
      mfa_recovery_codes: null,
      quiet_hours_start: null,
      quiet_hours_end: null,
      no_show_count: 0,
      last_login_at: null,
      failed_login_count: 0,
      locked_until: null,
      marketing_opt_in: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  return {
    organizationId,
    locationId,
    resourceId,
    serviceId,
    flexibleServiceId,
    creditServiceId,
    customerId,
    timezone,
  };
}

/** Crea un tipo de bono y se lo emite al cliente de la fixture. */
export async function seedCreditPack(
  db: Kysely<Database>,
  fixture: Fixture,
  options: {
    credits?: number;
    used?: number;
    serviceIds?: string[];
    expiresAt?: string | null;
    cancelled?: boolean;
    onlinePurchase?: boolean;
  } = {},
): Promise<{ packId: string; walletId: string }> {
  const now = isoNow();
  const packId = newId();
  const walletId = newId();

  await db
    .insertInto('credit_packs')
    .values({
      id: packId,
      organization_id: fixture.organizationId,
      name: 'Bono de pruebas',
      description: null,
      credits: options.credits ?? 5,
      price_cents: 5000,
      currency: 'EUR',
      validity_days: 365,
      service_ids_json: JSON.stringify(options.serviceIds ?? [fixture.creditServiceId]),
      online_purchase: options.onlinePurchase === false ? 0 : 1,
      sort_order: 0,
      active: 1,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db
    .insertInto('credit_wallets')
    .values({
      id: walletId,
      organization_id: fixture.organizationId,
      user_id: fixture.customerId,
      credit_pack_id: packId,
      credits_total: options.credits ?? 5,
      credits_used: options.used ?? 0,
      expires_at: options.expiresAt === undefined ? null : options.expiresAt,
      source: 'admin',
      granted_by: null,
      payment_id: null,
      note: null,
      cancelled_at: options.cancelled ? now : null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return { packId, walletId };
}

/** Próximo lunes a partir de hoy, para tener siempre un día laborable. */
export function nextMonday(): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() !== 1);
  return date.toISOString().slice(0, 10);
}
