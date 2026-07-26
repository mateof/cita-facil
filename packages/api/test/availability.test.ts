import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, nextMonday, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { computeAvailability, resolveDuration } from '../src/modules/availability/engine.ts';
import { createAppointment, cancelAppointment } from '../src/modules/appointments/service.ts';
import { newId } from '../src/lib/ids.ts';
import { isoNow, localToInstant } from '../src/lib/dates.ts';

let db: Kysely<Database>;
let fixture: Fixture;
let monday: string;

before(async () => {
  db = await createTestDatabase();
  fixture = await seedFixture(db);
  monday = nextMonday();
});

after(async () => {
  await closeTestDatabase(db);
});

describe('motor de disponibilidad', () => {
  it('genera huecos dentro del horario de la sede', async () => {
    const result = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      from: monday,
    });

    const slots = result.days[0]!.slots;
    assert.ok(slots.length > 0, 'debería haber huecos el lunes');
    assert.equal(slots[0]!.localStartMinute, 9 * 60);
  });

  it('no genera huecos que se salgan de la hora de cierre', async () => {
    const result = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      from: monday,
    });

    const last = result.days[0]!.slots.at(-1)!;
    // El servicio dura 60 minutos y se cierra a las 14:00.
    assert.equal(last.localStartMinute + last.durationMinutes, 14 * 60);
  });

  it('marca el fin de semana como cerrado', async () => {
    const saturday = new Date(`${monday}T12:00:00.000Z`);
    saturday.setUTCDate(saturday.getUTCDate() + 5);

    const result = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      from: saturday.toISOString().slice(0, 10),
    });

    assert.equal(result.days[0]!.closed, true);
    assert.equal(result.days[0]!.slots.length, 0);
  });
});

describe('duración ajustable por el cliente', () => {
  it('acepta una duración dentro del rango y en el tramo correcto', async () => {
    const service = await db
      .selectFrom('services')
      .selectAll()
      .where('id', '=', fixture.flexibleServiceId)
      .executeTakeFirstOrThrow();

    assert.equal(resolveDuration(service, 90), 90);
  });

  it('rechaza una duración fuera del rango permitido', async () => {
    const service = await db
      .selectFrom('services')
      .selectAll()
      .where('id', '=', fixture.flexibleServiceId)
      .executeTakeFirstOrThrow();

    assert.throws(() => resolveDuration(service, 180), /entre 30 y 120/);
  });

  it('rechaza una duración que no cae en el tramo', async () => {
    const service = await db
      .selectFrom('services')
      .selectAll()
      .where('id', '=', fixture.flexibleServiceId)
      .executeTakeFirstOrThrow();

    assert.throws(() => resolveDuration(service, 45), /tramos de 30/);
  });

  it('ofrece menos huecos cuanto más larga es la reserva', async () => {
    const corta = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.flexibleServiceId,
      from: monday,
      durationMinutes: 30,
    });
    const larga = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.flexibleServiceId,
      from: monday,
      durationMinutes: 120,
    });

    assert.ok(corta.days[0]!.slots.length > larga.days[0]!.slots.length);
  });

  it('calcula el precio por minuto según la duración elegida', async () => {
    const result = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.flexibleServiceId,
      from: monday,
      durationMinutes: 90,
    });

    // 20 céntimos por minuto durante 90 minutos.
    assert.equal(result.days[0]!.slots[0]!.priceCents, 1800);
  });
});

