import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, nextMonday, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { computeAvailability } from '../src/modules/availability/engine.ts';
import { newId } from '../src/lib/ids.ts';
import { addDays, isoNow } from '../src/lib/dates.ts';

/**
 * A qué horas puede empezar una cita, por servicio.
 *
 * La sede del fixture abre de lunes a viernes de 9 a 14 y la organización tiene
 * rejilla de 30 minutos. El servicio de estas pruebas dura 45, que es donde se
 * nota la diferencia entre los modos: 45 no divide a la hora.
 */

let db: Kysely<Database>;
let fixture: Fixture;
let monday: string;
let serviceId: string;

async function crearServicio(): Promise<string> {
  const id = newId();
  const now = isoNow();
  await db
    .insertInto('services')
    .values({
      id,
      organization_id: fixture.organizationId,
      location_id: fixture.locationId,
      category_id: null,
      name: 'Clase de prueba',
      name_i18n_json: null,
      description_json: null,
      color: null,
      image_url: null,
      duration_mode: 'fixed',
      duration_minutes: 45,
      min_duration_minutes: null,
      max_duration_minutes: null,
      duration_step_minutes: null,
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
      min_advance_minutes: -1,
      max_advance_days: 365,
      cancellation_cutoff_minutes: -1,
      reschedule_cutoff_minutes: 0,
      allocation_strategy: null,
      allow_resource_selection: 1,
      publicly_bookable: 1,
      staff_only: 0,
      start_mode: 'inherit',
      start_interval_minutes: null,
      start_offset_minutes: 0,
      start_times_json: null,
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
      service_id: id,
      resource_id: fixture.resourceId,
      duration_minutes: null,
      price_cents: null,
    })
    .execute();

  return id;
}

/** Cambia el modo de inicio del servicio de prueba. */
async function configurar(
  patch: Partial<{
    start_mode: string;
    start_interval_minutes: number | null;
    start_offset_minutes: number;
    start_times_json: string | null;
  }>,
): Promise<void> {
  await db.updateTable('services').set(patch).where('id', '=', serviceId).execute();
}

/** Las horas que se ofrecen ese día, en minutos desde medianoche. */
async function horasDe(date: string): Promise<number[]> {
  const result = await computeAvailability({
    organizationId: fixture.organizationId,
    serviceId,
    from: date,
  });
  return result.days[0]!.slots.map((slot) => slot.localStartMinute);
}

const h = (hora: number, minuto = 0) => hora * 60 + minuto;

before(async () => {
  db = await createTestDatabase();
  fixture = await seedFixture(db);
  monday = nextMonday();
  serviceId = await crearServicio();
});

after(async () => {
  await closeTestDatabase(db);
});

beforeEach(async () => {
  await configurar({
    start_mode: 'inherit',
    start_interval_minutes: null,
    start_offset_minutes: 0,
    start_times_json: null,
  });
});

