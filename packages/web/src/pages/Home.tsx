import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, MapPin, Search } from 'lucide-react';
import { api } from '../lib/api.ts';
import { EntityAvatar } from '../components/avatar.tsx';
import { Card, EmptyState, LoadingBlock, PageHeader } from '../components/ui.tsx';

interface OrganizationSummary {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  imageUrl: string | null;
  icon: string | null;
  color: string | null;
}

/**
 * Punto de entrada.
 *
 * En una instalación de un solo negocio (el caso normal) esta pantalla no se
 * llega a ver: se redirige a su página de reservas. Con varios establecimientos
 * hace de directorio.
 */
export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['public-organizations'],
    queryFn: () => api.get<OrganizationSummary[]>('/public/organizations'),
  });

  useEffect(() => {
    if (data?.length === 1) {
      navigate(`/${data[0]!.slug}`, { replace: true });
    }
  }, [data, navigate]);

  if (isLoading) return <LoadingBlock rows={3} />;

  if (!data || data.length === 0) {
    return (
      <EmptyState
        icon={<CalendarPlus className="size-10" />}
        title={t('common.empty')}
        description="Todavía no hay ningún establecimiento con reserva online."
      />
    );
  }

  return (
    <div>
      <PageHeader title={t('booking.title')} />

      <ul className="grid gap-3 sm:grid-cols-2">
        {data.map((organization) => (
          <Card as="li" key={organization.id} className="transition hover:border-brand">
            <Link to={`/${organization.slug}`} className="flex items-center gap-3">
              <EntityAvatar
                name={organization.name}
                avatar={{
                  imageUrl: organization.imageUrl,
                  icon: organization.icon,
                  color: organization.color,
                }}
                square
              />
              <span className="min-w-0">
              <p className="font-semibold text-slate-900">{organization.name}</p>
              <p className="mt-1 flex items-center gap-1 text-sm text-slate-500">
                <MapPin className="size-3.5" aria-hidden />
                {organization.timezone}
              </p>
              </span>
            </Link>
          </Card>
        ))}
      </ul>

      <div className="mt-6 text-center">
        <Link to="/consultar" className="inline-flex items-center gap-2 text-sm text-brand hover:underline">
          <Search className="size-4" aria-hidden />
          {t('appointments.lookupTitle')}
        </Link>
      </div>
    </div>
  );
}
