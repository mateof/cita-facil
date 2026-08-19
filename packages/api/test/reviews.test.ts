import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Kysely } from 'kysely';
import { closeTestDatabase, createTestDatabase, seedFixture, type Fixture } from './helpers.ts';
import type { Database } from '../src/db/types.ts';
import { newId, shortCode } from '../src/lib/ids.ts';
import { isoNow } from '../src/lib/dates.ts';
import {
  listReviewsForStaff,
  moderateReview,
  publicAuthorName,
  publicReviews,
  ratingsByService,
  saveReview,
} from '../src/modules/appointments/reviews.ts';

/**
 * Valoraciones públicas.
 *
 * Lo que se comprueba aquí es sobre todo lo que **no** sale: sin el ajuste
 * puesto, el endpoint público no devuelve nada, y lo que está sin aprobar no
 * cuenta ni en la media ni en la lista.
 */

let db: Kysely<Database>;
let fixture: Fixture;

before(async () => {
  db = await createTestDatabase();
  fixture = await seedFixture(db);
});

after(async () => {
  await closeTestDatabase(db);
});

beforeEach(async () => {
  await db.deleteFrom('reviews').execute();
  await ajustes({});
});

async function ajustes(valores: Record<string, unknown>): Promise<void> {
  await db
    .updateTable('organizations')
    .set({ settings_json: JSON.stringify({ slotGranularityMinutes: 30, ...valores }) })
    .where('id', '=', fixture.organizationId)
    .execute();
}

/** Deja una valoración ya escrita, publicada o no. */
async function valoracion(rating: number, published: boolean, comment = 'Muy bien'): Promise<string> {
  const id = newId();
  await db
    .insertInto('reviews')
    .values({
      id,
      organization_id: fixture.organizationId,
      appointment_id: shortCode(10),
      customer_id: fixture.customerId,
      resource_id: fixture.resourceId,
      service_id: fixture.serviceId,
      rating,
      comment,
      published: published ? 1 : 0,
      reply: null,
      created_at: isoNow(),
    })
    .execute();
  return id;
}

describe('moderación', () => {
  it('una valoración nueva espera aprobación', async () => {
    await saveReview({
      id: newId(),
      organizationId: fixture.organizationId,
      appointmentId: shortCode(10),
      customerId: fixture.customerId,
      resourceId: fixture.resourceId,
      serviceId: fixture.serviceId,
      rating: 5,
    });

    const panel = await listReviewsForStaff(fixture.organizationId, { limit: 10 });

    assert.equal(panel.items[0]?.published, false);
  });

  it('se publica sola si el negocio no modera', async () => {
    await ajustes({ reviewsRequireApproval: false });

    await saveReview({
      id: newId(),
      organizationId: fixture.organizationId,
      appointmentId: shortCode(10),
      customerId: fixture.customerId,
      resourceId: fixture.resourceId,
      serviceId: fixture.serviceId,
      rating: 4,
    });

    const panel = await listReviewsForStaff(fixture.organizationId, { limit: 10 });

    assert.equal(panel.items[0]?.published, true);
  });

  it('publicar una valoración la deja visible', async () => {
    await ajustes({ publicReviewsEnabled: true });
    const id = await valoracion(5, false);

    await moderateReview(fixture.organizationId, id, { published: true });

    assert.equal((await publicReviews(fixture.organizationId)).count, 1);
  });

  it('responder guarda la respuesta del negocio', async () => {
    const id = await valoracion(3, true);

    await moderateReview(fixture.organizationId, id, { reply: 'Gracias por avisarnos' });

    const panel = await listReviewsForStaff(fixture.organizationId, { limit: 10 });
    assert.equal(panel.items[0]?.reply, 'Gracias por avisarnos');
  });
});

describe('resumen público', () => {
  /** Publicar los comentarios de la clientela es una decisión del negocio. */
  it('no devuelve nada si el negocio no publica valoraciones', async () => {
    await valoracion(5, true);

    assert.equal((await publicReviews(fixture.organizationId)).count, 0);
  });

  it('no cuenta lo que está sin aprobar', async () => {
    await ajustes({ publicReviewsEnabled: true });
    await valoracion(5, true);
    await valoracion(1, false);

    assert.equal((await publicReviews(fixture.organizationId)).count, 1);
  });

  it('la media se redondea a un decimal', async () => {
    await ajustes({ publicReviewsEnabled: true });
    await valoracion(5, true);
    await valoracion(4, true);
    await valoracion(4, true);

    assert.equal((await publicReviews(fixture.organizationId)).average, 4.3);
  });

  it('reparte las notas por estrellas', async () => {
    await ajustes({ publicReviewsEnabled: true });
    await valoracion(5, true);
    await valoracion(5, true);

    assert.equal((await publicReviews(fixture.organizationId)).distribution['5'], 2);
  });

  it('la nota por servicio también respeta el ajuste', async () => {
    await valoracion(5, true);

    assert.equal((await ratingsByService(fixture.organizationId)).size, 0);
  });

  it('calcula la nota de cada servicio', async () => {
    await ajustes({ publicReviewsEnabled: true });
    await valoracion(4, true);

    const notas = await ratingsByService(fixture.organizationId);

    assert.equal(notas.get(fixture.serviceId)?.average, 4);
  });
});

describe('firma de las reseñas', () => {
  /** Ni el nombre entero, que señala a una persona, ni "anónimo", que no dice nada. */
  it('firma con el nombre de pila y la inicial del apellido', () => {
    assert.equal(publicAuthorName('Lucía Pena Ríos'), 'Lucía P.');
  });

  it('con un solo nombre firma con él', () => {
    assert.equal(publicAuthorName('Lucía'), 'Lucía');
  });

  it('sin nombre firma como cliente', () => {
    assert.equal(publicAuthorName(null), 'Cliente');
  });
});
