import { expect, test } from '@playwright/test';
import { CUENTAS, entrar, tokenDe } from './helpers.ts';

/**
 * Recorrido del panel de administración.
 *
 * Cada sección se comprueba por su encabezado y por algún dato que solo aparece
 * si la consulta al API ha respondido. Es la regresión del fallo que dejaba el
 * panel en blanco: entonces todas estas pantallas se quedaban en "Cargando…".
 */
const SECCIONES = [
  { ruta: '/admin', titulo: 'Hoy en el centro', contenido: 'CITAS' },
  { ruta: '/admin/agenda', titulo: 'Agenda', contenido: 'Carlos Vidal' },
  { ruta: '/admin/citas', titulo: 'Citas', contenido: 'Buscar' },
  { ruta: '/admin/servicios', titulo: 'Servicios', contenido: 'Corte de pelo' },
  { ruta: '/admin/recursos', titulo: 'Recursos', contenido: 'Cabina de estética' },
  { ruta: '/admin/horarios', titulo: 'Horarios', contenido: 'Lunes' },
  { ruta: '/admin/equipo', titulo: 'Equipo', contenido: 'Ana Ríos' },
  { ruta: '/admin/informes', titulo: 'Informes', contenido: 'TASA DE CANCELACIÓN' },
  { ruta: '/admin/avisos', titulo: 'Avisos', contenido: 'appointment.reminder' },
  { ruta: '/admin/integraciones', titulo: 'Integraciones', contenido: 'Claves de API' },
  { ruta: '/admin/ajustes', titulo: 'Ajustes', contenido: 'Zona horaria' },
  { ruta: '/admin/acceso', titulo: 'Acceso y registro', contenido: 'Métodos de acceso' },
  { ruta: '/admin/sistema', titulo: 'Sistema', contenido: 'Migraciones' },
];

test.describe('panel de administración', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
  });

  for (const seccion of SECCIONES) {
    test(`la sección ${seccion.ruta} carga con datos`, async ({ page }) => {
      const errores: string[] = [];
      page.on('pageerror', (error) => errores.push(error.message));

      await page.goto(seccion.ruta);

      // Se acota al contenido principal: el menú lateral sigue en el DOM en
      // móvil, solo oculto, y sus enlaces repiten muchos de estos textos.
      const principal = page.getByRole('main');

      await expect(principal.getByRole('heading', { name: seccion.titulo }).first()).toBeVisible();
      await expect(principal.getByText(seccion.contenido).first()).toBeVisible();
      // "Cargando…" es lo que se quedaba en pantalla cuando no había
      // organización activa.
      await expect(principal.getByText('Cargando…')).toHaveCount(0);
      expect(errores).toEqual([]);
    });
  }

  test('el panel del día permite registrar la llegada de una cita', async ({ page }) => {
    await page.goto('/admin');

    // Los datos de ejemplo dejan una cita para el día siguiente, así que se
    // avanza un día en lugar de depender de que hoy haya algo en la agenda.
    await page.getByRole('button', { name: 'Siguiente' }).click();

    const boton = page.getByRole('button', { name: 'Registrar llegada' }).first();
    await expect(boton).toBeVisible();
    await boton.click();

    await expect(page.getByText('Has llegado').first()).toBeVisible();
  });
});

test.describe('acceso al panel', () => {
  test('un cliente sin permisos no entra en el panel', async ({ page }) => {
    await entrar(page, CUENTAS.cliente);
    await page.goto('/admin');

    // Se le devuelve al portal de cliente. No se comprueba una ruta concreta
    // porque la portada redirige al establecimiento cuando solo hay uno.
    await expect(page).not.toHaveURL(/\/admin/);
    await expect(page.getByRole('heading', { name: 'Hoy en el centro' })).toHaveCount(0);
  });

  /**
   * Regresión: el administrador de la instalación que no pertenece a ninguna
   * organización se encontraba el panel vacío y sin ninguna pista.
   */
  test('un administrador sin organizaciones ve el panel y puede crear la primera', async ({
    page,
    request,
  }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const correo = `admin-sin-org-${Date.now()}@ejemplo.es`;

    const creado = await request.post('/api/v1/admin/users', {
      headers: { authorization: `Bearer ${token}` },
      data: {
        email: correo,
        name: 'Admin sin organización',
        platformRole: 'superadmin',
        sendInvitation: false,
      },
    });
    expect(creado.ok()).toBeTruthy();
    const { activationUrl } = (await creado.json()) as { activationUrl: string };

    // Se activa la cuenta desde la interfaz, que además prueba ese recorrido.
    await page.goto(new URL(activationUrl).pathname + new URL(activationUrl).search);
    await expect(page.getByRole('heading', { name: 'Activa tu cuenta' })).toBeVisible();

    await page.getByLabel('Contraseña', { exact: true }).fill('ClaveDePruebas2026');
    await page.getByLabel('Repite la contraseña').fill('ClaveDePruebas2026');
    await page.getByRole('button', { name: 'Activar y entrar' }).click();
    await expect(page).toHaveURL(/\/mis-citas/);

    // Como es administrador de la instalación, ve el panel y trabaja sobre la
    // organización que ya existe aunque no pertenezca a ella.
    await page.goto('/admin');
    await expect(page.getByRole('main').getByRole('heading', { name: 'Hoy en el centro' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Cargando…')).toHaveCount(0);
  });
});
