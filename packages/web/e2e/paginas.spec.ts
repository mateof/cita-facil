import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * El pie vive dentro del <main> del portal, así que no tiene rol
 * `contentinfo`: se localiza por el nombre de su navegación.
 */
const pieDelEstablecimiento = (page: Page) =>
  page.getByRole('navigation', { name: 'Información del establecimiento' });

/**
 * Páginas de contenido del establecimiento: contacto y sobre nosotros.
 *
 * El contenido lo escribe el negocio en Markdown o en HTML, así que además del
 * recorrido normal hay que comprobar que lo peligroso no llega al navegador.
 */

/** Deja una página guardada por API, que es preparación y no lo que se verifica. */
async function guardarPagina(
  request: APIRequestContext,
  key: 'contact' | 'about',
  datos: { title: string; body: string; format?: 'markdown' | 'html'; published?: boolean },
): Promise<void> {
  const token = await tokenDe(request, CUENTAS.admin);
  const organizacion = await organizacionId(request);
  const response = await request.put(`/api/v1/organizations/${organizacion}/pages/${key}`, {
    headers: { authorization: `Bearer ${token}` },
    data: {
      format: datos.format ?? 'markdown',
      title: { es: datos.title },
      body: { es: datos.body },
      published: datos.published ?? true,
    },
  });
  expect(response.ok()).toBeTruthy();
}

test.afterEach(async ({ request }) => {
  // Sin publicar y sin contenido: como estaban antes de la prueba.
  for (const key of ['contact', 'about'] as const) {
    await guardarPagina(request, key, { title: '', body: '', published: false });
  }
});

test.describe('páginas del establecimiento', () => {
  test('una página publicada se enlaza desde el pie de la reserva', async ({ page, request }) => {
    await guardarPagina(request, 'contact', { title: 'Contacto', body: '## Dónde estamos' });

    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(pieDelEstablecimiento(page).getByRole('link', { name: 'Contacto' })).toBeVisible();
  });

  test('sin páginas publicadas no aparece el pie', async ({ page, request }) => {
    await guardarPagina(request, 'contact', { title: 'Contacto', body: 'algo', published: false });

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(page.getByTestId('servicio').first()).toBeVisible();

    await expect(pieDelEstablecimiento(page)).toHaveCount(0);
  });

  test('el enlace del pie abre la página con su contenido', async ({ page, request }) => {
    await guardarPagina(request, 'about', {
      title: 'Sobre nosotros',
      body: '## Quiénes somos\n\nPeluquería de barrio desde 1998.',
    });

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await pieDelEstablecimiento(page).getByRole('link', { name: 'Sobre nosotros' }).click();

    await expect(page.getByRole('heading', { name: 'Quiénes somos' })).toBeVisible();
  });

  test('el Markdown se convierte a HTML', async ({ page, request }) => {
    await guardarPagina(request, 'contact', {
      title: 'Contacto',
      body: '**Teléfono:** 981 000 000\n\n- Lunes a viernes\n- Sábados',
    });

    await page.goto(`/${ORGANIZACION_SLUG}/contacto`);

    await expect(page.getByRole('listitem').filter({ hasText: 'Lunes a viernes' })).toBeVisible();
  });

  test('el HTML también se admite tal cual', async ({ page, request }) => {
    await guardarPagina(request, 'contact', {
      title: 'Contacto',
      format: 'html',
      body: '<h2>Visítanos</h2><p>Rúa Real, 12</p>',
    });

    await page.goto(`/${ORGANIZACION_SLUG}/contacto`);

    await expect(page.getByRole('heading', { name: 'Visítanos' })).toBeVisible();
  });

  /**
   * Regresión de seguridad: el token de sesión vive en memoria del navegador,
   * así que un script en la página de un establecimiento se llevaría la sesión
   * de quien la visite.
   */
  test('un script incrustado no llega al navegador', async ({ page, request }) => {
    await guardarPagina(request, 'contact', {
      title: 'Contacto',
      format: 'html',
      body: '<p>Hola</p><script>window.__colado = true;</script>',
    });

    await page.goto(`/${ORGANIZACION_SLUG}/contacto`);
    await expect(page.getByText('Hola')).toBeVisible();

    expect(await page.evaluate(() => '__colado' in window)).toBe(false);
  });

  test('un enlace con javascript: se queda sin destino', async ({ page, request }) => {
    await guardarPagina(request, 'contact', {
      title: 'Contacto',
      format: 'html',
      body: '<a href="javascript:alert(1)">pulsa aquí</a>',
    });

    await page.goto(`/${ORGANIZACION_SLUG}/contacto`);

    await expect(page.getByText('pulsa aquí')).not.toHaveAttribute('href', /javascript/);
  });

  /**
   * Escrita solo en un idioma, se enseña igualmente en los demás. Es la misma
   * degradación que usan los nombres y las descripciones de los servicios:
   * mejor leerlo en otro idioma que no encontrarlo.
   */
  test('una página escrita solo en otro idioma se enlaza igualmente', async ({ page, request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const organizacion = await organizacionId(request);
    await request.put(`/api/v1/organizations/${organizacion}/pages/contact`, {
      headers: { authorization: `Bearer ${token}` },
      data: { format: 'markdown', title: { gl: 'Contacto' }, body: { gl: 'Onde estamos' }, published: true },
    });

    await page.goto(`/${ORGANIZACION_SLUG}`);

    await expect(pieDelEstablecimiento(page).getByRole('link', { name: 'Contacto' })).toBeVisible();
  });

  test('una página publicada pero sin ningún contenido no se enlaza', async ({ page, request }) => {
    await guardarPagina(request, 'contact', { title: 'Contacto', body: '' });

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await expect(page.getByTestId('servicio').first()).toBeVisible();

    await expect(pieDelEstablecimiento(page)).toHaveCount(0);
  });
});

test.describe('editor de páginas', () => {
  test('lo que se guarda en el panel se publica en la página pública', async ({ page }) => {
    const texto = `Nuestra historia ${Date.now().toString().slice(-5)}`;

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/ajustes');
    await page.getByRole('button', { name: 'Páginas' }).click();
    await page.getByRole('button', { name: 'Sobre nosotros' }).click();

    await page.getByLabel('Título').fill('Sobre nosotros');
    await page.getByLabel(/Contenido/).fill(`## ${texto}`);
    await page.getByRole('switch', { name: 'Publicada' }).click();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status')).toBeVisible();

    await page.goto(`/${ORGANIZACION_SLUG}/sobre-nosotros`);
    await expect(page.getByRole('heading', { name: texto })).toBeVisible();
  });

  test('la vista previa enseña el contenido ya convertido', async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/ajustes');
    await page.getByRole('button', { name: 'Páginas' }).click();

    await page.getByLabel(/Contenido/).fill('## Un encabezado');
    await page.getByRole('button', { name: 'Vista previa' }).click();

    await expect(page.getByTestId('vista-previa').getByRole('heading', { name: 'Un encabezado' })).toBeVisible();
  });
});
