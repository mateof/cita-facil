import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';

/**
 * Valoraciones en la página pública del establecimiento.
 *
 * Se recogían desde el principio y solo las veía el negocio. Enseñarlas es lo
 * que las convierte en un argumento de venta, y es además lo que un cliente
 * espera encontrar antes de reservar en un sitio donde no ha estado nunca.
 *
 * Las reseñas van firmadas con el nombre de pila y la inicial del apellido, y
 * el recorte lo hace el servidor: la pantalla nunca llega a recibir el nombre
 * completo de otra persona.
 */

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
  distribution: Record<string, number>;
  items: PublicReview[];
}

/** Estrellas de una nota. Decorativas: la nota va al lado en texto. */
export function RatingStars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={clsx('inline-flex', className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          className={clsx(
            'size-4',
            star <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-300',
          )}
        />
      ))}
    </span>
  );
}

/** Nota compacta para pegar junto al nombre de un servicio. */
export function RatingChip({ average, count }: { average: number; count: number }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);

  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"
      title={t('reviews.countLabel', { count })}
    >
      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden />
      {average.toLocaleString(locale === 'en' ? 'en-GB' : 'es-ES', { minimumFractionDigits: 1 })}
      <span className="font-normal text-slate-500">({count})</span>
    </span>
  );
}

export function OrganizationReviews({ organizationId }: { organizationId: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);

  const { data } = useQuery({
    queryKey: ['public-reviews', organizationId],
    queryFn: () =>
      api.get<ReviewSummary>(`/public/organizations/${organizationId}/reviews`, {
        query: { limit: 10 },
      }),
    retry: false,
  });

  // Sin valoraciones no se pinta nada: una sección vacía que dice "todavía no
  // hay opiniones" resta más de lo que informa.
  if (!data || data.count === 0 || data.average === null) return null;

  return (
    <section className="mt-8 border-t border-slate-200 pt-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
        {t('reviews.title')}
      </h2>

      <div className="mb-4 flex items-center gap-3">
        <span className="text-3xl font-bold tabular-nums">
          {data.average.toLocaleString(locale === 'en' ? 'en-GB' : 'es-ES', {
            minimumFractionDigits: 1,
          })}
        </span>
        <span>
          <RatingStars value={data.average} />
          <span className="block text-sm text-slate-500">
            {t('reviews.countLabel', { count: data.count })}
          </span>
        </span>
      </div>

      <ul className="space-y-3">
        {data.items.map((review) => (
          <li key={review.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <RatingStars value={review.rating} />
              <span className="font-medium text-slate-700">{review.authorName}</span>
              <span className="text-slate-400">
                {formatDate(review.createdAt, locale, undefined, { dateStyle: 'medium' })}
              </span>
              {review.serviceName && (
                <span className="text-slate-500">· {review.serviceName}</span>
              )}
            </div>

            {review.comment && <p className="mt-2 text-sm text-slate-700">{review.comment}</p>}

            {review.reply && (
              <p className="mt-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
                <span className="font-medium">{t('reviews.reply')}: </span>
                {review.reply}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
