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
import { createAppointment, changeStatus } from '../src/modules/appointments/service.ts';
import {
  confirmAttendance,
  declineAttendance,
  noShowFeeFor,
} from '../src/modules/appointments/attendance.ts';
import { requireAppointmentDetail } from '../src/modules/appointments/queries.ts';
import { localToInstant } from '../src/lib/dates.ts';

/**
 * Confirmación de asistencia y cargo por falta.
 *
 * La regla que se comprueba una y otra vez aquí es la misma: avisar siempre se
 * puede, y lo que decide el plazo no es si se admite el aviso, sino si se
 * cobra.
 */

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

beforeEach(async () => {
  await db.deleteFrom('appointments').execute();
  await ajustes({});
  await db
    .updateTable('services')
    .set({ no_show_fee_cents: -1 })
    .where('id', '=', fixture.serviceId)
    .execute();
});

/** Deja los ajustes de la organización tal cual se le pasen. */
async function ajustes(valores: Record<string, unknown>): Promise<void> {
  await db
    .updateTable('organizations')
    .set({ settings_json: JSON.stringify({ slotGranularityMinutes: 30, ...valores }) })
    .where('id', '=', fixture.organizationId)
    .execute();
}

/** Reserva a una hora concreta del próximo lunes. */
async function reservar(hour: number) {
  const { appointment } = await createAppointment(
    fixture.organizationId,
    { serviceId: fixture.serviceId, startsAt: localToInstant(monday, hour * 60, fixture.timezone), partySize: 1 },
    { userId: fixture.customerId, isStaff: false },
  );
  return appointment;
}

describe('confirmación de asistencia', () => {
  it('deja anotado que el cliente dijo que iba a ir', async () => {
    const cita = await reservar(9);

    const confirmada = await confirmAttendance(cita.accessCode);

    assert.ok(confirmada.attendanceConfirmedAt);
  });

  it('no cambia el estado de la cita', async () => {
    const cita = await reservar(10);

    const confirmada = await confirmAttendance(cita.accessCode);

    assert.equal(confirmada.status, 'confirmed');
  });

  it('rechaza confirmar una cita ya cerrada', async () => {
    const cita = await reservar(11);
    await changeStatus(cita.id, 'cancelled', { isStaff: true });

    await assert.rejects(confirmAttendance(cita.accessCode), /cerrada/);
  });
});

describe('aviso de que no se puede acudir', () => {
  it('cancela la cita', async () => {
    const cita = await reservar(9);

    const { appointment } = await declineAttendance(cita.accessCode);

    assert.equal(appointment.status, 'cancelled');
  });

  /**
   * Es la decisión de fondo: cerrarle la puerta a quien avisa tarde solo
   * consigue que no avise, y una silla vacía sin aviso es peor que una
   * cancelación tardía.
   */
  it('deja avisar aunque el plazo de cancelación ya haya pasado', async () => {
    await ajustes({ cancellationCutoffMinutes: 100_000 });
    const cita = await reservar(10);

    const { appointment } = await declineAttendance(cita.accessCode);

    assert.equal(appointment.status, 'cancelled');
  });

  it('marca el aviso como fuera de plazo', async () => {
    await ajustes({ cancellationCutoffMinutes: 100_000 });
    const cita = await reservar(11);

    const { late } = await declineAttendance(cita.accessCode);

    assert.equal(late, true);
  });

  it('no cobra nada a quien avisa dentro de plazo', async () => {
    await ajustes({ cancellationCutoffMinutes: 60, noShowFeeCents: 500 });
    const cita = await reservar(12);

    const { feeCents } = await declineAttendance(cita.accessCode);

    assert.equal(feeCents, 0);
  });

  it('cobra el cargo a quien avisa fuera de plazo', async () => {
    await ajustes({ cancellationCutoffMinutes: 100_000, noShowFeeCents: 500 });
    const cita = await reservar(13);

    const { feeCents } = await declineAttendance(cita.accessCode);

    assert.equal(feeCents, 500);
  });
});

describe('cargo por falta', () => {
  it('se anota en la cita al marcar la falta', async () => {
    await ajustes({ noShowFeeCents: 800 });
    const cita = await reservar(9);
    await changeStatus(cita.id, 'no_show', { isStaff: true });

    const despues = await requireAppointmentDetail(cita.id);

    assert.equal(despues.noShowFeeCents, 800);
  });

  it('deja el pago pendiente', async () => {
    await ajustes({ noShowFeeCents: 800 });
    const cita = await reservar(10);
    await changeStatus(cita.id, 'no_show', { isStaff: true });

    const despues = await requireAppointmentDetail(cita.id);

    assert.equal(despues.paymentStatus, 'pending');
  });

  /** La señal ya cobrada es justo lo que cubre la falta. */
  it('no cobra dos veces a quien ya había pagado', async () => {
    await ajustes({ noShowFeeCents: 800 });
    const cita = await reservar(11);
    await db
      .updateTable('appointments')
      .set({ payment_status: 'paid' })
      .where('id', '=', cita.id)
      .execute();
    await changeStatus(cita.id, 'no_show', { isStaff: true });

    const despues = await requireAppointmentDetail(cita.id);

    assert.equal(despues.noShowFeeCents, 0);
  });

  it('el servicio manda sobre la organización', async () => {
    await ajustes({ noShowFeeCents: 800 });
    await db
      .updateTable('services')
      .set({ no_show_fee_cents: 200 })
      .where('id', '=', fixture.serviceId)
      .execute();
    const cita = await reservar(12);

    assert.equal(await noShowFeeFor(cita), 200);
  });

  /** Cero es una decisión explícita del servicio, no un "sin configurar". */
  it('un servicio que no cobra faltas no cobra aunque su organización sí', async () => {
    await ajustes({ noShowFeeCents: 800 });
    await db
      .updateTable('services')
      .set({ no_show_fee_cents: 0 })
      .where('id', '=', fixture.serviceId)
      .execute();
    const cita = await reservar(13);

    assert.equal(await noShowFeeFor(cita), 0);
  });
});
