import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import {
  closeTestDatabase,
  createTestDatabase,
  nextMonday,
  seedFixture,
  type Fixture,
} from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import {
  createForm,
  deleteForm,
  listForms,
  listResponses,
  pendingForms,
  saveFormResponse,
  setServiceForms,
} from '../src/modules/catalog/forms.ts';
import { createAppointment } from '../src/modules/appointments/service.ts';
import { localToInstant } from '../src/lib/dates.ts';

/**
 * Formularios y consentimientos.
 *
 * Lo que se comprueba es lo que protege al negocio: sin el consentimiento
 * obligatorio no se llega a crear la cita, y lo firmado no desaparece porque
 * alguien borre la hoja.
 */

let db: Kysely<Database>;
let fixture: Fixture;
let monday: string;

before(async () => {
  db = await createTestDatabase();
  fixture = await seedFixture(db);
  monday = nextMonday();
});

after(async () => {
  await closeTestDatabase(db);
});

beforeEach(async () => {
  await db.deleteFrom('form_responses').execute();
  await db.deleteFrom('service_forms').execute();
  await db.deleteFrom('forms').execute();
  await db.deleteFrom('appointments').execute();
});

async function consentimiento(options: { requiresSignature?: boolean } = {}) {
  return createForm(fixture.organizationId, {
    name: 'Consentimiento informado',
    kind: 'consent',
    fields: [],
    consentText: 'Autorizo el tratamiento.',
    requiresSignature: options.requiresSignature ?? false,
    active: true,
  });
}

async function formularioAlergias() {
  return createForm(fixture.organizationId, {
    name: 'Alergias',
    kind: 'form',
    fields: [
      { key: 'alergias', label: '¿Alguna alergia?', type: 'text', required: true, options: [] },
      { key: 'notas', label: 'Algo más', type: 'textarea', required: false, options: [] },
    ],
    active: true,
  });
}

async function reservar(hour: number, formResponses?: unknown[]) {
  return createAppointment(
    fixture.organizationId,
    {
      serviceId: fixture.serviceId,
      startsAt: localToInstant(monday, hour * 60, fixture.timezone),
      partySize: 1,
      formResponses: formResponses as never,
    },
    { userId: fixture.customerId, isStaff: false },
  );
}

describe('definición', () => {
  it('un consentimiento sin texto no se crea', async () => {
    await assert.rejects(
      createForm(fixture.organizationId, {
        name: 'Vacío',
        kind: 'consent',
        fields: [],
        active: true,
      }),
      /texto/,
    );
  });

  it('dos campos con la misma clave no se admiten', async () => {
    await assert.rejects(
      createForm(fixture.organizationId, {
        name: 'Repetido',
        kind: 'form',
        fields: [
          { key: 'x', label: 'Uno', type: 'text', required: false, options: [] },
          { key: 'x', label: 'Otro', type: 'text', required: false, options: [] },
        ],
        active: true,
      }),
      /misma clave/,
    );
  });

  /** Lo que alguien firmó no puede desaparecer porque el negocio cambie de hoja. */
  it('borrar un formulario con respuestas lo desactiva en lugar de borrarlo', async () => {
    const form = await consentimiento();
    await saveFormResponse(fixture.organizationId, {
      formId: form.id,
      answers: {},
      accepted: true,
    });

    await deleteForm(fixture.organizationId, form.id);

    const formularios = await listForms(fixture.organizationId);
    assert.equal(formularios[0]?.active, false);
  });

  it('borrar un formulario sin respuestas sí lo borra', async () => {
    const form = await formularioAlergias();

    await deleteForm(fixture.organizationId, form.id);

    assert.equal((await listForms(fixture.organizationId)).length, 0);
  });
});

