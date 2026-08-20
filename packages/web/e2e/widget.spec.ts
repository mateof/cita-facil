import { expect, test } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, organizacionId, tokenDe } from './helpers.ts';

/**
 * Widget de reserva.
 *
 * Lo que hay que comprobar es que la reserva empotrada funciona igual pero sin
 * la navegación de la aplicación, y que las cabeceras dejan meterla en un marco
 * de otra página. Esto último no se ve mirando la pantalla: se mira la
 * respuesta.
 */
test.describe('widget', () => {
  test('la pantalla empotrada enseña los servicios', async ({ page }) => {
    await page.goto(`/embed/${ORGANIZACION_SLUG}`);

    await expect(page.getByText('Corte de pelo').first()).toBeVisible();
  });

  test('la pantalla empotrada no lleva la navegación del portal', async ({ page }) => {
    await page.goto(`/embed/${ORGANIZACION_SLUG}`);

    await expect(page.getByRole('link', { name: 'Mis citas' })).toHaveCount(0);
  });

  /** Con `frame-ancestors 'none'` el marco saldría en blanco en la web del negocio. */
  test('la respuesta permite empotrarla en otra página', async ({ request }) => {
    const respuesta = await request.get(`/embed/${ORGANIZACION_SLUG}`);

    expect(respuesta.headers()['x-frame-options']).toBeUndefined();
  });

  test('el script del widget se sirve como JavaScript', async ({ request }) => {
    const respuesta = await request.get('/widget.js');

    expect(respuesta.headers()['content-type']).toContain('javascript');
  });

  test('con dominios configurados, solo esos pueden empotrarla', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const id = await organizacionId(request);
    const actual = (await (
      await request.get(`/api/v1/organizations/${id}`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { settings: Record<string, unknown> };

    await request.patch(`/api/v1/organizations/${id}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { settings: { ...actual.settings, embedOrigins: ['https://mipeluqueria.es'] } },
    });

    const respuesta = await request.get(`/embed/${ORGANIZACION_SLUG}`);

    // Se deja como estaba para no condicionar a las demás pruebas.
    await request.patch(`/api/v1/organizations/${id}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { settings: { ...actual.settings, embedOrigins: [] } },
    });

    expect(respuesta.headers()['content-security-policy']).toContain(
      'frame-ancestors https://mipeluqueria.es',
    );
  });

  test('el script lleva el marco a la pantalla empotrada', async ({ request }) => {
    const cuerpo = await (await request.get('/widget.js')).text();

    expect(cuerpo).toContain("'/embed/'");
  });
});
