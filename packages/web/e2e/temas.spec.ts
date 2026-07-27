import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * Temas de la organización.
 *
 * Lo que importa comprobar es que lo que se configura en el panel se ve en la
 * página pública, que el panel no cambia de aspecto por ello y que el CSS
 * propio no puede pedirle nada a un servidor ajeno.
 */

/** Deja la organización sin tema, que es como estaba antes de cada prueba. */
async function limpiarTemas(request: APIRequestContext): Promise<void> {
  const token = await tokenDe(request, CUENTAS.admin);
  const cabeceras = { authorization: `Bearer ${token}` };
  const organizacion = await organizacionId(request);

  const temas = (await (
    await request.get(`/api/v1/organizations/${organizacion}/themes`, { headers: cabeceras })
  ).json()) as { id: string }[];

  for (const tema of temas) {
    await request.delete(`/api/v1/organizations/${organizacion}/themes/${tema.id}`, {
      headers: cabeceras,
    });
  }
}

test.afterEach(async ({ request }) => {
  await limpiarTemas(request);
});

test.describe('gestión de temas', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/temas');
  });

  test('partir de un ejemplo deja un tema propio en la tabla', async ({ page }) => {
    await page.getByRole('button', { name: 'Partir de un ejemplo' }).click();
    await page.getByRole('button', { name: /Noche/ }).click();

    // Al copiarlo se abre para retocarlo; se cierra para ver la tabla.
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'Noche' })).toBeVisible();
  });

  test('el buscador filtra por el nombre del tema', async ({ page, request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const organizacion = await organizacionId(request);
    for (const nombre of ['Verano', 'Invierno']) {
      await request.post(`/api/v1/organizations/${organizacion}/themes`, {
        headers: { authorization: `Bearer ${token}` },
        data: { name: nombre, tokens: {} },
      });
    }

    await page.reload();
    await page.getByLabel('Buscar').fill('invier');

    await expect(page.getByRole('row').filter({ hasText: 'Verano' })).toHaveCount(0);
  });

  test('un tema nuevo se puede crear desde cero', async ({ page }) => {
    await page.getByRole('button', { name: 'Nuevo tema' }).click();

    const dialogo = page.getByRole('dialog');
    // `exact`: el formulario tiene además "Nombre largo" y "Nombre corto".
    await dialogo.getByLabel('Nombre', { exact: true }).fill('Mi tema');
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'Mi tema' })).toBeVisible();
  });
});

test.describe('el tema en la página pública', () => {
  /** Crea un tema con lo que se quiera y lo deja en uso. */
  async function activar(
    request: APIRequestContext,
    tema: Record<string, unknown>,
  ): Promise<void> {
    const token = await tokenDe(request, CUENTAS.admin);
    const cabeceras = { authorization: `Bearer ${token}` };
    const organizacion = await organizacionId(request);

    const creado = (await (
      await request.post(`/api/v1/organizations/${organizacion}/themes`, {
        headers: cabeceras,
        data: { name: 'De prueba', tokens: {}, ...tema },
      })
    ).json()) as { id: string };

    await request.post(`/api/v1/organizations/${organizacion}/themes/${creado.id}/activate`, {
      headers: cabeceras,
    });
  }

  test('los colores del tema se aplican al fondo', async ({ page, request }) => {
    await activar(request, { tokens: { background: '#101820' } });

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(page.getByTestId('servicio').first()).toBeVisible();

    const fondo = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(fondo).toBe('rgb(16, 24, 32)');
  });

  test('el nombre largo de la cabecera se ve en escritorio', async ({ page, request }) => {
    test.skip(test.info().project.name !== 'escritorio', 'El nombre largo es de escritorio');
    await activar(request, { header: { longName: 'Peluquería del Centro', shortName: 'PDC' } });

    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(page.getByRole('banner').getByText('Peluquería del Centro')).toBeVisible();
  });

  test('el nombre corto de la cabecera se ve en móvil', async ({ page, request }) => {
    test.skip(test.info().project.name !== 'movil', 'El nombre corto es de móvil');
    await activar(request, { header: { longName: 'Peluquería del Centro', shortName: 'PDC' } });

    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(page.getByRole('banner').getByText('PDC')).toBeVisible();
  });

  /**
   * Sin marca configurada, la cabecera cae al nombre del negocio. En móvil se
   * enseña la versión corta, así que se comprueba lo que comparten las dos:
   * la primera palabra, que es la que se ve en ambos anchos.
   */
  test('sin tema, la cabecera enseña el nombre del negocio', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(
      page.getByRole('banner').getByText(/Peluquería/).locator('visible=true').first(),
    ).toBeVisible();
  });

  test('el CSS propio llega a la página', async ({ page, request }) => {
    await activar(request, { customCss: '.prueba-tema { position: fixed }' });

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(page.getByTestId('servicio').first()).toBeVisible();

    const hoja = await page.evaluate(
      () => document.getElementById('tema-de-la-organizacion')?.textContent ?? '',
    );
    expect(hoja).toContain('.prueba-tema');
  });

  /** Una imagen de fuera delataría a quién visita la página y cuándo. */
  test('el CSS propio no puede pedirle nada a otro servidor', async ({ page, request }) => {
    await activar(request, {
      customCss: '.a { background: url(https://ajeno.example/pixel.png) }',
    });

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(page.getByTestId('servicio').first()).toBeVisible();

    const hoja = await page.evaluate(
      () => document.getElementById('tema-de-la-organizacion')?.textContent ?? '',
    );
    expect(hoja).not.toContain('ajeno.example');
  });

  /**
   * El panel es donde se administra el negocio: no puede depender del CSS que
   * el propio negocio haya escrito para su escaparate.
   */
  test('el tema no se aplica en el panel', async ({ page, request }) => {
    await activar(request, { tokens: { background: '#101820' } });
    await entrar(page, CUENTAS.admin);

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(page.getByTestId('servicio').first()).toBeVisible();
    await page.goto('/admin/temas');
    await expect(page.getByRole('heading', { name: 'Temas' })).toBeVisible();

    const marcado = await page.evaluate(() => document.documentElement.dataset.tema ?? null);
    expect(marcado).toBe(null);
  });
});

test.describe('llevar un tema a otro sitio', () => {
  test('lo exportado se puede volver a importar', async ({ page, request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const cabeceras = { authorization: `Bearer ${token}` };
    const organizacion = await organizacionId(request);

    const creado = (await (
      await request.post(`/api/v1/organizations/${organizacion}/themes`, {
        headers: cabeceras,
        data: { name: 'Para compartir', tokens: { brand: '#ff00ff' } },
      })
    ).json()) as { id: string };

    const fichero = await (
      await request.get(`/api/v1/organizations/${organizacion}/themes/${creado.id}/export`, {
        headers: cabeceras,
      })
    ).json();

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/temas');
    await page.getByRole('button', { name: 'Importar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo
      .getByLabel('Importar un tema')
      .fill(JSON.stringify({ ...fichero, name: 'Importado' }));
    await dialogo.getByRole('button', { name: 'Importar' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'Importado' })).toBeVisible();
  });

  test('un fichero que no es un tema se rechaza', async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/temas');
    await page.getByRole('button', { name: 'Importar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Importar un tema').fill('{"esto":"no es un tema"}');
    await dialogo.getByRole('button', { name: 'Importar' }).click();

    await expect(dialogo.getByRole('alert')).toBeVisible();
  });
});
