import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { newId, shortCode } from '../src/lib/ids.ts';
import { isoNow } from '../src/lib/dates.ts';
import {
  getCustomerDetail,
  listCustomers,
  updateCustomerProfile,
} from '../src/modules/customers/service.ts';

/**
 * Ficha de cliente.
 *
 * Las cifras se calculan sobre las citas, los pagos y los bonos que ya hay, así
 * que lo que se comprueba aquí es que cuentan lo que el mostrador espera ver:
 * una falta no es una visita, una cita pagada con bono no vuelve a sumar al
 * gasto y quien no es cliente de este negocio no tiene ficha.
 */

let db: Kysely<Database>;
let fixture: Fixture;

before(async () => {
  db = await createTestDatabase();
  fixture = await seedFixture(db);
});

after(async () => {
  await closeTestDatabase(db);
});

beforeEach(async () => {
  await db.deleteFrom('customer_profiles').execute();
  await db.deleteFrom('payments').execute();
  await db.deleteFrom('credit_debts').execute();
  await db.deleteFrom('appointments').execute();
});

/** Inserta una cita ya pasada sin pasar por las reglas de reserva. */
async function citaPasada(options: {
  customerId?: string | null;
  status?: string;
  daysAgo?: number;
  priceCents?: number;
  paymentStatus?: string;
  creditWalletId?: string | null;
}): Promise<string> {
  const id = newId();
  const startsAt = new Date(Date.now() - (options.daysAgo ?? 7) * 86_400_000).toISOString();
  const endsAt = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();

  await db
    .insertInto('appointments')
    .values({
      id,
      organization_id: fixture.organizationId,
      location_id: fixture.locationId,
      service_id: fixture.serviceId,
      resource_id: fixture.resourceId,
      customer_id: options.customerId === undefined ? fixture.customerId : options.customerId,
      guest_name: null,
      guest_email: null,
      guest_phone: null,
      guest_locale: null,
      starts_at: startsAt,
      ends_at: endsAt,
      block_starts_at: startsAt,
      block_ends_at: endsAt,
      local_date: startsAt.slice(0, 10),
      local_start_minute: 600,
      duration_minutes: 60,
      timezone: fixture.timezone,
      status: options.status ?? 'completed',
      source: 'admin',
      party_size: 1,
      price_cents: options.priceCents ?? 2000,
      currency: 'EUR',
      payment_status: options.paymentStatus ?? 'not_required',
      notes: null,
      internal_notes: null,
      custom_fields_json: null,
      access_code: shortCode(8),
      access_uses: 0,
      checked_in_at: null,
      completed_at: null,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
      recurrence_id: null,
      rescheduled_from: null,
      waitlist_entry_id: null,
      credit_wallet_id: options.creditWalletId ?? null,
      hold_expires_at: null,
      reminder_scheduled_at: null,
      created_by: null,
      created_at: isoNow(),
      updated_at: isoNow(),
    })
    .execute();

  return id;
}

const FILTROS = { sort: 'name' as const, page: 1, pageSize: 25 };

