import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import {
  THEME_PRESETS,
  defaultThemeTokens,
  sanitizeCustomCss,
  themeToCssVariables,
} from '@cita-facil/shared';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import {
  activateTheme,
  activeTheme,
  copyPreset,
  createTheme,
  deactivateThemes,
  exportTheme,
  importTheme,
  listThemes,
  updateTheme,
} from '../src/modules/themes/service.ts';

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
  await db.deleteFrom('themes').execute();
});

const nuevo = (nombre = 'Mi tema') => ({
  name: nombre,
  description: null,
  tokens: { brand: '#ff0000' },
  customCss: null,
  header: null,
});

describe('temas de una organización', () => {
  it('un tema nuevo no se aplica hasta que se activa', async () => {
    const tema = await createTheme(fixture.organizationId, nuevo(), null);
    assert.equal(tema.active, false);
  });

  it('los ajustes que no se tocan salen de los valores por defecto', async () => {
    const tema = await createTheme(fixture.organizationId, nuevo(), null);
    assert.equal(tema.tokens.surface, defaultThemeTokens().surface);
  });

  it('activar un tema lo deja como el de la organización', async () => {
    const tema = await createTheme(fixture.organizationId, nuevo(), null);
    await activateTheme(fixture.organizationId, tema.id, null);

    const enUso = await activeTheme(fixture.organizationId);
    assert.equal(enUso?.id, tema.id);
  });

  /** Dos temas activos harían que la página pública eligiera al azar. */
  it('activar otro desactiva el anterior', async () => {
    const primero = await createTheme(fixture.organizationId, nuevo('Primero'), null);
    const segundo = await createTheme(fixture.organizationId, nuevo('Segundo'), null);

    await activateTheme(fixture.organizationId, primero.id, null);
    await activateTheme(fixture.organizationId, segundo.id, null);

    const activos = (await listThemes(fixture.organizationId)).filter((tema) => tema.active);
    assert.deepEqual(
      activos.map((tema) => tema.id),
      [segundo.id],
    );
  });

  it('se puede volver al aspecto de serie', async () => {
    const tema = await createTheme(fixture.organizationId, nuevo(), null);
    await activateTheme(fixture.organizationId, tema.id, null);

    await deactivateThemes(fixture.organizationId);

    assert.equal(await activeTheme(fixture.organizationId), null);
  });

  it('el CSS propio se guarda ya limpio', async () => {
    const tema = await createTheme(
      fixture.organizationId,
      { ...nuevo(), customCss: '@import url(https://ajeno.example/x.css); .a { color: red }' },
      null,
    );
    assert.ok(!tema.customCss?.includes('@import'));
  });

  it('editar cambia solo lo que se manda', async () => {
    const tema = await createTheme(fixture.organizationId, nuevo(), null);
    const editado = await updateTheme(
      fixture.organizationId,
      tema.id,
      { name: 'Otro nombre' },
      null,
    );

    assert.deepEqual(
      { nombre: editado.name, marca: editado.tokens.brand },
      { nombre: 'Otro nombre', marca: '#ff0000' },
    );
  });
});

describe('llevar un tema de un sitio a otro', () => {
  it('lo exportado se puede volver a importar', async () => {
    const tema = await createTheme(fixture.organizationId, nuevo('Para exportar'), null);
    const fichero = await exportTheme(fixture.organizationId, tema.id);

    const importado = await importTheme(fixture.organizationId, fichero, null);

    assert.equal(importado.tokens.brand, '#ff0000');
  });

  it('el fichero exportado dice qué formato es', async () => {
    const tema = await createTheme(fixture.organizationId, nuevo(), null);
    const fichero = await exportTheme(fixture.organizationId, tema.id);

    assert.equal(fichero.format, 'cita-facil-theme');
  });

  /**
   * Un tema exportado por una versión más nueva puede traer ajustes que aquí
   * no existen. Se descartan en vez de rechazar el fichero entero.
   */
  it('al importar se descartan los ajustes desconocidos', async () => {
    const importado = await importTheme(
      fixture.organizationId,
      {
        format: 'cita-facil-theme',
        version: 1,
        name: 'Del futuro',
        tokens: { brand: '#00ff00', ajusteQueNoExiste: 'lo que sea' },
      } as never,
      null,
    );

    assert.equal('ajusteQueNoExiste' in importado.tokens, false);
  });

  it('al importar se conserva lo que sí se reconoce', async () => {
    const importado = await importTheme(
      fixture.organizationId,
      {
        format: 'cita-facil-theme',
        version: 1,
        name: 'Del futuro',
        tokens: { brand: '#00ff00', ajusteQueNoExiste: 'lo que sea' },
      } as never,
      null,
    );

    assert.equal(importado.tokens.brand, '#00ff00');
  });

  it('copiar un ejemplo deja un tema propio y editable', async () => {
    const copia = await copyPreset(fixture.organizationId, 'night', null);
    assert.equal(copia.organizationId, fixture.organizationId);
  });

  it('copiar un ejemplo que no existe falla', async () => {
    await assert.rejects(() => copyPreset(fixture.organizationId, 'inventado', null), /no existe/);
  });
});

