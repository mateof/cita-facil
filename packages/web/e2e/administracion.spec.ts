import { expect, test, type Page } from '@playwright/test';
import { CUENTAS, entrar, salir, tokenDe } from './helpers.ts';

/**
 * Operaciones del panel que cambian datos, verificadas de punta a punta:
 * lo que se crea en el panel tiene que verse después en la reserva pública.
 */
test.describe('gestión desde el panel', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
  });

  test('un servicio nuevo aparece en la página pública de reservas', async ({ page }) => {
    const nombre = `Masaje de prueba ${Date.now().toString().slice(-5)}`;

    await page.goto('/admin/servicios');
    await page.getByRole('button', { name: 'Nuevo servicio' }).click();

    await page.getByLabel('Nombre').fill(nombre);
    await page.getByLabel('Duración (min)').fill('45');
    await page.getByLabel('Precio (céntimos)').fill('2500');

    // Se asigna al recurso que ya existe para que tenga agenda.
    await page.getByRole('dialog').getByText('Cabina de estética').click();
    await page.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByText(nombre)).toBeVisible();

    await page.goto('/peluqueria-ejemplo');
    await expect(page.getByRole('button', { name: new RegExp(nombre) })).toBeVisible();
  });

  test('cambiar el nombre del establecimiento se refleja en la página pública', async ({ page }) => {
    const nombre = `Peluquería Ejemplo ${Date.now().toString().slice(-4)}`;

    await page.goto('/admin/ajustes');
    await page.getByLabel('Nombre').fill(nombre);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status')).toBeVisible();

    await page.goto('/peluqueria-ejemplo');
    await expect(page.getByRole('heading', { name: nombre })).toBeVisible();
  });

  test('desactivar un método de acceso lo quita de la pantalla de entrada', async ({ page }) => {
    await page.goto('/admin/acceso');

    const interruptor = page.getByRole('switch', { name: 'Passkey' });
    await expect(interruptor).toHaveAttribute('aria-checked', 'true');
    await interruptor.click();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status').first()).toBeVisible();

    await salir(page);
    await page.goto('/entrar');
    await expect(page.getByRole('button', { name: 'Entrar con passkey' })).toHaveCount(0);

    // Se vuelve a dejar como estaba para no condicionar al resto de pruebas.
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/acceso');
    await page.getByRole('switch', { name: 'Passkey' }).click();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status').first()).toBeVisible();
  });

  /**
   * Regresión: la bolita del interruptor se posicionaba sin `left`, así que
   * partía del centro del carril (posición estática dentro de un botón) y el
   * desplazamiento la sacaba fuera, encima del componente de al lado. Apagado
   * parecía encendido porque la bolita quedaba a la derecha en los dos casos.
   */
  const bolitaDelInterruptor = (page: Page, etiqueta: string) =>
    page.evaluate((nombre) => {
      const boton = [...document.querySelectorAll('[role="switch"]')].find(
        (elemento) => elemento.getAttribute('aria-label') === nombre,
      );
      const bolita = boton?.firstElementChild;
      if (!boton || !bolita) return null;
      // Se cierran las transiciones en curso para medir la posición final.
      bolita.getAnimations().forEach((animacion) => animacion.finish());
      const carril = boton.getBoundingClientRect();
      const caja = bolita.getBoundingClientRect();
      return {
        dentro: caja.left >= carril.left && caja.right <= carril.right,
        margenIzquierdo: Math.round(caja.left - carril.left),
        margenDerecho: Math.round(carril.right - caja.right),
      };
    }, etiqueta);

  // Se usa "Usuario y contraseña" y no se guarda: así estas dos pruebas no
  // dependen de en qué estado dejen los interruptores las demás.
  const INTERRUPTOR = 'Usuario y contraseña';

  test('la bolita del interruptor encendido se apoya en el borde derecho del carril', async ({
    page,
  }) => {
    await page.goto('/admin/acceso');
    await expect(page.getByRole('switch', { name: INTERRUPTOR })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await expect
      .poll(() => bolitaDelInterruptor(page, INTERRUPTOR))
      .toEqual({ dentro: true, margenIzquierdo: 22, margenDerecho: 2 });
  });

  test('la bolita del interruptor apagado se apoya en el borde izquierdo del carril', async ({
    page,
  }) => {
    await page.goto('/admin/acceso');
    await page.getByRole('switch', { name: INTERRUPTOR }).click();

    await expect
      .poll(() => bolitaDelInterruptor(page, INTERRUPTOR))
      .toEqual({ dentro: true, margenIzquierdo: 2, margenDerecho: 22 });
  });

  test('cerrar el registro impide crear cuentas nuevas', async ({ page, request }) => {
    const token = await tokenDe(request, CUENTAS.admin);
    const guardarModo = (registrationMode: string) =>
      request.put('/api/v1/admin/auth-settings', {
        headers: { authorization: `Bearer ${token}` },
        data: { registrationMode },
      });

    await page.goto('/admin/acceso');
    await page.getByRole('radio', { name: /^Cerrado/ }).check();
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByRole('status').first()).toBeVisible();

    try {
      await salir(page);
      await page.goto('/registro');

      await page.getByLabel('Nombre y apellidos').fill('Alguien de fuera');
      await page.getByLabel('Correo electrónico').fill(`fuera-${Date.now()}@ejemplo.es`);
      await page.getByLabel('Contraseña', { exact: true }).fill('ClaveLargaDePrueba1');
      await page.getByLabel('Repite la contraseña').fill('ClaveLargaDePrueba1');
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Crear cuenta' }).click();

      await expect(page.getByRole('alert')).toContainText(/cerrad/i);
    } finally {
      // El modo se restablece por API pase lo que pase: si esta prueba deja el
      // registro cerrado, arrastra a las demás.
      await guardarModo('open');
    }
  });

  test('el informe resume la actividad del periodo', async ({ page }) => {
    await page.goto('/admin/informes');
    const principal = page.getByRole('main');

    // `.first()`: "Citas" e "Ingresos" aparecen tanto en las cifras de arriba
    // como en los títulos de las gráficas, y sin acotar salta el modo estricto.
    await expect(principal.getByText('Citas').first()).toBeVisible();
    await expect(principal.getByText('Ingresos').first()).toBeVisible();
    await expect(principal.getByText('Servicios más solicitados')).toBeVisible();
  });
});

