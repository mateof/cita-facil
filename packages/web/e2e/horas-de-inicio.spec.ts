import { expect, test, type APIRequestContext } from '@playwright/test';
import { CUENTAS, ORGANIZACION_SLUG, entrar, organizacionId, tokenDe } from './helpers.ts';

/**
 * A qué horas empieza cada servicio.
 *
 * Lo que importa comprobar es que lo que se elige en el panel sale por el API
 * de disponibilidad, que es de donde el cliente saca las horas. Cada prueba
 * crea su propio servicio y lo borra al terminar: la siembra la comparten los
 * dos proyectos y las demás pruebas.
 */

const PREFIJO = 'Servicio de horas';

async function cabeceras(request: APIRequestContext) {
  return { authorization: `Bearer ${await tokenDe(request, CUENTAS.admin)}` };
}

/** Crea un servicio de 45 minutos con el modo de inicio que se le pida. */
async function crearServicio(
  request: APIRequestContext,
  extra: Record<string, unknown>,
): Promise<{ id: string; organizacion: string }> {
  const organizacion = await organizacionId(request);
  const headers = await cabeceras(request);

  const respuesta = await request.post(`/api/v1/organizations/${organizacion}/services`, {
    headers,
    data: {
      name: `${PREFIJO} ${Date.now().toString().slice(-6)}`,
      durationMode: 'fixed',
      durationMinutes: 45,
      priceMode: 'fixed',
      priceCents: 1000,
      currency: 'EUR',
      capacity: 1,
      maxAdvanceDays: 365,
      ...extra,
    },
  });

  expect(respuesta.ok(), await respuesta.text()).toBeTruthy();
  const servicio = (await respuesta.json()) as { id: string };
  return { id: servicio.id, organizacion };
}

/** Las horas locales que ofrece el API para ese servicio, dentro de dos semanas. */
async function horasOfrecidas(
  request: APIRequestContext,
  organizacion: string,
  serviceId: string,
): Promise<{ dia: string; horas: string[] }[]> {
  const desde = new Date();
  desde.setDate(desde.getDate() + 7);
  const hasta = new Date(desde);
  hasta.setDate(hasta.getDate() + 6);

  const respuesta = await request.get(
    `/api/v1/public/organizations/${organizacion}/availability?serviceId=${serviceId}` +
      `&from=${desde.toISOString().slice(0, 10)}&to=${hasta.toISOString().slice(0, 10)}`,
  );
  expect(respuesta.ok()).toBeTruthy();

  const cuerpo = (await respuesta.json()) as {
    days: { date: string; slots: { localStartMinute: number }[] }[];
  };

  return cuerpo.days.map((dia) => ({
    dia: dia.date,
    horas: dia.slots.map((slot) => {
      const hora = Math.floor(slot.localStartMinute / 60);
      const minuto = slot.localStartMinute % 60;
      return `${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`;
    }),
  }));
}

test.afterEach(async ({ request }) => {
  const organizacion = await organizacionId(request);
  const headers = await cabeceras(request);
  const lista = (await (
    await request.get(`/api/v1/organizations/${organizacion}/services`, { headers })
  ).json()) as { id: string; name: string }[];

  for (const servicio of lista.filter((item) => item.name.startsWith(PREFIJO))) {
    await request.delete(`/api/v1/organizations/${organizacion}/services/${servicio.id}`, {
      headers,
    });
  }
});

