import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import {
  closeTestDatabase,
  createTestDatabase,
  nextMonday,
  seedFixture,
  type Fixture,
} from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { newId } from '../src/lib/ids.ts';
import { isoNow, localToInstant } from '../src/lib/dates.ts';
import { computeAvailability } from '../src/modules/availability/engine.ts';
import { createAppointment } from '../src/modules/appointments/service.ts';
import { requireAppointmentDetail } from '../src/modules/appointments/queries.ts';

/**
 * Varios servicios en la misma cita.
 *
 * Lo que hay que comprobar es que la agenda cuenta la suma: si se ofrece un
 * hueco donde solo cabe el primero, la cita siguiente se pisa.
 */

let db: Kysely<Database>;
let fixture: Fixture;
let monday: string;
let segundoId: string;

before(async () => {
  db = await createTestDatabase();
  fixture = await seedFixture(db);
  monday = nextMonday();
  segundoId = await servicioDe30();
});

after(async () => {
  await closeTestDatabase(db);
});

beforeEach(async () => {
  await db.deleteFrom('appointment_services').execute();
  await db.deleteFrom('appointments').execute();
});

/** Un segundo servicio de media hora que comparte recurso con el principal. */
async function servicioDe30(): Promise<string> {
  const id = newId();
  const now = isoNow();

  const base = await db
    .selectFrom('services')
    .selectAll()
    .where('id', '=', fixture.serviceId)
    .executeTakeFirstOrThrow();

  await db
    .insertInto('services')
    .values({ ...base, id, name: 'Arreglo rápido', duration_minutes: 30, price_cents: 500 })
    .execute();

  await db
    .insertInto('service_resources')
    .values({
      service_id: id,
      resource_id: fixture.resourceId,
      duration_minutes: null,
      price_cents: null,
    })
    .execute();

  await db
    .updateTable('services')
    .set({ created_at: now, updated_at: now })
    .where('id', '=', id)
    .execute();

  return id;
}

describe('disponibilidad', () => {
  it('la cita ocupa la suma de los dos servicios', async () => {
    const disponibilidad = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      additionalServiceIds: [segundoId],
      from: monday,
    });

    // 60 del principal más 30 del añadido.
    assert.equal(disponibilidad.days[0]?.slots[0]?.durationMinutes, 90);
  });

  it('el precio también suma', async () => {
    const disponibilidad = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      additionalServiceIds: [segundoId],
      from: monday,
    });

    assert.equal(disponibilidad.days[0]?.slots[0]?.priceCents, 1500);
  });

  /** Con 90 minutos ya no cabe empezar a las 13:30 en una jornada que cierra a las 14. */
  it('deja de ofrecer los huecos donde no cabe entera', async () => {
    const solo = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      from: monday,
    });
    const combinada = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId: fixture.serviceId,
      additionalServiceIds: [segundoId],
      from: monday,
    });

    assert.ok((combinada.days[0]?.slots.length ?? 0) < (solo.days[0]?.slots.length ?? 0));
  });

  it('un servicio que no existe no se puede añadir', async () => {
    await assert.rejects(
      computeAvailability({
        organizationId: fixture.organizationId,
        serviceId: fixture.serviceId,
        additionalServiceIds: ['no-existe'],
        from: monday,
      }),
      /no existe/,
    );
  });

  /** Dos ajustables en la misma visita no tendrían una duración única. */
  it('no se puede añadir un servicio de duración ajustable', async () => {
    await assert.rejects(
      computeAvailability({
        organizationId: fixture.organizationId,
        serviceId: fixture.serviceId,
        additionalServiceIds: [fixture.flexibleServiceId],
        from: monday,
      }),
      /ajustable/,
    );
  });
});

describe('reserva', () => {
  it('la cita dura lo que suman los servicios', async () => {
    const { appointment } = await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        additionalServiceIds: [segundoId],
        startsAt: localToInstant(monday, 9 * 60, fixture.timezone),
        partySize: 1,
      },
      { userId: fixture.customerId, isStaff: false },
    );

    assert.equal(appointment.durationMinutes, 90);
  });

  it('el detalle enseña los dos servicios', async () => {
    const { appointment } = await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        additionalServiceIds: [segundoId],
        startsAt: localToInstant(monday, 10 * 60, fixture.timezone),
        partySize: 1,
      },
      { userId: fixture.customerId, isStaff: false },
    );

    const detalle = await requireAppointmentDetail(appointment.id);

    assert.equal(detalle.services.length, 2);
  });

  it('el servicio principal conserva su propia duración en el detalle', async () => {
    const { appointment } = await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        additionalServiceIds: [segundoId],
        startsAt: localToInstant(monday, 11 * 60, fixture.timezone),
        partySize: 1,
      },
      { userId: fixture.customerId, isStaff: false },
    );

    const detalle = await requireAppointmentDetail(appointment.id);

    assert.equal(detalle.services[0]?.durationMinutes, 60);
  });

  it('el precio de la cita es la suma', async () => {
    const { appointment } = await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        additionalServiceIds: [segundoId],
        startsAt: localToInstant(monday, 12 * 60, fixture.timezone),
        partySize: 1,
      },
      { userId: fixture.customerId, isStaff: false },
    );

    assert.equal(appointment.priceCents, 1500);
  });

  /** Una cita no puede consumir saldo de varios bonos a la vez. */
  it('no se puede combinar un servicio de bono', async () => {
    await assert.rejects(
      createAppointment(
        fixture.organizationId,
        {
          serviceId: fixture.serviceId,
          additionalServiceIds: [fixture.creditServiceId],
          startsAt: localToInstant(monday, 13 * 60, fixture.timezone),
          partySize: 1,
        },
        { userId: fixture.customerId, isStaff: false },
      ),
      /bono/,
    );
  });

  it('la cita ocupa el hueco entero y no deja reservar encima', async () => {
    await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        additionalServiceIds: [segundoId],
        startsAt: localToInstant(monday, 9 * 60, fixture.timezone),
        partySize: 1,
      },
      { userId: fixture.customerId, isStaff: false },
    );

    await assert.rejects(
      createAppointment(
        fixture.organizationId,
        {
          serviceId: fixture.serviceId,
          startsAt: localToInstant(monday, 10 * 60, fixture.timezone),
          partySize: 1,
        },
        { userId: fixture.customerId, isStaff: false },
      ),
      /disponible|ocupado/i,
    );
  });
});
