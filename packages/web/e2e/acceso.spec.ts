import { expect, test } from '@playwright/test';
import { CUENTAS, entrar, salir } from './helpers.ts';

test.describe('acceso', () => {
  test('la pantalla de acceso solo ofrece los métodos habilitados', async ({ page }) => {
    await page.goto('/entrar');

    await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar con passkey' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Entrar con DNIe o certificado' })).toBeVisible();
    // Google no está configurado en el entorno de pruebas.
    await expect(page.getByRole('link', { name: /Google/ })).toHaveCount(0);
  });

  test('entra con correo y contraseña', async ({ page }) => {
    await entrar(page, CUENTAS.cliente);
    await expect(page.getByRole('heading', { name: 'Mis citas' })).toBeVisible();
  });

  test('rechaza una contraseña incorrecta', async ({ page }) => {
    await page.goto('/entrar');
    await page.getByLabel('Correo electrónico').fill(CUENTAS.cliente.email);
    await page.getByLabel('Contraseña', { exact: true }).fill('no-es-la-buena-123');
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    await expect(page.getByRole('alert')).toContainText(/correo o la contraseña/i);
    await expect(page).toHaveURL(/\/entrar/);
  });

  /**
   * Regresión: el endpoint de renovación rechazaba las llamadas sin cuerpo con
   * un 422, así que cualquier recarga de página cerraba la sesión.
   */
  test('la sesión sobrevive a recargar la página', async ({ page }) => {
    await entrar(page, CUENTAS.cliente);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mis citas' })).toBeVisible();

    // Y también a una navegación completa a otra ruta protegida.
    await page.goto('/perfil');
    await expect(page.getByRole('heading', { name: 'Mi perfil' })).toBeVisible();
  });

  test('al cerrar sesión deja de haber acceso a las rutas protegidas', async ({ page }) => {
    await entrar(page, CUENTAS.cliente);

    await salir(page);
    await page.goto('/mis-citas');

    await expect(page).toHaveURL(/\/entrar/);
  });

  test('una ruta protegida sin sesión lleva al acceso y vuelve luego', async ({ page }) => {
    await page.goto('/perfil');
    await expect(page).toHaveURL(/\/entrar\?volver=%2Fperfil/);

    await page.getByLabel('Correo electrónico').fill(CUENTAS.cliente.email);
    await page.getByLabel('Contraseña', { exact: true }).fill(CUENTAS.cliente.password);
    await page.getByRole('button', { name: 'Iniciar sesión' }).click();

    await expect(page).toHaveURL(/\/perfil/);
  });
});
