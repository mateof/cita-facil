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
import {
  adjustWallet,
  balanceFor,
  eligibilityFor,
  grantPack,
  refundCredit,
} from '../src/modules/credits/service.ts';
import { cancelAppointment, createAppointment } from '../src/modules/appointments/service.ts';
import { localToInstant } from '../src/lib/dates.ts';

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
  await db.deleteFrom('credit_ledger').execute();
  await db.deleteFrom('credit_wallets').execute();
  await db.deleteFrom('credit_packs').execute();
  await db.deleteFrom('appointments').execute();
});

/** Hora concreta de un lunes laborable, para no depender del día que se ejecute. */
function slotAt(hour: number): string {
  return localToInstant(nextMonday(), hour * 60, fixture.timezone);
}

function reservar(hour: number, serviceId = fixture.creditServiceId) {
  return createAppointment(fixture.organizationId, {
    serviceId,
    locationId: fixture.locationId,
    customerId: fixture.customerId,
    startsAt: slotAt(hour),
  } as never);
}

describe('elegibilidad', () => {
  it('un servicio que no exige bono deja reservar sin saldo', async () => {
    const result = await eligibilityFor(fixture.organizationId, fixture.customerId, fixture.serviceId);
    assert.equal(result.required, false);
  });

  it('un servicio de bono no admite a quien no se ha identificado', async () => {
    const result = await eligibilityFor(fixture.organizationId, null, fixture.creditServiceId);
    assert.equal(result.reason, 'anonymous');
  });

  it('con saldo disponible, deja reservar', async () => {
    await seedCreditPack(db, fixture, { credits: 5, used: 2 });
    const result = await eligibilityFor(
      fixture.organizationId,
      fixture.customerId,
      fixture.creditServiceId,
    );
    assert.deepEqual(
      { allowed: result.allowed, available: result.available },
      { allowed: true, available: 3 },
    );
  });

  it('un bono de otro servicio no vale para este', async () => {
    await seedCreditPack(db, fixture, { serviceIds: [fixture.serviceId] });
    const result = await eligibilityFor(
      fixture.organizationId,
      fixture.customerId,
      fixture.creditServiceId,
    );
    assert.equal(result.reason, 'no_credits');
  });

  it('un bono sin servicios asignados vale para cualquiera', async () => {
    await seedCreditPack(db, fixture, { serviceIds: [] });
    const result = await eligibilityFor(
      fixture.organizationId,
      fixture.customerId,
      fixture.creditServiceId,
    );
    assert.equal(result.allowed, true);
  });

  it('un bono caducado no cuenta', async () => {
    await seedCreditPack(db, fixture, { expiresAt: '2020-01-01T00:00:00.000Z' });
    const result = await eligibilityFor(
      fixture.organizationId,
      fixture.customerId,
      fixture.creditServiceId,
    );
    assert.equal(result.available, 0);
  });

  it('un bono anulado no cuenta', async () => {
    await seedCreditPack(db, fixture, { cancelled: true });
    const result = await eligibilityFor(
      fixture.organizationId,
      fixture.customerId,
      fixture.creditServiceId,
    );
    assert.equal(result.available, 0);
  });

  it('un bono agotado no cuenta', async () => {
    await seedCreditPack(db, fixture, { credits: 3, used: 3 });
    const result = await eligibilityFor(
      fixture.organizationId,
      fixture.customerId,
      fixture.creditServiceId,
    );
    assert.equal(result.available, 0);
  });
});

describe('reserva con bono', () => {
  it('descuenta una sesión al reservar', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5 });
    await reservar(10);

    const wallet = await db
      .selectFrom('credit_wallets')
      .select('credits_used')
      .where('id', '=', walletId)
      .executeTakeFirstOrThrow();
    assert.equal(wallet.credits_used, 1);
  });

  it('deja la cita apuntando al bono del que salió la sesión', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);

    const row = await db
      .selectFrom('appointments')
      .select('credit_wallet_id')
      .where('id', '=', appointment.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.credit_wallet_id, walletId);
  });

  it('anota el consumo en el histórico del bono', async () => {
    await seedCreditPack(db, fixture, { credits: 5 });
    await reservar(10);

    const movements = await db.selectFrom('credit_ledger').selectAll().execute();
    assert.deepEqual(
      movements.map((row) => ({ delta: row.delta, reason: row.reason })),
      [{ delta: -1, reason: 'appointment' }],
    );
  });

  it('la cita queda pagada porque la sesión se cobró con el bono', async () => {
    await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);
    assert.equal(appointment.paymentStatus, 'paid');
  });

  it('sin saldo no deja reservar', async () => {
    await seedCreditPack(db, fixture, { credits: 2, used: 2 });
    await assert.rejects(() => reservar(10), /sesión de bono/i);
  });

  it('sin ningún bono no deja reservar', async () => {
    await assert.rejects(() => reservar(10), /sesión de bono/i);
  });

  it('el rechazo no deja la cita a medias', async () => {
    await seedCreditPack(db, fixture, { credits: 1, used: 1 });
    await reservar(10).catch(() => undefined);

    const appointments = await db.selectFrom('appointments').selectAll().execute();
    assert.equal(appointments.length, 0);
  });

  it('gasta primero el bono que antes caduca', async () => {
    const pronto = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const tarde = new Date(Date.now() + 90 * 86_400_000).toISOString();
    const { walletId: caducaPronto } = await seedCreditPack(db, fixture, { expiresAt: pronto });
    await seedCreditPack(db, fixture, { expiresAt: tarde });

    const { appointment } = await reservar(10);
    const row = await db
      .selectFrom('appointments')
      .select('credit_wallet_id')
      .where('id', '=', appointment.id)
      .executeTakeFirstOrThrow();
    assert.equal(row.credit_wallet_id, caducaPronto);
  });

  /**
   * El descuento va condicionado a que quede saldo en el propio `UPDATE`. Sin
   * eso, dos reservas a la vez leerían el mismo saldo y gastarían la misma
   * sesión, que es justo lo que este caso comprueba.
   */
  it('dos reservas simultáneas no gastan la misma última sesión', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 1 });

    const resultados = await Promise.allSettled([reservar(10), reservar(12)]);
    const conseguidas = resultados.filter((resultado) => resultado.status === 'fulfilled');

    const wallet = await db
      .selectFrom('credit_wallets')
      .select('credits_used')
      .where('id', '=', walletId)
      .executeTakeFirstOrThrow();
    assert.deepEqual(
      { reservas: conseguidas.length, consumidas: wallet.credits_used },
      { reservas: 1, consumidas: 1 },
    );
  });
});

