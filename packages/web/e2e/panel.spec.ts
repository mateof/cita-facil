import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, tokenDe } from './helpers.ts';

/**
 * Deja una cita nueva en el primer día próximo con huecos libres y devuelve el
 * nombre con el que aparece en el panel y cuántos días hay que avanzar desde
 * hoy para verla.
 *
 * No vale con reservar "mañana" a secas: el horario de ejemplo cierra los
 * domingos, así que los sábados no habría ningún hueco y el test caería. Se
 * recorren los días siguientes hasta dar con uno abierto.
 *
 * Registrar una llegada no tiene vuelta atrás (`checked_in` no puede volver a
 * `confirmed`, y así debe ser), y los dos proyectos (escritorio y móvil)
 * comparten servidor y base de datos. Si ambos se pelean por la única cita de
 * ejemplo, el segundo ya no encuentra el botón. Cada uno crea la suya, con
 * nombre propio para no confundirlas entre sí.
 */
async function citaParaRegistrar(
  request: APIRequestContext,
): Promise<{ nombre: string; saltos: number }> {
  const nombre = `Cliente de paso ${Date.now().toString().slice(-5)}`;

  const publica = (await (
    await request.get(`/api/v1/public/organizations/${ORGANIZACION_SLUG}`)
  ).json()) as {
    organization: { id: string; timezone: string };
    services: { id: string }[];
  };
  const organizacion = publica.organization.id;
  const servicio = publica.services[0].id;

  // Días en la zona de la organización, que son los que enseña el panel al
  // pulsar "Siguiente". Calcularlos en UTC no vale: a última hora del día
  // señalarían al siguiente. `sv-SE` da el formato `YYYY-MM-DD`.
  const enLaZona = new Intl.DateTimeFormat('sv-SE', {
    timeZone: publica.organization.timezone,
  });

  for (let saltos = 1; saltos <= 7; saltos++) {
    const dia = enLaZona.format(new Date(Date.now() + saltos * 24 * 60 * 60 * 1000));

    const disponibilidad = (await (
      await request.get(
        `/api/v1/public/organizations/${organizacion}/availability?serviceId=${servicio}&from=${dia}&to=${dia}`,
      )
    ).json()) as { days: { date: string; slots: { startsAt: string; resourceIds: string[] }[] }[] };
    const huecos = disponibilidad.days.find((jornada) => jornada.date === dia)?.slots ?? [];
    if (huecos.length === 0) continue;

    // Sin token a propósito: reservando como personal, la cita se apunta a la
    // cuenta que la crea y en el panel saldría con el nombre del administrador.
    const response = await request.post(`/api/v1/organizations/${organizacion}/appointments`, {
      data: {
        serviceId: servicio,
        startsAt: huecos[0].startsAt,
        resourceId: huecos[0].resourceIds[0],
        guest: { name: nombre, email: 'cliente-de-paso@ejemplo.es' },
      },
    });
    expect(response.status()).toBe(201);

    return { nombre, saltos };
  }

  throw new Error('no hay ningún hueco libre en los próximos 7 días');
}

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

  test('el panel del día permite registrar la llegada de una cita', async ({ page, request }) => {
    const { nombre: cliente, saltos } = await citaParaRegistrar(request);

    await page.goto('/admin');
    // La cita se creó en el primer día próximo con hueco: se avanza el panel
    // hasta ese día en vez de mirar la agenda de hoy.
    for (let i = 0; i < saltos; i++) {
      await page.getByRole('button', { name: 'Siguiente' }).click();
    }

    const fila = page.getByRole('listitem').filter({ hasText: cliente });
    await fila.getByRole('button', { name: 'Registrar llegada' }).click();

    await expect(fila.getByText('Has llegado')).toBeVisible();
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
