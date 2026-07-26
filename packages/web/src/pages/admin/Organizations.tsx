import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2, Check, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import type { ManageableOrganization } from '../../stores/auth.ts';
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
} from '../../components/ui.tsx';

interface OrganizationRow extends ManageableOrganization {
  timezone: string;
  locale: string;
  currency: string;
  status: string;
}

interface OrganizationUsage {
  locations: number;
  services: number;
  appointments: number;
  members: number;
}

type Draft = {
  id?: string;
  name: string;
  slug?: string;
  timezone: string;
  locale: string;
  currency: string;
  email?: string;
  phone?: string;
  taxId?: string;
};

function emptyDraft(locale: string): Draft {
  return {
    name: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
    locale,
    currency: 'EUR',
  };
}

/**
 * Alta y gestión de organizaciones.
 *
 * La organización es la unidad de aislamiento: cada una tiene sus sedes, su
 * catálogo, su personal y sus clientes, y nada se cruza entre ellas. Esta
 * pantalla es de plataforma, solo para el administrador de la instalación:
 * quien lleva una peluquería no tiene por qué ver el gimnasio de al lado.
 */
export default function Organizations() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const reload = useAuth((state) => state.reload);
  const activeOrganizationId = useAuth((state) => state.activeOrganizationId);
  const setActiveOrganization = useAuth((state) => state.setActiveOrganization);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<OrganizationRow | null>(null);

  const organizations = useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<OrganizationRow[]>('/organizations'),
  });

  const save = useMutation({
    mutationFn: (input: Draft) => {
      const body = {
        name: input.name,
        slug: input.slug || undefined,
        timezone: input.timezone,
        locale: input.locale,
        currency: input.currency,
        email: input.email || undefined,
        phone: input.phone || undefined,
        taxId: input.taxId || undefined,
      };
      return input.id
        ? api.patch<OrganizationRow>(`/organizations/${input.id}`, body)
        : api.post<OrganizationRow>('/organizations', body);
    },
    onSuccess: async (organization, input) => {
      setDraft(null);
      await reload();
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
      // Al crear una nueva se pasa a trabajar en ella: es lo que se quiere
      // hacer a continuación, configurarla.
      if (!input.id) setActiveOrganization(organization.id);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${id}`),
    onSuccess: async () => {
      setRemoving(null);
      await reload();
      void queryClient.invalidateQueries({ queryKey: ['organizations'] });
    },
  });

  const locale = i18n.language.slice(0, 2);

  return (
    <div>
      <PageHeader
        title={t('admin.organizations.title')}
        description={t('admin.organizations.description')}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={() => setDraft(emptyDraft(locale))}>
            {t('admin.organizations.new')}
          </Button>
        }
      />

      {organizations.isLoading && <LoadingBlock rows={3} />}
      <ErrorMessage error={organizations.error ?? remove.error} />

      <ul className="space-y-2">
        {organizations.data?.map((organization) => {
          const active = organization.id === activeOrganizationId;
          return (
            <Card as="li" key={organization.id} className="flex flex-wrap items-center gap-3">
              <Building2 className="size-5 shrink-0 text-brand" aria-hidden />

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 font-semibold">
                  {organization.name}
                  {active && (
                    <Badge className="bg-brand-soft text-brand">
                      {t('admin.organizations.working')}
                    </Badge>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-slate-500">
                  /{organization.slug} · {organization.timezone} · {organization.currency}
                </p>
              </div>

              <div className="flex items-center gap-1">
                <a
                  href={`/reservar/${organization.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label={t('admin.organizations.publicPage')}
                >
                  <ExternalLink className="size-4" />
                </a>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label={t('common.edit')}
                  onClick={() =>
                    setDraft({
                      id: organization.id,
                      name: organization.name,
                      slug: organization.slug,
                      timezone: organization.timezone,
                      locale: organization.locale,
                      currency: organization.currency,
                    })
                  }
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('common.delete')}
                  onClick={() => setRemoving(organization)}
                >
                  <Trash2 className="size-4" />
                </button>
                {!active && (
                  <Button variant="ghost" onClick={() => setActiveOrganization(organization.id)}>
                    {t('admin.organizations.workHere')}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </ul>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t('common.edit') : t('admin.organizations.new')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={save.isPending}
              disabled={!draft?.name}
              onClick={() => draft && save.mutate(draft)}
            >
              {draft?.id ? t('common.save') : t('admin.organizations.create')}
            </Button>
          </>
        }
      >
        {draft && <OrganizationForm draft={draft} error={save.error} onChange={setDraft} />}
      </Modal>

      <RemoveModal
        organization={removing}
        pending={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </div>
  );
}

function OrganizationForm({
  draft,
  error,
  onChange,
}: {
  draft: Draft;
  error: unknown;
  onChange: (draft: Draft) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });

  const timezones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Europe/Madrid', 'Atlantic/Canary', 'UTC'];

  return (
    <div>
      <ErrorMessage error={error} />

      <Field label={t('admin.organizations.name')} required>
        <Input
          value={draft.name}
          onChange={(event) => set({ name: event.target.value })}
          placeholder={t('admin.organizations.namePlaceholder')}
        />
      </Field>

      <Field label={t('admin.organizations.slug')} hint={t('admin.organizations.slugHint')}>
        <Input
          value={draft.slug ?? ''}
          onChange={(event) => set({ slug: event.target.value })}
          placeholder="gimnasio-centro"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.settings.timezone')}>
          <Select value={draft.timezone} onChange={(event) => set({ timezone: event.target.value })}>
            {timezones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('common.language')}>
          <Select value={draft.locale} onChange={(event) => set({ locale: event.target.value })}>
            <option value="es">Español</option>
            <option value="gl">Galego</option>
            <option value="en">English</option>
          </Select>
        </Field>

        <Field label={t('admin.organizations.currency')}>
          <Input
            value={draft.currency}
            maxLength={3}
            onChange={(event) => set({ currency: event.target.value.toUpperCase() })}
          />
        </Field>

        <Field label={t('admin.organizations.taxId')}>
          <Input value={draft.taxId ?? ''} onChange={(event) => set({ taxId: event.target.value })} />
        </Field>
      </div>

      <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        {t('admin.organizations.createHint')}
      </p>
    </div>
  );
}

/**
 * Baja de una organización. Se enseña antes lo que cuelga de ella: dar de baja
 * un negocio con citas futuras no debería poder hacerse sin verlo.
 */
function RemoveModal({
  organization,
  pending,
  onClose,
  onConfirm,
}: {
  organization: OrganizationRow | null;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  const usage = useQuery({
    enabled: Boolean(organization),
    queryKey: ['organization-usage', organization?.id],
    queryFn: () => api.get<OrganizationUsage>(`/organizations/${organization?.id}/usage`),
  });

  return (
    <Modal
      open={organization !== null}
      onClose={onClose}
      title={t('admin.organizations.removeTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            {t('admin.organizations.removeAction')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm">
        {t('admin.organizations.removeConfirm', { name: organization?.name ?? '' })}
      </p>

      {usage.data && (
        <ul className="mb-3 space-y-1 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          <li className="flex items-center gap-2">
            <Check className="size-4 text-slate-400" aria-hidden />
            {t('admin.organizations.usageAppointments', { count: usage.data.appointments })}
          </li>
          <li className="flex items-center gap-2">
            <Check className="size-4 text-slate-400" aria-hidden />
            {t('admin.organizations.usageServices', { count: usage.data.services })}
          </li>
          <li className="flex items-center gap-2">
            <Check className="size-4 text-slate-400" aria-hidden />
            {t('admin.organizations.usageMembers', { count: usage.data.members })}
          </li>
        </ul>
      )}

      <p className="text-xs text-slate-500">{t('admin.organizations.removeHint')}</p>
    </Modal>
  );
}
