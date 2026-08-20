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
  Switch,
  Tabs,
  Textarea,
} from '../../components/ui.tsx';
import { RatingStars } from '../../components/reviews.tsx';
import { Combobox } from '../../components/combobox.tsx';
import { CustomerPicker, toOptions } from '../../components/pickers.tsx';

const STATUSES = [
  'pending',
  'confirmed',
  'checked_in',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

/**
 * Citas del panel.
 *
 * Dos pestañas: el buscador de citas, que es el día a día, y las valoraciones,
 * que salen de esas mismas citas y hay que aprobar antes de que se vean en la
 * página pública. Van juntas para no añadir otra entrada al menú lateral por
 * una pantalla que se abre una vez a la semana.
 */
export default function Appointments() {
  const { t } = useTranslation();
  const can = useAuth((state) => state.can);
  const [tab, setTab] = useState('appointments');

  return (
    <div>
      <PageHeader title={t('nav.appointments')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'appointments', label: t('nav.appointments') },
          ...(can('review:moderate') ? [{ id: 'reviews', label: t('reviews.title') }] : []),
        ]}
      />
      {tab === 'appointments' ? <AppointmentsTab /> : <ReviewsTab />}
    </div>
  );
}

/** Buscador y gestor de citas, con alta manual desde el mostrador. */
function AppointmentsTab() {
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
      <div className="mb-4 flex justify-end">
        <Button icon={<CalendarPlus className="size-4" />} onClick={() => setNewOpen(true)}>
          {t('admin.newAppointment')}
        </Button>
      </div>

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
                {/* Con varios servicios se enseñan todos: es una sola visita. */}
                {(appointment.services ?? [{ name: appointment.serviceName }])
                  .map((servicio) => servicio.name)
                  .join(' + ')}
                {appointment.resourceName && ` · ${appointment.resourceName}`}
              </p>
            </div>

            {appointment.priceCents > 0 && (
              <span className="text-sm font-medium tabular-nums">
                {formatMoney(appointment.priceCents, appointment.currency, locale)}
              </span>
            )}

            {appointment.attendanceConfirmedAt && (
              <Badge className="bg-emerald-100 text-emerald-800">
                {t('appointments.attendanceConfirmedShort')}
              </Badge>
            )}

            {appointment.noShowFeeCents > 0 && (
              <Badge className="bg-amber-100 text-amber-800">
                {t('appointments.feeShort', {
                  amount: formatMoney(appointment.noShowFeeCents, appointment.currency, locale),
                })}
              </Badge>
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
  const [customerId, setCustomerId] = useState<string | null>(null);
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
        customerId: customerId ?? undefined,
        // Los campos vacíos se quitan: el servidor valida el correo y el
        // teléfono en cuanto vienen, y una cadena vacía no es ninguno de los
        // dos. Mandarlos tal cual rechazaba el alta de quien solo deja nombre.
        guest:
          !customerId && guest.name
            ? {
                name: guest.name,
                email: guest.email || undefined,
                phone: guest.phone || undefined,
              }
            : undefined,
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
          <Button
            loading={create.isPending}
            disabled={!slot || (!customerId && !guest.name)}
            onClick={() => create.mutate()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <ErrorMessage error={create.error} />

      <Field label={t('admin.service')} required>
        <Combobox
          value={serviceId || null}
          options={toOptions(organization.data, (item) => item.name)}
          onChange={(id) => {
            setServiceId(id ?? '');
            setSlot(null);
          }}
        />
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

      <Field label={t('admin.existingCustomer')} hint={t('admin.existingCustomerHint')}>
        <CustomerPicker
          value={customerId}
          onChange={(id, option) => {
            setCustomerId(id);
            // Al enlazar con una cuenta, sus datos los pone el servidor; los
            // campos de invitado dejan de hacer falta.
            if (id) setGuest({ name: '', email: '', phone: '' });
            else if (option) setGuest({ name: option.label, email: '', phone: '' });
          }}
        />
      </Field>

      <Field label={t('admin.customer')} required={!customerId}>
        <Input
          value={guest.name}
          disabled={Boolean(customerId)}
          onChange={(event) => setGuest({ ...guest, name: event.target.value })}
          placeholder={t('auth.name')}
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('auth.email')}>
          <Input
            type="email"
            disabled={Boolean(customerId)}
            value={guest.email}
            onChange={(event) => setGuest({ ...guest, email: event.target.value })}
          />
        </Field>
        <Field label={t('auth.phone')}>
          <Input
            type="tel"
            disabled={Boolean(customerId)}
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

/* -------------------------------------------------------------------------- */
/* Valoraciones                                                               */
/* -------------------------------------------------------------------------- */

interface StaffReview {
  id: string;
  rating: number;
  comment: string | null;
  reply: string | null;
  published: boolean;
  createdAt: string;
  customerName: string | null;
  serviceName: string | null;
  resourceName: string | null;
}

/**
 * Moderación de valoraciones.
 *
 * Publicar es un interruptor por reseña, no una acción masiva: lo que se
 * publica lleva el nombre del negocio al lado, así que la decisión se toma una
 * a una. Ocultar no borra nada; la valoración sigue contando en el panel y en
 * la ficha del cliente, simplemente no se enseña fuera.
 */
function ReviewsTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();

  const [onlyPending, setOnlyPending] = useState(false);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const { data, isLoading, error } = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['admin-reviews', organizationId, onlyPending],
    queryFn: () =>
      api.get<{ items: StaffReview[]; average: number | null; count: number; pending: number }>(
        `/organizations/${organizationId}/reviews`,
        { query: { onlyPending: onlyPending || undefined } },
      ),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/organizations/${organizationId}/reviews/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin-reviews'] }),
  });

  return (
    <div>
      <Card className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {data?.average !== null && data?.average !== undefined && (
            <>
              <span className="text-2xl font-bold tabular-nums">
                {data.average.toLocaleString(locale === 'en' ? 'en-GB' : 'es-ES', {
                  minimumFractionDigits: 1,
                })}
              </span>
              <RatingStars value={data.average} />
            </>
          )}
          <span className="text-sm text-slate-500">
            {t('reviews.countLabel', { count: data?.count ?? 0 })}
            {(data?.pending ?? 0) > 0 && ` · ${t('reviews.pendingCount', { count: data!.pending })}`}
          </span>
        </div>

        <Switch
          checked={onlyPending}
          onChange={setOnlyPending}
          label={t('reviews.onlyPending')}
        />
      </Card>

      <ErrorMessage error={error ?? update.error} />
      {isLoading && <LoadingBlock rows={3} />}

      {data && data.items.length === 0 && <EmptyState title={t('reviews.empty')} />}

      <ul className="space-y-2">
        {data?.items.map((review) => (
          <Card as="li" key={review.id}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <RatingStars value={review.rating} />
              <span className="font-medium">{review.customerName ?? t('admin.customer')}</span>
              <span className="text-slate-400">
                {formatDateTime(review.createdAt, locale)}
              </span>
              {review.serviceName && <span className="text-slate-500">· {review.serviceName}</span>}
              <Badge
                className={
                  review.published ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                }
              >
                {review.published ? t('reviews.published') : t('reviews.pending')}
              </Badge>
            </div>

            {review.comment && <p className="mt-2 text-sm text-slate-700">{review.comment}</p>}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Field label={t('reviews.reply')} className="mb-0 flex-1">
                <Input
                  value={replies[review.id] ?? review.reply ?? ''}
                  placeholder={t('reviews.replyHint')}
                  onChange={(event) =>
                    setReplies({ ...replies, [review.id]: event.target.value })
                  }
                />
              </Field>
              <Button
                variant="secondary"
                disabled={replies[review.id] === undefined}
                onClick={() =>
                  update.mutate({ id: review.id, patch: { reply: replies[review.id] } })
                }
              >
                {t('common.save')}
              </Button>
              <Button
                variant={review.published ? 'ghost' : 'primary'}
                onClick={() =>
                  update.mutate({ id: review.id, patch: { published: !review.published } })
                }
              >
                {review.published ? t('reviews.hide') : t('reviews.publish')}
              </Button>
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}

export type { PublicOrganization };
