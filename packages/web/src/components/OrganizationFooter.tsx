import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import type { PublicOrganization } from '../lib/types.ts';

/** Ruta de cada página de contenido dentro del establecimiento. */
const PATHS: Record<string, string> = {
  contact: 'contacto',
  about: 'sobre-nosotros',
};

/**
 * Pie de la página pública del establecimiento.
 *
 * Solo aparece si el negocio ha publicado alguna página. Con ninguna
 * publicada no se pinta nada, para no dejar una franja vacía en una pantalla
 * que está pensada para reservar en tres toques.
 */
export function OrganizationFooter({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);

  const { data } = useQuery({
    queryKey: ['public-org', slug, locale],
    queryFn: () =>
      api.get<PublicOrganization>(`/public/organizations/${slug}`, { query: { locale } }),
    retry: false,
  });

  const pages = data?.pages ?? [];
  const branding = data?.organization.branding;
  const legal = [
    branding?.termsUrl ? { href: branding.termsUrl, label: 'Condiciones' } : null,
    branding?.privacyUrl ? { href: branding.privacyUrl, label: 'Privacidad' } : null,
  ].filter(Boolean) as { href: string; label: string }[];

  if (pages.length === 0 && legal.length === 0) return null;

  return (
    <footer className="mt-8 border-t border-slate-200 pt-4">
      {/* El pie va dentro del <main> del portal, así que no es `contentinfo`:
          se identifica por el nombre de su navegación. */}
      <nav
        aria-label={t('booking.aboutTheBusiness')}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500"
      >
        {pages.map((page) => (
          <Link
            key={page.key}
            to={`/reservar/${slug}/${PATHS[page.key] ?? page.key}`}
            className="hover:text-brand hover:underline"
          >
            {page.title}
          </Link>
        ))}
        {legal.map((item) => (
          <a
            key={item.href}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-brand hover:underline"
          >
            {item.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
