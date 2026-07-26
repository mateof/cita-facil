import { expect, test } from '@playwright/test';
import { CUENTAS, entrar, tokenDe } from './helpers.ts';

/**
 * Alta de organizaciones desde el panel.
 *
 * La instalación es multi-tenant: cada organización es un negocio con su
 * catálogo, su personal y sus clientes. Estas pruebas verifican que el
 * administrador de la instalación puede crear una segunda y que lo que hay
 * dentro de una no se ve desde la otra.
 */

const PREFIJO = 'Gimnasio de prueba';

test.describe('organizaciones', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
  });

  /**
   * Limpieza por API: si una prueba falla a mitad, la organización que haya
   * creado no puede quedarse ahí condicionando a las siguientes.
   */
  test.afterEach(async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const response = await request.get('/api/v1/organizations', {
      headers: { authorization: `Bearer ${token}` },
    });
    const organizaciones = (await response.json()) as { id: string; name: string }[];

    for (const organizacion of organizaciones.filter((item) => item.name.startsWith(PREFIJO))) {
      await request.delete(`/api/v1/organizations/${organizacion.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });

  test('el administrador de la instalación crea una organización nueva', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();

    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();
  });

  test('la organización nueva empieza con su catálogo vacío', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    // Al crearla se pasa a trabajar en ella, así que los servicios que se ven
    // son los suyos: ninguno. Los de la peluquería no se cruzan.
    await page.goto('/admin/servicios');
    await expect(page.getByRole('main').getByText('Corte de pelo')).toHaveCount(0);
  });

  test('la organización nueva aparece en el portal público', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();
  });

  test('dar de baja una organización la quita del panel', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    const fila = page.getByRole('listitem').filter({ hasText: nombre });
    await fila.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Dar de baja' }).click();

    await expect(page.getByRole('main').getByText(nombre)).toHaveCount(0);
  });

  test('un cliente no puede crear organizaciones', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.cliente);

    const response = await request.post('/api/v1/organizations', {
      headers: { authorization: `Bearer ${token}` },
      data: { name: 'Chiringuito', timezone: 'Europe/Madrid', locale: 'es', currency: 'EUR' },
    });

    expect(response.status()).toBe(403);
  });
});
