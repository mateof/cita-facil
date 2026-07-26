import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { minutesToTime, timeToMinutes, todayIso } from '../../lib/format.ts';
import type { AdminLocation, AdminResource, ScheduleRule } from '../../lib/types.ts';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SuccessMessage,
  Tabs,
} from '../../components/ui.tsx';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Horarios, festivos y ausencias.
 *
 * El horario se define por propietario: la sede marca el general y un recurso
 * concreto puede tener el suyo, que se intersecta con el de la sede. Así, un
 * fisioterapeuta que solo trabaja por las tardes no necesita que se cierre el
 * centro por las mañanas.
 */
export default function Schedules() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('weekly');

  return (
    <div>
      <PageHeader title={t('admin.schedules.title')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'weekly', label: t('admin.schedules.weekly') },
          { id: 'exceptions', label: t('admin.schedules.exceptions') },
          { id: 'timeOff', label: t('admin.schedules.timeOff') },
        ]}
      />

      {tab === 'weekly' && <WeeklyTab />}
      {tab === 'exceptions' && <ExceptionsTab />}
      {tab === 'timeOff' && <TimeOffTab />}
    </div>
  );
}

function useOwners() {
  const organizationId = useAuth((state) => state.activeOrganizationId);

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

  return { organizationId, locations: locations.data ?? [], resources: resources.data ?? [] };
}

/* -------------------------------------------------------------------------- */