describe('listado de clientes', () => {
  it('quien ha reservado alguna vez aparece en la lista', async () => {
    await citaPasada({});

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.items[0]?.id, fixture.customerId);
  });

  it('quien reserva sin cuenta no genera ficha', async () => {
    await citaPasada({ customerId: null });

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.total, 0);
  });

  it('la última visita es la de la cita atendida más reciente', async () => {
    await citaPasada({ daysAgo: 30 });
    await citaPasada({ daysAgo: 3 });

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.items[0]?.stats.lastVisitAt?.slice(0, 10), fechaHace(3));
  });

  it('una falta no cuenta como visita', async () => {
    await citaPasada({ daysAgo: 30 });
    await citaPasada({ daysAgo: 2, status: 'no_show' });

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.items[0]?.stats.lastVisitAt?.slice(0, 10), fechaHace(30));
  });

  it('las faltas se cuentan aparte', async () => {
    await citaPasada({ status: 'no_show' });

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.items[0]?.stats.noShows, 1);
  });

  it('las cancelaciones no cuentan como citas', async () => {
    await citaPasada({ status: 'cancelled' });

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.items[0]?.stats.appointments, 0);
  });

  it('el gasto suma las citas cobradas', async () => {
    await citaPasada({ priceCents: 2500, paymentStatus: 'paid' });

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.items[0]?.stats.spendCents, 2500);
  });

  /**
   * Ese dinero entró al comprar el bono. Contarlo también en la cita doblaría
   * el gasto de quien compra series de sesiones.
   */
  it('una cita pagada con bono no vuelve a sumar al gasto', async () => {
    await citaPasada({ priceCents: 2500, paymentStatus: 'paid', creditWalletId: newId() });

    const lista = await listCustomers(fixture.organizationId, FILTROS);

    assert.equal(lista.items[0]?.stats.spendCents, 0);
  });

  it('filtra por etiqueta', async () => {
    await citaPasada({});
    await updateCustomerProfile(fixture.organizationId, fixture.customerId, { tags: ['vip'] });

    const lista = await listCustomers(fixture.organizationId, { ...FILTROS, tag: 'moroso' });

    assert.equal(lista.total, 0);
  });

  it('el filtro de inactividad deja fuera a quien vino hace poco', async () => {
    await citaPasada({ daysAgo: 5 });

    const lista = await listCustomers(fixture.organizationId, { ...FILTROS, inactiveDays: 30 });

    assert.equal(lista.total, 0);
  });

  it('el filtro de inactividad encuentra a quien no viene desde hace tiempo', async () => {
    await citaPasada({ daysAgo: 200 });

    const lista = await listCustomers(fixture.organizationId, { ...FILTROS, inactiveDays: 30 });

    assert.equal(lista.total, 1);
  });
});

describe('ficha de cliente', () => {
  it('guarda las notas del mostrador', async () => {
    await citaPasada({});

    const ficha = await updateCustomerProfile(fixture.organizationId, fixture.customerId, {
      notes: 'Prefiere que la llamen por la tarde',
    });

    assert.equal(ficha.notes, 'Prefiere que la llamen por la tarde');
  });

  it('no repite una etiqueta puesta dos veces', async () => {
    await citaPasada({});

    const ficha = await updateCustomerProfile(fixture.organizationId, fixture.customerId, {
      tags: ['vip', 'vip'],
    });

    assert.deepEqual(ficha.tags, ['vip']);
  });

  it('trae el historial de citas', async () => {
    await citaPasada({});

    const ficha = await getCustomerDetail(fixture.organizationId, fixture.customerId);

    assert.equal(ficha.appointments.length, 1);
  });

  /**
   * Es la misma regla de privacidad que impide buscar personas fuera de la
   * organización: sin esta comprobación, la ficha sería una forma de leer el
   * teléfono de cualquier cuenta probando identificadores.
   */
  it('no deja abrir la ficha de alguien que no es cliente del negocio', async () => {
    const ajeno = await usuarioSuelto();

    await assert.rejects(
      getCustomerDetail(fixture.organizationId, ajeno),
      /clienta de esta organización/,
    );
  });
});

/** Fecha local `YYYY-MM-DD` de hace N días, para comparar sin la hora. */
function fechaHace(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Una cuenta de la instalación que no ha pisado esta organización. */
async function usuarioSuelto(): Promise<string> {
  const id = newId();
  const now = isoNow();

  await db
    .insertInto('users')
    .values({
      id,
      email: `suelto-${shortCode(6).toLowerCase()}@ejemplo.es`,
      email_key: `suelto-${id}@ejemplo.es`,
      email_verified: 1,
      phone: null,
      phone_verified: 0,
      password_hash: null,
      name: 'Cuenta de otra organización',
      given_name: null,
      family_name: null,
      nif: null,
      nif_key: id,
      locale: 'es',
      timezone: fixture.timezone,
      avatar_url: null,
      icon: null,
      color: null,
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

  return id;
}
