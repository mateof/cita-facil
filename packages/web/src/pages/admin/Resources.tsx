import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import type { AdminLocation, AdminResource } from '../../lib/types.ts';
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
} from '../../components/ui.tsx';

const TYPES = ['staff', 'room', 'seat', 'court', 'lane', 'equipment', 'table', 'vehicle', 'other'] as const;

type Draft = Partial<AdminResource>;

/** Recursos reservables: personal, salas, pistas, calles de piscina, equipos. */
export default function Resources() {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const locations = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['locations', organizationId],
    queryFn: () => api.get<AdminLocation[]>(`/organizations/${organizationId}/locations`),
  });

  const resources = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['resources', organizationId],
    queryFn: () => api.get<AdminResource[]>(`/organizations/${organizationId}/resources`),
  });

  const members = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['members', organizationId],
    queryFn: () =>
      api.get<{ userId: string; name: string }[]>(`/organizations/${organizationId}/members`),
  });

  const save = useMutation({
    mutationFn: (input: Draft) =>
      input.id
        ? api.patch(`/organizations/${organizationId}/resources/${input.id}`, input)
        : api.post(`/organizations/${organizationId}/resources`, input),
    onSuccess: () => {
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['resources'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/resources/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['resources'] }),
  });

  const openNew = () =>
    setDraft({
      name: '',
      type: 'staff',
      capacity: 1,
      bookableDirectly: true,
      active: true,
      sortOrder: 0,
      locationId: locations.data?.[0]?.id ?? '',
    });

  return (
    <div>
      <PageHeader
        title={t('admin.resources.title')}
        actions={
          <Button icon={<Plus className="size-4" />} onClick={openNew}>
            {t('admin.resources.new')}
          </Button>
        }
      />

      {resources.isLoading && <LoadingBlock rows={3} />}
      <ErrorMessage error={remove.error} />

      <ul className="grid gap-2 sm:grid-cols-2">
        {resources.data?.map((resource) => (
          <Card as="li" key={resource.id} className="flex items-center gap-3">
            <span
              className="size-10 shrink-0 rounded-xl"
              style={{ background: resource.color ?? 'var(--brand)' }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{resource.name}</p>
              <p className="text-sm text-slate-500">
                {t(`admin.resources.types.${resource.type}`)}
                {resource.capacity > 1 && ` · ${t('admin.resources.capacity')} ${resource.capacity}`}
                {' · '}
                {locations.data?.find((location) => location.id === resource.locationId)?.name}
              </p>
            </div>
            {!resource.active && <Badge className="bg-slate-200">{t('common.no')}</Badge>}
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                aria-label={t('common.edit')}
                onClick={() => setDraft(resource)}
              >
                <Pencil className="size-4" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={t('common.delete')}
                onClick={() => remove.mutate(resource.id)}
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
        title={draft?.id ? t('common.edit') : t('admin.resources.new')}
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
          <>
            <ErrorMessage error={save.error} />

            <Field label={t('admin.services.name')} required>
              <Input
                value={draft.name ?? ''}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>

            <Field label={t('admin.resources.type')}>
              <Select
                value={draft.type ?? 'staff'}
                onChange={(event) => setDraft({ ...draft, type: event.target.value })}
              >
                {TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`admin.resources.types.${type}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('admin.location')}>
              <Select
                value={draft.locationId ?? ''}
                onChange={(event) => setDraft({ ...draft, locationId: event.target.value })}
              >
                {locations.data?.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label={t('admin.resources.capacity')}
              hint="Personas que pueden usarlo a la vez"
            >
              <Input
                type="number"
                min={1}
                value={draft.capacity ?? 1}
                onChange={(event) => setDraft({ ...draft, capacity: Number(event.target.value) })}
              />
            </Field>

            {draft.type === 'staff' && (
              <Field label={t('admin.resources.linkedUser')}>
                <Select
                  value={draft.userId ?? ''}
                  onChange={(event) =>
                    setDraft({ ...draft, userId: event.target.value || null })
                  }
                >
                  <option value="">{t('common.none')}</option>
                  {members.data?.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label={t('admin.settings.brandColor')}>
              <Input
                type="color"
                value={draft.color ?? '#2563eb'}
                onChange={(event) => setDraft({ ...draft, color: event.target.value })}
                className="h-11 p-1"
              />
            </Field>

            <Switch
              checked={draft.bookableDirectly ?? true}
              onChange={(value) => setDraft({ ...draft, bookableDirectly: value })}
              label={t('admin.resources.bookableDirectly')}
            />
            <Switch
              checked={draft.active ?? true}
              onChange={(value) => setDraft({ ...draft, active: value })}
              label={t('common.yes')}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
