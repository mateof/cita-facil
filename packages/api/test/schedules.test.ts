import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import {
  cancelSchedule,
  createSchedule,
  getSchedule,
  listSchedules,
  runSchedule,
} from '../src/modules/appointments/schedules.ts';
import { cancelAppointment, createAppointment } from '../src/modules/appointments/service.ts';
import { addDays, isoNow, localToInstant, weekdayOf } from '../src/lib/dates.ts';

/**
 * Programaciones semanales.
 *
 * Lo que hay que asegurar es que el generador no duplica ni resucita: cada
 * fecha se procesa una sola vez, y una cita cancelada a mano no vuelve a
 * aparecer sola la próxima vez que corra.
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
  await db.deleteFrom('schedule_occurrences').execute();
  await db.deleteFrom('appointment_schedules').execute();
  await db.deleteFrom('appointments').execute();
});

const hoy = () => isoNow().slice(0, 10);

/** Un día de la semana que caiga dentro de los próximos siete y sea laborable. */
function proximoDiaLaborable(): { fecha: string; weekday: number } {
  for (let salto = 1; salto <= 7; salto += 1) {
    const fecha = addDays(hoy(), salto);
    const weekday = weekdayOf(fecha);
    if (weekday <= 5) return { fecha, weekday };
  }
  throw new Error('No hay laborable en los próximos siete días');
}

async function programar(extra: Record<string, unknown> = {}) {
  const { weekday } = proximoDiaLaborable();
  return createSchedule(
    fixture.organizationId,
    {
      serviceId: fixture.serviceId,
      customerId: fixture.customerId,
      locationId: fixture.locationId,
      weekday,
      startMinute: 10 * 60,
      ...extra,
    },
    null,
  );
}

describe('crear una programación', () => {
  it('la primera cita se crea sin esperar al planificador', async () => {
    const programacion = await programar();

    const citas = await db
      .selectFrom('appointments')
      .select(['id'])
      .where('customer_id', '=', fixture.customerId)
      .execute();

    assert.equal(citas.length, 1, `programación ${programacion.id}`);
  });

  it('queda anotada la fecha que se ha procesado', async () => {
    const programacion = await programar();
    const detalle = await getSchedule(fixture.organizationId, programacion.id);

    assert.equal(detalle.occurrences?.length, 1);
  });

  it('aparece en el listado de la organización', async () => {
    await programar();
    const listado = await listSchedules(fixture.organizationId, { onlyActive: true });

    assert.equal(listado.length, 1);
  });

  it('rechaza un día de la semana que no existe', async () => {
    await assert.rejects(
      () =>
        createSchedule(
          fixture.organizationId,
          {
            serviceId: fixture.serviceId,
            customerId: fixture.customerId,
            weekday: 9,
            startMinute: 600,
          },
          null,
        ),
      /día de la semana/i,
    );
  });
});

describe('generación semanal', () => {
  /** Correr dos veces seguidas no puede duplicar la cita de la misma fecha. */
  it('volver a ejecutarla no crea nada nuevo', async () => {
    const programacion = await programar();

    const creadas = await runSchedule(programacion.id);

    assert.equal(creadas, 0);
  });

  /**
   * El caso que pide el negocio: alguien anula un día suelto y el sistema no
   * se lo vuelve a poner.
   */
  it('una cita cancelada a mano no se vuelve a crear', async () => {
    const programacion = await programar();
    const cita = await db
      .selectFrom('appointments')
      .select(['id'])
      .where('customer_id', '=', fixture.customerId)
      .executeTakeFirstOrThrow();

    await cancelAppointment(cita.id, {}, { isStaff: true });
    await runSchedule(programacion.id);

    const vivas = await db
      .selectFrom('appointments')
      .select(['id'])
      .where('customer_id', '=', fixture.customerId)
      .where('status', '!=', 'cancelled')
      .execute();
    assert.equal(vivas.length, 0);
  });

  it('la semana siguiente sí se genera cuando entra en el horizonte', async () => {
    const programacion = await programar();
    const { fecha } = proximoDiaLaborable();

    // Una semana después, esa fecha ya cae dentro de los siete días.
    const creadas = await runSchedule(programacion.id, addDays(fecha, 1));

    assert.equal(creadas, 1);
  });

  it('una programación parada deja de generar', async () => {
    const programacion = await programar();
    const { fecha } = proximoDiaLaborable();

    await cancelSchedule(fixture.organizationId, programacion.id, null);
    const creadas = await runSchedule(programacion.id, addDays(fecha, 1));

    assert.equal(creadas, 0);
  });

  it('pararla no cancela las citas ya creadas', async () => {
    const programacion = await programar();
    await cancelSchedule(fixture.organizationId, programacion.id, null);

    const vivas = await db
      .selectFrom('appointments')
      .select(['id'])
      .where('customer_id', '=', fixture.customerId)
      .where('status', '!=', 'cancelled')
      .execute();
    assert.equal(vivas.length, 1);
  });
});

describe('cuando el hueco está ocupado', () => {
  /**
   * El recurso de la fixture tiene aforo uno, así que una cita normal a esa
   * hora deja el hueco sin sitio para la de la programación.
   */
  async function ocuparElHueco(): Promise<void> {
    const { fecha } = proximoDiaLaborable();
    await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        locationId: fixture.locationId,
        startsAt: localToInstant(fecha, 10 * 60, fixture.timezone),
        guest: { name: 'Quien ocupa el hueco' },
      } as never,
      { isStaff: true },
    );
  }

  it('con "saltar", esa semana no se reserva nada', async () => {
    await ocuparElHueco();
    const programacion = await programar({ startMinute: 10 * 60, onConflict: 'skip' });

    const detalle = await getSchedule(fixture.organizationId, programacion.id);
    assert.equal(detalle.occurrences?.[0]?.status, 'skipped');
  });

  it('con "saltar", queda anotado el motivo', async () => {
    await ocuparElHueco();
    const programacion = await programar({ startMinute: 10 * 60, onConflict: 'skip' });

    const detalle = await getSchedule(fixture.organizationId, programacion.id);
    assert.match(detalle.occurrences?.[0]?.reason ?? '', /hueco/);
  });

  it('con "el más cercano", se reserva a otra hora del mismo día', async () => {
    await ocuparElHueco();
    const programacion = await programar({ startMinute: 10 * 60, onConflict: 'nearest' });

    const detalle = await getSchedule(fixture.organizationId, programacion.id);
    assert.equal(detalle.occurrences?.[0]?.status, 'created');
  });

  it('con "reservar igualmente", la cita se crea aunque no quepa', async () => {
    await ocuparElHueco();
    const programacion = await programar({ startMinute: 10 * 60, onConflict: 'force' });

    const detalle = await getSchedule(fixture.organizationId, programacion.id);
    assert.equal(detalle.occurrences?.[0]?.status, 'created');
  });
});
