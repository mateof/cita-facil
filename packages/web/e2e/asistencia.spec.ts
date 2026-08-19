import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, organizacionId, tokenDe } from './helpers.ts';

/**
 * Confirmación de asistencia desde el enlace del recordatorio.
 *
 * La prueba entra por donde entra el cliente: la dirección de consulta con el
 * código, sin sesión iniciada. Cada caso crea su propia cita porque confirmar y
 * cancelar no tienen vuelta atrás y los dos proyectos comparten base de datos.
 */

/** Deja el ajuste de confirmación como se pida, para toda la organización. */
async function pedirConfirmacion(request: APIRequestContext, activo: boolean): Promise<void> {
  const token = await tokenDe(request, CUENTAS.admin);
  const id = await organizacionId(request);
  const actual = (await (
    await request.get(`/api/v1/organizations/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { settings: Record<string, unknown> };

  const response = await request.patch(`/api/v1/organizations/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: { settings: { ...actual.settings, attendanceConfirmationEnabled: activo } },
  });
  expect(response.ok()).toBeTruthy();
}

/** Reserva una cita de invitado y devuelve su código de acceso. */
async function citaDeInvitado(request: APIRequestContext, nombre: string): Promise<string> {
  const publica = (await (
    await request.get(`/api/v1/public/organizations/${ORGANIZACION_SLUG}`)
  ).json()) as {
    organization: { id: string; timezone: string };
    services: { id: string }[];
  };

  const dia = new Intl.DateTimeFormat('sv-SE', { timeZone: publica.organization.timezone }).format(
    new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
  );

  const disponibilidad = (await (
    await request.get(
      `/api/v1/public/organizations/${publica.organization.id}/availability?serviceId=${publica.services[0].id}&from=${dia}&to=${dia}`,
    )
  ).json()) as { days: { date: string; slots: { startsAt: string }[] }[] };

  const huecos = disponibilidad.days.flatMap((jornada) => jornada.slots);
  expect(huecos.length).toBeGreaterThan(0);

  const response = await request.post(
    `/api/v1/organizations/${publica.organization.id}/appointments`,
    {
      data: {
        serviceId: publica.services[0].id,
        startsAt: huecos[0].startsAt,
        guest: { name: nombre, email: 'invitado@ejemplo.es' },
      },
    },
  );
  expect(response.status()).toBe(201);
  const cita = (await response.json()) as { accessCode: string };
  return cita.accessCode;
}

test.describe('confirmación de asistencia', () => {
  test('el enlace del recordatorio deja confirmar sin iniciar sesión', async ({
    page,
    request,
  }) => {
    await pedirConfirmacion(request, true);
    const codigo = await citaDeInvitado(request, `Confirma ${Date.now().toString().slice(-5)}`);

    await page.goto(`/consultar?c=${codigo}&accion=confirmar`);
    await page.getByRole('button', { name: 'Confirmo que voy' }).click();

    await expect(page.getByText('Gracias por confirmar')).toBeVisible();
  });

  test('avisar de que no se puede ir cancela la cita', async ({ page, request }) => {
    await pedirConfirmacion(request, true);
    const codigo = await citaDeInvitado(request, `Avisa ${Date.now().toString().slice(-5)}`);

    await page.goto(`/consultar?c=${codigo}&accion=cancelar`);
    await page.getByRole('button', { name: 'No puedo ir' }).click();

    await expect(page.getByText('La cita queda cancelada')).toBeVisible();
  });

  test('sin el ajuste activo no se ofrece confirmar', async ({ page, request }) => {
    await pedirConfirmacion(request, false);
    const codigo = await citaDeInvitado(request, `Sin ajuste ${Date.now().toString().slice(-5)}`);

    await page.goto(`/consultar?c=${codigo}`);

    await expect(page.getByRole('button', { name: 'Confirmo que voy' })).toHaveCount(0);
  });
});