function WeeklyTab() {
  const { t } = useTranslation();
  const { organizationId, locations, resources } = useOwners();
  const queryClient = useQueryClient();

  const [owner, setOwner] = useState<{ type: string; id: string } | null>(null);
  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!owner && locations[0]) setOwner({ type: 'location', id: locations[0].id });
  }, [locations, owner]);

  const schedule = useQuery({
    enabled: Boolean(organizationId && owner),
    queryKey: ['schedule', organizationId, owner?.type, owner?.id],
    queryFn: () =>
      api.get<ScheduleRule[]>(`/organizations/${organizationId}/schedules`, {
        query: { ownerType: owner!.type, ownerId: owner!.id },
      }),
  });

  useEffect(() => {
    if (schedule.data) setRules(schedule.data);
  }, [schedule.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/organizations/${organizationId}/schedules`, {
        ownerType: owner!.type,
        ownerId: owner!.id,
        rules,
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['schedule'] });
    },
  });

  const addRange = (weekday: number) => {
    setRules([...rules, { weekday, startMinute: 9 * 60, endMinute: 14 * 60 }]);
  };

  return (
    <Card>
      <Field label={t('admin.schedules.appliesTo')}>
        <Select
          value={owner ? `${owner.type}:${owner.id}` : ''}
          onChange={(event) => {
            const [type, id] = event.target.value.split(':');
            setOwner({ type: type!, id: id! });
          }}
        >
          <optgroup label={t('nav.services')}>
            {locations.map((location) => (
              <option key={location.id} value={`location:${location.id}`}>
                {location.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={t('admin.resources.title')}>
            {resources.map((resource) => (
              <option key={resource.id} value={`resource:${resource.id}`}>
                {resource.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </Field>

      {saved && <SuccessMessage>{t('common.save')}</SuccessMessage>}
      <ErrorMessage error={save.error} />

      <div className="space-y-3">
        {WEEKDAYS.map((weekday) => {
          const dayRules = rules
            .map((rule, index) => ({ rule, index }))
            .filter((item) => item.rule.weekday === weekday);

          return (
            <div key={weekday} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-medium">{t(`admin.schedules.weekdays.${weekday}`)}</span>
                <button
                  type="button"
                  onClick={() => addRange(weekday)}
                  className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
                >
                  <Plus className="size-4" aria-hidden />
                  {t('admin.schedules.addRange')}
                </button>
              </div>

              {dayRules.length === 0 && (
                <p className="text-sm text-slate-400">{t('admin.schedules.closed')}</p>
              )}

              <div className="space-y-2">
                {dayRules.map(({ rule, index }) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={minutesToTime(rule.startMinute)}
                      onChange={(event) => {
                        const next = [...rules];
                        next[index] = { ...rule, startMinute: timeToMinutes(event.target.value) };
                        setRules(next);
                      }}
                      className="max-w-32"
                    />
                    <span className="text-slate-400">–</span>
                    <Input
                      type="time"
                      value={minutesToTime(rule.endMinute)}
                      onChange={(event) => {
                        const next = [...rules];
                        next[index] = { ...rule, endMinute: timeToMinutes(event.target.value) };
                        setRules(next);
                      }}
                      className="max-w-32"
                    />
                    <button
                      type="button"
                      className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      aria-label={t('common.delete')}
                      onClick={() => setRules(rules.filter((_, position) => position !== index))}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>
        {t('common.save')}
      </Button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function ExceptionsTab() {
  const { t } = useTranslation();
  const { organizationId, locations, resources } = useOwners();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    ownerType: 'location',
    ownerId: '',
    type: 'closed',
    date: todayIso(),
    startMinute: 9 * 60,
    endMinute: 14 * 60,
    reason: '',
  });

  const exceptions = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['exceptions', organizationId],
    queryFn: () =>
      api.get<
        {
          id: string;
          ownerType: string;
          ownerId: string;
          type: string;
          date: string;
          startMinute: number | null;
          endMinute: number | null;
          reason: string | null;
        }[]
      >(`/organizations/${organizationId}/schedule-exceptions`),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${organizationId}/schedule-exceptions`, {
        ...draft,
        ownerId: draft.ownerId || locations[0]?.id,
        startMinute: draft.type === 'open' ? draft.startMinute : null,
        endMinute: draft.type === 'open' ? draft.endMinute : null,
        reason: draft.reason || undefined,
      }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      api.delete(`/organizations/${organizationId}/schedule-exceptions/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['exceptions'] }),
  });

  const ownerName = (ownerId: string) =>
    locations.find((location) => location.id === ownerId)?.name ??
    resources.find((resource) => resource.id === ownerId)?.name ??
    ownerId;

  return (
    <Card>
      <div className="mb-3 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          {t('common.add')}
        </Button>
      </div>

      <ul className="divide-y divide-slate-100">
        {exceptions.data?.map((exception) => (
          <li key={exception.id} className="flex items-center justify-between py-2.5">
            <span className="text-sm">
              <span className="font-medium">{exception.date}</span>
              {' · '}
              {exception.type === 'closed'
                ? t('admin.schedules.closed')
                : `${minutesToTime(exception.startMinute ?? 0)}–${minutesToTime(exception.endMinute ?? 0)}`}
              {' · '}
              <span className="text-slate-500">{ownerName(exception.ownerId)}</span>
              {exception.reason && <span className="text-slate-400"> · {exception.reason}</span>}
            </span>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={t('common.delete')}
              onClick={() => remove.mutate(exception.id)}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin.schedules.exceptions')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={create.error} />

        <Field label={t('admin.schedules.appliesTo')}>
          <Select
            value={`${draft.ownerType}:${draft.ownerId || locations[0]?.id || ''}`}
            onChange={(event) => {
              const [type, id] = event.target.value.split(':');
              setDraft({ ...draft, ownerType: type!, ownerId: id! });
            }}
          >
            {locations.map((location) => (
              <option key={location.id} value={`location:${location.id}`}>
                {location.name}
              </option>
            ))}
            {resources.map((resource) => (
              <option key={resource.id} value={`resource:${resource.id}`}>
                {resource.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('common.date')}>
          <Input
            type="date"
            value={draft.date}
            onChange={(event) => setDraft({ ...draft, date: event.target.value })}
          />
        </Field>

        <Field label={t('common.filter')}>
          <Select
            value={draft.type}
            onChange={(event) => setDraft({ ...draft, type: event.target.value })}
          >
            <option value="closed">{t('admin.schedules.closed')}</option>
            <option value="open">{t('admin.schedules.openExtra')}</option>
          </Select>
        </Field>

        {draft.type === 'open' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('common.from')}>
              <Input
                type="time"
                value={minutesToTime(draft.startMinute)}
                onChange={(event) =>
                  setDraft({ ...draft, startMinute: timeToMinutes(event.target.value) })
                }
              />
            </Field>
            <Field label={t('common.to')}>
              <Input
                type="time"
                value={minutesToTime(draft.endMinute)}
                onChange={(event) =>
                  setDraft({ ...draft, endMinute: timeToMinutes(event.target.value) })
                }
              />
            </Field>
          </div>
        )}

        <Field label={t('admin.schedules.reason')}>
          <Input
            value={draft.reason}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
          />
        </Field>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function TimeOffTab() {
  const { t } = useTranslation();
  const { organizationId, resources } = useOwners();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [affected, setAffected] = useState<number | null>(null);
  const [draft, setDraft] = useState({
    resourceId: '',
    startsAt: '',
    endsAt: '',
    reason: '',
  });

  const timeOff = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['time-off', organizationId],
    queryFn: () =>
      api.get<
        { id: string; resourceId: string | null; startsAt: string; endsAt: string; reason: string | null }[]
      >(`/organizations/${organizationId}/time-off`),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; affectedAppointments: number }>(
        `/organizations/${organizationId}/time-off`,
        {
          resourceId: draft.resourceId || null,
          startsAt: new Date(draft.startsAt).toISOString(),
          endsAt: new Date(draft.endsAt).toISOString(),
          reason: draft.reason || undefined,
        },
      ),
    onSuccess: (data) => {
      setAffected(data.affectedAppointments);
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['time-off'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/time-off/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['time-off'] }),
  });

  return (
    <Card>
      {affected !== null && affected > 0 && (
        <SuccessMessage>{t('admin.schedules.affectedAppointments', { count: affected })}</SuccessMessage>
      )}

      <div className="mb-3 flex justify-end">
        <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          {t('common.add')}
        </Button>
      </div>

      <ul className="divide-y divide-slate-100">
        {timeOff.data?.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-2.5 text-sm">
            <span>
              <span className="font-medium">
                {new Date(item.startsAt).toLocaleString()} → {new Date(item.endsAt).toLocaleString()}
              </span>
              {item.resourceId && (
                <span className="text-slate-500">
                  {' · '}
                  {resources.find((resource) => resource.id === item.resourceId)?.name}
                </span>
              )}
              {item.reason && <span className="text-slate-400"> · {item.reason}</span>}
            </span>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={t('common.delete')}
              onClick={() => remove.mutate(item.id)}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin.schedules.timeOff')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={create.isPending}
              disabled={!draft.startsAt || !draft.endsAt}
              onClick={() => create.mutate()}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={create.error} />

        <Field label={t('admin.resource')}>
          <Select
            value={draft.resourceId}
            onChange={(event) => setDraft({ ...draft, resourceId: event.target.value })}
          >
            <option value="">{t('common.all')}</option>
            {resources.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('common.from')} required>
          <Input
            type="datetime-local"
            value={draft.startsAt}
            onChange={(event) => setDraft({ ...draft, startsAt: event.target.value })}
          />
        </Field>

        <Field label={t('common.to')} required>
          <Input
            type="datetime-local"
            value={draft.endsAt}
            onChange={(event) => setDraft({ ...draft, endsAt: event.target.value })}
          />
        </Field>

        <Field label={t('admin.schedules.reason')}>
          <Input
            value={draft.reason}
            onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
          />
        </Field>
      </Modal>
    </Card>
  );
}
