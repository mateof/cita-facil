import type { Kysely } from 'kysely';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { newId, shortCode } from '../lib/ids.js';
import { hashPassword } from '../lib/password.js';
import { isoNow, localToInstant, todayIn, addDays } from '../lib/dates.js';
import type { Database } from './types.js';

/**
 * Crea el primer administrador de la instalación a partir de las variables
 * `BOOTSTRAP_ADMIN_*`. Es idempotente: si el usuario ya existe no lo toca.
 */
export async function ensureBootstrapAdmin(db: Kysely<Database>): Promise<void> {
  if (!env.BOOTSTRAP_ADMIN_EMAIL || !env.BOOTSTRAP_ADMIN_PASSWORD) return;

  const email = env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase();
  const existing = await db
    .selectFrom('users')
    .select(['id'])
    .where('email_key', '=', email)
    .executeTakeFirst();
  if (existing) return;

  const now = isoNow();
  const userId = newId();
  await db
    .insertInto('users')
    .values({
      id: userId,
      email,
      email_key: email,
      email_verified: 1,
      phone: null,
      phone_verified: 0,
      password_hash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD),
      name: 'Administrador',
      given_name: null,
      family_name: null,
      nif: null,
      nif_key: userId,
      locale: env.DEFAULT_LOCALE,
      timezone: env.DEFAULT_TIMEZONE,
      avatar_url: null,
      platform_role: 'superadmin',
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

  await db
    .insertInto('identities')
    .values({
      id: newId(),
      user_id: userId,
      provider: 'password',
      subject: email,
      issuer: null,
      metadata_json: null,
      last_used_at: null,
      created_at: now,
    })
    .execute();

  logger.info({ email }, 'Administrador inicial creado');

  if (env.BOOTSTRAP_ORG_NAME) {
    await createOrganizationWithOwner(db, env.BOOTSTRAP_ORG_NAME, userId);
  }
}

async function createOrganizationWithOwner(
  db: Kysely<Database>,
  name: string,
  ownerId: string,
): Promise<string> {
  const now = isoNow();
  const orgId = newId();
  const slug = slugify(name);

  await db
    .insertInto('organizations')
    .values({
      id: orgId,
      slug,
      name,
      timezone: env.DEFAULT_TIMEZONE,
      locale: env.DEFAULT_LOCALE,
      currency: 'EUR',
      email: null,
      phone: null,
      tax_id: null,
      settings_json: null,
      status: 'active',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  await db
    .insertInto('memberships')
    .values({
      id: newId(),
      organization_id: orgId,
      user_id: ownerId,
      role: 'owner',
      job_title: null,
      bookable: 0,
      active: 1,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return orgId;
}

/** Convierte un nombre en un identificador apto para URL, sin acentos. */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || `org-${shortCode(6).toLowerCase()}`;
}

/**
 * Datos de demostración: una peluquería y un polideportivo, con sedes,
 * profesionales, pistas, servicios de duración fija y ajustable, horarios y
 * algunas citas. Sirve para probar la aplicación sin configurar nada.
 */
export async function seedDemoData(db: Kysely<Database>): Promise<void> {
  const already = await db.selectFrom('organizations').select(['id']).executeTakeFirst();
  if (already) {
    logger.info('Ya hay organizaciones; se omiten los datos de ejemplo');
    return;
  }

  const now = isoNow();
  const password = await hashPassword('CitaFacil2026!');

  /* ------------------------------------------------------------- usuarios */
  const admin = { id: newId(), email: 'admin@ejemplo.es', name: 'Ana Ríos' };
  const stylist = { id: newId(), email: 'carlos@ejemplo.es', name: 'Carlos Vidal' };
  const customer = { id: newId(), email: 'cliente@ejemplo.es', name: 'Lucía Pena' };

  for (const [user, role] of [
    [admin, 'superadmin'],
    [stylist, 'user'],
    [customer, 'user'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id: user.id,
        email: user.email,
        email_key: user.email,
        email_verified: 1,
        phone: null,
        phone_verified: 0,
        password_hash: password,
        name: user.name,
        given_name: null,
        family_name: null,
        nif: null,
        nif_key: user.id,
        locale: 'es',
        timezone: 'Europe/Madrid',
        avatar_url: null,
        platform_role: role,
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
    await db
      .insertInto('identities')
      .values({
        id: newId(),
        user_id: user.id,
        provider: 'password',
        subject: user.email,
        issuer: null,
        metadata_json: null,
        last_used_at: null,
        created_at: now,
      })
      .execute();
  }

  /* -------------------------------------------------------- organizaciones */
  const orgId = newId();
  await db
    .insertInto('organizations')
    .values({
      id: orgId,
      slug: 'peluqueria-ejemplo',
      name: 'Peluquería Ejemplo',
      timezone: 'Europe/Madrid',
      locale: 'es',
      currency: 'EUR',
      email: 'hola@ejemplo.es',
      phone: '+34981000000',
      tax_id: null,
      settings_json: JSON.stringify({
        holdMinutes: 10,
        allowGuestBooking: true,
        waitlistEnabled: true,
        slotGranularityMinutes: 15,
      }),
      status: 'active',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  for (const [userId, role] of [
    [admin.id, 'owner'],
    [stylist.id, 'staff'],
  ] as const) {
    await db
      .insertInto('memberships')
      .values({
        id: newId(),
        organization_id: orgId,
        user_id: userId,
        role,
        job_title: role === 'staff' ? 'Estilista' : null,
        bookable: role === 'staff' ? 1 : 0,
        active: 1,
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  const locationId = newId();
  await db
    .insertInto('locations')
    .values({
      id: locationId,
      organization_id: orgId,
      slug: 'centro',
      name: 'Sede Centro',
      timezone: 'Europe/Madrid',
      address_line: 'Rúa Real, 12',
      city: 'A Coruña',
      postal_code: '15003',
      region: 'A Coruña',
      country: 'ES',
      latitude: '43.3713',
      longitude: '-8.3960',
      phone: '+34981000000',
      email: null,
      description_json: JSON.stringify({
        es: 'Nuestro salón principal en pleno centro.',
        gl: 'O noso salón principal no centro.',
        en: 'Our main salon downtown.',
      }),
      active: 1,
      sort_order: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  /* ------------------------------------------------------------- recursos */
  const resourceCarlos = newId();
  const resourceSala = newId();
  await db
    .insertInto('resources')
    .values([
      {
        id: resourceCarlos,
        organization_id: orgId,
        location_id: locationId,
        user_id: stylist.id,
        name: 'Carlos Vidal',
        type: 'staff',
        description_json: null,
        capacity: 1,
        color: '#2563eb',
        image_url: null,
        bookable_directly: 1,
        sort_order: 0,
        active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
      {
        id: resourceSala,
        organization_id: orgId,
        location_id: locationId,
        user_id: null,
        name: 'Cabina de estética',
        type: 'room',
        description_json: null,
        capacity: 1,
        color: '#059669',
        image_url: null,
        bookable_directly: 1,
        sort_order: 1,
        active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
    ])
    .execute();

  /* ------------------------------------------------------------ servicios */
  const serviceCorte = newId();
  const serviceSala = newId();
  const serviceBronceado = newId();
  await db
    .insertInto('services')
    .values([
      {
        id: serviceCorte,
        organization_id: orgId,
        location_id: locationId,
        category_id: null,
        name: 'Corte de pelo',
        name_i18n_json: JSON.stringify({ es: 'Corte de pelo', gl: 'Corte de pelo', en: 'Haircut' }),
        description_json: JSON.stringify({
          es: 'Lavado, corte y peinado.',
          gl: 'Lavado, corte e peiteado.',
          en: 'Wash, cut and styling.',
        }),
        color: '#2563eb',
        image_url: null,
        duration_mode: 'fixed',
        duration_minutes: 30,
        min_duration_minutes: null,
        max_duration_minutes: null,
        duration_step_minutes: null,
        buffer_before_minutes: 0,
        buffer_after_minutes: 5,
        price_mode: 'fixed',
        price_cents: 1800,
        price_per_minute_cents: null,
        currency: 'EUR',
        deposit_cents: 0,
        payment_required: 0,
        requires_credit_pack: 0,
        capacity: 1,
        requires_approval: 0,
        min_advance_minutes: 60,
        max_advance_days: 60,
        cancellation_cutoff_minutes: 120,
        reschedule_cutoff_minutes: 120,
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
      },
      {
        // Ejemplo de servicio con duración ajustable por el cliente: reserva la
        // cabina entre 30 y 120 minutos en tramos de 30, con precio por minuto.
        id: serviceSala,
        organization_id: orgId,
        location_id: locationId,
        category_id: null,
        name: 'Alquiler de cabina',
        name_i18n_json: JSON.stringify({
          es: 'Alquiler de cabina',
          gl: 'Alugueiro de cabina',
          en: 'Room rental',
        }),
        description_json: JSON.stringify({
          es: 'Reserva la cabina el tiempo que necesites.',
          gl: 'Reserva a cabina o tempo que precises.',
          en: 'Book the room for as long as you need.',
        }),
        color: '#059669',
        image_url: null,
        duration_mode: 'flexible',
        duration_minutes: 60,
        min_duration_minutes: 30,
        max_duration_minutes: 120,
        duration_step_minutes: 30,
        buffer_before_minutes: 0,
        buffer_after_minutes: 15,
        price_mode: 'per_minute',
        price_cents: 0,
        price_per_minute_cents: 25,
        currency: 'EUR',
        deposit_cents: 0,
        payment_required: 0,
        requires_credit_pack: 0,
        capacity: 1,
        requires_approval: 0,
        min_advance_minutes: 0,
        max_advance_days: 30,
        cancellation_cutoff_minutes: 60,
        reschedule_cutoff_minutes: 60,
        allocation_strategy: null,
        allow_resource_selection: 1,
        publicly_bookable: 1,
        staff_only: 0,
        custom_fields_json: null,
        sort_order: 1,
        active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
      {
        // Ejemplo de servicio que solo se reserva con bono, como una cabina de
        // bronceado o una clase de sala: la sesión se paga al comprar el bono.
        id: serviceBronceado,
        organization_id: orgId,
        location_id: locationId,
        category_id: null,
        name: 'Sesión de bronceado',
        name_i18n_json: JSON.stringify({
          es: 'Sesión de bronceado',
          gl: 'Sesión de bronceado',
          en: 'Tanning session',
        }),
        description_json: JSON.stringify({
          es: 'Diez minutos de cabina. Se reserva con bono.',
          gl: 'Dez minutos de cabina. Resérvase con bono.',
          en: 'Ten minutes in the booth. Booked with a pass.',
        }),
        color: '#f59e0b',
        image_url: null,
        duration_mode: 'fixed',
        duration_minutes: 15,
        min_duration_minutes: null,
        max_duration_minutes: null,
        duration_step_minutes: null,
        buffer_before_minutes: 0,
        buffer_after_minutes: 5,
        price_mode: 'fixed',
        price_cents: 0,
        price_per_minute_cents: null,
        currency: 'EUR',
        deposit_cents: 0,
        payment_required: 0,
        requires_credit_pack: 1,
        capacity: 1,
        requires_approval: 0,
        min_advance_minutes: 0,
        max_advance_days: 60,
        cancellation_cutoff_minutes: 60,
        reschedule_cutoff_minutes: 60,
        allocation_strategy: null,
        allow_resource_selection: 1,
        publicly_bookable: 1,
        staff_only: 0,
        custom_fields_json: null,
        sort_order: 2,
        active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      },
    ])
    .execute();

  await db
    .insertInto('service_resources')
    .values([
      { service_id: serviceCorte, resource_id: resourceCarlos, duration_minutes: null, price_cents: null },
      { service_id: serviceSala, resource_id: resourceSala, duration_minutes: null, price_cents: null },
      { service_id: serviceBronceado, resource_id: resourceSala, duration_minutes: null, price_cents: null },
    ])
    .execute();

  /* ------------------------------------------------------------------ bonos */
  // Dos tipos de bono para el servicio que los exige: uno a la venta por la web
  // y otro que solo se emite en el centro, para que se vea la diferencia.
  const packDiez = newId();
  await db
    .insertInto('credit_packs')
    .values([
      {
        id: packDiez,
        organization_id: orgId,
        name: 'Bono 10 sesiones',
        description: 'Diez sesiones de bronceado, válidas un año.',
        credits: 10,
        price_cents: 9000,
        currency: 'EUR',
        validity_days: 365,
        service_ids_json: JSON.stringify([serviceBronceado]),
        online_purchase: 1,
        sort_order: 0,
        active: 1,
        created_at: now,
        updated_at: now,
      },
      {
        id: newId(),
        organization_id: orgId,
        name: 'Bono 5 sesiones (solo en el centro)',
        description: 'Cinco sesiones de bronceado. Se contrata en recepción.',
        credits: 5,
        price_cents: 5000,
        currency: 'EUR',
        validity_days: 180,
        service_ids_json: JSON.stringify([serviceBronceado]),
        online_purchase: 0,
        sort_order: 1,
        active: 1,
        created_at: now,
        updated_at: now,
      },
    ])
    .execute();

  // La clienta de ejemplo ya tiene un bono con saldo, para poder probar la
  // reserva de un servicio de bono nada más arrancar.
  const walletId = newId();
  await db
    .insertInto('credit_wallets')
    .values({
      id: walletId,
      organization_id: orgId,
      user_id: customer.id,
      credit_pack_id: packDiez,
      credits_total: 10,
      credits_used: 2,
      expires_at: new Date(Date.now() + 300 * 86_400_000).toISOString(),
      source: 'admin',
      granted_by: admin.id,
      payment_id: null,
      note: 'Bono de ejemplo',
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db
    .insertInto('credit_ledger')
    .values({
      id: newId(),
      wallet_id: walletId,
      appointment_id: null,
      delta: 10,
      reason: 'grant',
      created_by: admin.id,
      note: 'Bono de ejemplo',
      created_at: now,
    })
    .execute();

  /* -------------------------------------------------------------- horarios */
  const weekdayRules = [1, 2, 3, 4, 5].flatMap((weekday) => [
    { weekday, start: 9 * 60, end: 14 * 60 },
    { weekday, start: 16 * 60, end: 20 * 60 },
  ]);
  weekdayRules.push({ weekday: 6, start: 10 * 60, end: 14 * 60 });

  await db
    .insertInto('schedules')
    .values(
      weekdayRules.map((rule) => ({
        id: newId(),
        organization_id: orgId,
        owner_type: 'location',
        owner_id: locationId,
        weekday: rule.weekday,
        start_minute: rule.start,
        end_minute: rule.end,
        valid_from: null,
        valid_to: null,
        created_at: now,
      })),
    )
    .execute();

  /* ---------------------------------------------------------- cita de ejemplo */
  const timezone = 'Europe/Madrid';
  const tomorrow = addDays(todayIn(timezone), 1);
  const startsAt = localToInstant(tomorrow, 10 * 60, timezone);
  const endsAt = localToInstant(tomorrow, 10 * 60 + 30, timezone);

  await db
    .insertInto('appointments')
    .values({
      id: newId(),
      organization_id: orgId,
      location_id: locationId,
      service_id: serviceCorte,
      resource_id: resourceCarlos,
      customer_id: customer.id,
      guest_name: null,
      guest_email: null,
      guest_phone: null,
      guest_locale: null,
      starts_at: startsAt,
      ends_at: endsAt,
      block_starts_at: startsAt,
      block_ends_at: localToInstant(tomorrow, 10 * 60 + 35, timezone),
      local_date: tomorrow,
      local_start_minute: 600,
      duration_minutes: 30,
      timezone,
      status: 'confirmed',
      source: 'web',
      party_size: 1,
      price_cents: 1800,
      currency: 'EUR',
      payment_status: 'not_required',
      notes: null,
      internal_notes: null,
      custom_fields_json: null,
      access_code: shortCode(10),
      access_uses: 0,
      checked_in_at: null,
      completed_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
      recurrence_id: null,
      rescheduled_from: null,
      waitlist_entry_id: null,
      hold_expires_at: null,
      reminder_scheduled_at: null,
      created_by: customer.id,
      created_at: now,
      updated_at: now,
    })
    .execute();

  logger.info(
    { organizacion: 'Peluquería Ejemplo', usuarios: [admin.email, stylist.email, customer.email] },
    'Datos de ejemplo creados (contraseña: CitaFacil2026!)',
  );
}
