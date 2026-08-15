import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import {
  closeTestDatabase,
  createTestDatabase,
  nextMonday,
  seedCreditPack,
  seedFixture,
  type Fixture,
} from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { balanceFor, grantPack } from '../src/modules/credits/service.ts';
import { countPendingDebts } from '../src/modules/credits/debts.ts';
import {
  cancelAppointment,
  changeStatus,
  createAppointment,
} from '../src/modules/appointments/service.ts';
import { INHERIT, effectiveRules } from '../src/modules/appointments/rules.ts';
import { localToInstant } from '../src/lib/dates.ts';

/**
 * Cuándo se cobra el bono, sesiones a deber y plazos heredados.
 *
 * Los tres se apoyan en lo mismo: un servicio puede seguir la norma de su
 * organización o llevar la suya, y `null` (heredar) no es lo mismo que cero
 * (sin límite).
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
  await db.deleteFrom('credit_debts').execute();
  await db.deleteFrom('credit_ledger').execute();
  await db.deleteFrom('credit_wallets').execute();
  await db.deleteFrom('credit_packs').execute();
  await db.deleteFrom('appointments').execute();
  await ajustes({});
  await db
    .updateTable('services')
    .set({ credit_charge_mode: 'inherit' })
    .where('id', '=', fixture.creditServiceId)
    .execute();
});

/** Deja los ajustes de la organización tal cual se le pasen. */
async function ajustes(valores: Record<string, unknown>): Promise<void> {
  await db
    .updateTable('organizations')
    .set({
      settings_json: JSON.stringify({
        slotGranularityMinutes: 30,
        holdMinutes: 10,
        ...valores,
      }),
    })
    .where('id', '=', fixture.organizationId)
    .execute();
}

function slotAt(hour: number): string {
  return localToInstant(nextMonday(), hour * 60, fixture.timezone);
}

function reservar(hour: number) {
  return createAppointment(fixture.organizationId, {
    serviceId: fixture.creditServiceId,
    locationId: fixture.locationId,
    customerId: fixture.customerId,
    startsAt: slotAt(hour),
  } as never);
}

describe('cuándo se descuenta la sesión', () => {
  it('con la norma de siempre, se descuenta al reservar', async () => {
    await seedCreditPack(db, fixture, { credits: 5 });
    await reservar(10);

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 4);
  });

  it('con cobro al completar, reservar no descuenta nada', async () => {
    await ajustes({ creditChargeMode: 'completion' });
    await seedCreditPack(db, fixture, { credits: 5 });
    await reservar(10);

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 5);
  });

  it('con cobro al completar, la sesión se descuenta al dar la cita por hecha', async () => {
    await ajustes({ creditChargeMode: 'completion' });
    await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);

    await changeStatus(appointment.id, 'completed', { isStaff: true });

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 4);
  });

  /** No presentarse no puede salir más barato que venir. */
  it('con cobro al completar, una falta también se cobra', async () => {
    await ajustes({ creditChargeMode: 'completion' });
    await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);

    await changeStatus(appointment.id, 'no_show', { isStaff: true });

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 4);
  });

  it('con cobro al completar, cancelar antes no descuenta nada', async () => {
    await ajustes({ creditChargeMode: 'completion' });
    await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);

    await cancelAppointment(appointment.id, {}, { isStaff: true });

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 5);
  });

  it('el servicio puede llevar la contraria a su organización', async () => {
    await ajustes({ creditChargeMode: 'completion' });
    await db
      .updateTable('services')
      .set({ credit_charge_mode: 'booking' })
      .where('id', '=', fixture.creditServiceId)
      .execute();
    await seedCreditPack(db, fixture, { credits: 5 });

    await reservar(10);

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 4);
  });
});

