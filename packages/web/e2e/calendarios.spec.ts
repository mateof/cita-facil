import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, organizacionId, tokenDe } from './helpers.ts';

/**
 * Calendario del profesional.
 *
 * La parte que se puede comprobar de punta a punta sin un calendario externo de
 * verdad es la agenda publicada: que la dirección se crea, que responde un
 * calendario y que rotarla anula la anterior.
 */
async function primerRecurso(request: APIRequestContext) {
  const token = await tokenDe(request, CUENTAS.admin);
  const organizacion = await organizacionId(request);

  const recursos = (await (
    await request.get(`/api/v1/organizations/${organizacion}/resources`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { id: string; name: string }[];

  return { token, organizacion, recurso: recursos[0]! };
}

test.describe('calendario del profesional', () => {
  test('la dirección publicada responde un calendario', async ({ request }) => {
    const { token, organizacion, recurso } = await primerRecurso(request);

    const creada = await request.post(
      `/api/v1/organizations/${organizacion}/resources/${recurso.id}/calendar-token`,
      { headers: { authorization: `Bearer ${token}` }, data: {} },
    );
    expect(creada.ok()).toBeTruthy();
    const { url } = (await creada.json()) as { url: string };

    const calendario = await request.get(new URL(url).pathname);

    expect(await calendario.text()).toContain('BEGIN:VCALENDAR');
  });

  test('se sirve como calendario, no como texto suelto', async ({ request }) => {
    const { token, organizacion, recurso } = await primerRecurso(request);
    const creada = await request.post(
      `/api/v1/organizations/${organizacion}/resources/${recurso.id}/calendar-token`,
      { headers: { authorization: `Bearer ${token}` }, data: {} },
    );
    const { url } = (await creada.json()) as { url: string };

    const calendario = await request.get(new URL(url).pathname);

    expect(calendario.headers()['content-type']).toContain('text/calendar');
  });

  /** Es lo único que anula una dirección compartida por error. */
  test('rotar la dirección deja la anterior sin servicio', async ({ request }) => {
    const { token, organizacion, recurso } = await primerRecurso(request);

    const primera = (await (
      await request.post(
        `/api/v1/organizations/${organizacion}/resources/${recurso.id}/calendar-token`,
        { headers: { authorization: `Bearer ${token}` }, data: {} },
      )
    ).json()) as { url: string };

    await request.post(
      `/api/v1/organizations/${organizacion}/resources/${recurso.id}/calendar-token`,
      { headers: { authorization: `Bearer ${token}` }, data: {} },
    );

    const respuesta = await request.get(new URL(primera.url).pathname);

    expect(respuesta.status()).toBe(404);
  });

  test('rechaza un calendario externo que apunte a la red interna', async ({ request }) => {
    const { token, organizacion, recurso } = await primerRecurso(request);

    const respuesta = await request.put(
      `/api/v1/organizations/${organizacion}/resources/${recurso.id}/calendar`,
      {
        headers: { authorization: `Bearer ${token}` },
        data: { url: 'http://127.0.0.1:6379/x.ics' },
      },
    );

    expect(respuesta.status()).toBe(400);
  });
});
