import { useEffect } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, MapPin, Search, Store } from 'lucide-react';
import { api } from '../lib/api.ts';
import type { OrganizationSummary } from '../lib/types.ts';
import { useAuth } from '../stores/auth.ts';
import {
  forgetOrganization,
  useRememberedOrganization,
} from '../stores/organization-context.ts';
import { EntityAvatar } from '../components/avatar.tsx';
import { Card, EmptyState, LoadingBlock, PageHeader } from '../components/ui.tsx';

/**
 * Punto de entrada.
 *
 * En una instalación de un solo negocio (el caso normal) esta pantalla no se
 * llega a ver: se redirige a su página de reservas.
 *
 * Con varios negocios hace de directorio, pero solo para quien ha iniciado
 * sesión. Un visitante llega por el enlace de un establecimiento concreto y su
 * portada es la de ese establecimiento, con su marca y su tema: enseñarle aquí
 * la lista entera le saca del sitio en el que creía estar y, de paso, cuenta a
 * cualquiera qué otros negocios hay en la instalación. El API aplica la misma
 * regla, así que esto no es solo un adorno de la interfaz.
 */
export default function Home() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuth((state) => state.user);
  const recordada = useRememberedOrganization();

  // Sin sesión y con un negocio a la espalda, la portada común no llega a
  // pintarse: se vuelve al establecimiento por el que se entró.
  const volverAlNegocio = Boolean(recordada) && !user;

  const { data, isLoading } = useQuery({
    enabled: !volverAlNegocio,
    queryKey: ['public-organizations'],
    queryFn: () => api.get<OrganizationSummary[]>('/public/organizations'),
  });

  useEffect(() => {
    // Solo cuando de verdad se va a enseñar el directorio el contexto pasa a
    // ser la instalación. Con un único negocio se salta a él, y borrarlo antes
    // hacía parpadear la marca de la cabecera en cada paso por la portada.
    if (!volverAlNegocio && (data?.length ?? 0) > 1) forgetOrganization();
  }, [volverAlNegocio, data]);

  useEffect(() => {
    if (data?.length === 1) {
      navigate(`/${data[0]!.slug}`, { replace: true });
    }
  }, [data, navigate]);

  if (volverAlNegocio) return <Navigate to={`/${recordada}`} replace />;

  if (isLoading) return <LoadingBlock rows={3} />;

  if (!data || data.length === 0) {
    // Sin sesión la lista viene vacía a propósito, y decir "no hay ningún
    // establecimiento" sería mentira: lo que falta es el enlace del negocio.
    return user ? (
      <EmptyState
        icon={<CalendarPlus className="size-10" />}
        title={t('common.empty')}
        description={t('directory.empty')}
      />
    ) : (
      <EmptyState
        icon={<Store className="size-10" />}
        title={t('directory.needLink')}
        description={t('directory.needLinkHint')}
        action={
          <Link to="/consultar" className="btn-primary">
            {t('appointments.lookupTitle')}
          </Link>
        }
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
