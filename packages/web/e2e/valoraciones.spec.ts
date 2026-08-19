import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * Valoraciones: de la cita completada a la página pública.
 *
 * El recorrido completo pasa por tres manos, y la prueba las recorre todas:
 * la clienta valora, el negocio aprueba y el visitante lo ve.
 */

async function ajustar(request: APIRequestContext, valores: Record<string, unknown>): Promise<void> {
  const token = await tokenDe(request, CUENTAS.admin);
  const id = await organizacionId(request);
  const actual = (await (
    await request.get(`/api/v1/organizations/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  ).json()) as { settings: Record<string, unknown> };

  const response = await request.patch(`/api/v1/organizations/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: { settings: { ...actual.settings, ...valores } },
  });
  expect(response.ok()).toBeTruthy();
}

/**
 * Deja una valoración de la clienta de ejemplo sobre una cita completada, y
 * devuelve su identificador para poder moderarla.
 */
async function valorar(request: APIRequestContext, nota: number, comentario: string) {
  const clienta = await tokenDe(request, CUENTAS.cliente);
  const admin = await tokenDe(request, CUENTAS.admin);
  const organizacion = await organizacionId(request);

  const publica = (await (
    await request.get(`/api/v1/public/organizations/${ORGANIZACION_SLUG}`)
  ).json()) as { organization: { timezone: string }; services: { id: string }[] };

  // Rango de dos semanas: pidiendo un solo día se cae en cuanto ese día es
  // domingo, que la sede de ejemplo cierra, o se lo han llevado otras pruebas.
  const desde = new Intl.DateTimeFormat('sv-SE', {
    timeZone: publica.organization.timezone,
  }).format(new Date());
  const hasta = new Intl.DateTimeFormat('sv-SE', {
    timeZone: publica.organization.timezone,
  }).format(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000));

  const disponibilidad = (await (
    await request.get(
      `/api/v1/public/organizations/${organizacion}/availability?serviceId=${publica.services[0].id}&from=${desde}&to=${hasta}`,
    )
  ).json()) as { days: { slots: { startsAt: string }[] }[] };
  const huecos = disponibilidad.days.flatMap((jornada) => jornada.slots);
  expect(huecos.length, 'la agenda de pruebas se ha quedado sin huecos').toBeGreaterThan(0);

  const creada = await request.post(`/api/v1/organizations/${organizacion}/appointments`, {
    headers: { authorization: `Bearer ${clienta}` },
    data: { serviceId: publica.services[0].id, startsAt: huecos[0].startsAt },
  });
  expect(creada.status()).toBe(201);
  const cita = (await creada.json()) as { id: string };

  // Solo se puede valorar una cita completada, y completarla es cosa del centro.
  const completada = await request.post(
    `/api/v1/organizations/${organizacion}/appointments/${cita.id}/status`,
    { headers: { authorization: `Bearer ${admin}` }, data: { status: 'completed' } },
  );
  expect(completada.ok()).toBeTruthy();

  const valoracion = await request.post(
    `/api/v1/organizations/${organizacion}/appointments/${cita.id}/review`,
    { headers: { authorization: `Bearer ${clienta}` }, data: { rating: nota, comment: comentario } },
  );
  expect(valoracion.status()).toBe(201);

  const listado = (await (
    await request.get(`/api/v1/organizations/${organizacion}/reviews`, {
      headers: { authorization: `Bearer ${admin}` },
    })
  ).json()) as { items: { id: string; comment: string | null }[] };

  const mia = listado.items.find((item) => item.comment === comentario);
  expect(mia).toBeTruthy();
  return { organizacion, admin, reviewId: mia!.id };
}

test.describe('valoraciones', () => {
  test('una valoración nueva llega sin publicar al panel', async ({ page, request }) => {
    const comentario = `Sin aprobar ${Date.now().toString().slice(-5)}`;
    await ajustar(request, { publicReviewsEnabled: true, reviewsRequireApproval: true });
    await valorar(request, 5, comentario);

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/citas');
    await page.getByRole('button', { name: 'Valoraciones' }).click();

    const fila = page.getByRole('listitem').filter({ hasText: comentario });
    await expect(fila.getByText('Sin publicar')).toBeVisible();
  });

  test('al publicarla aparece en la página del establecimiento', async ({ page, request }) => {
    const comentario = `Publicada ${Date.now().toString().slice(-5)}`;
    await ajustar(request, { publicReviewsEnabled: true, reviewsRequireApproval: true });
    const { organizacion, admin, reviewId } = await valorar(request, 5, comentario);

    const publicada = await request.patch(
      `/api/v1/organizations/${organizacion}/reviews/${reviewId}`,
      { headers: { authorization: `Bearer ${admin}` }, data: { published: true } },
    );
    expect(publicada.ok()).toBeTruthy();

    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(page.getByText(comentario)).toBeVisible();
  });

  test('sin el ajuste de publicación la página no enseña valoraciones', async ({
    page,
    request,
  }) => {
    await ajustar(request, { publicReviewsEnabled: false });

    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(page.getByRole('heading', { name: 'Valoraciones' })).toHaveCount(0);
  });
});
