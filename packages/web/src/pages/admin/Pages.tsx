import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Eye, ExternalLink, Pencil } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { renderRichText } from '../../lib/richtext.ts';
import type { OrganizationPage, PublicPageKey } from '../../lib/types.ts';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Select,
  SuccessMessage,
  Switch,
  Tabs,
  Textarea,
} from '../../components/ui.tsx';

const RUTAS: Record<PublicPageKey, string> = {
  contact: 'contacto',
  about: 'sobre-nosotros',
};

/**
 * Páginas de contenido del establecimiento: contacto y sobre nosotros.
 *
 * Se edita el idioma que se esté usando en el panel, igual que las
 * descripciones de los servicios. Cada idioma se guarda por separado, así que
 * una página puede estar en español y todavía no en gallego, y en ese caso no
 * se le enseña vacía a quien navegue en gallego.
 */
export default function PagesTab({ slug }: { slug: string | null }) {
  const { t } = useTranslation();
  const [key, setKey] = useState<PublicPageKey>('contact');
  const organizationId = useAuth((state) => state.activeOrganizationId);

  const pages = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['organization-pages', organizationId],
    queryFn: () => api.get<OrganizationPage[]>(`/organizations/${organizationId}/pages`),
  });

  const page = pages.data?.find((item) => item.key === key);

  return (
    <div>
      <Tabs
        active={key}
        onChange={(id) => setKey(id as PublicPageKey)}
        tabs={[
          { id: 'contact', label: t('admin.pages.contact') },
          { id: 'about', label: t('admin.pages.about') },
        ]}
      />

      {pages.isLoading && <LoadingBlock rows={4} />}
      {page && <PageEditor key={page.key} page={page} slug={slug} />}
    </div>
  );
}

function PageEditor({ page, slug }: { page: OrganizationPage; slug: string | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();

  const [format, setFormat] = useState(page.format);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [published, setPublished] = useState(page.published);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);

  /**
   * Al cambiar de idioma se carga lo escrito en ese idioma, que es otro
   * contenido y no una traducción viva.
   *
   * El control por referencia es imprescindible: el objeto `page` es nuevo en
   * cada relectura de la consulta (al volver a la pestaña, al guardar…), y sin
   * esto cualquiera de ellas borraría lo que se estuviera escribiendo y el
   * aviso de "guardado".
   */
  const cargado = useRef('');
  useEffect(() => {
    const actual = `${page.key}:${locale}`;
    if (cargado.current === actual) return;
    cargado.current = actual;

    setTitle(page.title?.[locale] ?? '');
    setBody(page.body?.[locale] ?? '');
    setFormat(page.format);
    setPublished(page.published);
    setSaved(false);
  }, [page, locale]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/organizations/${organizationId}/pages/${page.key}`, {
        format,
        // Se conservan los demás idiomas: solo se reemplaza el que se edita.
        title: { ...(page.title ?? {}), [locale]: title },
        body: { ...(page.body ?? {}), [locale]: body },
        published,
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['organization-pages'] });
    },
  });

  const html = useMemo(() => renderRichText(body, format), [body, format]);

  return (
    <Card>
      {saved && <SuccessMessage>{t('admin.pages.saved')}</SuccessMessage>}
      <ErrorMessage error={save.error} />

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.pages.pageTitle')} hint={t('admin.pages.titleHint')}>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>

        <Field label={t('admin.pages.format')} hint={t('admin.pages.formatHint')}>
          <Select
            value={format}
            onChange={(event) => setFormat(event.target.value as 'markdown' | 'html')}
          >
            <option value="markdown">Markdown</option>
            <option value="html">HTML</option>
          </Select>
        </Field>
      </div>

      <Field
        label={`${t('admin.pages.content')} (${locale.toUpperCase()})`}
        hint={t('admin.pages.contentHint')}
      >
        {preview ? (
          <div
            className="prose-simple min-h-48 rounded-xl border border-slate-200 bg-slate-50 p-4"
            data-testid="vista-previa"
            /* Ya viene saneado por `renderRichText`. */
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <Textarea
            value={body}
            rows={16}
            className="font-mono text-sm"
            onChange={(event) => setBody(event.target.value)}
            placeholder={
              format === 'markdown'
                ? '## Dónde estamos\n\nRúa Real, 12\n\n**Teléfono:** 981 000 000'
                : '<h2>Dónde estamos</h2>\n<p>Rúa Real, 12</p>'
            }
          />
        )}
      </Field>

      <Switch
        checked={published}
        onChange={setPublished}
        label={t('admin.pages.published')}
        hint={t('admin.pages.publishedHint')}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
        <Button
          variant="ghost"
          icon={preview ? <Pencil className="size-4" /> : <Eye className="size-4" />}
          onClick={() => setPreview(!preview)}
        >
          {preview ? t('admin.pages.edit') : t('admin.pages.preview')}
        </Button>
        {page.published && slug && (
          <a
            href={`/${slug}/${RUTAS[page.key]}`}
            target="_blank"
            rel="noreferrer"
            className="btn-ghost inline-flex items-center gap-1.5"
          >
            <ExternalLink className="size-4" aria-hidden />
            {t('admin.pages.viewPublic')}
          </a>
        )}
      </div>
    </Card>
  );
}
