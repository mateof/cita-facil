import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Ticket, Timer, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { formatDuration, formatMoney } from '../../lib/format.ts';
import type { AdminResource, AdminService } from '../../lib/types.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Switch,
  Tabs,
  Textarea,
} from '../../components/ui.tsx';
import { AvatarPicker } from '../../components/avatar-picker.tsx';
import { CutoffSelect } from '../../components/cutoff-select.tsx';
import { EntityAvatar } from '../../components/avatar.tsx';
import { FormsTab } from './Forms.tsx';
import { ServiceFormsPicker } from '../../components/service-forms.tsx';

type Draft = Partial<AdminService> & { descriptionText?: string };

const EMPTY: Draft = {
  name: '',
  durationMode: 'fixed',
  durationMinutes: 30,
  minDurationMinutes: 30,
  maxDurationMinutes: 120,
  durationStepMinutes: 15,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  priceMode: 'fixed',
  priceCents: 0,
  pricePerMinuteCents: 0,
  currency: 'EUR',
  depositCents: 0,
  paymentRequired: false,
  requiresCreditPack: false,
  capacity: 1,
  requiresApproval: false,
  minAdvanceMinutes: 0,
  maxAdvanceDays: 90,
  cancellationCutoffMinutes: 0,
  rescheduleCutoffMinutes: 0,
  allowResourceSelection: true,
  publiclyBookable: true,
  staffOnly: false,
  active: true,
  resourceIds: [],
};

/** Gestión de servicios, incluida la duración ajustable por el cliente. */
/**
 * Servicios y los formularios que piden.
 *
 * Van en la misma pantalla con dos pestañas porque un formulario suelto no
 * significa nada: existe colgado del servicio que lo exige.
 */
export default function Services() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('services');

  return (
    <div>
      <PageHeader title={t('admin.services.title')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'services', label: t('admin.services.title') },
          { id: 'forms', label: t('admin.forms.title') },
        ]}
      />
      {tab === 'services' ? <ServicesTab /> : <FormsTab />}
    </div>
  );
}

function ServicesTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const services = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['services', organizationId],
    queryFn: () => api.get<AdminService[]>(`/organizations/${organizationId}/services`),
  });

  const resources = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['resources', organizationId],
    queryFn: () => api.get<AdminResource[]>(`/organizations/${organizationId}/resources`),
  });

  const save = useMutation({
    mutationFn: (input: Draft) => {
      const body = {
        ...input,
        description: input.descriptionText ? { [locale]: input.descriptionText } : undefined,
        descriptionText: undefined,
      };
      return input.id
        ? api.patch(`/organizations/${organizationId}/services/${input.id}`, body)
        : api.post(`/organizations/${organizationId}/services`, body);
    },
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/services/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['services'] }),
  });

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setDraft({ ...EMPTY })}>
          {t('admin.services.new')}
        </Button>
      </div>

      {services.isLoading && <LoadingBlock rows={3} />}
      <ErrorMessage error={remove.error} />

      <ul className="space-y-2">
        {services.data?.map((service) => (
          <Card as="li" key={service.id} className="flex flex-wrap items-center gap-3">
            <EntityAvatar
              name={service.name}
              avatar={{ imageUrl: service.imageUrl, icon: service.icon, color: service.color }}
              square
            />

            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold">
                {service.name}
                {!service.active && <Badge className="bg-slate-200">{t('common.no')}</Badge>}
                {service.durationMode === 'flexible' && (
                  <Badge className="bg-indigo-100 text-indigo-800">
                    <Timer className="size-3" aria-hidden />
                    {service.minDurationMinutes}–{service.maxDurationMinutes} min
                  </Badge>
                )}
                {service.requiresApproval && (
                  <Badge className="bg-amber-100 text-amber-800">
                    {t('admin.services.requiresApproval')}
                  </Badge>
                )}
                {service.requiresCreditPack && (
                  <Badge className="bg-brand-soft text-brand">
                    <Ticket className="size-3" aria-hidden />
                    {t('admin.services.creditPack')}
                  </Badge>
                )}
              </p>
              <p className="mt-0.5 text-sm text-slate-500">
                {service.durationMode === 'fixed'
                  ? formatDuration(service.durationMinutes, locale)
                  : `${t('admin.services.flexible')}`}
                {service.priceMode !== 'free' && (
                  <>
                    {' · '}
                    {service.priceMode === 'per_minute'
                      ? `${formatMoney(service.pricePerMinuteCents ?? 0, service.currency, locale)}/min`
                      : formatMoney(service.priceCents, service.currency, locale)}
                  </>
                )}
                {service.capacity > 1 && ` · ${t('admin.services.capacity')} ${service.capacity}`}
              </p>
            </div>

            <div className="flex gap-1">
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label={t('common.edit')}
                onClick={() =>
                  setDraft({
                    ...service,
                    descriptionText: service.description?.[locale] ?? '',
                  })
                }
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={t('common.delete')}
                onClick={() => remove.mutate(service.id)}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </Card>
        ))}
      </ul>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        wide
        title={draft?.id ? t('common.edit') : t('admin.services.new')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {draft && (
          <ServiceForm
            draft={draft}
            resources={resources.data ?? []}
            error={save.error}
            onChange={setDraft}
          />
        )}
      </Modal>
    </div>
  );
}