test.describe('horas a las que empieza un servicio', () => {
  test('en punto: todas las horas ofrecidas caen en punto', async ({ request }) => {
    const { id, organizacion } = await crearServicio(request, {
      startMode: 'interval',
      startIntervalMinutes: 60,
    });

    const dias = await horasOfrecidas(request, organizacion, id);
    const todas = dias.flatMap((dia) => dia.horas);

    expect(todas.length, 'debería haber alguna hora en la semana').toBeGreaterThan(0);
    for (const hora of todas) expect(hora).toMatch(/:00$/);
  });

  test('con desfase, las horas caen a y cuarto y a menos cuarto', async ({ request }) => {
    const { id, organizacion } = await crearServicio(request, {
      startMode: 'interval',
      startIntervalMinutes: 30,
      startOffsetMinutes: 15,
    });

    const todas = (await horasOfrecidas(request, organizacion, id)).flatMap((dia) => dia.horas);

    expect(todas.length).toBeGreaterThan(0);
    for (const hora of todas) expect(hora).toMatch(/:(15|45)$/);
  });

  test('encadenadas: cada hora va pegada a la anterior', async ({ request }) => {
    const { id, organizacion } = await crearServicio(request, { startMode: 'sequence' });

    const dias = (await horasOfrecidas(request, organizacion, id)).filter(
      (dia) => dia.horas.length > 1,
    );
    expect(dias.length, 'debería haber algún día con varias horas').toBeGreaterThan(0);

    for (const dia of dias) {
      const minutos = dia.horas.map((hora) => {
        const [h, m] = hora.split(':');
        return Number(h) * 60 + Number(m);
      });
      // Puede haber varios tramos al día (mañana y tarde), así que se admite
      // que entre dos horas haya 45 minutos o un salto mayor por el cierre.
      for (let i = 1; i < minutos.length; i += 1) {
        expect(minutos[i]! - minutos[i - 1]!).toBeGreaterThanOrEqual(45);
      }
    }
  });

  test('horas fijas: solo esos días y a esas horas', async ({ request }) => {
    const { id, organizacion } = await crearServicio(request, {
      startMode: 'fixed',
      // Martes y jueves a las 12:00 y a las 17:00.
      startTimes: [{ weekdays: [2, 4], minutes: [12 * 60, 17 * 60] }],
    });

    const dias = await horasOfrecidas(request, organizacion, id);

    for (const dia of dias) {
      // getUTCDay: 0 es domingo; el horario del ejemplo es de lunes a sábado.
      const diaSemana = new Date(`${dia.dia}T12:00:00.000Z`).getUTCDay();
      const esMartesOJueves = diaSemana === 2 || diaSemana === 4;

      if (!esMartesOJueves) {
        expect(dia.horas, `${dia.dia} no debería ofrecer nada`).toEqual([]);
      } else {
        for (const hora of dia.horas) expect(['12:00', '17:00']).toContain(hora);
      }
    }

    const conHoras = dias.filter((dia) => dia.horas.length > 0);
    expect(conHoras.length, 'martes y jueves deberían tener horas').toBeGreaterThan(0);
  });

  test('el panel deja elegir el modo y guarda las horas fijas', async ({ page, request }) => {
    const { id, organizacion } = await crearServicio(request, { startMode: 'inherit' });

    await entrar(page, CUENTAS.admin);
    await page.goto('/admin/servicios');

    const fila = page.getByRole('listitem').filter({ hasText: PREFIJO });
    await fila.getByRole('button', { name: 'Editar' }).click();

    const dialogo = page.getByRole('dialog');
    await dialogo.getByLabel('Cuándo empieza la cita').selectOption('fixed');

    await dialogo.getByRole('button', { name: 'Añadir horario' }).click();
    await dialogo.getByRole('button', { name: 'M', exact: true }).first().click();
    await dialogo.getByLabel('Horas').fill('12:00, 17:00');
    await dialogo.getByRole('button', { name: 'Guardar' }).click();

    await expect(dialogo).toBeHidden();

    // Lo que se guardó es lo que hay que ver al volver a abrirlo.
    const guardado = (await (
      await request.get(`/api/v1/organizations/${organizacion}/services/${id}`, {
        headers: await cabeceras(request),
      })
    ).json()) as { startMode: string; startTimes: { weekdays: number[]; minutes: number[] }[] };

    expect(guardado.startMode).toBe('fixed');
    expect(guardado.startTimes[0]!.minutes).toEqual([12 * 60, 17 * 60]);
    expect(guardado.startTimes[0]!.weekdays).toEqual([2]);
  });
});