describe('reserva de citas', () => {
  it('ocupa el hueco reservado y desaparece de la disponibilidad', async () => {
    const startsAt = localToInstant(monday, 10 * 60, fixture.timezone);

    const { appointment } = await createAppointment(
      fixture.organizationId,
      { serviceId: fixture.serviceId, startsAt, partySize: 1 },
      { userId: fixture.customerId, isStaff: false },
    );

    assert.equal(appointment.status, 'confirmed');

    const after = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      from: monday,
    });

    const stillFree = after.days[0]!.slots.some((slot) => slot.localStartMinute === 10 * 60);
    assert.equal(stillFree, false, 'el hueco de las 10:00 debería estar ocupado');
  });

  it('rechaza una segunda reserva en el mismo hueco', async () => {
    const startsAt = localToInstant(monday, 11 * 60, fixture.timezone);

    await createAppointment(
      fixture.organizationId,
      { serviceId: fixture.serviceId, startsAt, partySize: 1 },
      { userId: fixture.customerId, isStaff: false },
    );

    await assert.rejects(
      createAppointment(
        fixture.organizationId,
        { serviceId: fixture.serviceId, startsAt, partySize: 1 },
        { userId: fixture.customerId, isStaff: false },
      ),
      /disponible|ocupado/i,
    );
  });

  it('libera el hueco al cancelar', async () => {
    const startsAt = localToInstant(monday, 12 * 60, fixture.timezone);

    const { appointment } = await createAppointment(
      fixture.organizationId,
      { serviceId: fixture.serviceId, startsAt, partySize: 1 },
      { userId: fixture.customerId, isStaff: false },
    );

    await cancelAppointment(appointment.id, { actor: { isStaff: true }, notifyCustomer: false });

    const after = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      from: monday,
    });

    const free = after.days[0]!.slots.some((slot) => slot.localStartMinute === 12 * 60);
    assert.equal(free, true, 'el hueco cancelado vuelve a estar libre');
  });

  it('respeta la antelación mínima del servicio', async () => {
    const serviceId = newId();
    const now = isoNow();

    await db
      .insertInto('services')
      .values({
        id: serviceId,
        organization_id: fixture.organizationId,
        location_id: fixture.locationId,
        category_id: null,
        name: 'Con antelación',
        name_i18n_json: null,
        description_json: null,
        color: null,
        image_url: null,
        duration_mode: 'fixed',
        duration_minutes: 30,
        min_duration_minutes: null,
        max_duration_minutes: null,
        duration_step_minutes: null,
        buffer_before_minutes: 0,
        buffer_after_minutes: 0,
        price_mode: 'free',
        price_cents: 0,
        price_per_minute_cents: null,
        currency: 'EUR',
        deposit_cents: 0,
        payment_required: 0,
        capacity: 1,
        requires_approval: 0,
        // Un año de antelación mínima: no debería haber ningún hueco pronto.
        min_advance_minutes: 525_600,
        max_advance_days: 365,
        cancellation_cutoff_minutes: 0,
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
      })
      .execute();

    await db
      .insertInto('service_resources')
      .values({
        service_id: serviceId,
        resource_id: fixture.resourceId,
        duration_minutes: null,
        price_cents: null,
      })
      .execute();

    const result = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId,
      from: monday,
    });

    assert.equal(result.days[0]!.slots.length, 0);
  });
});

describe('márgenes entre citas', () => {
  it('el margen posterior bloquea el hueco siguiente', async () => {
    const serviceId = newId();
    const now = isoNow();
    const resourceId = newId();

    await db
      .insertInto('resources')
      .values({
        id: resourceId,
        organization_id: fixture.organizationId,
        location_id: fixture.locationId,
        user_id: null,
        name: 'Sala con margen',
        type: 'room',
        description_json: null,
        capacity: 1,
        color: null,
        image_url: null,
        bookable_directly: 1,
        sort_order: 1,
        active: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      .execute();

    await db
      .insertInto('services')
      .values({
        id: serviceId,
        organization_id: fixture.organizationId,
        location_id: fixture.locationId,
        category_id: null,
        name: 'Con limpieza',
        name_i18n_json: null,
        description_json: null,
        color: null,
        image_url: null,
        duration_mode: 'fixed',
        duration_minutes: 30,
        min_duration_minutes: null,
        max_duration_minutes: null,
        duration_step_minutes: null,
        buffer_before_minutes: 0,
        buffer_after_minutes: 30,
        price_mode: 'free',
        price_cents: 0,
        price_per_minute_cents: null,
        currency: 'EUR',
        deposit_cents: 0,
        payment_required: 0,
        capacity: 1,
        requires_approval: 0,
        min_advance_minutes: 0,
        max_advance_days: 365,
        cancellation_cutoff_minutes: 0,
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
      })
      .execute();

    await db
      .insertInto('service_resources')
      .values({ service_id: serviceId, resource_id: resourceId, duration_minutes: null, price_cents: null })
      .execute();

    const startsAt = localToInstant(monday, 9 * 60, fixture.timezone);
    await createAppointment(
      fixture.organizationId,
      { serviceId, startsAt, partySize: 1 },
      { userId: fixture.customerId, isStaff: false },
    );

    const result = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId,
      resourceId,
      from: monday,
    });

    // La cita de 9:00 dura 30 minutos y arrastra 30 de margen: hasta las 10:00
    // no debería haber nada libre.
    const tooEarly = result.days[0]!.slots.some((slot) => slot.localStartMinute < 10 * 60);
    assert.equal(tooEarly, false);
  });
});
