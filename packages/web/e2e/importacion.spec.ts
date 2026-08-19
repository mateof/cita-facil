import { expect, test } from '@playwright/test';
import { CUENTAS, entrar } from './helpers.ts';

/**
 * Importación desde CSV.
 *
 * El recorrido que importa es el de dos pasos: el ensayo no escribe nada y el
 * botón que escribe de verdad solo aparece después.
 */
test.describe('importación', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/clientes');
    await page.getByRole('button', { name: 'Importar' }).click();
  });

  test('el ensayo dice lo que haría sin escribir nada', async ({ page }) => {
    const correo = `importada-${Date.now().toString().slice(-6)}@ejemplo.es`;
    await page
      .getByLabel('O pega aquí el contenido')
      .fill(`nombre;correo\nCliente importada;${correo}`);
    await page.getByRole('button', { name: 'Probar sin escribir' }).click();

    await expect(page.getByText('1 nuevo')).toBeVisible();
  });

  test('el botón de importar de verdad solo aparece tras el ensayo', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Importar de verdad' })).toHaveCount(0);
  });

  test('al importar de verdad el cliente aparece en la lista', async ({ page }) => {
    const nombre = `Importada ${Date.now().toString().slice(-5)}`;
    const correo = `${nombre.toLowerCase().replace(/\s+/g, '-')}@ejemplo.es`;

    await page.getByLabel('O pega aquí el contenido').fill(`nombre;correo\n${nombre};${correo}`);
    await page.getByRole('button', { name: 'Probar sin escribir' }).click();
    await page.getByRole('button', { name: 'Importar de verdad' }).click();
    await expect(page.getByText('Importación terminada')).toBeVisible();

    await page.getByRole('button', { name: 'Clientes' }).first().click();

    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();
  });
});
