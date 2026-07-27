import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * Reglas de reserva: cuándo se cobra el bono, sesiones a deber y plazos.
 *
 * Los ajustes se tocan por API porque lo que interesa comprobar es el efecto en
 * la reserva, no el formulario; el formulario tiene sus propias pruebas.
 */

async function cabeceras(request: APIRequestContext): Promise<Record<string, string>> {
  const token = await tokenDe(request, CUENTAS.admin);
  return { authorization: `Bearer ${token}` };
}

/** Cambia ajustes de la organización sin pisar los demás. */
async function ajustar(request: APIRequestContext, valores: Record<string, unknown>): Promise<void> {
  const headers = await cabeceras(request);
  const organizacion = await organizacionId(request);
  await request.patch(`/api/v1/organizations/${organizacion}`, {
    headers,
    data: { settings: valores },
  });
}

/** Saldo de bono de una cuenta. */
async function saldoDe(
  request: APIRequestContext,
  cuenta: { email: string; password: string },
): Promise<number> {
  const token = await tokenDe(request, cuenta);
  const organizacion = await organizacionId(request);
  const respuesta = await request.get(`/api/v1/organizations/${organizacion}/credits/balance`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return ((await respuesta.json()) as { available: number }).available;
}

test.afterEach(async ({ request }) => {
  // Los ajustes vuelven a su sitio: si no, arrastran a las demás pruebas.
  await ajustar(request, {
    creditChargeMode: 'booking',
    allowCreditDebt: false,
    cancellationCutoffMinutes: 0,
    minAdvanceMinutes: 0,
  });
});

test.describe('cuándo se descuenta el bono', () => {
  test('el panel deja elegir cobrar al completar', async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/ajustes');
    await page.getByRole('button', { name: 'Reservas' }).click();

    await page.getByLabel('Cuándo se descuenta el bono').selectOption('completion');
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByRole('status').first()).toBeVisible();
  });

  test('con cobro al completar, reservar no gasta saldo', async ({ page, request }) => {
    await ajustar(request, { creditChargeMode: 'completion' });
    const antes = await saldoDe(request, CUENTAS.cliente);

    await entrar(page, CUENTAS.cliente);
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByTestId('servicio').filter({ hasText: 'Sesión de bronceado' }).click();
    await page.locator('[data-testid="dia"][data-disponible="si"]').first().click();
    await page.locator('[data-testid="hueco"]').first().click();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: '¡Cita confirmada!' })).toBeVisible();

    expect(await saldoDe(request, CUENTAS.cliente)).toBe(antes);
  });
});

test.describe('sesiones a deber', () => {
  test('el panel deja activarlo con su tope', async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/ajustes');
    await page.getByRole('button', { name: 'Reservas' }).click();

    await page.getByRole('switch', { name: 'Permitir reservar sin saldo' }).click();

    await expect(page.getByLabel('Sesiones que se pueden deber')).toBeVisible();
  });

  /**
   * La cuenta se crea aquí y no se reutiliza ninguna de las de ejemplo: otras
   * pruebas les entregan bonos, y entonces esta comprobación dejaría de medir
   * lo que dice medir.
   */
  test('sin saldo y sin permiso, la reserva se rechaza', async ({ request }) => {
    const organizacion = await organizacionId(request);
    const correo = `sin-bono-${Date.now()}@ejemplo.es`;

    const alta = await request.post('/api/v1/auth/register', {
      data: {
        name: 'Cliente sin bono',
        email: correo,
        password: 'ClaveLargaDePrueba1',
        acceptTerms: true,
      },
    });
    expect(alta.ok()).toBeTruthy();
    const token = ((await alta.json()) as { tokens: { accessToken: string } }).tokens.accessToken;

    const publica = (await (
      await request.get(`/api/v1/public/organizations/${ORGANIZACION_SLUG}`)
    ).json()) as { services: { id: string; name: string }[] };
    const servicio = publica.services.find((item) => item.name === 'Sesión de bronceado')!;

    const disponibilidad = (await (
      await request.get(
        `/api/v1/public/organizations/${organizacion}/availability?serviceId=${servicio.id}&from=${new Date().toISOString().slice(0, 10)}`,
      )
    ).json()) as { days: { slots: { startsAt: string }[] }[] };
    const hueco = disponibilidad.days.flatMap((dia) => dia.slots)[0]!;

    const respuesta = await request.post(`/api/v1/organizations/${organizacion}/appointments`, {
      headers: { authorization: `Bearer ${token}` },
      data: { serviceId: servicio.id, startsAt: hueco.startsAt },
    });

    expect(respuesta.status()).toBe(403);
  });
});

