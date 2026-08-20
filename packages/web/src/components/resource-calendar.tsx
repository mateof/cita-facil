import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarSync, Check, Copy, RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDateTime } from '../lib/format.ts';
import type { AdminResource } from '../lib/types.ts';
import { Button, ErrorMessage, Field, Input } from './ui.tsx';

/**
 * Calendario de una agenda, en los dos sentidos.
 *
 * Arriba, la dirección que el profesional se suscribe en su móvil para ver sus
 * citas. Abajo, el calendario personal del que se importa la ocupación, que es
 * lo que evita que se le reserve un hueco en el que tiene el médico.
 *
 * Solo aparece con el recurso ya guardado: hasta entonces no hay a qué agenda
 * enganchar nada.
 */
export function ResourceCalendar({
  organizationId,
  resource,
}: {
  organizationId: string | null;
  resource: AdminResource | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const queryClient = useQueryClient();

  const [copiado, setCopiado] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  const refrescar = () => void queryClient.invalidateQueries({ queryKey: ['resources'] });

  const crearToken = useMutation({
    mutationFn: () =>
      api.post<{ url: string }>(
        `/organizations/${organizationId}/resources/${resource?.id}/calendar-token`,
        {},
      ),
    onSuccess: refrescar,
  });

  const guardarUrl = useMutation({
    mutationFn: (valor: string | null) =>
      api.put(`/organizations/${organizationId}/resources/${resource?.id}/calendar`, {
        url: valor,
      }),
    onSuccess: () => {
      setUrl(null);
      refrescar();
    },
  });

  const sincronizar = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${organizationId}/resources/${resource?.id}/calendar/sync`, {}),
    onSuccess: refrescar,
  });

  if (!resource) {
    return <p className="text-sm text-slate-500">{t('admin.resources.calendarSaveFirst')}</p>;
  }

  const feed = crearToken.data?.url ?? resource.calendarFeedUrl;
  const externa = url ?? resource.calendarUrl ?? '';

  return (
    <div>
      <ErrorMessage error={crearToken.error ?? guardarUrl.error ?? sincronizar.error} />

      <p className="mb-1 text-sm font-medium">{t('admin.resources.calendarFeed')}</p>
      <p className="mb-2 text-xs text-slate-500">{t('admin.resources.calendarFeedHint')}</p>

      {feed ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <code className="scroll-thin max-w-full overflow-x-auto rounded-lg bg-slate-100 px-2 py-1 text-xs">
            {feed}
          </code>
          <Button
            variant="ghost"
            icon={copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
            onClick={() =>
              void navigator.clipboard.writeText(feed).then(() => {
                setCopiado(true);
                setTimeout(() => setCopiado(false), 2000);
              })
            }
          >
            {copiado ? t('common.copied') : t('common.copy')}
          </Button>
          <Button
            variant="ghost"
            loading={crearToken.isPending}
            onClick={() => crearToken.mutate()}
          >
            {t('admin.resources.calendarRotate')}
          </Button>
        </div>
      ) : (
        <Button
          className="mb-4"
          variant="secondary"
          icon={<CalendarSync className="size-4" />}
          loading={crearToken.isPending}
          onClick={() => crearToken.mutate()}
        >
          {t('admin.resources.calendarCreate')}
        </Button>
      )}

      <div className="border-t border-slate-100 pt-4">
        <Field
          label={t('admin.resources.calendarExternal')}
          hint={t('admin.resources.calendarExternalHint')}
          className="mb-2"
        >
          <Input
            value={externa}
            placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={url === null}
            loading={guardarUrl.isPending}
            onClick={() => guardarUrl.mutate(externa.trim() || null)}
          >
            {t('admin.resources.calendarSave')}
          </Button>

          {resource.calendarUrl && (
            <Button
              variant="ghost"
              icon={<RefreshCw className="size-4" />}
              loading={sincronizar.isPending}
              onClick={() => sincronizar.mutate()}
            >
              {t('admin.resources.calendarSyncNow')}
            </Button>
          )}
        </div>

        {resource.calendarSyncedAt && (
          <p className="mt-2 text-xs text-slate-500">
            {t('admin.resources.calendarSyncedAt', {
              date: formatDateTime(resource.calendarSyncedAt, locale),
            })}
          </p>
        )}

        {resource.calendarError && (
          <p className="mt-2 text-xs text-red-700">{resource.calendarError}</p>
        )}
      </div>
    </div>
  );
}
