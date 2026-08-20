import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { newId, shortCode } from '../src/lib/ids.ts';
import { isoNow } from '../src/lib/dates.ts';
import { applyTemplate } from '../src/modules/catalog/templates.ts';
import { listServices } from '../src/modules/catalog/service.ts';
import { computeAvailability } from '../src/modules/availability/engine.ts';
import { ORGANIZATION_TEMPLATES } from '@cita-facil/shared';

/**
 * Plantillas de alta.
 *
 * Lo que se comprueba es lo que promete la funcionalidad: después de aplicar
 * una plantilla, la organización tiene agenda de verdad y se pueden ver huecos
 * sin haber configurado nada a mano.
 */

let db: Kysely<Database>;

before(async () => {
  db = await createTestDatabase();
});

after(async () => {
  await closeTestDatabase(db);
});

let organizationId: string;

beforeEach(async () => {
  organizationId = await organizacionVacia();
});

/** Una organización con su sede y nada más, como la deja el alta. */
async function organizacionVacia(): Promise<string> {
  const id = newId();
  const now = isoNow();

  await db
    .insertInto('organizations')
    .values({
      id,
      slug: `plantilla-${shortCode(6).toLowerCase()}`,
      name: 'Negocio nuevo',
      timezone: 'Europe/Madrid',
      locale: 'es',
      currency: 'EUR',
      email: null,
      phone: null,
      tax_id: null,
      settings_json: null,
      status: 'active',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  await db
    .insertInto('locations')
    .values({
      id: newId(),
      organization_id: id,
      slug: `sede-${shortCode(6).toLowerCase()}`,
      name: 'Sede',
      timezone: 'Europe/Madrid',
      address_line: null,
      city: null,
      postal_code: null,
      region: null,
      country: 'ES',
      latitude: null,
      longitude: null,
      phone: null,
      email: null,
      description_json: null,
      active: 1,
      sort_order: 0,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    })
    .execute();

  return id;
}

/** Próximo miércoles, que todas las plantillas tienen abierto. */
function proximoMiercoles(): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() !== 3);
  return date.toISOString().slice(0, 10);
}

describe('aplicar una plantilla', () => {
  it('crea los servicios de la plantilla', async () => {
    const resultado = await applyTemplate(organizationId, 'hairdresser');

    assert.equal(resultado.services, 4);
  });

  it('crea los recursos de la plantilla', async () => {
    const resultado = await applyTemplate(organizationId, 'hairdresser');

    assert.equal(resultado.resources, 2);
  });

  /** Es lo que de verdad promete: agenda con huecos sin tocar nada. */
  it('deja la agenda con huecos el primer día laborable', async () => {
    await applyTemplate(organizationId, 'hairdresser');
    const servicios = await listServices(organizationId, { onlyActive: true });

    const disponibilidad = await computeAvailability({
      organizationId,
      serviceId: servicios[0]!.id,
      from: proximoMiercoles(),
    });

    assert.ok((disponibilidad.days[0]?.slots.length ?? 0) > 0);
  });

  it('el nombre del servicio viaja en los tres idiomas', async () => {
    await applyTemplate(organizationId, 'hairdresser');

    const servicios = await listServices(organizationId, {});
    assert.equal((servicios[0]?.nameI18n as { en?: string } | null)?.en, 'Haircut');
  });

  it('la plantilla de gimnasio deja un bono a la venta', async () => {
    await applyTemplate(organizationId, 'gym');

    const bonos = await db
      .selectFrom('credit_packs')
      .select(['id'])
      .where('organization_id', '=', organizationId)
      .execute();

    assert.equal(bonos.length, 1);
  });

  it('la plantilla de clínica deja el consentimiento enganchado', async () => {
    await applyTemplate(organizationId, 'clinic');

    const enganches = await db
      .selectFrom('service_forms')
      .select(['form_id'])
      .execute();

    assert.ok(enganches.length > 0);
  });

  it('la plantilla de barbería enciende la cola sin cita', async () => {
    await applyTemplate(organizationId, 'barbershop');

    const fila = await db
      .selectFrom('organizations')
      .select(['settings_json'])
      .where('id', '=', organizationId)
      .executeTakeFirst();

    const ajustes = JSON.parse(fila?.settings_json ?? '{}') as { walkInQueueEnabled?: boolean };
    assert.equal(ajustes.walkInQueueEnabled, true);
  });

  /** Aplicarla dos veces duplicaría el catálogo entero. */
  it('no se aplica sobre una organización que ya tiene servicios', async () => {
    await applyTemplate(organizationId, 'hairdresser');

    await assert.rejects(applyTemplate(organizationId, 'gym'), /sin servicios/);
  });

  it('una plantilla que no existe da error', async () => {
    await assert.rejects(applyTemplate(organizationId, 'inventada'), /no existe/);
  });
});

describe('catálogo de plantillas', () => {
  it('todas tienen los tres idiomas en su nombre', () => {
    const completas = ORGANIZATION_TEMPLATES.every(
      (template) => template.label.es && template.label.gl && template.label.en,
    );

    assert.equal(completas, true);
  });

  it('todas traen al menos un servicio', () => {
    assert.equal(
      ORGANIZATION_TEMPLATES.every((template) => template.services.length > 0),
      true,
    );
  });
});
