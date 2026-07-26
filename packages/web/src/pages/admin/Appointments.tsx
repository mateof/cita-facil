import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Search } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { addDaysIso, formatDateTime, formatMoney, statusClass, todayIso } from '../../lib/format.ts';
import type { Appointment, Paged, PublicOrganization, Slot } from '../../lib/types.ts';
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
  PageHeader,
  Select,
  Textarea,
} from '../../components/ui.tsx';

const STATUSES = [
  'pending',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

/** Buscador y gestor de citas del panel, con alta manual desde el mostrador. */
export default function Appointments() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(addDaysIso(todayIso(), 30));
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['admin-appointments', organizationId, search, status, from, to, page],
    queryFn: () =>
      api.get<Paged<Appointment>>(`/organizations/${organizationId}/appointments`, {
        query: {
          search: search || undefined,
          status: status || undefined,
          from: from ? `${from}T00:00:00.000Z` : undefined,
          to: to ? `${to}T23:59:59.999Z` : undefined,
          page,
          pageSize: 25,
        },
      }),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api.post(`/organizations/${organizationId}/appointments/${id}/status`, { status: next }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-appointments'] }),
  });

  return (
    <div>
      <PageHeader
        title={t('nav.appointments')}
        actions={
          <Button icon={<CalendarPlus className="size-4" />} onClick={() => setNewOpen(true)}>
            {t('admin.newAppointment')}
          </Button>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label={t('common.search')} className="mb-0">
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t('admin.customer')}
            />
          </Field>
          <Field label={t('common.filter')} className="mb-0">
            <Select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">{t('common.all')}</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {t(`appointments.status.${item}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.from')} className="mb-0">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={t('common.to')} className="mb-0">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>
      </Card>

      <ErrorMessage error={error} />
      {isLoading && <LoadingBlock rows={4} />}

      {data && data.items.length === 0 && (
        <EmptyState icon={<Search className="size-10" />} title={t('common.empty')} />
      )}

      <ul className="space-y-2">
        {data?.items.map((appointment) => (
          <Card as="li" key={appointment.id} className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {appointment.customerName}
                {appointment.customerPhone && (
                  <span className="ml-2 text-sm font-normal text-slate-500">
                    {appointment.customerPhone}
                  </span>
                )}
              </p>
              <p className="text-sm text-slate-500">
                {formatDateTime(appointment.startsAt, locale, appointment.timezone)} ·{' '}
                {appointment.serviceName}
                {appointment.resourceName && ` · ${appointment.resourceName}`}
              </p>
            </div>

            {appointment.priceCents > 0 && (
              <span className="text-sm font-medium tabular-nums">
                {formatMoney(appointment.priceCents, appointment.currency, locale)}
              </span>
            )}

            <Badge className={statusClass(appointment.status)}>
              {t(`appointments.status.${appointment.status}`)}
            </Badge>

            <Select
              value=""
              className="max-w-44"
              aria-label={t('common.edit')}
              onChange={(event) => {
                if (event.target.value) {
                  changeStatus.mutate({ id: appointment.id, next: event.target.value });
                  event.target.value = '';
                }
              }}
            >
              <option value="">{t('common.edit')}…</option>
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {t(`appointments.status.${item}`)}
                </option>
              ))}
            </Select>
          </Card>
        ))}
      </ul>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t('common.previous')}
          </Button>
          <span className="text-sm text-slate-500">
            {page} {t('common.of')} {data.totalPages} · {data.total} {t('common.results')}
          </span>
          <Button
            variant="secondary"
            disabled={page >= data.totalPages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
          </Button>
        </div>
      )}

      <NewAppointmentModal
        open={newOpen}
        organizationId={organizationId}
        onClose={() => setNewOpen(false)}
        onCreated={() => {
          setNewOpen(false);
          void queryClient.invalidateQueries({ queryKey: ['admin-appointments'] });
        }}
      />
    </div>
  );
}

