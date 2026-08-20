import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Check, Code2, Copy, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.ts';
import { Button, Card, Field, Input } from './ui.tsx';

/**
 * El trozo de código que el negocio pega en su web.
 *
 * Se enseña ya escrito y con un botón de copiar, no explicado: quien mantiene
 * la web de una peluquería copia y pega, no compone etiquetas. Debajo va el
 * enlace directo, que es lo que se manda por redes sociales o por WhatsApp.
 */
export function WidgetCard({
  organizationId,
  slug,
}: {
  organizationId: string | null;
  slug: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [copiado, setCopiado] = useState<string | null>(null);
  const [origenes, setOrigenes] = useState<string | null>(null);

  const organizacion = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['organization', organizationId],
    queryFn: () =>
      api.get<{ settings: Record<string, unknown> }>(`/organizations/${organizationId}`),
  });

  const guardar = useMutation({
    mutationFn: (lista: string[]) =>
      api.patch(`/organizations/${organizationId}`, {
        settings: { ...(organizacion.data?.settings ?? {}), embedOrigins: lista },
      }),
    onSuccess: () => {
      setOrigenes(null);
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });

  if (!slug) return null;

  const base = window.location.origin;
  const snippet = `<script src="${base}/widget.js" data-slug="${slug}" data-height="720" defer></script>`;
  const enlace = `${base}/${slug}`;

  const copiar = (texto: string, clave: string) => {
    void navigator.clipboard.writeText(texto).then(() => {
      setCopiado(clave);
      setTimeout(() => setCopiado(null), 2000);
    });
  };

  const guardadas = ((organizacion.data?.settings?.embedOrigins as string[] | undefined) ?? []).join(
    ', ',
  );
  const actuales = origenes ?? guardadas;

  return (
    <Card className="mb-4">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Code2 className="size-4 text-slate-400" aria-hidden />
        {t('admin.integrations.widget')}
      </h2>
      <p className="mb-3 text-sm text-slate-500">{t('admin.integrations.widgetHint')}</p>

      <pre className="scroll-thin mb-2 overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-100">
        <code>{snippet}</code>
      </pre>
      <Button
        variant="secondary"
        icon={copiado === 'snippet' ? <Check className="size-4" /> : <Copy className="size-4" />}
        onClick={() => copiar(snippet, 'snippet')}
      >
        {copiado === 'snippet' ? t('common.copied') : t('common.copy')}
      </Button>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <p className="mb-1 text-sm font-medium">{t('admin.integrations.directLink')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={enlace}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-mono text-sm text-brand hover:underline"
          >
            {enlace}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <Button
            variant="ghost"
            icon={copiado === 'link' ? <Check className="size-4" /> : <Copy className="size-4" />}
            onClick={() => copiar(enlace, 'link')}
          >
            {copiado === 'link' ? t('common.copied') : t('common.copy')}
          </Button>
        </div>
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        <Field
          label={t('admin.integrations.embedOrigins')}
          hint={t('admin.integrations.embedOriginsHint')}
          className="mb-2"
        >
          <Input
            value={actuales}
            placeholder="https://mipeluqueria.es, https://www.mipeluqueria.es"
            onChange={(event) => setOrigenes(event.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={origenes === null}
          loading={guardar.isPending}
          onClick={() =>
            guardar.mutate(
              actuales
                .split(',')
                .map((origen) => origen.trim())
                .filter(Boolean),
            )
          }
        >
          {t('common.save')}
        </Button>
      </div>
    </Card>
  );
}
