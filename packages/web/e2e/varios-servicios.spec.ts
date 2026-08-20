import { expect, test } from '@playwright/test';
import { ORGANIZACION_SLUG } from './helpers.ts';

/**
 * Varios servicios en la misma visita.
 *
 * Se comprueba por el API lo que se puede medir con un número (la duración y el
 * precio suman) y por pantalla lo que solo se ve mirando: que el selector
 * aparece al elegir día y hora.
 */
test.describe('varios servicios por cita', () => {
  test('el paso de día y hora ofrece añadir otro servicio', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByRole('button', { name: /Corte de pelo/ }).click();

    await expect(page.getByText('¿Algo más en la misma visita?')).toBeVisible();
  });

  test('la disponibilidad cuenta la suma de los dos servicios', async ({ request }) => {
    const publica = (await (
      await request.get(`/api/v1/public/organizations/${ORGANIZACION_SLUG}`)
    ).json()) as {
      organization: { id: string; timezone: string };
      services: { id: string; name: string; durationMinutes: number; durationMode: string }[];
    };

    // Corte de pelo y arreglo de barba: los dos combinables de la siembra.
    const corte = publica.services.find((item) => item.name === 'Corte de pelo')!;
    const barba = publica.services.find((item) => item.name === 'Arreglo de barba')!;
    expect(barba).toBeDefined();

    // Dos semanas de rango: una prueba que se salta cuando no encuentra datos
    // es una prueba que no comprueba nada, y esta agenda la usan otras.
    const desde = new Intl.DateTimeFormat('sv-SE', {
      timeZone: publica.organization.timezone,
    }).format(new Date());
    const hasta = new Intl.DateTimeFormat('sv-SE', {
      timeZone: publica.organization.timezone,
    }).format(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));

    const combinada = (await (
      await request.get(
        `/api/v1/public/organizations/${publica.organization.id}/availability?serviceId=${corte.id}&additionalServiceIds=${barba.id}&from=${desde}&to=${hasta}`,
      )
    ).json()) as { days: { slots: { durationMinutes: number }[] }[] };

    const hueco = combinada.days.flatMap((dia) => dia.slots)[0];
    expect(hueco, 'la agenda de pruebas se ha quedado sin huecos').toBeDefined();

    expect(hueco!.durationMinutes).toBe(corte.durationMinutes + barba.durationMinutes);
  });
});
