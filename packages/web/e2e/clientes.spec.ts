import { expect, test } from '@playwright/test';
import { CUENTAS, entrar } from './helpers.ts';

/**
 * Ficha de cliente.
 *
 * La clienta de ejemplo tiene una cita en la siembra, así que aparece en la
 * lista sin que la prueba tenga que preparar nada. Lo que se anota (notas y
 * etiquetas) sí es de cada tirada: los proyectos de escritorio y móvil
 * comparten base de datos, y una nota fija haría que el segundo encontrara la
 * del primero.
 */
test.describe('clientes', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/clientes');
  });

  test('la ficha enseña el historial de la clienta', async ({ page }) => {
    await page.getByRole('main').getByRole('button', { name: /Lucía Pena/ }).click();

    await expect(page.getByRole('dialog').getByText('Últimas citas')).toBeVisible();
  });

  test('una nota interna se guarda y sigue ahí al volver a abrir la ficha', async ({ page }) => {
    const nota = `Prefiere la tarde ${Date.now().toString().slice(-5)}`;

    await page.getByRole('main').getByRole('button', { name: /Lucía Pena/ }).click();
    const ficha = page.getByRole('dialog');
    await ficha.getByLabel('Notas internas').fill(nota);
    await ficha.getByRole('button', { name: 'Guardar' }).click();

    await page.getByRole('main').getByRole('button', { name: /Lucía Pena/ }).click();

    await expect(page.getByRole('dialog').getByLabel('Notas internas')).toHaveValue(nota);
  });

  test('el buscador tolera erratas en el nombre', async ({ page }) => {
    await page.getByRole('main').getByLabel('Buscar').fill('pena');

    await expect(page.getByRole('main').getByText('Lucía Pena')).toBeVisible();
  });
});
