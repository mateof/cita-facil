import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { FormDefinition } from '@cita-facil/shared';
import { api } from '../lib/api.ts';
import { Badge, Button, Card, ErrorMessage, Switch } from './ui.tsx';

/**
 * Qué formularios pide un servicio.
 *
 * Va aparte del formulario del servicio porque se guarda aparte: el enganche
 * vive en su propia tabla y se puede cambiar sin tocar el servicio. En un
 * servicio que todavía no existe no se enseña nada, porque no hay a qué
 * engancharlo.
 */

interface AttachedForm extends FormDefinition {
  required: boolean;
  oncePerCustomer: boolean;
}

interface Link {
  formId: string;
  required: boolean;
  oncePerCustomer: boolean;
  sortOrder: number;
}

export function ServiceFormsPicker({
  organizationId,
  serviceId,
}: {
  organizationId: string | null;
  serviceId: string | undefined;
}) {
  const { t } = useTranslation();
  const [links, setLinks] = useState<Link[] | null>(null);

  const disponibles = useQuery({
    enabled: Boolean(organizationId && serviceId),
    queryKey: ['forms', organizationId],
    queryFn: () =>
      api.get<FormDefinition[]>(`/organizations/${organizationId}/forms`, {
        query: { onlyActive: true },
      }),
  });

  const enganchados = useQuery({
    enabled: Boolean(organizationId && serviceId),
    queryKey: ['service-forms', organizationId, serviceId],
    queryFn: () =>
      api.get<AttachedForm[]>(`/organizations/${organizationId}/services/${serviceId}/forms`),
  });

  useEffect(() => {
    if (!enganchados.data) return;
    setLinks(
      enganchados.data.map((form, indice) => ({
        formId: form.id,
        required: form.required,
        oncePerCustomer: form.oncePerCustomer,
        sortOrder: indice,
      })),
    );
  }, [enganchados.data]);

  const guardar = useMutation({
    mutationFn: (siguiente: Link[]) =>
      api.put(`/organizations/${organizationId}/services/${serviceId}/forms`, {
        forms: siguiente,
      }),
    onSuccess: () => void enganchados.refetch(),
  });

  if (!serviceId) {
    return <p className="text-sm text-slate-500">{t('admin.forms.saveServiceFirst')}</p>;
  }

  const actuales = links ?? [];
  const cambiar = (siguiente: Link[]) => {
    setLinks(siguiente);
    guardar.mutate(siguiente);
  };

  return (
    <div>
      <ErrorMessage error={guardar.error} />

      {disponibles.data?.length === 0 && (
        <p className="text-sm text-slate-500">{t('admin.forms.noneYet')}</p>
      )}

      <ul className="space-y-2">
        {disponibles.data?.map((form) => {
          const enlace = actuales.find((item) => item.formId === form.id);

          return (
            <Card as="li" key={form.id} className="flex flex-wrap items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {form.name}
                  <Badge
                    className={
                      form.kind === 'consent'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-100 text-slate-600'
                    }
                  >
                    {t(`admin.forms.kind.${form.kind}`)}
                  </Badge>
                </span>
                {enlace && (
                  <span className="mt-1 flex flex-wrap gap-4">
                    <Switch
                      checked={enlace.required}
                      onChange={(value) =>
                        cambiar(
                          actuales.map((item) =>
                            item.formId === form.id ? { ...item, required: value } : item,
                          ),
                        )
                      }
                      label={t('admin.forms.requiredLabel')}
                    />
                    <Switch
                      checked={enlace.oncePerCustomer}
                      onChange={(value) =>
                        cambiar(
                          actuales.map((item) =>
                            item.formId === form.id ? { ...item, oncePerCustomer: value } : item,
                          ),
                        )
                      }
                      label={t('admin.forms.onceLabel')}
                    />
                  </span>
                )}
              </span>

              <Button
                variant={enlace ? 'ghost' : 'secondary'}
                onClick={() =>
                  cambiar(
                    enlace
                      ? actuales.filter((item) => item.formId !== form.id)
                      : [
                          ...actuales,
                          {
                            formId: form.id,
                            required: true,
                            oncePerCustomer: form.kind === 'consent',
                            sortOrder: actuales.length,
                          },
                        ],
                  )
                }
              >
                {enlace ? t('admin.forms.detach') : t('admin.forms.attach')}
              </Button>
            </Card>
          );
        })}
      </ul>
    </div>
  );
}