test.describe('plazos de reserva y cancelación', () => {
  test('el plazo se elige de una lista legible, no en minutos', async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/ajustes');
    await page.getByRole('button', { name: 'Reservas' }).click();

    await expect(
      page.getByLabel('Plazo para cancelar').getByRole('option', { name: '1 día' }),
    ).toBeAttached();
  });

  test('un servicio puede seguir el plazo de su organización', async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/servicios');
    await page.getByRole('button', { name: 'Editar' }).first().click();

    const dialogo = page.getByRole('dialog');
    await expect(
      dialogo.getByLabel('Plazo para cancelar').getByRole('option', { name: /organización/ }),
    ).toBeAttached();
  });

  test('con el plazo cerrado, el cliente ya no puede cancelar', async ({ request }) => {
    await ajustar(request, { cancellationCutoffMinutes: 525_600 });

    const token = await tokenDe(request, CUENTAS.cliente);
    const organizacion = await organizacionId(request);
    const citas = (await (
      await request.get(`/api/v1/me/appointments?status=confirmed`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { items: { id: string }[] };

    test.skip(citas.items.length === 0, 'La clienta no tiene ninguna cita futura');

    const respuesta = await request.post(
      `/api/v1/organizations/${organizacion}/appointments/${citas.items[0]!.id}/cancel`,
      { headers: { authorization: `Bearer ${token}` }, data: {} },
    );

    expect(respuesta.status()).toBe(403);
  });
});

test.describe('programaciones semanales', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/programaciones');
  });

  test.afterEach(async ({ request }) => {
    const headers = await cabeceras(request);
    const organizacion = await organizacionId(request);
    const programaciones = (await (
      await request.get(`/api/v1/organizations/${organizacion}/recurring`, { headers })
    ).json()) as { id: string; active: boolean }[];

    // Las citas que hayan creado se cancelan primero: quedan en la agenda y
    // ocuparían huecos que otras pruebas necesitan libres.
    for (const programacion of programaciones) {
      const detalle = (await (
        await request.get(
          `/api/v1/organizations/${organizacion}/recurring/${programacion.id}`,
          { headers },
        )
      ).json()) as { occurrences?: { appointmentId: string | null }[] };

      for (const ocurrencia of detalle.occurrences ?? []) {
        if (!ocurrencia.appointmentId) continue;
        await request.post(
          `/api/v1/organizations/${organizacion}/appointments/${ocurrencia.appointmentId}/cancel`,
          { headers, data: {} },
        );
      }
    }

    // Dos pasadas: la primera para las activas, la segunda las quita de la
    // lista. Si no, se acumulan y la siguiente prueba ve filas de sobra.
    for (const programacion of programaciones) {
      if (programacion.active) {
        await request.delete(
          `/api/v1/organizations/${organizacion}/recurring/${programacion.id}`,
          { headers },
        );
      }
      await request.delete(
        `/api/v1/organizations/${organizacion}/recurring/${programacion.id}`,
        { headers },
      );
    }
  });

  test('crear una programación la deja en la tabla', async ({ page }) => {
    await page.getByRole('button', { name: 'Nueva programación' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Cliente').fill('Luc');
    await dialogo.getByRole('option', { name: /Lucía/ }).click();
    await dialogo.getByLabel('Servicio').fill('Corte');
    await dialogo.getByRole('option', { name: /Corte de pelo/ }).click();
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'Lucía Pena' })).toBeVisible();
  });

  test('la programación crea ya la cita de esta semana', async ({ page, request }) => {
    await page.getByRole('button', { name: 'Nueva programación' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Cliente').fill('Luc');
    await dialogo.getByRole('option', { name: /Lucía/ }).click();
    await dialogo.getByLabel('Servicio').fill('Corte');
    await dialogo.getByRole('option', { name: /Corte de pelo/ }).click();
    await dialogo.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Lucía Pena' })).toBeVisible();

    const headers = await cabeceras(request);
    const organizacion = await organizacionId(request);
    const programaciones = (await (
      await request.get(`/api/v1/organizations/${organizacion}/recurring`, { headers })
    ).json()) as { id: string; active: boolean }[];
    const viva = programaciones.find((item) => item.active)!;

    const detalle = (await (
      await request.get(`/api/v1/organizations/${organizacion}/recurring/${viva.id}`, { headers })
    ).json()) as { occurrences: { status: string }[] };

    expect(detalle.occurrences.length).toBeGreaterThan(0);
  });

  test('pararla la deja marcada como parada', async ({ page }) => {
    await page.getByRole('button', { name: 'Nueva programación' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Cliente').fill('Luc');
    await dialogo.getByRole('option', { name: /Lucía/ }).click();
    await dialogo.getByLabel('Servicio').fill('Corte');
    await dialogo.getByRole('option', { name: /Corte de pelo/ }).click();
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    // Las programaciones paradas se quedan en la tabla, así que la de esta
    // prueba es la única con el botón de parar.
    const fila = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'Parar' }) });
    await fila.getByRole('button', { name: 'Parar' }).click();

    await expect(fila.getByRole('button', { name: 'Parar' })).toHaveCount(0);
  });

  /** Volver a generar no puede duplicar la cita de una fecha ya procesada. */
  test('generar otra vez no crea nada nuevo', async ({ page, request }) => {
    await page.getByRole('button', { name: 'Nueva programación' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Cliente').fill('Luc');
    await dialogo.getByRole('option', { name: /Lucía/ }).click();
    await dialogo.getByLabel('Servicio').fill('Corte');
    await dialogo.getByRole('option', { name: /Corte de pelo/ }).click();
    await dialogo.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Lucía Pena' })).toBeVisible();

    const headers = await cabeceras(request);
    const organizacion = await organizacionId(request);
    const programaciones = (await (
      await request.get(`/api/v1/organizations/${organizacion}/recurring`, { headers })
    ).json()) as { id: string; active: boolean }[];
    const viva = programaciones.find((item) => item.active)!;

    const respuesta = await request.post(
      `/api/v1/organizations/${organizacion}/recurring/${viva.id}/run`,
      { headers },
    );

    expect(((await respuesta.json()) as { created: number }).created).toBe(0);
  });
});
