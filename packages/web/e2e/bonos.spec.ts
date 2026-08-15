import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, entrar, organizacionId, salir, tokenDe } from './helpers.ts';

/**
 * Bonos: series de sesiones prepagadas.
 *
 * Los datos de ejemplo dejan el servicio "Sesión de bronceado" marcado como
 * "solo con bono", dos tipos de bono (uno a la venta por la web y otro solo
 * de mostrador) y un bono con saldo para la clienta.
 */

const SERVICIO_CON_BONO = 'Sesión de bronceado';

/** Saldo de la clienta, leído por el API para no depender de la interfaz. */
async function saldoDe(
  request: APIRequestContext,
  cuenta: { email: string; password: string },
): Promise<number> {
  const token = await tokenDe(request, cuenta);
  const organizacion = await organizacionId(request);
  const response = await request.get(`/api/v1/organizations/${organizacion}/credits/balance`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as { available: number };
  return body.available;
}

test.describe('bonos en la reserva', () => {
  test('el servicio que necesita bono se marca en la lista', async ({ page }) => {
    await page.goto('/peluqueria-ejemplo');

    const servicio = page
      .getByTestId('servicio')
      .filter({ hasText: SERVICIO_CON_BONO });
    await expect(servicio).toContainText('Con bono');
  });

  test('sin sesión iniciada, el servicio de bono pide identificarse', async ({ page }) => {
    await page.goto('/peluqueria-ejemplo');
    await page.getByTestId('servicio').filter({ hasText: SERVICIO_CON_BONO }).click();

    await expect(page.getByTestId('bono-necesario')).toContainText('Identifícate');
  });

  test('con saldo, el servicio de bono deja elegir día', async ({ page }) => {
    await entrar(page, CUENTAS.cliente);
    await page.goto('/peluqueria-ejemplo');
    await page.getByTestId('servicio').filter({ hasText: SERVICIO_CON_BONO }).click();

    await expect(page.getByTestId('bono-necesario')).toHaveCount(0);
  });

  test('reservar con bono descuenta una sesión', async ({ page, request }) => {
    const antes = await saldoDe(request, CUENTAS.cliente);

    await entrar(page, CUENTAS.cliente);
    await page.goto('/peluqueria-ejemplo');
    await page.getByTestId('servicio').filter({ hasText: SERVICIO_CON_BONO }).click();

    // Mismo criterio que en la reserva normal: el primer día con hueco, por
    // atributo y no por texto, que lleva abreviaturas con tilde.
    await page.locator('[data-testid="dia"][data-disponible="si"]').first().click();
    await page.locator('[data-testid="hueco"]').first().click();
    await page.getByRole('button', { name: 'Confirmar reserva' }).click();
    await expect(page.getByRole('heading', { name: '¡Cita confirmada!' })).toBeVisible();

    expect(await saldoDe(request, CUENTAS.cliente)).toBe(antes - 1);
  });
});

test.describe('bonos del cliente', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.cliente);
  });

  test('la pantalla de bonos muestra el saldo disponible', async ({ page, request }) => {
    const saldo = await saldoDe(request, CUENTAS.cliente);
    await page.goto('/mis-bonos');

    await expect(page.getByRole('main').getByText(String(saldo), { exact: true })).toBeVisible();
  });

  test('solo se ofrece a la venta el bono con compra online', async ({ page }) => {
    await page.goto('/mis-bonos');

    const venta = page.getByRole('main').getByRole('heading', { name: 'A la venta' });
    await expect(venta).toBeVisible();
    await expect(page.getByRole('main')).not.toContainText('solo en el centro');
  });
});