function ServiceForm({
  draft,
  resources,
  error,
  onChange,
}: {
  draft: Draft;
  resources: AdminResource[];
  error: unknown;
  onChange: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  return (
    <div>
      <ErrorMessage error={error} />

      <Field label={t('admin.services.name')} required>
        <Input value={draft.name ?? ''} onChange={(event) => set({ name: event.target.value })} />
      </Field>

      <Field label={t('avatar.fieldLabel')}>
        <AvatarPicker
          name={draft.name ?? ''}
          target="service"
          organizationId={organizationId}
          value={{ imageUrl: draft.imageUrl, icon: draft.icon, color: draft.color }}
          onChange={(avatar) => set(avatar)}
        />
      </Field>

      <Field label={t('admin.services.description')}>
        <Textarea
          value={draft.descriptionText ?? ''}
          onChange={(event) => set({ descriptionText: event.target.value })}
        />
      </Field>

      {/* Duración */}
      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">{t('admin.services.durationMode')}</legend>

        <div className="mb-3 flex gap-2">
          {(['fixed', 'flexible'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => set({ durationMode: mode })}
              aria-pressed={draft.durationMode === mode}
              className={
                draft.durationMode === mode
                  ? 'flex-1 rounded-xl border border-brand bg-brand-soft px-3 py-2 text-sm font-medium text-brand'
                  : 'flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:border-slate-300'
              }
            >
              {t(`admin.services.${mode}`)}
            </button>
          ))}
        </div>

        {draft.durationMode === 'flexible' && (
          <p className="mb-3 rounded-lg bg-indigo-50 p-2.5 text-xs text-indigo-900">
            {t('admin.services.flexibleHint')}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`${t('admin.duration')} (min)`} className="mb-0">
            <Input
              type="number"
              min={1}
              value={draft.durationMinutes ?? 30}
              onChange={(event) => set({ durationMinutes: Number(event.target.value) })}
            />
          </Field>

          {draft.durationMode === 'flexible' && (
            <>
              <Field label={t('admin.services.step')} className="mb-0">
                <Input
                  type="number"
                  min={1}
                  value={draft.durationStepMinutes ?? 15}
                  onChange={(event) => set({ durationStepMinutes: Number(event.target.value) })}
                />
              </Field>
              <Field label={t('admin.services.minDuration')} className="mb-0">
                <Input
                  type="number"
                  min={1}
                  value={draft.minDurationMinutes ?? 30}
                  onChange={(event) => set({ minDurationMinutes: Number(event.target.value) })}
                />
              </Field>
              <Field label={t('admin.services.maxDuration')} className="mb-0">
                <Input
                  type="number"
                  min={1}
                  value={draft.maxDurationMinutes ?? 120}
                  onChange={(event) => set({ maxDurationMinutes: Number(event.target.value) })}
                />
              </Field>
            </>
          )}

          <Field label={t('admin.services.bufferBefore')} className="mb-0">
            <Input
              type="number"
              min={0}
              value={draft.bufferBeforeMinutes ?? 0}
              onChange={(event) => set({ bufferBeforeMinutes: Number(event.target.value) })}
            />
          </Field>
          <Field label={t('admin.services.bufferAfter')} className="mb-0">
            <Input
              type="number"
              min={0}
              value={draft.bufferAfterMinutes ?? 0}
              onChange={(event) => set({ bufferAfterMinutes: Number(event.target.value) })}
            />
          </Field>
        </div>
      </fieldset>

      {/* Precio */}
      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">{t('admin.services.priceMode')}</legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.services.priceMode')} className="mb-0">
            <Select
              value={draft.priceMode ?? 'fixed'}
              onChange={(event) => set({ priceMode: event.target.value })}
            >
              <option value="free">{t('admin.services.priceFree')}</option>
              <option value="fixed">{t('admin.services.priceFixed')}</option>
              <option value="per_minute">{t('admin.services.pricePerMinute')}</option>
              <option value="per_person">{t('admin.services.pricePerPerson')}</option>
            </Select>
          </Field>

          {draft.priceMode === 'per_minute' ? (
            <Field label={`${t('admin.price')} (céntimos/min)`} className="mb-0">
              <Input
                type="number"
                min={0}
                value={draft.pricePerMinuteCents ?? 0}
                onChange={(event) => set({ pricePerMinuteCents: Number(event.target.value) })}
              />
            </Field>
          ) : (
            <Field label={`${t('admin.price')} (céntimos)`} className="mb-0">
              <Input
                type="number"
                min={0}
                value={draft.priceCents ?? 0}
                onChange={(event) => set({ priceCents: Number(event.target.value) })}
              />
            </Field>
          )}

          <Field label={`${t('admin.services.deposit')} (céntimos)`} className="mb-0">
            <Input
              type="number"
              min={0}
              value={draft.depositCents ?? 0}
              onChange={(event) => set({ depositCents: Number(event.target.value) })}
            />
          </Field>

          {/* Vacío hereda el cargo de la organización; cero es no cobrar faltas. */}
          <Field
            label={`${t('admin.rules.noShowFee')} (céntimos)`}
            hint={t('admin.rules.noShowFeeServiceHint')}
            className="mb-0"
          >
            <Input
              type="number"
              min={0}
              placeholder={t('admin.rules.inherit')}
              value={draft.noShowFeeCents ?? ''}
              onChange={(event) =>
                set({
                  noShowFeeCents: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </Field>
        </div>

        <div className="divide-y divide-slate-100">
          <Switch
            checked={draft.paymentRequired ?? false}
            onChange={(value) => set({ paymentRequired: value })}
            label={t('admin.services.paymentRequired')}
          />
          <Switch
            checked={draft.requiresCreditPack ?? false}
            onChange={(value) => set({ requiresCreditPack: value })}
            label={t('admin.services.requiresCreditPack')}
            hint={t('admin.services.requiresCreditPackHint')}
          />
        </div>
      </fieldset>

      {/* Reglas */}
      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">{t('admin.settings.booking')}</legend>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.services.capacity')} hint={t('admin.services.capacityHint')} className="mb-0">
            <Input
              type="number"
              min={1}
              value={draft.capacity ?? 1}
              onChange={(event) => set({ capacity: Number(event.target.value) })}
            />
          </Field>
          <Field label={t('admin.rules.minAdvance')} hint={t('admin.rules.minAdvanceHint')} className="mb-0">
            <CutoffSelect
              allowInherit
              value={draft.minAdvanceMinutes}
              onChange={(value) => set({ minAdvanceMinutes: value })}
            />
          </Field>
          <Field label={t('admin.rules.cancelCutoff')} hint={t('admin.rules.cancelCutoffHint')} className="mb-0">
            <CutoffSelect
              allowInherit
              value={draft.cancellationCutoffMinutes}
              onChange={(value) => set({ cancellationCutoffMinutes: value })}
            />
          </Field>
          <Field label={t('admin.rules.chargeMode')} hint={t('admin.rules.chargeModeHint')} className="mb-0">
            <Select
              value={draft.creditChargeMode ?? 'inherit'}
              onChange={(event) => set({ creditChargeMode: event.target.value as never })}
            >
              <option value="inherit">{t('admin.rules.chargeInherit')}</option>
              <option value="booking">{t('admin.rules.chargeBooking')}</option>
              <option value="completion">{t('admin.rules.chargeCompletion')}</option>
            </Select>
          </Field>
          <Field label={`${t('admin.services.maxAdvance')} (${t('common.days')})`} className="mb-0">
            <Input
              type="number"
              min={0}
              value={draft.maxAdvanceDays ?? 90}
              onChange={(event) => set({ maxAdvanceDays: Number(event.target.value) })}
            />
          </Field>
          <Field label={`${t('admin.services.cancellationCutoff')} (min)`} className="mb-0">
            <Input
              type="number"
              min={0}
              value={draft.cancellationCutoffMinutes ?? 0}
              onChange={(event) => set({ cancellationCutoffMinutes: Number(event.target.value) })}
            />
          </Field>
        </div>

        <div className="mt-2 divide-y divide-slate-100">
          <Switch
            checked={draft.requiresApproval ?? false}
            onChange={(value) => set({ requiresApproval: value })}
            label={t('admin.services.requiresApproval')}
          />
          <Switch
            checked={draft.allowResourceSelection ?? true}
            onChange={(value) => set({ allowResourceSelection: value })}
            label={t('admin.services.allowResourceSelection')}
          />
          <Switch
            checked={draft.publiclyBookable ?? true}
            onChange={(value) => set({ publiclyBookable: value })}
            label={t('admin.services.publiclyBookable')}
          />
          <Switch
            checked={draft.staffOnly ?? false}
            onChange={(value) => set({ staffOnly: value })}
            label={t('admin.services.staffOnly')}
          />
          <Switch
            checked={draft.active ?? true}
            onChange={(value) => set({ active: value })}
            label={t('common.yes')}
          />
        </div>
      </fieldset>

      <Field label={t('admin.services.assignedResources')}>
        <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-3">
          {resources.length === 0 && (
            <p className="text-sm text-slate-500">{t('common.empty')}</p>
          )}
          {resources.map((resource) => (
            <label key={resource.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(draft.resourceIds ?? []).includes(resource.id)}
                onChange={(event) =>
                  set({
                    resourceIds: event.target.checked
                      ? [...(draft.resourceIds ?? []), resource.id]
                      : (draft.resourceIds ?? []).filter((id) => id !== resource.id),
                  })
                }
                className="size-4 rounded border-slate-300"
              />
              {resource.name}
            </label>
          ))}
        </div>
      </Field>

      <Field label={t('admin.forms.title')} hint={t('admin.forms.serviceHint')}>
        <ServiceFormsPicker organizationId={organizationId} serviceId={draft.id} />
      </Field>
    </div>
  );
}