describe('horas a las que empieza un servicio', () => {
  it('por defecto usa la rejilla de la organización', async () => {
    assert.deepEqual(await horasDe(monday), [
      h(9),
      h(9, 30),
      h(10),
      h(10, 30),
      h(11),
      h(11, 30),
      h(12),
      h(12, 30),
      h(13),
    ]);
  });

  it('en punto: solo a las horas cerradas', async () => {
    await configurar({ start_mode: 'interval', start_interval_minutes: 60 });

    assert.deepEqual(await horasDe(monday), [h(9), h(10), h(11), h(12), h(13)]);
  });

  it('cada media hora con desfase: a y cuarto y a menos cuarto', async () => {
    await configurar({
      start_mode: 'interval',
      start_interval_minutes: 30,
      start_offset_minutes: 15,
    });

    assert.deepEqual(await horasDe(monday), [
      h(9, 15),
      h(9, 45),
      h(10, 15),
      h(10, 45),
      h(11, 15),
      h(11, 45),
      h(12, 15),
      h(12, 45),
      h(13, 15),
    ]);
  });

  it('encadenadas: cada una empieza cuando acaba la anterior', async () => {
    await configurar({ start_mode: 'sequence' });

    assert.deepEqual(await horasDe(monday), [
      h(9),
      h(9, 45),
      h(10, 30),
      h(11, 15),
      h(12),
      h(12, 45),
    ]);
  });

  /*
   * Encadenadas ofrece menos horas que la rejilla, y a la vez caben más citas
   * en el día: la rejilla de 30 con sesiones de 45 obliga a dejar 15 minutos
   * muertos entre una y la siguiente. Es justo el motivo de tener el modo.
   */
  it('encadenadas no deja huecos muertos entre una cita y la siguiente', async () => {
    await configurar({ start_mode: 'sequence' });
    const horas = await horasDe(monday);

    for (let i = 1; i < horas.length; i += 1) {
      assert.equal(horas[i]! - horas[i - 1]!, 45, 'deberían ir pegadas');
    }
  });

  it('horas fijas: martes y jueves a las 12:00 y a las 16:00', async () => {
    await configurar({
      start_mode: 'fixed',
      start_times_json: JSON.stringify([{ weekdays: [2, 4], minutes: [h(12), h(16)] }]),
    });

    // Las 16:00 no salen: la sede cierra a las 14:00 y una hora fija no abre
    // nada por su cuenta, solo elige entre lo que ya está abierto.
    assert.deepEqual(await horasDe(addDays(monday, 1)), [h(12)]);
    assert.deepEqual(await horasDe(addDays(monday, 3)), [h(12)]);
  });

  it('horas fijas: los días que no están en la lista no ofrecen nada', async () => {
    await configurar({
      start_mode: 'fixed',
      start_times_json: JSON.stringify([{ weekdays: [2, 4], minutes: [h(12)] }]),
    });

    assert.deepEqual(await horasDe(monday), []);
    assert.deepEqual(await horasDe(addDays(monday, 2)), []);
  });

  it('horas fijas sin días marcados valen todos los días', async () => {
    await configurar({
      start_mode: 'fixed',
      start_times_json: JSON.stringify([{ weekdays: [], minutes: [h(10), h(11, 30)] }]),
    });

    assert.deepEqual(await horasDe(monday), [h(10), h(11, 30)]);
    assert.deepEqual(await horasDe(addDays(monday, 1)), [h(10), h(11, 30)]);
  });

  it('una hora fija que no cabe entera antes de cerrar no se ofrece', async () => {
    await configurar({
      start_mode: 'fixed',
      // 13:30 más 45 minutos se pasa de las 14:00.
      start_times_json: JSON.stringify([{ weekdays: [], minutes: [h(13), h(13, 30)] }]),
    });

    assert.deepEqual(await horasDe(monday), [h(13)]);
  });

  it('un JSON de horas ilegible deja el día sin huecos en vez de reventar', async () => {
    await configurar({ start_mode: 'fixed', start_times_json: 'esto no es json' });

    assert.deepEqual(await horasDe(monday), []);
  });

  /*
   * El personal mueve citas a mano a horas que no caen en ninguna rejilla, y
   * `isSlotFree` pide granularidad 1 justamente para no rechazarlas. Esa
   * petición manda sobre el modo del servicio: si no, un servicio de horas
   * fijas no dejaría mover una cita cinco minutos.
   */
  it('la rejilla que pide quien llama manda sobre el modo del servicio', async () => {
    await configurar({
      start_mode: 'fixed',
      start_times_json: JSON.stringify([{ weekdays: [], minutes: [h(12)] }]),
    });

    const result = await computeAvailability({
      organizationId: fixture.organizationId,
      serviceId,
      from: monday,
      granularityMinutes: 1,
    });

    const horas = result.days[0]!.slots.map((slot) => slot.localStartMinute);
    assert.ok(horas.includes(h(10, 7)), 'debería ofrecer también las 10:07');
  });
});
