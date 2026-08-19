import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * Formularios y consentimientos.
 *
 * La prueba crea su propio consentimiento y lo engancha a un servicio suyo, y
 * lo desengancha al terminar: el servicio de ejemplo lo usan otras pruebas para
 * reservar, y dejarle un consentimiento obligatorio les rompería la reserva.
 */

async function contexto(request: APIRequestContext) {
  const token = await tokenDe(request, CUENTAS.admin);
  const organizacion = await organizacionId(request);
  return { token, organizacion };
}

async function crearConsentimiento(request: APIRequestContext, nombre: string) {
  const { token, organizacion } = await contexto(request);

  const creado = await request.post(`/api/v1/organizations/${organizacion}/forms`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: nombre,
      kind: 'consent',
      consentText: 'Autorizo el tratamiento de mis datos para esta cita.',
      requiresSignature: true,
      fields: [],
      active: true,
    },
  });
  expect(creado.status()).toBe(201);
  return (await creado.json()) as { id: string };
}

/** Un servicio propio de la prueba, para no tocar el que usan las demás. */
async function crearServicio(request: APIRequestContext, nombre: string) {
  const { token, organizacion } = await contexto(request);

  const creado = await request.post(`/api/v1/organizations/${organizacion}/services`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      name: nombre,
      durationMode: 'fixed',
      durationMinutes: 30,
      priceMode: 'fixed',
      priceCents: 1000,
      currency: 'EUR',
      capacity: 1,
      publiclyBookable: true,
      active: true,
    },
  });
  expect(creado.status()).toBe(201);
  return (await creado.json()) as { id: string };
}

test.describe('formularios', () => {
  test('un consentimiento nuevo aparece en la pestaña de formularios', async ({
    page,
    request,
  }) => {
    const nombre = `Consentimiento ${Date.now().toString().slice(-5)}`;
    await crearConsentimiento(request, nombre);

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/servicios');
    await page.getByRole('button', { name: 'Formularios' }).click();

    await expect(page.getByRole('listitem').filter({ hasText: nombre })).toBeVisible();
  });

  test('el consentimiento enganchado se pide al reservar', async ({ page, request }) => {
    const sufijo = Date.now().toString().slice(-5);
    const { token, organizacion } = await contexto(request);
    const form = await crearConsentimiento(request, `Consentimiento web ${sufijo}`);
    const servicio = await crearServicio(request, `Servicio con papel ${sufijo}`);

    const enganchado = await request.put(
      `/api/v1/organizations/${organizacion}/services/${servicio.id}/forms`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { forms: [{ formId: form.id, required: true, oncePerCustomer: false, sortOrder: 0 }] },
      },
    );
    expect(enganchado.ok()).toBeTruthy();

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByRole('button', { name: new RegExp(`Servicio con papel ${sufijo}`) }).click();
    await page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().click();

    await expect(page.getByText('He leído y acepto')).toBeVisible();
  });
});