describe('traducción a variables CSS', () => {
  it('los colores pasan tal cual', () => {
    const variables = themeToCssVariables({ ...defaultThemeTokens(), brand: '#123456' });
    assert.equal(variables['--brand'], '#123456');
  });

  /** Se guarda `serif`, no la pila entera: así se puede cambiar sin migrar. */
  it('la familia tipográfica se resuelve a una pila de fuentes', () => {
    const variables = themeToCssVariables({ ...defaultThemeTokens(), fontFamily: 'serif' });
    assert.match(variables['--tema-fuente']!, /Georgia/);
  });

  it('la sombra se resuelve a su valor CSS', () => {
    const variables = themeToCssVariables({ ...defaultThemeTokens(), shadow: 'none' });
    assert.equal(variables['--tema-sombra'], 'none');
  });

  it('un ajuste que falta usa su valor por defecto', () => {
    const variables = themeToCssVariables({});
    assert.equal(variables['--brand'], '#2563eb');
  });
});

describe('limpieza del CSS propio', () => {
  it('quita los @import', () => {
    assert.equal(sanitizeCustomCss('@import url(https://ajeno.example/a.css);'), '');
  });

  /** Una imagen externa delataría a quién visita la página y cuándo. */
  it('quita las imágenes de otros servidores', () => {
    const limpio = sanitizeCustomCss('.a { background: url(https://ajeno.example/pixel.png) }');
    assert.ok(!limpio.includes('ajeno.example'));
  });

  it('deja pasar las imágenes subidas a la aplicación', () => {
    const limpio = sanitizeCustomCss('.a { background: url(/api/v1/uploads/org/x.png) }');
    assert.ok(limpio.includes('/api/v1/uploads/org/x.png'));
  });

  it('deja pasar las imágenes incrustadas', () => {
    const limpio = sanitizeCustomCss('.a { background: url(data:image/png;base64,AAAA) }');
    assert.ok(limpio.includes('data:image/png'));
  });

  it('no se puede colar un @import dentro de un comentario', () => {
    const limpio = sanitizeCustomCss('/* @im*/@import url(https://ajeno.example/a.css);');
    assert.ok(!limpio.includes('ajeno.example'));
  });

  it('quita expression() de los navegadores viejos', () => {
    const limpio = sanitizeCustomCss('.a { width: expression(alert(1)) }');
    assert.ok(!limpio.includes('expression'));
  });

  it('el resto del CSS se conserva', () => {
    const limpio = sanitizeCustomCss('.tarjeta { border-radius: 2rem; }');
    assert.equal(limpio, '.tarjeta { border-radius: 2rem; }');
  });

  it('corta el CSS demasiado largo', () => {
    const limpio = sanitizeCustomCss('a'.repeat(30_000));
    assert.ok(limpio.length <= 20_000);
  });
});

describe('temas de ejemplo', () => {
  it('todos traen los ajustes del catálogo completos', () => {
    const claves = Object.keys(defaultThemeTokens()).sort();
    for (const preset of THEME_PRESETS) {
      assert.deepEqual(Object.keys(preset.tokens).sort(), claves, preset.key);
    }
  });

  it('cada ejemplo tiene una clave distinta', () => {
    const claves = THEME_PRESETS.map((preset) => preset.key);
    assert.equal(new Set(claves).size, claves.length);
  });
});
