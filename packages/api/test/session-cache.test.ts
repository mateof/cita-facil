import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { newId } from '../src/lib/ids.ts';
import { isoNow } from '../src/lib/dates.ts';
import { sessionState } from '../src/modules/auth/session-cache.ts';
import { revokeAllSessions, revokeSession } from '../src/modules/auth/tokens.ts';
import { isRedisEnabled, setRedisForTests, type CacheClient } from '../src/lib/redis.ts';

/**
 * Comprobación del estado de sesión.
 *
 * Estas pruebas corren **sin Redis**, que es la instalación por defecto: lo que
 * verifican es que sin caché el comportamiento sea el de siempre, consultando
 * la base de datos. Con Redis el resultado tiene que ser el mismo; lo único que
 * cambia es de dónde sale la respuesta.
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
  await db.deleteFrom('sessions').execute();
});

async function crearSesion(
  options: { expiresAt?: string; revoked?: boolean } = {},
): Promise<string> {
  const id = newId();
  await db
    .insertInto('sessions')
    .values({
      id,
      user_id: fixture.customerId,
      refresh_token_hash: `hash-${id}`,
      user_agent: null,
      ip: null,
      auth_method: 'password',
      mfa_satisfied: 0,
      expires_at: options.expiresAt ?? new Date(Date.now() + 86_400_000).toISOString(),
      revoked_at: options.revoked ? isoNow() : null,
      last_used_at: isoNow(),
      created_at: isoNow(),
    })
    .execute();
  return id;
}

describe('estado de la sesión', () => {
  it('sin Redis configurado, la caché queda desactivada', () => {
    assert.equal(isRedisEnabled(), false);
  });

  it('una sesión viva se considera activa', async () => {
    const id = await crearSesion();
    const estado = await sessionState(id);
    assert.equal(estado.active, true);
  });

  it('una sesión revocada no está activa', async () => {
    const id = await crearSesion({ revoked: true });
    const estado = await sessionState(id);
    assert.equal(estado.active, false);
  });

  it('una sesión caducada no está activa', async () => {
    const id = await crearSesion({ expiresAt: '2020-01-01T00:00:00.000Z' });
    const estado = await sessionState(id);
    assert.equal(estado.active, false);
  });

  it('una sesión que no existe no está activa', async () => {
    const estado = await sessionState(newId());
    assert.equal(estado.active, false);
  });

  /**
   * Lo importante de la caché: revocar tiene efecto en la siguiente petición,
   * no cuando caduque la entrada.
   */
  it('revocar la sesión se nota de inmediato', async () => {
    const id = await crearSesion();
    await sessionState(id);

    await revokeSession(id);

    assert.equal((await sessionState(id)).active, false);
  });

  it('revocar todas las sesiones deja fuera a las demás', async () => {
    const primera = await crearSesion();
    const segunda = await crearSesion();
    await sessionState(primera);
    await sessionState(segunda);

    await revokeAllSessions(fixture.customerId);

    assert.deepEqual(
      [(await sessionState(primera)).active, (await sessionState(segunda)).active],
      [false, false],
    );
  });

  it('revocar todas salvo una respeta la excluida', async () => {
    const conservada = await crearSesion();
    const otra = await crearSesion();

    await revokeAllSessions(fixture.customerId, conservada);

    assert.deepEqual(
      [(await sessionState(conservada)).active, (await sessionState(otra)).active],
      [true, false],
    );
  });
});

/**
 * Con Redis. Se usa un doble en memoria en lugar de levantar un servidor: lo
 * que hay que verificar es la lógica de la caché (que cachea, que la revocación
 * la borra y que un fallo del cliente no rompe nada), no el protocolo de Redis.
 */
describe('estado de la sesión con caché', () => {
  const almacen = new Map<string, string>();

  const doble: CacheClient = {
    async get(key) {
      return almacen.get(key) ?? null;
    },
    async set(key, value) {
      almacen.set(key, value);
    },
    async del(...keys) {
      for (const key of keys) almacen.delete(key);
    },
  };

  beforeEach(() => {
    almacen.clear();
    setRedisForTests(doble);
  });

  after(() => setRedisForTests(null));

  it('la caché queda activada', () => {
    assert.equal(isRedisEnabled(), true);
  });

  it('la segunda consulta se responde desde la caché', async () => {
    const id = await crearSesion();
    await sessionState(id);

    // Se revoca por detrás, sin pasar por `revokeSession`, que es lo que
    // borraría la entrada. Si respondiera la base de datos, saldría inactiva.
    await db.updateTable('sessions').set({ revoked_at: isoNow() }).where('id', '=', id).execute();

    assert.equal((await sessionState(id)).active, true);
  });

  it('revocar borra la entrada cacheada', async () => {
    const id = await crearSesion();
    await sessionState(id);

    await revokeSession(id);

    assert.equal((await sessionState(id)).active, false);
  });

  it('una sesión cacheada que caduca durante el TTL deja de valer', async () => {
    const id = await crearSesion({ expiresAt: new Date(Date.now() + 400).toISOString() });
    assert.equal((await sessionState(id)).active, true);

    await new Promise((resolve) => setTimeout(resolve, 600));

    assert.equal((await sessionState(id)).active, false);
  });

  it('si el cliente falla se responde desde la base de datos', async () => {
    setRedisForTests({
      get: async () => {
        throw new Error('Redis caído');
      },
      set: async () => {
        throw new Error('Redis caído');
      },
      del: async () => {
        throw new Error('Redis caído');
      },
    });

    const id = await crearSesion();
    assert.equal((await sessionState(id)).active, true);
  });
});
