import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import {
  callNext,
  changeQueueStatus,
  joinQueue,
  queueOf,
  ticketStatus,
} from '../src/modules/appointments/queue.ts';

/**
 * Cola sin cita previa.
 *
 * El orden de llegada es lo único que decide, y la espera estimada tiene que
 * salir de lo que hay delante, no de una promesa.
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
  await db.deleteFrom('queue_entries').execute();
  await ajustes({ walkInQueueEnabled: true, walkInPublicJoin: true, walkInDefaultMinutes: 20 });
});

async function ajustes(valores: Record<string, unknown>): Promise<void> {
  await db
    .updateTable('organizations')
    .set({ settings_json: JSON.stringify({ slotGranularityMinutes: 30, ...valores }) })
    .where('id', '=', fixture.organizationId)
    .execute();
}

const MOSTRADOR = { isStaff: true };

describe('apuntarse en la cola', () => {
  it('el primero se lleva el número uno', async () => {
    const turno = await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);

    assert.equal(turno.ticketNumber, 1);
  });

  it('el siguiente se lleva el número dos', async () => {
    await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    const segundo = await joinQueue(
      fixture.organizationId,
      { name: 'Bea', partySize: 1 },
      MOSTRADOR,
    );

    assert.equal(segundo.ticketNumber, 2);
  });

  it('el segundo tiene a uno delante', async () => {
    await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    const segundo = await joinQueue(
      fixture.organizationId,
      { name: 'Bea', partySize: 1 },
      MOSTRADOR,
    );

    assert.equal(segundo.ahead, 1);
  });

  /** La espera sale de lo que dura lo que hay delante, no de una promesa. */
  it('estima la espera con lo que hay por delante', async () => {
    await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    const segundo = await joinQueue(
      fixture.organizationId,
      { name: 'Bea', partySize: 1 },
      MOSTRADOR,
    );

    // Un solo recurso en la fixture y veinte minutos por turno sin servicio.
    assert.equal(segundo.estimatedWaitMinutes, 20);
  });

  it('el primero no espera nada', async () => {
    const turno = await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);

    assert.equal(turno.estimatedWaitMinutes, 0);
  });

  it('con la cola apagada no deja apuntar a nadie', async () => {
    await ajustes({ walkInQueueEnabled: false });

    await assert.rejects(
      joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR),
      /no está activa/,
    );
  });

  it('sin permiso para coger turno online, el cliente no se apunta solo', async () => {
    await ajustes({ walkInQueueEnabled: true, walkInPublicJoin: false });

    await assert.rejects(
      joinQueue(
        fixture.organizationId,
        { name: 'Ana', partySize: 1 },
        { userId: fixture.customerId, isStaff: false },
      ),
      /mostrador/,
    );
  });

  /** Apuntarse dos veces no adelanta el sitio de nadie y descuadra la espera. */
  it('una misma persona no coge dos turnos', async () => {
    await joinQueue(
      fixture.organizationId,
      { customerId: fixture.customerId, partySize: 1 },
      MOSTRADOR,
    );

    await assert.rejects(
      joinQueue(fixture.organizationId, { customerId: fixture.customerId, partySize: 1 }, MOSTRADOR),
      /ya tienes un turno/i,
    );
  });

  it('pide un nombre a quien no tiene cuenta', async () => {
    await assert.rejects(
      joinQueue(fixture.organizationId, { partySize: 1 }, MOSTRADOR),
      /nombre/,
    );
  });
});

describe('llamar y atender', () => {
  it('llama al que lleva más esperando', async () => {
    await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    await joinQueue(fixture.organizationId, { name: 'Bea', partySize: 1 }, MOSTRADOR);

    const llamado = await callNext(fixture.organizationId);

    assert.equal(llamado?.name, 'Ana');
  });

  it('con la cola vacía no llama a nadie', async () => {
    assert.equal(await callNext(fixture.organizationId), null);
  });

  it('quien ya ha sido llamado deja de contar en la espera', async () => {
    await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    const segundo = await joinQueue(
      fixture.organizationId,
      { name: 'Bea', partySize: 1 },
      MOSTRADOR,
    );
    await callNext(fixture.organizationId);

    const cola = await queueOf(fixture.organizationId);

    assert.equal(cola.waiting.find((item) => item.id === segundo.id)?.ahead, 0);
  });

  it('cerrar un turno lo saca de la espera', async () => {
    const turno = await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    await changeQueueStatus(fixture.organizationId, turno.id, 'done');

    const cola = await queueOf(fixture.organizationId);

    assert.equal(cola.waiting.length, 0);
  });

  it('el turno cerrado queda en el histórico del día', async () => {
    const turno = await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    await changeQueueStatus(fixture.organizationId, turno.id, 'done');

    const cola = await queueOf(fixture.organizationId);

    assert.equal(cola.closed.length, 1);
  });
});

describe('lo que ve el cliente', () => {
  it('consulta su turno por su identificador', async () => {
    const turno = await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);

    const estado = await ticketStatus(fixture.organizationId, turno.id);

    assert.equal(estado.ticketNumber, 1);
  });

  it('ve cuántos tiene delante', async () => {
    await joinQueue(fixture.organizationId, { name: 'Ana', partySize: 1 }, MOSTRADOR);
    const segundo = await joinQueue(
      fixture.organizationId,
      { name: 'Bea', partySize: 1 },
      MOSTRADOR,
    );

    const estado = await ticketStatus(fixture.organizationId, segundo.id);

    assert.equal(estado.ahead, 1);
  });
});
