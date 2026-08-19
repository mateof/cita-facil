import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import type { PublicOrganization } from '../lib/types.ts';
import { useOrganizationTheme } from '../components/theme.tsx';

interface Board {
  organizationName: string;
  locationName: string;
  calling: { ticketNumber: number; name: string; resourceName: string | null }[];
  next: { ticketNumber: number; name: string }[];
}

/**
 * Pantalla de sala.
 *
 * Está pensada para una televisión colgada en la pared y mirada desde cuatro
 * metros: números enormes, sin menús y sin nada en lo que se pueda pulsar por
 * error. Se refresca sola cada diez segundos.
 *
 * Solo enseña el número y el nombre de pila, porque la ve todo el que pasa.
 */
export default function QueueDisplay() {
  const { slug = '' } = useParams();
  const { t } = useTranslation();

  const organizacion = useQuery({
    queryKey: ['public-org', slug],
    queryFn: () => api.get<PublicOrganization>(`/public/organizations/${slug}`),
  });

  useOrganizationTheme(organizacion.data?.theme);

  const organizationId = organizacion.data?.organization.id;

  const board = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['queue-display', organizationId],
    queryFn: () => api.get<Board>(`/public/organizations/${organizationId}/queue-display`),
    refetchInterval: 10_000,
  });

  const llamando = board.data?.calling ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-slate-900 p-6 text-white sm:p-10">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold sm:text-4xl">{board.data?.organizationName ?? ''}</h1>
        <p className="text-lg text-slate-400 sm:text-2xl">{board.data?.locationName ?? ''}</p>
      </header>

      <main className="flex flex-1 flex-col justify-center">
        {llamando.length === 0 ? (
          <p className="text-center text-3xl text-slate-400 sm:text-5xl">
            {t('queue.displayIdle')}
          </p>
        ) : (
          <ul className="grid gap-6 sm:grid-cols-2">
            {llamando.map((entry) => (
              <li
                key={entry.ticketNumber}
                className="rounded-3xl bg-white/10 p-8 text-center backdrop-blur"
              >
                <p className="text-sm uppercase tracking-widest text-slate-300 sm:text-lg">
                  {t('queue.now')}
                </p>
                {/* El número es lo único que se lee desde el fondo de la sala. */}
                <p className="my-2 text-7xl font-black tabular-nums sm:text-9xl">
                  {entry.ticketNumber}
                </p>
                <p className="text-2xl sm:text-4xl">{entry.name}</p>
                {entry.resourceName && (
                  <p className="mt-1 text-lg text-slate-300 sm:text-2xl">{entry.resourceName}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      {(board.data?.next.length ?? 0) > 0 && (
        <footer className="mt-8 border-t border-white/20 pt-4">
          <p className="mb-2 text-sm uppercase tracking-widest text-slate-400 sm:text-base">
            {t('queue.upNext')}
          </p>
          <ul className="flex flex-wrap gap-4 text-2xl font-semibold tabular-nums sm:text-4xl">
            {board.data?.next.map((entry) => (
              <li key={entry.ticketNumber} className="rounded-xl bg-white/10 px-4 py-2">
                {entry.ticketNumber}
              </li>
            ))}
          </ul>
        </footer>
      )}
    </div>
  );
}
