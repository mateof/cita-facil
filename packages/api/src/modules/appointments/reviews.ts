import { db } from '../../db/index.js';
import { isoNow } from '../../lib/dates.js';
import { NotFoundError } from '../../lib/errors.js';
import { organizationSettings } from '../availability/engine.js';

/**
 * Valoraciones.
 *
 * Se recogían desde el principio y se quedaban en el panel. Aquí está lo que
 * las saca a la calle: la nota media del negocio, la de cada servicio y las
 * reseñas que el negocio ha decidido publicar.
 *
 * Dos ajustes las gobiernan, y los dos son del negocio:
 *
 * - **Publicar valoraciones**: de fábrica está apagado. Enseñar los comentarios
 *   de la clientela en la página pública es una decisión comercial, no algo que
 *   deba pasar solo porque se actualiza la aplicación.
 * - **Aprobar antes de publicar**: encendido de fábrica. Una reseña es texto
 *   escrito por un tercero que acaba en la página del negocio; que pase por
 *   delante de alguien antes es lo prudente.
 */

export interface ReviewSettings {
  publicReviewsEnabled: boolean;
  reviewsRequireApproval: boolean;
}

export async function reviewSettings(organizationId: string): Promise<ReviewSettings> {
  const settings = (await organizationSettings(organizationId)) as {
    publicReviewsEnabled?: boolean;
    reviewsRequireApproval?: boolean;
  };
  return {
    publicReviewsEnabled: settings.publicReviewsEnabled === true,
    reviewsRequireApproval: settings.reviewsRequireApproval !== false,
  };
}

/**
 * Cómo se firma una reseña en público: nombre de pila y la inicial del primer
 * apellido. Ni el nombre completo, que identifica a una persona concreta en un
 * pueblo, ni "Anónimo", que le quita todo el valor a la reseña.
 */
export function publicAuthorName(name: string | null): string {
  const partes = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'Cliente';
  if (partes.length === 1) return partes[0]!;
  return `${partes[0]} ${partes[1]!.charAt(0).toUpperCase()}.`;
}

export interface PublicReview {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  createdAt: string;
  authorName: string;
  serviceName: string | null;
  resourceName: string | null;
}

export interface ReviewSummary {
  average: number | null;
  count: number;
  /** Cuántas valoraciones hay de cada nota, de 1 a 5. */
  distribution: Record<string, number>;
  items: PublicReview[];
}

const EMPTY: ReviewSummary = { average: null, count: 0, distribution: {}, items: [] };

/**
 * Resumen público de las valoraciones. Devuelve vacío si el negocio no las
 * publica: es un endpoint sin autenticación y no debe filtrar comentarios que
 * nadie ha decidido enseñar.
 */
export async function publicReviews(
  organizationId: string,
  filters: { serviceId?: string; resourceId?: string; limit?: number } = {},
): Promise<ReviewSummary> {
  const { publicReviewsEnabled } = await reviewSettings(organizationId);
  if (!publicReviewsEnabled) return EMPTY;

  let query = db()
    .selectFrom('reviews')
    .leftJoin('users', 'users.id', 'reviews.customer_id')
    .leftJoin('services', 'services.id', 'reviews.service_id')
    .leftJoin('resources', 'resources.id', 'reviews.resource_id')
    .select([
      'reviews.id',
      'reviews.rating',
      'reviews.comment',
      'reviews.reply',
      'reviews.created_at',
      'users.name as customer_name',
      'services.name as service_name',
      'resources.name as resource_name',
    ])
    .where('reviews.organization_id', '=', organizationId)
    .where('reviews.published', '=', 1);

  if (filters.serviceId) query = query.where('reviews.service_id', '=', filters.serviceId);
  if (filters.resourceId) query = query.where('reviews.resource_id', '=', filters.resourceId);

  const rows = await query.orderBy('reviews.created_at', 'desc').execute();
  if (rows.length === 0) return EMPTY;

  const distribution: Record<string, number> = {};
  for (const row of rows) {
    const clave = String(row.rating);
    distribution[clave] = (distribution[clave] ?? 0) + 1;
  }

  return {
    // Una nota media con más de un decimal aparenta una precisión que no tiene.
    average: Math.round((rows.reduce((sum, row) => sum + row.rating, 0) / rows.length) * 10) / 10,
    count: rows.length,
    distribution,
    items: rows.slice(0, filters.limit ?? 20).map((row) => ({
      id: row.id,
      rating: row.rating,
      comment: row.comment,
      reply: row.reply,
      createdAt: row.created_at,
      authorName: publicAuthorName(row.customer_name),
      serviceName: row.service_name,
      resourceName: row.resource_name,
    })),
  };
}