describe('devolución', () => {
  it('cancelar la cita devuelve la sesión', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);

    await cancelAppointment(appointment.id, { notifyCustomer: false });

    const wallet = await db
      .selectFrom('credit_wallets')
      .select('credits_used')
      .where('id', '=', walletId)
      .executeTakeFirstOrThrow();
    assert.equal(wallet.credits_used, 0);
  });

  it('la devolución queda anotada en el histórico', async () => {
    await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);
    await cancelAppointment(appointment.id, { notifyCustomer: false });

    const devolucion = await db
      .selectFrom('credit_ledger')
      .selectAll()
      .where('delta', '>', 0)
      .executeTakeFirst();
    assert.equal(devolucion?.reason, 'cancel');
  });

  it('no devuelve dos veces la misma sesión', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5 });
    const { appointment } = await reservar(10);
    await cancelAppointment(appointment.id, { notifyCustomer: false });

    await refundCredit(appointment.id, 'cancel');

    const wallet = await db
      .selectFrom('credit_wallets')
      .select('credits_used')
      .where('id', '=', walletId)
      .executeTakeFirstOrThrow();
    assert.equal(wallet.credits_used, 0);
  });

  it('una cita sin bono no devuelve nada', async () => {
    const { appointment } = await reservar(10, fixture.serviceId);
    assert.equal(await refundCredit(appointment.id, 'cancel'), false);
  });
});

describe('gestión desde el panel', () => {
  it('emitir un bono deja saldo disponible', async () => {
    const { packId } = await seedCreditPack(db, fixture, { credits: 4 });
    await db.deleteFrom('credit_wallets').execute();

    await grantPack({
      organizationId: fixture.organizationId,
      userId: fixture.customerId,
      packId,
      source: 'admin',
      silent: true,
    });

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 4);
  });

  it('se puede emitir con una cantidad distinta a la del tipo de bono', async () => {
    const { packId } = await seedCreditPack(db, fixture, { credits: 4 });
    await db.deleteFrom('credit_wallets').execute();

    const wallet = await grantPack({
      organizationId: fixture.organizationId,
      userId: fixture.customerId,
      packId,
      credits: 12,
      source: 'admin',
      silent: true,
    });
    assert.equal(wallet.total, 12);
  });

  it('añadir sesiones sube el saldo', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5, used: 1 });
    const wallet = await adjustWallet(fixture.organizationId, walletId, { delta: 3 }, null);
    assert.equal(wallet.remaining, 7);
  });

  it('no se pueden retirar sesiones ya consumidas', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5, used: 4 });
    await assert.rejects(
      () => adjustWallet(fixture.organizationId, walletId, { delta: -3 }, null),
      /consumidas/i,
    );
  });

  it('anular un bono lo deja fuera del saldo', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5 });
    await adjustWallet(fixture.organizationId, walletId, { cancelled: true }, null);

    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.equal(balance.available, 0);
  });

  it('un bono anulado se puede reactivar', async () => {
    const { walletId } = await seedCreditPack(db, fixture, { credits: 5, cancelled: true });
    const wallet = await adjustWallet(fixture.organizationId, walletId, { cancelled: false }, null);
    assert.equal(wallet.status, 'active');
  });

  it('solo se ofrecen para comprar los bonos con venta online', async () => {
    await seedCreditPack(db, fixture, { onlinePurchase: false });
    const balance = await balanceFor(fixture.organizationId, fixture.customerId);
    assert.deepEqual(balance.packsForSale, []);
  });
});