/**
 * Alta de cita desde el mostrador.
 *
 * Los dos caminos: enlazarla con una cuenta que ya existe, o apuntar los datos
 * de alguien que viene por primera vez. Antes solo se podía lo segundo, así
 * que una cita del panel nunca quedaba asociada a su cliente.
 */
test.describe('nueva cita desde el panel', () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/citas');
    await page.getByRole('button', { name: 'Nueva cita' }).click();
  });

  /** Elige servicio, día con hueco y la primera hora libre. */
  async function elegirHueco(page: Page): Promise<void> {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Servicio').fill('Corte');
    await dialogo.getByRole('option', { name: /Corte de pelo/ }).click();
    await dialogo.getByRole('button', { name: /^\d{2}:\d{2}$/ }).first().click();
  }

  test('el servicio se elige escribiendo parte del nombre', async ({ page }) => {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Servicio').fill('corte');

    await expect(dialogo.getByRole('option', { name: /Corte de pelo/ })).toBeVisible();
  });

  test('una cita a nombre de un cliente registrado queda enlazada con su cuenta', async ({
    page,
  }) => {
    const dialogo = page.getByRole('dialog');
    await elegirHueco(page);
    await dialogo.getByLabel('Cliente registrado').fill('Luc');
    await dialogo.getByRole('option', { name: /Lucía/ }).click();
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByRole('main')).toContainText('Lucía Pena');
  });

  test('con la cuenta enlazada no se piden los datos a mano', async ({ page }) => {
    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Cliente registrado').fill('Luc');
    await dialogo.getByRole('option', { name: /Lucía/ }).click();

    await expect(dialogo.getByLabel('Cliente', { exact: true })).toBeDisabled();
  });

  test('quien viene por primera vez se apunta a mano', async ({ page }) => {
    const nombre = `Visita ${Date.now().toString().slice(-5)}`;
    const dialogo = page.getByRole('dialog');
    await elegirHueco(page);
    await dialogo.getByLabel('Cliente', { exact: true }).fill(nombre);
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect(page.getByRole('main')).toContainText(nombre);
  });
});
