import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Credenciales que crea la siembra de ejemplo al arrancar el servidor de
 * pruebas. Están aquí en un sitio único para que un cambio en la siembra se
 * arregle en un solo lugar.
 */
export const CUENTAS = {
  admin: { email: 'admin@ejemplo.es', password: 'CitaFacil2026!', nombre: 'Ana Ríos' },
  personal: { email: 'carlos@ejemplo.es', password: 'CitaFacil2026!', nombre: 'Carlos Vidal' },
  cliente: { email: 'cliente@ejemplo.es', password: 'CitaFacil2026!', nombre: 'Lucía Pena' },
} as const;

export const ORGANIZACION_SLUG = 'peluqueria-ejemplo';

/** Inicia sesión por la interfaz, como lo haría una persona. */
export async function entrar(
  page: Page,
  cuenta: { email: string; password: string },
): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('Correo electrónico').fill(cuenta.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(cuenta.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  // La aplicación lleva a "Mis citas" tras entrar.
  await expect(page).toHaveURL(/\/mis-citas/);
}

/**
 * Cierra la sesión desde el portal de cliente.
 *
 * Se pasa por la portada a propósito: en el panel el botón vive en el menú
 * lateral, que en móvil está plegado, y la prueba no debería depender del ancho
 * de la ventana para algo que no está verificando.
 */
export async function salir(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
}

/**
 * Inicia sesión por el API y devuelve el token. Se usa cuando la prueba
 * necesita preparar datos, no cuando lo que se verifica es el propio acceso.
 */
export async function tokenDe(
  request: APIRequestContext,
  cuenta: { email: string; password: string },
): Promise<string> {
  const response = await request.post('/api/v1/auth/login', {
    data: { email: cuenta.email, password: cuenta.password },
  });
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as { tokens: { accessToken: string } };
  return body.tokens.accessToken;
}

export async function organizacionId(request: APIRequestContext): Promise<string> {
  const response = await request.get(`/api/v1/public/organizations/${ORGANIZACION_SLUG}`);
  const body = (await response.json()) as { organization: { id: string } };
  return body.organization.id;
}

/** Fecha local de dentro de N días en formato `YYYY-MM-DD`. */
export function enDias(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Próximo día laborable, que es cuando la sede de ejemplo abre. */
export function proximoLaborable(): string {
  const date = new Date();
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  return date.toISOString().slice(0, 10);
}