/**
 * Alta manual de cita desde el mostrador. El personal puede saltarse las
 * reglas de antelación, así que la consulta de disponibilidad se hace con
 * `ignoreRules`.
 */
function NewAppointmentModal({
  open,
  organizationId,
  onClose,
  onCreated,
}: {
  open: boolean;
  organizationId: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [duration, setDuration] = useState<number | ''>('');
  const [slot, setSlot] = useState<Slot | null>(null);
  const [guest, setGuest] = useState({ name: '', email: '', phone: '' });
  const [notes, setNotes] = useState('');

  const organization = useQuery({
    enabled: open && Boolean(organizationId),
    queryKey: ['org-services', organizationId],
    queryFn: () =>
      api.get<{ id: string; name: string; durationMode: string; durationMinutes: number }[]>(
        `/organizations/${organizationId}/services`,
        { query: { onlyActive: true } },
      ),
  });

  const availability = useQuery({
    enabled: open && Boolean(serviceId),
    queryKey: ['admin-availability', organizationId, serviceId, date, duration],
    queryFn: () =>
      api.get<{ timezone: string; days: { slots: Slot[] }[] }>(
        `/organizations/${organizationId}/availability`,
        {
          query: {
            serviceId,
            from: date,
            durationMinutes: duration || undefined,
            ignoreRules: true,
          },
        },
      ),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<Appointment>(`/organizations/${organizationId}/appointments`, {
        serviceId,
        startsAt: slot!.startsAt,
        durationMinutes: duration || undefined,
        guest: guest.name ? guest : undefined,
        notes: notes || undefined,
        source: 'admin',
      }),
    onSuccess: onCreated,
  });

  const service = organization.data?.find((item) => item.id === serviceId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t('admin.newAppointment')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} disabled={!slot} onClick={() => create.mutate()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ErrorMessage error={create.error} />

      <Field label={t('admin.service')} required>
        <Select
          value={serviceId}
          onChange={(event) => {
            setServiceId(event.target.value);
            setSlot(null);
          }}
        >
          <option value="">—</option>
          {organization.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </Field>

      {service?.durationMode === 'flexible' && (
        <Field label={`${t('admin.duration')} (min)`}>
          <Input
            type="number"
            value={duration}
            placeholder={String(service.durationMinutes)}
            onChange={(event) => setDuration(event.target.value ? Number(event.target.value) : '')}
          />
        </Field>
      )}

      <Field label={t('common.date')}>
        <Input
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setSlot(null);
          }}
        />
      </Field>

      {serviceId && (
        <Field label={t('booking.chooseTime')}>
          <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">
            {(availability.data?.days[0]?.slots ?? []).map((item) => (
              <button
                key={item.startsAt}
                type="button"
                onClick={() => setSlot(item)}
                className={
                  slot?.startsAt === item.startsAt
                    ? 'rounded-lg border border-brand bg-brand text-white py-2 text-sm'
                    : 'rounded-lg border border-slate-200 py-2 text-sm hover:border-brand'
                }
              >
                {new Date(item.startsAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: availability.data?.timezone,
                })}
              </button>
            ))}
          </div>
          {availability.data?.days[0]?.slots.length === 0 && (
            <p className="mt-2 text-sm text-slate-500">{t('booking.noSlots')}</p>
          )}
        </Field>
      )}

      <Field label={t('admin.customer')} required>
        <Input
          value={guest.name}
          onChange={(event) => setGuest({ ...guest, name: event.target.value })}
          placeholder={t('auth.name')}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('auth.email')}>
          <Input
            type="email"
            value={guest.email}
            onChange={(event) => setGuest({ ...guest, email: event.target.value })}
          />
        </Field>
        <Field label={t('auth.phone')}>
          <Input
            type="tel"
            value={guest.phone}
            onChange={(event) => setGuest({ ...guest, phone: event.target.value })}
          />
        </Field>
      </div>

      <Field label={t('admin.internalNotes')}>
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} />
      </Field>
    </Modal>
  );
}

export type { PublicOrganization };
