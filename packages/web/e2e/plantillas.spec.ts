import { expect, test } from '@playwright/test';
import { CUENTAS, entrar } from './helpers.ts';

/**
 * Plantillas de alta.
 *
 * La prueba crea su propia organización, que es lo que hace la plantilla, y
 * comprueba lo que promete: que el catálogo queda puesto sin tocar nada.
 */
test.describe('plantillas de alta', () => {
  test('al crear una organización con plantilla, el catálogo queda hecho', async ({ page }) => {
    const nombre = `Peluquería de prueba ${Date.now().toString().slice(-5)}`;

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nombre del negocio').fill(nombre);
    await dialogo.getByRole('button', { name: /Peluquería/ }).click();
    await dialogo.getByRole('button', { name: 'Crear' }).click();

    // Al crear una organización se pasa a trabajar en ella, así que Servicios
    // enseña ya el catálogo de la plantilla.
    await page.goto('/admin/servicios');

    await expect(page.getByRole('main').getByText('Corte de pelo').first()).toBeVisible();
  });

  test('empezar en blanco no crea ningún servicio', async ({ page }) => {
    const nombre = `Sin plantilla ${Date.now().toString().slice(-5)}`;

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nombre del negocio').fill(nombre);
    await dialogo.getByRole('button', { name: 'Crear' }).click();

    await page.goto('/admin/servicios');

    await expect(page.getByRole('main').getByText('Corte de pelo')).toHaveCount(0);
  });
});
