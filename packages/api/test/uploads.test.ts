import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { colorFor, initialsOf, resolveAvatar } from '@cita-facil/shared';

/**
 * Imágenes de las entidades.
 *
 * Lo que se comprueba del guardado es sobre todo lo que no debe entrar: un
 * fichero que dice ser PNG pero no lo es, un SVG (que puede llevar scripts y se
 * serviría desde nuestro propio dominio) y cualquier intento de escribir fuera
 * de la carpeta.
 */

let directory: string;

before(async () => {
  // El módulo lee la configuración al importarse, así que la carpeta se fija
  // antes del primer `import`.
  directory = await mkdtemp(join(tmpdir(), 'cita-facil-uploads-'));
  process.env.DATA_DIR = directory;
});

after(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** PNG de 1x1 de verdad: la comprobación mira los primeros bytes. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001',
  'hex',
);

describe('guardar una imagen', () => {
  it('acepta un PNG y devuelve su dirección', async () => {
    const { saveUpload } = await import('../src/modules/uploads/service.ts');
    const guardado = await saveUpload({ scope: 'org1', bytes: PNG });

    assert.match(guardado.url, /^\/api\/v1\/uploads\/org1\/[a-z0-9]+\.png$/);
  });

  it('el fichero queda escrito en la carpeta de la organización', async () => {
    const { saveUpload } = await import('../src/modules/uploads/service.ts');
    await saveUpload({ scope: 'org2', bytes: PNG });

    const ficheros = await readdir(join(directory, 'uploads', 'org2'));
    assert.equal(ficheros.length, 1);
  });

  it('se puede volver a leer lo guardado', async () => {
    const { readUpload, saveUpload } = await import('../src/modules/uploads/service.ts');
    const guardado = await saveUpload({ scope: 'org3', bytes: PNG });

    const leido = await readUpload(guardado.path);
    assert.deepEqual(leido.bytes, PNG);
  });

  it('rechaza un fichero que dice ser PNG pero no lo es', async () => {
    const { saveUpload } = await import('../src/modules/uploads/service.ts');
    await assert.rejects(
      () => saveUpload({ scope: 'org4', bytes: Buffer.from('esto es texto') }),
      /PNG, JPEG, WebP o GIF/,
    );
  });

  /** Un SVG es un documento con scripts, servido desde nuestro propio dominio. */
  it('rechaza un SVG', async () => {
    const { saveUpload } = await import('../src/modules/uploads/service.ts');
    await assert.rejects(
      () => saveUpload({ scope: 'org5', bytes: Buffer.from('<svg><script>alert(1)</script></svg>') }),
      /PNG, JPEG, WebP o GIF/,
    );
  });

  it('rechaza un fichero vacío', async () => {
    const { saveUpload } = await import('../src/modules/uploads/service.ts');
    await assert.rejects(() => saveUpload({ scope: 'org6', bytes: Buffer.alloc(0) }), /vacío/);
  });

  it('rechaza una imagen de más de 2 MB', async () => {
    const { saveUpload } = await import('../src/modules/uploads/service.ts');
    const grande = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    await assert.rejects(() => saveUpload({ scope: 'org7', bytes: grande }), /2 MB/);
  });

  it('rechaza un destino con caracteres raros', async () => {
    const { saveUpload } = await import('../src/modules/uploads/service.ts');
    await assert.rejects(() => saveUpload({ scope: '../fuera', bytes: PNG }), /Destino/);
  });
});

describe('leer una imagen', () => {
  it('no admite salirse de la carpeta', async () => {
    const { readUpload } = await import('../src/modules/uploads/service.ts');
    await assert.rejects(() => readUpload('../../cita-facil.sqlite'), /no existe/);
  });

  it('no admite una ruta sin carpeta', async () => {
    const { readUpload } = await import('../src/modules/uploads/service.ts');
    await assert.rejects(() => readUpload('suelto.png'), /no existe/);
  });

  it('falla si el fichero no está', async () => {
    const { readUpload } = await import('../src/modules/uploads/service.ts');
    await assert.rejects(() => readUpload('org1/noexiste.png'), /no existe/);
  });
});

describe('borrar una imagen', () => {
  it('la quita de la carpeta', async () => {
    const { deleteUpload, readUpload, saveUpload } = await import(
      '../src/modules/uploads/service.ts'
    );
    const guardado = await saveUpload({ scope: 'org8', bytes: PNG });

    await deleteUpload(guardado.path);

    await assert.rejects(() => readUpload(guardado.path), /no existe/);
  });

  it('no se queja si ya no estaba', async () => {
    const { deleteUpload } = await import('../src/modules/uploads/service.ts');
    await deleteUpload('org8/yaborrada.png');
  });
});

describe('iniciales de una entidad', () => {
  it('toma la primera letra de las dos primeras palabras', () => {
    assert.equal(initialsOf('Peluquería Ejemplo'), 'PE');
  });

  it('se salta las preposiciones', () => {
    assert.equal(initialsOf('Corte de pelo'), 'CP');
  });

  it('con una sola palabra usa sus dos primeras letras', () => {
    assert.equal(initialsOf('Sede'), 'SE');
  });

  it('devuelve un interrogante si no hay nombre', () => {
    assert.equal(initialsOf('   '), '?');
  });
});

describe('color de respaldo', () => {
  it('el mismo nombre da siempre el mismo color', () => {
    assert.equal(colorFor('Peluquería Ejemplo'), colorFor('Peluquería Ejemplo'));
  });

  it('nombres distintos no tienen por qué compartirlo', () => {
    const colores = new Set(['Corte de pelo', 'Gimnasio', 'Cabina', 'Masaje'].map(colorFor));
    assert.ok(colores.size > 1);
  });
});

describe('qué se pinta', () => {
  it('la imagen manda sobre todo lo demás', () => {
    const resultado = resolveAvatar('Corte', { imageUrl: '/api/v1/uploads/a/b.png', icon: 'scissors' });
    assert.equal(resultado.kind, 'image');
  });

  it('sin imagen se pinta el icono', () => {
    const resultado = resolveAvatar('Corte', { icon: 'scissors' });
    assert.equal(resultado.kind, 'icon');
  });

  it('sin imagen ni icono se pintan las iniciales', () => {
    const resultado = resolveAvatar('Corte de pelo', null);
    assert.deepEqual(
      { kind: resultado.kind, initials: (resultado as { initials: string }).initials },
      { kind: 'initials', initials: 'CP' },
    );
  });

  it('el color elegido gana al calculado', () => {
    const resultado = resolveAvatar('Corte', { color: '#123456' });
    assert.equal((resultado as { color: string }).color, '#123456');
  });
});
