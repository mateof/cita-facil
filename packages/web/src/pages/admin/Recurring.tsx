import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarSync, Play, Plus, Square, Trash2 } from 'lucide-react';
import { fuzzySearch } from '@cita-facil/shared';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { minutesToTime, timeToMinutes } from '../../lib/format.ts';
import type { AdminService } from '../../lib/types.ts';
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
import { Combobox } from '../../components/combobox.tsx';
import { CustomerPicker, toOptions } from '../../components/pickers.tsx';

/**
 * Programaciones semanales.
 *
 * Una programación es "esta persona, este servicio, los martes a las 19:00" y
 * el sistema va creando la cita de cada semana con antelación. La tabla enseña
 * lo que hace falta a diario: de quién es, cuándo, y si sigue viva.
 */

interface Schedule {
  id: string;
  serviceId: string;
  serviceName: string;
  customerId: string;
  customerName: string | null;
  weekday: number;
  startMinute: number;
  onConflict: string;
  horizonDays: number;
  active: boolean;
  occurrences?: { date: string; status: string; reason: string | null }[];
}

const DIAS = [1, 2, 3, 4, 5, 6, 7];

export default function Recurring() {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useState('');
  const [creando, setCreando] = useState(false);

  const programaciones = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['schedules', organizationId],
    queryFn: () => api.get<Schedule[]>(`/organizations/${organizationId}/recurring`),
  });

  const refrescar = () => queryClient.invalidateQueries({ queryKey: ['schedules'] });

  const parar = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/recurring/${id}`),
    onSuccess: () => void refrescar(),
  });

  const generar = useMutation({
    mutationFn: (id: string) => api.post(`/organizations/${organizationId}/recurring/${id}/run`),
    onSuccess: () => void refrescar(),
  });

  const visibles = useMemo(
    () =>
      fuzzySearch(programaciones.data ?? [], filtro, {
        fields: (schedule) => [schedule.customerName, schedule.serviceName],
        limit: 200,
      }),
    [programaciones.data, filtro],
  );

  return (
    <div>
      <PageHeader title={t('admin.recurring.title')} description={t('admin.recurring.description')} />

      <Card>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <Field label={t('common.search')} className="mb-0 w-60">
            <Input
              type="search"
              value={filtro}
              placeholder={t('admin.recurring.columnCustomer')}
              onChange={(event) => setFiltro(event.target.value)}
            />
          </Field>

          <Button icon={<Plus className="size-4" />} onClick={() => setCreando(true)}>
            {t('admin.recurring.newSchedule')}
          </Button>
        </div>

        <ErrorMessage error={parar.error ?? generar.error} />
        {programaciones.isLoading && <LoadingBlock rows={3} />}

        {programaciones.data?.length === 0 && (
          <p className="py-4 text-sm text-slate-500">{t('admin.recurring.empty')}</p>
        )}
        {programaciones.data && programaciones.data.length > 0 && visibles.length === 0 && (
          <p className="py-4 text-sm text-slate-500">{t('admin.recurring.noMatches')}</p>
        )}

        {visibles.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('admin.recurring.columnCustomer')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('admin.recurring.columnWhen')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('admin.recurring.columnService')}</th>
                  <th scope="col" className="py-2 pr-3 font-medium">{t('admin.recurring.columnStatus')}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t('admin.recurring.columnActions')}</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-100">
                {visibles.map((schedule) => (
                  <tr key={schedule.id}>
                    <td className="py-2.5 pr-3 font-medium text-slate-900">
                      {schedule.customerName}
                    </td>
                    <td className="py-2.5 pr-3">
                      {t(`admin.schedules.weekdays.${schedule.weekday}`)}
                      {' · '}
                      {minutesToTime(schedule.startMinute)}
                    </td>
                    <td className="py-2.5 pr-3">{schedule.serviceName}</td>
                    <td className="py-2.5 pr-3">
                      <Badge
                        className={
                          schedule.active
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-200 text-slate-700'
                        }
                      >
                        {schedule.active ? t('admin.recurring.active') : t('admin.recurring.stopped')}
                      </Badge>
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {!schedule.active && (
                          <button
                            type="button"
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label={t('common.delete')}
                            onClick={() => parar.mutate(schedule.id)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                        {schedule.active && (
                          <>
                            <button
                              type="button"
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                              aria-label={t('admin.recurring.runNow')}
                              onClick={() => generar.mutate(schedule.id)}
                            >
                              <Play className="size-4" />
                            </button>
                            <button
                              type="button"
                              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                              aria-label={t('admin.recurring.stop')}
                              onClick={() => parar.mutate(schedule.id)}
                            >
                              <Square className="size-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <NewScheduleModal open={creando} onClose={() => setCreando(false)} />
    </div>
  );
}

function NewScheduleModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({
    customerId: '',
    serviceId: '',
    weekday: 1,
    time: '10:00',
    onConflict: 'skip',
    horizonDays: 7,
  });

  const services = useQuery({
    enabled: open && Boolean(organizationId),
    queryKey: ['services', organizationId],
    queryFn: () => api.get<AdminService[]>(`/organizations/${organizationId}/services`),
  });

  const crear = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${organizationId}/recurring`, {
        customerId: draft.customerId,
        serviceId: draft.serviceId,
        weekday: draft.weekday,
        startMinute: timeToMinutes(draft.time),
        onConflict: draft.onConflict,
        horizonDays: draft.horizonDays,
      }),
    onSuccess: () => {
      setDraft({ ...draft, customerId: '', serviceId: '' });
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['schedules'] });
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('admin.recurring.newSchedule')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={crear.isPending}
            disabled={!draft.customerId || !draft.serviceId}
            onClick={() => crear.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ErrorMessage error={crear.error} />

      <Field label={t('admin.recurring.customer')} required>
        <CustomerPicker
          value={draft.customerId || null}
          onChange={(id) => setDraft({ ...draft, customerId: id ?? '' })}
        />
      </Field>

      <Field label={t('admin.recurring.service')} required>
        <Combobox
          value={draft.serviceId || null}
          options={toOptions(services.data, (service) => service.name)}
          onChange={(id) => setDraft({ ...draft, serviceId: id ?? '' })}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('admin.recurring.weekday')}>
          <Select
            value={String(draft.weekday)}
            onChange={(event) => setDraft({ ...draft, weekday: Number(event.target.value) })}
          >
            {DIAS.map((dia) => (
              <option key={dia} value={dia}>
                {t(`admin.schedules.weekdays.${dia}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('admin.recurring.time')}>
          <Input
            type="time"
            value={draft.time}
            onChange={(event) => setDraft({ ...draft, time: event.target.value })}
          />
        </Field>
      </div>

      <Field label={t('admin.recurring.onConflict')}>
        <Select
          value={draft.onConflict}
          onChange={(event) => setDraft({ ...draft, onConflict: event.target.value })}
        >
          <option value="skip">{t('admin.recurring.conflictSkip')}</option>
          <option value="nearest">{t('admin.recurring.conflictNearest')}</option>
          <option value="force">{t('admin.recurring.conflictForce')}</option>
        </Select>
      </Field>

      <Field label={t('admin.recurring.horizon')}>
        <Input
          type="number"
          min={1}
          max={60}
          value={draft.horizonDays}
          onChange={(event) => setDraft({ ...draft, horizonDays: Number(event.target.value) })}
        />
      </Field>

      <p className="text-xs text-slate-500">
        <CalendarSync className="mr-1 inline size-3.5" aria-hidden />
        {t('admin.recurring.stopHint')}
      </p>
    </Modal>
  );
}
