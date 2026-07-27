import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { api } from '../lib/api.ts';
import { renderRichText } from '../lib/richtext.ts';
import type { PublicOrganization, PublicPage } from '../lib/types.ts';
import { ErrorMessage, LoadingBlock } from '../components/ui.tsx';
import { OrganizationFooter } from '../components/OrganizationFooter.tsx';
import { useOrganizationTheme } from '../components/theme.tsx';

/**
 * Página de contenido de un establecimiento: contacto o sobre nosotros.
 *
 * El contenido lo escribe el propio negocio en Markdown o en HTML, así que se
 * pinta saneado. Ver `lib/richtext.ts` para el porqué.
 */
export default function OrganizationPage({ pageKey }: { pageKey: 'contact' | 'about' }) {
  const { slug = '' } = useParams();
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);

  const page = useQuery({
    queryKey: ['public-page', slug, pageKey, locale],
    queryFn: () =>
      api.get<PublicPage>(`/public/organizations/${slug}/pages/${pageKey}`, {
        query: { locale },
      }),
    retry: false,
  });

  // El tema del negocio también viste sus páginas de contenido: sin esto, ir
  // de la reserva a "sobre nosotros" cambiaría de aspecto a medio camino.
  const organizacion = useQuery({
    queryKey: ['public-org', slug],
    queryFn: () => api.get<PublicOrganization>(`/public/organizations/${slug}`),
  });
  useOrganizationTheme(organizacion.data?.theme);

  const html = useMemo(
    () => (page.data ? renderRichText(page.data.body, page.data.format) : ''),
    [page.data],
  );

  useEffect(() => {
    if (page.data?.title) document.title = page.data.title;
    return () => {
      document.title = t('common.appName');
    };
  }, [page.data?.title, t]);

  if (page.isLoading) return <LoadingBlock rows={4} />;
  if (page.error || !page.data) {
    return <ErrorMessage error={page.error ?? { message: t('errors.not_found') }} />;
  }

  return (
    <div className="pb-4">
      <Link
        to={`/${slug}`}
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
      </Link>

      <h1 className="mb-4 text-xl font-bold sm:text-2xl">{page.data.title}</h1>

      {/* El HTML ya viene saneado por `renderRichText`. */}
      <div className="prose-simple" dangerouslySetInnerHTML={{ __html: html }} />

      <OrganizationFooter slug={slug} />
    </div>
  );
}