/** Nota media por servicio, para pintarla junto a cada uno en la página pública. */
export async function ratingsByService(
  organizationId: string,
): Promise<Map<string, { average: number; count: number }>> {
  const { publicReviewsEnabled } = await reviewSettings(organizationId);
  if (!publicReviewsEnabled) return new Map();

  const rows = await db()
    .selectFrom('reviews')
    .select((eb) => [
      'service_id',
      eb.fn.countAll<number>().as('total'),
      eb.fn.sum<number>('rating').as('suma'),
    ])
    .where('organization_id', '=', organizationId)
    .where('published', '=', 1)
    .groupBy('service_id')
    .execute();

  const ratings = new Map<string, { average: number; count: number }>();
  for (const row of rows) {
    const count = Number(row.total ?? 0);
    if (count === 0) continue;
    ratings.set(row.service_id, {
      average: Math.round((Number(row.suma ?? 0) / count) * 10) / 10,
      count,
    });
  }
  return ratings;
}

/** Publica, oculta o responde una valoración. Es lo que hace la moderación. */
export async function moderateReview(
  organizationId: string,
  reviewId: string,
  patch: { published?: boolean; reply?: string | null },
): Promise<void> {
  const review = await db()
    .selectFrom('reviews')
    .select(['id'])
    .where('id', '=', reviewId)
    .where('organization_id', '=', organizationId)
    .executeTakeFirst();
  if (!review) throw new NotFoundError('La valoración no existe', 'review_not_found');

  await db()
    .updateTable('reviews')
    .set({
      ...(patch.published === undefined ? {} : { published: patch.published ? 1 : 0 }),
      ...(patch.reply === undefined ? {} : { reply: patch.reply?.trim() || null }),
    })
    .where('id', '=', reviewId)
    .execute();
}

/** Valoraciones tal y como las ve el panel, publicadas o no. */
export async function listReviewsForStaff(
  organizationId: string,
  filters: { serviceId?: string; resourceId?: string; onlyPending?: boolean; limit: number },
) {
  let query = db()
    .selectFrom('reviews')
    .leftJoin('users', 'users.id', 'reviews.customer_id')
    .leftJoin('services', 'services.id', 'reviews.service_id')
    .leftJoin('resources', 'resources.id', 'reviews.resource_id')
    .select([
      'reviews.id',
      'reviews.rating',
      'reviews.comment',
      'reviews.reply',
      'reviews.published',
      'reviews.created_at',
      'reviews.service_id',
      'reviews.resource_id',
      'users.name as customer_name',
      'services.name as service_name',
      'resources.name as resource_name',
    ])
    .where('reviews.organization_id', '=', organizationId);

  if (filters.serviceId) query = query.where('reviews.service_id', '=', filters.serviceId);
  if (filters.resourceId) query = query.where('reviews.resource_id', '=', filters.resourceId);
  if (filters.onlyPending) query = query.where('reviews.published', '=', 0);

  const rows = await query.orderBy('reviews.created_at', 'desc').limit(filters.limit).execute();

  const items = rows.map((row) => ({
    id: row.id,
    rating: row.rating,
    comment: row.comment,
    reply: row.reply,
    published: row.published === 1,
    createdAt: row.created_at,
    serviceId: row.service_id,
    resourceId: row.resource_id,
    customerName: row.customer_name,
    serviceName: row.service_name,
    resourceName: row.resource_name,
  }));

  return {
    items,
    count: items.length,
    average:
      items.length > 0
        ? Math.round((items.reduce((sum, item) => sum + item.rating, 0) / items.length) * 10) / 10
        : null,
    pending: items.filter((item) => !item.published).length,
  };
}

/** Deja constancia de una valoración nueva, respetando la moderación. */
export async function saveReview(params: {
  organizationId: string;
  appointmentId: string;
  customerId: string | null;
  resourceId: string | null;
  serviceId: string;
  rating: number;
  comment?: string | null;
  id: string;
}): Promise<void> {
  const { reviewsRequireApproval } = await reviewSettings(params.organizationId);

  await db()
    .insertInto('reviews')
    .values({
      id: params.id,
      organization_id: params.organizationId,
      appointment_id: params.appointmentId,
      customer_id: params.customerId,
      resource_id: params.resourceId,
      service_id: params.serviceId,
      rating: params.rating,
      comment: params.comment ?? null,
      published: reviewsRequireApproval ? 0 : 1,
      reply: null,
      created_at: isoNow(),
    })
    .execute();
}
