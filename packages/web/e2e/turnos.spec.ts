import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * Cola sin cita previa.
 *
 * Cada prueba apunta a su propia persona con un nombre único: los proyectos de
 * escritorio y móvil comparten base de datos y la cola es del día, así que lo
 * que apunte una prueba lo ve la siguiente.
 */

async function activarCola(request: APIRequestContext, activa: boolean): Promise<void> {
  const token = await tokenDe(request, CUENTAS.admin);
  const id = await organizacionId(request);
  const actual = (await (
    await request.get(`/api/v1/organizations/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { settings: Record<string, unknown> };

  const response = await request.patch(`/api/v1/organizations/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      settings: {
        ...actual.settings,
        walkInQueueEnabled: activa,
        walkInPublicJoin: activa,
      },
    },
  });
  expect(response.ok()).toBeTruthy();
}

/**
 * Vacía la cola del día.
 *
 * "Llamar al siguiente" llama a quien lleve más esperando, y eso puede ser
 * alguien que apuntó otra prueba. Sin dejar la cola limpia, la comprobación
 * dependería del orden de ejecución.
 */
async function vaciarCola(request: APIRequestContext): Promise<void> {
  const token = await tokenDe(request, CUENTAS.admin);
  const id = await organizacionId(request);
  const cola = (await (
    await request.get(`/api/v1/organizations/${id}/queue`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { waiting: { id: string }[]; called: { id: string }[]; serving: { id: string }[] };

  for (const entry of [...cola.waiting, ...cola.called, ...cola.serving]) {
    await request.patch(`/api/v1/organizations/${id}/queue/${entry.id}`, {
      headers: { authorization: `Bearer ${token}` },
      data: { status: 'left' },
    });
  }
}

test.describe('turnos', () => {
  test('el mostrador apunta a alguien y aparece esperando', async ({ page, request }) => {
    const nombre = `Llega ${Date.now().toString().slice(-5)}`;
    await activarCola(request, true);
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/turnos');

    await page.getByRole('button', { name: 'Apuntar a alguien' }).click();
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Cliente').fill(nombre);
    await dialogo.getByRole('button', { name: 'Apuntar a alguien' }).click();

    await expect(page.getByRole('listitem').filter({ hasText: nombre })).toBeVisible();
  });

  test('llamar al siguiente lo pasa al mostrador', async ({ page, request }) => {
    const nombre = `Turno ${Date.now().toString().slice(-5)}`;
    await activarCola(request, true);
    await vaciarCola(request);

    const token = await tokenDe(request, CUENTAS.admin);
    const id = await organizacionId(request);
    const apuntado = await request.post(`/api/v1/organizations/${id}/queue`, {
      headers: { authorization: `Bearer ${token}` },
      data: { name: nombre },
    });
    expect(apuntado.status()).toBe(201);

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/turnos');
    await page.getByRole('button', { name: 'Llamar al siguiente' }).click();

    const enMostrador = page.getByRole('listitem').filter({ hasText: nombre });
    await expect(enMostrador.getByRole('button', { name: 'Atendiendo' })).toBeVisible();
  });

  test('la pantalla de sala enseña el número al que se llama', async ({ page, request }) => {
    const nombre = `Pantalla ${Date.now().toString().slice(-5)}`;
    await activarCola(request, true);
    await vaciarCola(request);

    const token = await tokenDe(request, CUENTAS.admin);
    const id = await organizacionId(request);
    const apuntado = await request.post(`/api/v1/organizations/${id}/queue`, {
      headers: { authorization: `Bearer ${token}` },
      data: { name: nombre },
    });
    const turno = (await apuntado.json()) as { ticketNumber: number };

    await request.post(`/api/v1/organizations/${id}/queue/next`, {
      headers: { authorization: `Bearer ${token}` },
      data: {},
    });

    await page.goto(`/${ORGANIZACION_SLUG}/turnos`);

    await expect(page.getByText(String(turno.ticketNumber), { exact: true })).toBeVisible();
  });

  test('con la cola apagada la página del negocio no ofrece coger turno', async ({
    page,
    request,
  }) => {
    await activarCola(request, false);

    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(page.getByRole('button', { name: 'Coger turno' })).toHaveCount(0);
  });
});
