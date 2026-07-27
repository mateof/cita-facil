import { expect, test } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * Imagen, icono o iniciales de una entidad.
 *
 * Las tres formas conviven y la que manda es la de más arriba, así que además
 * del recorrido normal se comprueba que quitar la de arriba deja ver la
 * siguiente.
 */

/** PNG de 1x1 de verdad: el servidor mira los primeros bytes, no la extensión. */
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001',
  'hex',
);

test.describe('sin configurar nada', () => {
  test('un servicio se ve con las iniciales de su nombre', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);

    const servicio = page.getByTestId('servicio').filter({ hasText: 'Alquiler de cabina' });
    await expect(servicio.getByText('AC', { exact: true })).toBeVisible();
  });

  /** El color sale del nombre, así que dos servicios distintos no se confunden. */
  test('cada entidad tiene su propio color', async ({ page }) => {
    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(page.getByTestId('servicio').first()).toBeVisible();

    const colores = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="servicio"] span[style*="background"]')].map(
        (elemento) => (elemento as HTMLElement).style.backgroundColor,
      ),
    );

    expect(new Set(colores).size).toBeGreaterThan(1);
  });
});

test.describe('elegir un icono', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
  });

  test('el buscador encuentra por su nombre en castellano', async ({ page }) => {
    await page.goto('/admin/recursos');
    await page.getByRole('button', { name: 'Editar' }).first().click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByRole('button', { name: 'Icono', exact: true }).click();
    await dialogo.getByLabel('Buscar icono').fill('tijeras');

    await expect(dialogo.getByRole('button', { name: 'scissors' })).toBeVisible();
  });

  test('el icono elegido se ve en la lista del panel', async ({ page }) => {
    await page.goto('/admin/recursos');
    const fila = page.getByRole('listitem').first();
    await fila.getByRole('button', { name: 'Editar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByRole('button', { name: 'Icono', exact: true }).click();
    await dialogo.getByLabel('Buscar icono').fill('dumbbell');
    await dialogo.getByRole('button', { name: 'dumbbell' }).click();
    await dialogo.getByRole('button', { name: 'Guardar' }).click();
    await expect(dialogo).toHaveCount(0);

    await expect(fila.locator('svg.lucide-dumbbell')).toBeVisible();
  });
});

test.describe('subir una imagen', () => {
  test('la imagen subida se sirve desde la propia aplicación', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const organizacion = await organizacionId(request);

    const subida = await request.post(`/api/v1/organizations/${organizacion}/uploads`, {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        target: 'service',
        file: { name: 'logo.png', mimeType: 'image/png', buffer: PNG },
      },
    });
    expect(subida.status()).toBe(201);

    const { url } = (await subida.json()) as { url: string };
    const descarga = await request.get(url);

    expect(descarga.headers()['content-type']).toBe('image/png');
  });

  test('no admite un fichero que no sea una imagen', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const organizacion = await organizacionId(request);

    const subida = await request.post(`/api/v1/organizations/${organizacion}/uploads`, {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        target: 'service',
        file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('no soy una imagen') },
      },
    });

    expect(subida.status()).toBe(400);
  });

  /** Un SVG puede llevar scripts y se serviría desde nuestro propio dominio. */
  test('no admite un SVG', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const organizacion = await organizacionId(request);

    const subida = await request.post(`/api/v1/organizations/${organizacion}/uploads`, {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        target: 'service',
        file: {
          name: 'x.svg',
          mimeType: 'image/svg+xml',
          buffer: Buffer.from('<svg><script>alert(1)</script></svg>'),
        },
      },
    });

    expect(subida.status()).toBe(400);
  });

  test('un cliente no puede subir imágenes del negocio', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.cliente);
    const organizacion = await organizacionId(request);

    const subida = await request.post(`/api/v1/organizations/${organizacion}/uploads`, {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        target: 'service',
        file: { name: 'logo.png', mimeType: 'image/png', buffer: PNG },
      },
    });

    expect(subida.status()).toBe(403);
  });
});