describe('sesiones a deber', () => {
  it('sin saldo y sin permiso, no se puede reservar', async () => {
    await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    await assert.rejects(() => reservar(10), /sesión de bono/i);
  });

  it('sin saldo pero con permiso, la cita se crea', async () => {
    await ajustes({ allowCreditDebt: true, maxCreditDebt: 2 });
    await seedCreditPack(db, fixture, { credits: 1, used: 1 });

    const { appointment } = await reservar(10);
    assert.equal(appointment.status, 'confirmed');
  });

  it('esa reserva queda anotada como sesión a deber', async () => {
    await ajustes({ allowCreditDebt: true, maxCreditDebt: 2 });
    await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    await reservar(10);

    assert.equal(await countPendingDebts(fixture.organizationId, fixture.customerId), 1);
  });

  it('al llegar al tope ya no se puede reservar más', async () => {
    await ajustes({ allowCreditDebt: true, maxCreditDebt: 1 });
    await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    await reservar(10);

    await assert.rejects(() => reservar(12), /sesión de bono/i);
  });

  it('comprar un bono salda lo que se debía', async () => {
    await ajustes({ allowCreditDebt: true, maxCreditDebt: 2 });
    const { packId } = await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    await reservar(10);

    await grantPack({
      organizationId: fixture.organizationId,
      userId: fixture.customerId,
      packId,
      credits: 5,
      source: 'admin',
      silent: true,
    });

    assert.equal(await countPendingDebts(fixture.organizationId, fixture.customerId), 0);
  });

  it('la sesión saldada sale del bono nuevo', async () => {
    await ajustes({ allowCreditDebt: true, maxCreditDebt: 2 });
    const { packId } = await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    await reservar(10);

    await grantPack({
      organizationId: fixture.organizationId,
      userId: fixture.customerId,
      packId,
      credits: 5,
      source: 'admin',
      silent: true,
    });

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 4);
  });

  it('cancelar la cita anula la deuda sin cobrarla', async () => {
    await ajustes({ allowCreditDebt: true, maxCreditDebt: 2 });
    await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    const { appointment } = await reservar(10);

    await cancelAppointment(appointment.id, {}, { isStaff: true });

    assert.equal(await countPendingDebts(fixture.organizationId, fixture.customerId), 0);
  });

  it('lo que se debe no se cobra dos veces si se compran dos bonos', async () => {
    await ajustes({ allowCreditDebt: true, maxCreditDebt: 2 });
    const { packId } = await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    await reservar(10);

    for (const _ of [1, 2]) {
      await grantPack({
        organizationId: fixture.organizationId,
        userId: fixture.customerId,
        packId,
        credits: 5,
        source: 'admin',
        silent: true,
      });
    }

    // 10 sesiones nuevas menos la que se debía.
    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 9);
  });
});

describe('plazos heredados', () => {
  const servicio = (min: number | null, cancel: number | null) => ({
    min_advance_minutes: min,
    cancellation_cutoff_minutes: cancel,
    credit_charge_mode: 'inherit',
  });

  it('sin valor propio, el servicio toma el de la organización', () => {
    const reglas = effectiveRules(servicio(null, null), { cancellationCutoffMinutes: 120 });
    assert.equal(reglas.cancellationCutoffMinutes, 120);
  });

  /** Cero es una decisión explícita: este servicio no pide antelación. */
  it('cero en el servicio significa sin límite, no heredar', () => {
    const reglas = effectiveRules(servicio(0, 0), { cancellationCutoffMinutes: 120 });
    assert.equal(reglas.cancellationCutoffMinutes, 0);
  });

  it('el valor del servicio manda sobre el de la organización', () => {
    const reglas = effectiveRules(servicio(null, 30), { cancellationCutoffMinutes: 120 });
    assert.equal(reglas.cancellationCutoffMinutes, 30);
  });

  it('sin nada configurado no hay límite', () => {
    const reglas = effectiveRules(servicio(null, null), {});
    assert.equal(reglas.cancellationCutoffMinutes, 0);
  });

  it('el modo de cobro también se hereda', () => {
    const reglas = effectiveRules(servicio(null, null), { creditChargeMode: 'completion' });
    assert.equal(reglas.creditChargeMode, 'completion');
  });
});

describe('cancelar fuera de plazo', () => {
  it('la organización puede fijar el plazo para todos sus servicios', async () => {
    await ajustes({ cancellationCutoffMinutes: 525_600 });
    await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);

    await assert.rejects(
      () => cancelAppointment(appointment.id, {}, { isStaff: false, userId: fixture.customerId }),
      /antelación/i,
    );
  });

  it('un servicio sin límite se puede cancelar aunque la organización lo pida', async () => {
    await ajustes({ cancellationCutoffMinutes: 525_600 });
    await db
      .updateTable('services')
      .set({ cancellation_cutoff_minutes: 0 })
      .where('id', '=', fixture.creditServiceId)
      .execute();
    await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);

    const cancelada = await cancelAppointment(
      appointment.id,
      {},
      { isStaff: false, userId: fixture.customerId },
    );
    assert.equal(cancelada.status, 'cancelled');

    // Se devuelve a "heredar" para no condicionar a las demás pruebas.
    await db
      .updateTable('services')
      .set({ cancellation_cutoff_minutes: INHERIT })
      .where('id', '=', fixture.creditServiceId)
      .execute();
  });
});
