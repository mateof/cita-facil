import { expect, test } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * Alta de organizaciones desde el panel.
 *
 * La instalación es multi-tenant: cada organización es un negocio con su
 * catálogo, su personal y sus clientes. Estas pruebas verifican que el
 * administrador de la instalación puede crear una segunda y que lo que hay
 * dentro de una no se ve desde la otra.
 */

const PREFIJO = 'Gimnasio de prueba';

test.describe('organizaciones', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
  });

  /**
   * Limpieza por API: si una prueba falla a mitad, la organización que haya
   * creado no puede quedarse ahí condicionando a las siguientes.
   */
  test.afterEach(async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const response = await request.get('/api/v1/organizations', {
      headers: { authorization: `Bearer ${token}` },
    });
    const organizaciones = (await response.json()) as { id: string; name: string }[];

    for (const organizacion of organizaciones.filter((item) => item.name.startsWith(PREFIJO))) {
      await request.delete(`/api/v1/organizations/${organizacion.id}`, {
        headers: { authorization: `Bearer ${token}` },
      });
    }
  });

  test('el administrador de la instalación crea una organización nueva', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();

    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();
  });

  test('la organización nueva empieza con su catálogo vacío', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    // Al crearla se pasa a trabajar en ella, así que los servicios que se ven
    // son los suyos: ninguno. Los de la peluquería no se cruzan.
    await page.goto('/admin/servicios');
    await expect(page.getByRole('main').getByText('Corte de pelo')).toHaveCount(0);
  });

  test('la organización nueva aparece en el portal público', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    await page.goto('/');
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();
  });

  /**
   * Con dos negocios en la instalación, el directorio deja de ser público: el
   * visitante llega por el enlace de uno concreto y la lista de los demás no le
   * incumbe. La excepción es la instalación de un solo negocio, donde no hay
   * nada que enumerar y la interfaz necesita la respuesta para saltar a él.
   */
  test('el directorio de negocios no se sirve sin sesión', async ({ page, request }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    // `request` no lleva la sesión del navegador: es un visitante cualquiera.
    const anonima = await request.get('/api/v1/public/organizations');
    expect(anonima.ok()).toBeTruthy();
    expect(await anonima.json()).toEqual([]);

    const token = await tokenDe(request, CUENTAS.admin);
    const conSesion = await request.get('/api/v1/public/organizations', {
      headers: { authorization: `Bearer ${token}` },
    });
    const negocios = (await conSesion.json()) as { name: string }[];
    expect(negocios.length).toBeGreaterThan(1);
    expect(negocios.map((negocio) => negocio.name)).toContain(nombre);
  });

  /**
   * "Reservar" lleva al negocio en curso, no a la portada, así que con varios
   * negocios hace falta una forma de cambiar de establecimiento sin escribir la
   * dirección a mano. El selector solo se pinta con sesión y con más de uno.
   */
  test('con varios negocios, el portal deja cambiar de establecimiento', async ({
    page,
    request,
  }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    // La dirección se calcula del nombre; se pregunta en vez de adivinarla.
    const token = await tokenDe(request, CUENTAS.admin);
    const todas = (await (
      await request.get('/api/v1/organizations', {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as { name: string; slug: string }[];
    const creada = todas.find((organizacion) => organizacion.name === nombre);
    expect(creada, 'la organización recién creada no aparece en el listado').toBeTruthy();

    await page.goto(`/${ORGANIZACION_SLUG}`);
    await page.getByRole('button', { name: 'Cambiar de establecimiento' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Establecimiento').fill(nombre);
    await dialogo.getByRole('option', { name: new RegExp(nombre) }).click();

    await expect(page).toHaveURL(new RegExp(`/${creada!.slug}$`));
  });

  test('dar de baja una organización la quita del panel', async ({ page }) => {
    const nombre = `${PREFIJO} ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/organizaciones');
    await page.getByRole('button', { name: 'Nueva organización' }).click();
    await page.getByLabel('Nombre del negocio').fill(nombre);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();

    const fila = page.getByRole('listitem').filter({ hasText: nombre });
    await fila.getByRole('button', { name: 'Eliminar' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Dar de baja' }).click();

    await expect(page.getByRole('main').getByText(nombre)).toHaveCount(0);
  });

  test('un cliente no puede crear organizaciones', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.cliente);

    const response = await request.post('/api/v1/organizations', {
      headers: { authorization: `Bearer ${token}` },
      data: { name: 'Chiringuito', timezone: 'Europe/Madrid', locale: 'es', currency: 'EUR' },
    });

    expect(response.status()).toBe(403);
  });
});

test.describe('direcciones de las organizaciones', () => {
  test('la organización se sirve en la raíz, por su dirección', async ({ page }) => {
    await page.goto('/peluqueria-ejemplo');

    await expect(page.getByRole('heading', { name: /Peluquería Ejemplo/ })).toBeVisible();
  });

  test('la dirección antigua redirige a la nueva', async ({ page }) => {
    await page.goto('/reservar/peluqueria-ejemplo');

    await expect(page).toHaveURL(/\/peluqueria-ejemplo$/);
  });

  test('la dirección antigua conserva el resto de la ruta', async ({ page, request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const organizacion = await organizacionId(request);
    await request.put(`/api/v1/organizations/${organizacion}/pages/contact`, {
      headers: { authorization: `Bearer ${token}` },
      data: { title: { es: 'Contacto' }, body: { es: 'Rúa Real, 12' }, published: true },
    });

    try {
      await page.goto('/reservar/peluqueria-ejemplo/contacto');

      await expect(page).toHaveURL(/\/peluqueria-ejemplo\/contacto$/);
    } finally {
      // La página se despublica pase lo que pase: otras pruebas comprueban que
      // sin contenido publicado no aparece el pie.
      await request.put(`/api/v1/organizations/${organizacion}/pages/contact`, {
        headers: { authorization: `Bearer ${token}` },
        data: { title: { es: '' }, body: { es: '' }, published: false },
      });
    }
  });

  /**
   * Cada organización vive en la raíz, así que su dirección compite con las
   * pantallas de la aplicación: una llamada "admin" dejaría el panel
   * inaccesible.
   */
  test('no se puede dar a una organización una dirección reservada', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);

    const response = await request.post('/api/v1/organizations', {
      headers: { authorization: `Bearer ${token}` },
      data: { name: 'Intento', slug: 'admin', timezone: 'Europe/Madrid', locale: 'es', currency: 'EUR' },
    });

    expect(response.status()).toBe(422);
  });

  test('un nombre que sale reservado se corrige solo al crearla', async ({ request }) => {
    const token = await tokenDe(request, CUENTAS.admin);

    // "Perfil" daría el slug `perfil`, que es una pantalla del portal.
    const response = await request.post('/api/v1/organizations', {
      headers: { authorization: `Bearer ${token}` },
      data: { name: 'Perfil', timezone: 'Europe/Madrid', locale: 'es', currency: 'EUR' },
    });
    expect(response.ok()).toBeTruthy();

    const creada = (await response.json()) as { id: string; slug: string };
    await request.delete(`/api/v1/organizations/${creada.id}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(creada.slug).not.toBe('perfil');
  });
});
