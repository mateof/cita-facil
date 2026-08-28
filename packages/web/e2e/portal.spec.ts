import { expect, test, type Page } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar } from './helpers.ts';

/**
 * Contexto de negocio en el portal de cliente.
 *
 * "Mis citas", "Mis bonos" y "Perfil" son pantallas comunes que no llevan el
 * negocio en la dirección, así que el establecimiento por el que se entró se
 * recuerda aparte. Lo que se comprueba aquí es que ese recuerdo sobrevive a ir
 * y venir por el menú, que es justo donde se perdía: "Reservar" llevaba a la
 * portada de la instalación, y la portada borraba el negocio.
 */

/**
 * El menú está dos veces en el DOM, arriba en escritorio y abajo en móvil, y
 * solo uno de los dos se ve. Se pulsa el visible en vez de fijar un ancho.
 */
function menu(page: Page, nombre: string) {
  return page.getByRole('link', { name: nombre }).locator('visible=true').first();
}

/** El nombre del negocio en la cabecera. Sin tema, es el de la organización. */
function marca(page: Page) {
  return page.getByRole('banner').getByText(/Peluquería/).locator('visible=true').first();
}

test.describe('contexto del negocio en el portal', () => {
  test('ir a "Mis citas" y volver por "Reservar" no pierde el negocio', async ({ page }) => {
    await entrar(page, CUENTAS.cliente);
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(marca(page)).toBeVisible();

    await menu(page, 'Mis citas').click();
    await expect(page).toHaveURL(/\/mis-citas/);
    await expect(marca(page)).toBeVisible();

    // Aquí estaba el fallo: "Reservar" iba a la portada de la instalación.
    await menu(page, 'Reservar').click();
    await expect(page).toHaveURL(new RegExp(`/${ORGANIZACION_SLUG}$`));

    await menu(page, 'Mis citas').click();
    await expect(page).toHaveURL(/\/mis-citas/);
    await expect(marca(page)).toBeVisible();
  });

  test('sin sesión, la portada devuelve al negocio del enlace', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(marca(page)).toBeVisible();

    // Quien llegó por el enlace de un negocio no tiene por qué ver el
    // directorio de la instalación: su portada es la de ese negocio.
    await page.goto('/');
    await expect(page).toHaveURL(new RegExp(`/${ORGANIZACION_SLUG}$`));
  });

  test('sin sesión, "Reservar" vuelve al negocio desde una pantalla común', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);
    // "Consultar una cita" tampoco lleva el negocio en la dirección.
    await page.goto('/consultar');
    await expect(marca(page)).toBeVisible();

    await menu(page, 'Reservar').click();
    await expect(page).toHaveURL(new RegExp(`/${ORGANIZACION_SLUG}$`));
  });
});