describe('qué se pide y cuándo', () => {
  it('el servicio pide lo que se le engancha', async () => {
    const form = await formularioAlergias();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: true, oncePerCustomer: false, sortOrder: 0 },
    ]);

    const pendientes = await pendingForms(fixture.organizationId, fixture.serviceId, null);

    assert.equal(pendientes.length, 1);
  });

  it('lo de "una sola vez" no se vuelve a pedir a quien ya lo firmó', async () => {
    const form = await consentimiento();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: true, oncePerCustomer: true, sortOrder: 0 },
    ]);
    await saveFormResponse(
      fixture.organizationId,
      { formId: form.id, answers: {}, accepted: true },
      { customerId: fixture.customerId },
    );

    const pendientes = await pendingForms(
      fixture.organizationId,
      fixture.serviceId,
      fixture.customerId,
    );

    assert.equal(pendientes.length, 0);
  });

  /** Sin cuenta no hay a quién atribuirle lo de la vez anterior. */
  it('a quien reserva sin cuenta se le pide siempre', async () => {
    const form = await consentimiento();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: true, oncePerCustomer: true, sortOrder: 0 },
    ]);

    const pendientes = await pendingForms(fixture.organizationId, fixture.serviceId, null);

    assert.equal(pendientes.length, 1);
  });
});

describe('respuestas', () => {
  it('un consentimiento sin aceptar no se guarda', async () => {
    const form = await consentimiento();

    await assert.rejects(
      saveFormResponse(fixture.organizationId, {
        formId: form.id,
        answers: {},
        accepted: false,
      }),
      /aceptar/,
    );
  });

  it('un consentimiento con firma obligatoria la exige', async () => {
    const form = await consentimiento({ requiresSignature: true });

    await assert.rejects(
      saveFormResponse(fixture.organizationId, {
        formId: form.id,
        answers: {},
        accepted: true,
      }),
      /firma/,
    );
  });

  it('un campo obligatorio sin responder no se guarda', async () => {
    const form = await formularioAlergias();

    await assert.rejects(
      saveFormResponse(fixture.organizationId, {
        formId: form.id,
        answers: { notas: 'nada' },
        accepted: false,
      }),
      /Falta responder/,
    );
  });

  it('deja constancia de la fecha de aceptación', async () => {
    const form = await consentimiento();

    const respuesta = await saveFormResponse(fixture.organizationId, {
      formId: form.id,
      answers: {},
      accepted: true,
    });

    assert.ok(respuesta.acceptedAt);
  });
});

describe('al reservar', () => {
  it('sin el consentimiento obligatorio no se crea la cita', async () => {
    const form = await consentimiento();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: true, oncePerCustomer: false, sortOrder: 0 },
    ]);

    await assert.rejects(reservar(9), /Falta responder/);
  });

  it('con el consentimiento firmado la cita se crea', async () => {
    const form = await consentimiento();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: true, oncePerCustomer: false, sortOrder: 0 },
    ]);

    const { appointment } = await reservar(10, [
      { formId: form.id, answers: {}, accepted: true },
    ]);

    assert.equal(appointment.status, 'confirmed');
  });

  it('la respuesta queda enganchada a la cita', async () => {
    const form = await consentimiento();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: true, oncePerCustomer: false, sortOrder: 0 },
    ]);

    const { appointment } = await reservar(11, [
      { formId: form.id, answers: {}, accepted: true },
    ]);

    const respuestas = await listResponses(fixture.organizationId, {
      appointmentId: appointment.id,
    });
    assert.equal(respuestas.length, 1);
  });

  /**
   * En un centro real el consentimiento se firma al llegar, con el papel
   * delante. Bloquear el alta por teléfono obligaría a inventar una aceptación.
   */
  it('el mostrador puede reservar sin el formulario', async () => {
    const form = await consentimiento();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: true, oncePerCustomer: false, sortOrder: 0 },
    ]);

    const { appointment } = await createAppointment(
      fixture.organizationId,
      {
        serviceId: fixture.serviceId,
        startsAt: localToInstant(monday, 12 * 60, fixture.timezone),
        partySize: 1,
        customerId: fixture.customerId,
      },
      { userId: 'empleado', isStaff: true },
    );

    assert.equal(appointment.status, 'confirmed');
  });

  it('un formulario opcional no bloquea la reserva', async () => {
    const form = await formularioAlergias();
    await setServiceForms(fixture.organizationId, fixture.serviceId, [
      { formId: form.id, required: false, oncePerCustomer: false, sortOrder: 0 },
    ]);

    const { appointment } = await reservar(13);

    assert.equal(appointment.status, 'confirmed');
  });
});
