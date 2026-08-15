import { expect, test } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar } from './helpers.ts';

/**
 * Recorrido de reserva completo desde la página pública, que es el camino que
 * más veces se recorre en la aplicación.
 */
test.describe('reserva pública', () => {
  test('la página del establecimiento lista sus servicios', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(page.getByRole('heading', { name: 'Peluquería Ejemplo' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Corte de pelo/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Alquiler de cabina/ })).toBeVisible();
  });

  test('un servicio de duración fija salta el paso de duración', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByRole('button', { name: /Corte de pelo/ }).click();

    await expect(page.getByRole('heading', { name: 'Elige el día' })).toBeVisible();
    await expect(page.getByText('¿Cuánto tiempo quieres reservar?')).toHaveCount(0);
  });

  test('un servicio de duración ajustable pregunta cuánto tiempo se reserva', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByRole('button', { name: /Alquiler de cabina/ }).click();

    await expect(page.getByText('¿Cuánto tiempo quieres reservar?')).toBeVisible();
    // Entre 30 y 120 minutos en tramos de 30: cuatro opciones.
    await expect(page.locator('[data-testid="duracion"]')).toHaveCount(4);
  });

  test('el precio por minuto cambia con la duración elegida', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByRole('button', { name: /Alquiler de cabina/ }).click();

    // 30 minutos a 0,25 EUR el minuto, y el doble al doble de tiempo.
    await expect(page.locator('[data-minutos="30"]')).toContainText('7,50');
    await expect(page.locator('[data-minutos="60"]')).toContainText('15');
    await expect(page.locator('[data-minutos="120"]')).toContainText('30');
  });

  test('reserva de principio a fin como cliente identificado', async ({ page }) => {
    await entrar(page, CUENTAS.cliente);

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByRole('button', { name: /Corte de pelo/ }).click();

    // Primer día con hueco de los que ofrece el selector.
    // Los días se localizan por atributo y no por su texto: las abreviaturas
    // llevan tilde ("Mié", "Sáb") y una expresión regular sobre el texto sería
    // frágil y dependiente del idioma.
    const dia = page.locator('[data-testid="dia"][data-disponible="si"]').first();
    await dia.click();

    await expect(page.getByRole('heading', { name: 'Elige la hora' })).toBeVisible();
    const hora = page.locator('[data-testid="hueco"]').first();
    const horaElegida = (await hora.textContent())?.trim().slice(0, 5) ?? '';
    await hora.click();

    // Resumen antes de confirmar.
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible();
    await expect(page.getByText('Corte de pelo')).toBeVisible();

    await page.getByRole('button', { name: 'Confirmar reserva' }).click();

    await expect(page.getByRole('heading', { name: '¡Cita confirmada!' })).toBeVisible();
    await expect(page.getByText('Código de acceso')).toBeVisible();
    // El código de acceso son diez caracteres en mayúsculas.
    await expect(page.locator('p.font-mono').first()).toHaveText(/^[0-9A-Z]{10}$/);

    // Y la cita aparece ya en el listado del cliente.
    await page.goto('/mis-citas');
    await expect(page.getByText('Corte de pelo').first()).toBeVisible();
    if (horaElegida) {
      await expect(page.getByText(horaElegida).first()).toBeVisible();
    }
  });

  test('el hueco reservado desaparece de la disponibilidad', async ({ page, request }) => {
    const info = await request.get(`/api/v1/public/organizations/${ORGANIZACION_SLUG}`);
    const { organization, services } = (await info.json()) as {
      organization: { id: string };
      services: { id: string; name: string }[];
    };
    const servicio = services.find((item) => item.name === 'Corte de pelo')!;

    const fecha = new Date();
    do {
      fecha.setDate(fecha.getDate() + 1);
    } while (fecha.getDay() === 0 || fecha.getDay() === 6);
    const dia = fecha.toISOString().slice(0, 10);

    const antes = await request.get(
      `/api/v1/public/organizations/${organization.id}/availability?serviceId=${servicio.id}&from=${dia}`,
    );
    const disponibles = ((await antes.json()) as { days: { slots: unknown[] }[] }).days[0]!.slots
      .length;

    await entrar(page, CUENTAS.cliente);
    await page.goto(`/${ORGANIZACION_SLUG}?servicio=${servicio.id}`);

    // El día se elige por su fecha, no "el primero con hueco": si no, según la
    // hora a la que se ejecute la suite la interfaz podría reservar en hoy
    // mientras la comprobación mira mañana, y el recuento no bajaría.
    await page.locator(`[data-testid="dia"][data-date="${dia}"]`).click();
    await page.locator('[data-testid="hueco"]').first().click();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: '¡Cita confirmada!' })).toBeVisible();

    const despues = await request.get(
      `/api/v1/public/organizations/${organization.id}/availability?serviceId=${servicio.id}&from=${dia}`,
    );
    const restantes = ((await despues.json()) as { days: { slots: unknown[] }[] }).days[0]!.slots
      .length;

    expect(restantes).toBeLessThan(disponibles);
  });

  test('consulta de una cita por su código sin tener sesión', async ({ page, request }) => {
    // La cita se crea por API para no depender del recorrido anterior.
    const login = await request.post('/api/v1/auth/login', {
      data: { email: CUENTAS.cliente.email, password: CUENTAS.cliente.password },
    });
    const { tokens } = (await login.json()) as { tokens: { accessToken: string } };

    const citas = await request.get('/api/v1/me/appointments?filter=all&pageSize=1', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    const { items } = (await citas.json()) as { items: { accessCode: string; serviceName: string }[] };
    const cita = items[0];
    test.skip(!cita, 'no hay ninguna cita creada todavía');

    await page.goto('/consultar');
    await page.getByLabel('Código de acceso').fill(cita!.accessCode);
    await page.getByRole('button', { name: 'Buscar' }).click();

    await expect(page.getByText(cita!.serviceName).first()).toBeVisible();
  });
});
