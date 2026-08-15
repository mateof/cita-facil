import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';

let db: Kysely<Database>;
let fixture: Fixture;
let directory: string;

before(async () => {
  // El directorio de copias se fija antes de cargar el módulo, porque lee la
  // configuración al importarse.
  directory = await mkdtemp(join(tmpdir(), 'cita-facil-backups-'));
  process.env.BACKUP_DIR = directory;
  process.env.DATA_DIR = directory;

  db = await createTestDatabase();
  fixture = await seedFixture(db);
});

after(async () => {
  await closeTestDatabase(db);
  await rm(directory, { recursive: true, force: true });
});

describe('copias de seguridad', () => {
  it('crea una copia con contenido', async () => {
    const { createBackup } = await import('../src/modules/backups/service.ts');
    const record = await createBackup({ trigger: 'manual' });

    assert.equal(record.status, 'completed');
    assert.ok(record.sizeBytes > 0);
    assert.ok(record.checksum);
  });

  it('restaura los datos tras vaciar las tablas', async () => {
    const { createBackup, restoreBackup } = await import('../src/modules/backups/service.ts');

    const before = await db
      .selectFrom('services')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();

    const record = await createBackup({ trigger: 'manual' });
    const result = await restoreBackup(record.filename, { truncate: true });

    assert.ok(result.rows > 0);

    const after = await db
      .selectFrom('services')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .executeTakeFirstOrThrow();

    assert.equal(Number(after.total), Number(before.total));
  });

  it('conserva los identificadores originales', async () => {
    const { createBackup, restoreBackup } = await import('../src/modules/backups/service.ts');

    const record = await createBackup({ trigger: 'manual' });
    await restoreBackup(record.filename, { truncate: true });

    const service = await db
      .selectFrom('services')
      .select(['id', 'name'])
      .where('id', '=', fixture.serviceId)
      .executeTakeFirst();

    assert.equal(service?.name, 'Consulta');
  });

  it('rechaza un nombre de fichero con salto de directorio', async () => {
    const { restoreBackup } = await import('../src/modules/backups/service.ts');
    await assert.rejects(restoreBackup('../../etc/passwd'), /no válido|no existe/i);
  });
});

describe('imágenes en la copia', () => {
  /** Viven en el disco, no en la base de datos: sin esto se perderían. */
  it('una copia restaurada devuelve las imágenes de las entidades', async () => {
    const { saveUpload, readUpload, deleteUpload } = await import(
      '../src/modules/uploads/service.ts'
    );
    const { createBackup, restoreBackup } = await import('../src/modules/backups/service.ts');
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001',
      'hex',
    );

    const guardada = await saveUpload({ scope: 'copias', bytes: png });
    const copia = await createBackup({ trigger: 'manual' });
    await deleteUpload(guardada.path);

    // Con `truncate` para no chocar con las filas que ya están.
    await restoreBackup(copia.filename, { truncate: true });

    const recuperada = await readUpload(guardada.path);
    assert.deepEqual(recuperada.bytes, png);
  });
});