test.describe('bonos desde el panel', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
  });

  test('la sección de bonos lista los tipos creados', async ({ page }) => {
    await page.goto('/admin/bonos');

    await expect(page.getByRole('main').getByText('Bono 10 sesiones').first()).toBeVisible();
  });

  test('un tipo de bono nuevo aparece a la venta para el cliente', async ({ page }) => {
    const nombre = `Bono de prueba ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/bonos');
    await page.getByRole('button', { name: 'Nuevo tipo de bono' }).click();
    await page.getByLabel('Nombre').fill(nombre);
    await page.getByLabel('Sesiones').fill('3');
    await page.getByLabel('Precio (céntimos)').fill('1500');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(nombre)).toBeVisible();

    await salir(page);
    await entrar(page, CUENTAS.cliente);
    await page.goto('/mis-bonos');
    await expect(page.getByRole('main').getByText(nombre)).toBeVisible();
  });

  test('entregar un bono deja saldo a esa persona', async ({ page, request }) => {
    const antes = await saldoDe(request, CUENTAS.personal);

    await page.goto('/admin/bonos');
    await page.getByRole('button', { name: 'Bonos emitidos' }).click();
    await page.getByRole('button', { name: 'Entregar bono' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Persona').fill(CUENTAS.personal.email);
    await dialogo.getByRole('option', { name: new RegExp(CUENTAS.personal.nombre) }).click();
    await dialogo.getByLabel('Tipo de bono').fill('Bono 10');
    await dialogo.getByRole('option', { name: /Bono 10 sesiones/ }).click();
    await dialogo.getByRole('button', { name: 'Entregar' }).click();

    await expect(page.getByRole('main')).toContainText(CUENTAS.personal.nombre);
    expect(await saldoDe(request, CUENTAS.personal)).toBe(antes + 10);
  });

  test('añadir una sesión a un bono emitido sube su saldo', async ({ page, request }) => {
    const antes = await saldoDe(request, CUENTAS.cliente);

    await page.goto('/admin/bonos');
    await page.getByRole('button', { name: 'Bonos emitidos' }).click();
    const fila = page.getByRole('row').filter({ hasText: CUENTAS.cliente.nombre }).first();
    await fila.getByRole('button', { name: 'Añadir una sesión' }).click();

    await expect
      .poll(() => saldoDe(request, CUENTAS.cliente))
      .toBe(antes + 1);
  });
});

/**
 * El buscador de personas es el mismo componente en toda la aplicación, así
 * que lo que se comprueba aquí (sugerencias mientras se escribe, acentos y
 * erratas) vale también para el resto de campos que enlazan entidades.
 */
test.describe('buscador de personas', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/bonos');
    await page.getByRole('button', { name: 'Bonos emitidos' }).click();
    await page.getByRole('button', { name: 'Entregar bono' }).click();
  });

  test('sugiere clientes escribiendo parte del nombre', async ({ page }) => {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Persona').fill('Luc');

    await expect(dialogo.getByRole('option', { name: /Lucía/ })).toBeVisible();
  });

  test('encuentra aunque no se escriban las tildes', async ({ page }) => {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Persona').fill('lucia');

    await expect(dialogo.getByRole('option', { name: /Lucía/ })).toBeVisible();
  });

  test('encuentra con una errata de tecleo', async ({ page }) => {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Persona').fill('lucai');

    await expect(dialogo.getByRole('option', { name: /Lucía/ })).toBeVisible();
  });

  test('se puede elegir con el teclado', async ({ page }) => {
    const dialogo = page.getByRole('dialog');
    const campo = dialogo.getByLabel('Persona');
    await campo.fill('Luc');
    await expect(dialogo.getByRole('option', { name: /Lucía/ })).toBeVisible();

    await campo.press('ArrowDown');
    await campo.press('Enter');

    await expect(campo).toHaveValue(/Lucía/);
  });

  /** El personal también recibe bonos, así que entra en las sugerencias. */
  test('sugiere también al personal del centro', async ({ page }) => {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Persona').fill('Carlos');

    await expect(dialogo.getByRole('option', { name: /Carlos/ })).toBeVisible();
  });
});

test.describe('editar un bono emitido', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/bonos');
    await page.getByRole('button', { name: 'Bonos emitidos' }).click();
  });

  test('cambiar las sesiones totales actualiza el saldo', async ({ page, request }) => {
    const fila = page.getByRole('row').filter({ hasText: CUENTAS.cliente.nombre }).first();
    await fila.getByRole('button', { name: 'Editar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Sesiones totales').fill('25');
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect.poll(() => saldoDe(request, CUENTAS.cliente)).toBeGreaterThan(20);
  });

  test('no deja dejar el bono por debajo de las sesiones usadas', async ({ page }) => {
    const fila = page.getByRole('row').filter({ hasText: CUENTAS.cliente.nombre }).first();
    await fila.getByRole('button', { name: 'Editar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Sesiones totales').fill('0');
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect(dialogo.getByRole('alert')).toBeVisible();
  });

  /** Guardar sin tocar nada no puede dejar el diálogo bloqueado con un error. */
  test('guardar sin cambios cierra el diálogo', async ({ page }) => {
    const fila = page.getByRole('row').filter({ hasText: CUENTAS.cliente.nombre }).first();
    await fila.getByRole('button', { name: 'Editar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect(dialogo).toHaveCount(0);
  });

  test('la nota escrita se conserva al reabrir el bono', async ({ page }) => {
    const nota = `Regalo ${Date.now().toString().slice(-5)}`;
    const fila = page.getByRole('row').filter({ hasText: CUENTAS.cliente.nombre }).first();
    await fila.getByRole('button', { name: 'Editar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Nota interna').fill(nota);
    await dialogo.getByRole('button', { name: 'Guardar' }).click();
    await expect(dialogo).toHaveCount(0);

    await fila.getByRole('button', { name: 'Editar' }).click();
    await expect(page.getByRole('dialog').getByLabel('Nota interna')).toHaveValue(nota);
  });

  test('el filtro por estado deja fuera los bonos activos', async ({ page }) => {
    await page.getByLabel('Estado').selectOption('cancelled');

    await expect(page.getByRole('main')).toContainText('No hay bonos emitidos con ese filtro');
  });
});
