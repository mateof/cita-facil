import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileSignature, Plus, Trash2 } from 'lucide-react';
import type { FormDefinition, FormField } from '@cita-facil/shared';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Modal,
  Select,
  Switch,
  Textarea,
} from '../../components/ui.tsx';

/**
 * Formularios y consentimientos.
 *
 * Viven en la pantalla de Servicios porque es a los servicios a lo que se
 * enganchan: la hoja de alergias no significa nada suelta, sino colgada del
 * tratamiento que la exige.
 */

type Draft = Partial<FormDefinition>;

const VACIO: Draft = {
  name: '',
  description: '',
  kind: 'form',
  fields: [],
  consentText: '',
  requiresSignature: false,
  active: true,
};

const TIPOS: FormField['type'][] = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'];

export function FormsTab() {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const forms = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['forms', organizationId],
    queryFn: () => api.get<FormDefinition[]>(`/organizations/${organizationId}/forms`),
  });

  const save = useMutation({
    mutationFn: (input: Draft) => {
      const body = {
        name: input.name,
        description: input.description || null,
        kind: input.kind,
        fields: input.fields ?? [],
        consentText: input.consentText || null,
        requiresSignature: input.requiresSignature ?? false,
        active: input.active ?? true,
      };
      return input.id
        ? api.patch(`/organizations/${organizationId}/forms/${input.id}`, body)
        : api.post(`/organizations/${organizationId}/forms`, body);
    },
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['forms'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/forms/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['forms'] }),
  });

  const setDraftValue = (patch: Draft) => setDraft({ ...draft, ...patch });

  const campos = draft?.fields ?? [];
  const setCampos = (fields: FormField[]) => setDraftValue({ fields });

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setDraft({ ...VACIO })}>
          {t('admin.forms.new')}
        </Button>
      </div>

      <ErrorMessage error={forms.error ?? remove.error} />
      {forms.isLoading && <LoadingBlock rows={3} />}

      {forms.data?.length === 0 && (
        <EmptyState
          icon={<FileSignature className="size-10" />}
          title={t('admin.forms.empty')}
          description={t('admin.forms.emptyHint')}
        />
      )}

      <ul className="space-y-2">
        {forms.data?.map((form) => (
          <Card as="li" key={form.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
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
                {!form.active && <Badge className="bg-slate-200">{t('admin.forms.inactive')}</Badge>}
              </p>
              <p className="text-sm text-slate-500">
                {form.kind === 'consent'
                  ? t('admin.forms.consentSummary', {
                      signature: form.requiresSignature ? t('admin.forms.withSignature') : '',
                    })
                  : t('admin.forms.fieldCount', { count: form.fields.length })}
              </p>
            </div>

            <Button variant="secondary" onClick={() => setDraft(form)}>
              {t('common.edit')}
            </Button>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={t('common.delete')}
              onClick={() => remove.mutate(form.id)}
            >
              <Trash2 className="size-4" />
            </button>
          </Card>
        ))}
      </ul>

      <Modal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        wide
        title={draft?.id ? t('common.edit') : t('admin.forms.new')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={save.isPending}
              disabled={!draft?.name?.trim()}
              onClick={() => draft && save.mutate(draft)}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <div>
            <ErrorMessage error={save.error} />

            <Field label={t('admin.forms.name')} required>
              <Input
                value={draft.name ?? ''}
                onChange={(event) => setDraftValue({ name: event.target.value })}
              />
            </Field>

            <Field label={t('admin.forms.description')}>
              <Input
                value={draft.description ?? ''}
                onChange={(event) => setDraftValue({ description: event.target.value })}
              />
            </Field>

            <Field label={t('admin.forms.kindLabel')} hint={t('admin.forms.kindHint')}>
              <Select
                value={draft.kind ?? 'form'}
                onChange={(event) =>
                  setDraftValue({ kind: event.target.value as FormDefinition['kind'] })
                }
              >
                <option value="form">{t('admin.forms.kind.form')}</option>
                <option value="consent">{t('admin.forms.kind.consent')}</option>
              </Select>
            </Field>

            {draft.kind === 'consent' ? (
              <>
                <Field label={t('admin.forms.consentText')} hint={t('admin.forms.consentTextHint')}>
                  <Textarea
                    rows={10}
                    value={draft.consentText ?? ''}
                    onChange={(event) => setDraftValue({ consentText: event.target.value })}
                  />
                </Field>
                <Switch
                  checked={draft.requiresSignature ?? false}
                  onChange={(value) => setDraftValue({ requiresSignature: value })}
                  label={t('admin.forms.requiresSignature')}
                  hint={t('admin.forms.requiresSignatureHint')}
                />
              </>
            ) : (
              <section className="mt-2">
                <h3 className="mb-2 font-semibold">{t('admin.forms.fields')}</h3>

                <ul className="space-y-3">
                  {campos.map((campo, indice) => (
                    <li key={indice} className="rounded-xl border border-slate-200 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t('admin.forms.fieldLabel')} className="mb-0">
                          <Input
                            value={campo.label}
                            onChange={(event) =>
                              setCampos(
                                campos.map((item, i) =>
                                  i === indice ? { ...item, label: event.target.value } : item,
                                ),
                              )
                            }
                          />
                        </Field>

                        <Field
                          label={t('admin.forms.fieldKey')}
                          hint={t('admin.forms.fieldKeyHint')}
                          className="mb-0"
                        >
                          <Input
                            value={campo.key}
                            onChange={(event) =>
                              setCampos(
                                campos.map((item, i) =>
                                  i === indice
                                    ? {
                                        ...item,
                                        key: event.target.value
                                          .toLowerCase()
                                          .replace(/[^a-z0-9_]/g, '_'),
                                      }
                                    : item,
                                ),
                              )
                            }
                          />
                        </Field>

                        <Field label={t('admin.forms.fieldType')} className="mb-0">
                          <Select
                            value={campo.type}
                            onChange={(event) =>
                              setCampos(
                                campos.map((item, i) =>
                                  i === indice
                                    ? { ...item, type: event.target.value as FormField['type'] }
                                    : item,
                                ),
                              )
                            }
                          >
                            {TIPOS.map((tipo) => (
                              <option key={tipo} value={tipo}>
                                {t(`admin.forms.types.${tipo}`)}
                              </option>
                            ))}
                          </Select>
                        </Field>

                        {campo.type === 'select' && (
                          <Field
                            label={t('admin.forms.fieldOptions')}
                            hint={t('admin.forms.fieldOptionsHint')}
                            className="mb-0"
                          >
                            <Input
                              value={campo.options.join(', ')}
                              onChange={(event) =>
                                setCampos(
                                  campos.map((item, i) =>
                                    i === indice
                                      ? {
                                          ...item,
                                          options: event.target.value
                                            .split(',')
                                            .map((option) => option.trim())
                                            .filter(Boolean),
                                        }
                                      : item,
                                  ),
                                )
                              }
                            />
                          </Field>
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <Switch
                          checked={campo.required}
                          onChange={(value) =>
                            setCampos(
                              campos.map((item, i) =>
                                i === indice ? { ...item, required: value } : item,
                              ),
                            )
                          }
                          label={t('admin.forms.fieldRequired')}
                        />
                        <button
                          type="button"
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={t('common.delete')}
                          onClick={() => setCampos(campos.filter((_, i) => i !== indice))}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>

                <Button
                  variant="secondary"
                  className="mt-3"
                  icon={<Plus className="size-4" />}
                  onClick={() =>
                    setCampos([
                      ...campos,
                      {
                        key: `campo_${campos.length + 1}`,
                        label: '',
                        type: 'text',
                        required: false,
                        options: [],
                      },
                    ])
                  }
                >
                  {t('admin.forms.addField')}
                </Button>
              </section>
            )}

            <Switch
              checked={draft.active ?? true}
              onChange={(value) => setDraftValue({ active: value })}
              label={t('admin.forms.activeLabel')}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}
