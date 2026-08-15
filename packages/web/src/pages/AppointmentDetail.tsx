import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  CalendarDays,
  Download,
  MapPin,
  Star,
  Trash2,
  User,
} from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDate, formatDuration, formatMoney, formatTime, statusClass } from '../lib/format.ts';
import type { Appointment } from '../lib/types.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  LoadingBlock,
  Modal,
  SuccessMessage,
  Textarea,
} from '../components/ui.tsx';

/** Detalle de una cita del cliente, con QR, descargas y acciones. */
export default function AppointmentDetail() {
  const { id = '' } = useParams();
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const queryClient = useQueryClient();

  const [cancelOpen, setCancelOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [reviewed, setReviewed] = useState(false);

  const { data: appointment, isLoading, error } = useQuery({
    queryKey: ['appointment', id],
    // El identificador de organización se resuelve buscando en las citas del
    // usuario, que es la única lista donde el cliente ve sus propias citas.
    queryFn: async () => {
      const mine = await api.get<{ items: Appointment[] }>('/me/appointments', {
        query: { filter: 'all', pageSize: 200 },
      });
      const found = mine.items.find((item) => item.id === id);
      if (!found) throw Object.assign(new Error('No encontrada'), { code: 'not_found' });
      return found;
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${appointment!.organizationId}/appointments/${id}/cancel`, {
        reason: reason || undefined,
        notifyCustomer: true,
      }),
    onSuccess: () => {
      setCancelOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['appointment', id] });
      void queryClient.invalidateQueries({ queryKey: ['my-appointments'] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${appointment!.organizationId}/appointments/${id}/review`, {
        rating,
        comment: comment || undefined,
      }),
    onSuccess: () => {
      setReviewOpen(false);
      setReviewed(true);
    },
  });

  if (isLoading) return <LoadingBlock rows={4} />;
  if (error || !appointment) return <ErrorMessage error={error} />;

  const canCancel = ['pending', 'confirmed'].includes(appointment.status);
  const canReview = appointment.status === 'completed' && !reviewed;
  const basePath = `/organizations/${appointment.organizationId}/appointments/${appointment.id}`;

  return (
    <div>
      <Link
        to="/mis-citas"
        className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
      </Link>

      {reviewed && <SuccessMessage>{t('appointments.thanksForRating')}</SuccessMessage>}

      <Card>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{appointment.serviceName}</h1>
            <p className="text-sm text-slate-500">{appointment.organizationName}</p>
          </div>
          <Badge className={statusClass(appointment.status)}>
            {t(`appointments.status.${appointment.status}`)}
          </Badge>
        </div>

        <dl className="space-y-2.5 text-sm">
          <Row
            icon={<CalendarDays className="size-4" />}
            value={`${formatDate(appointment.startsAt, locale, appointment.timezone, { dateStyle: 'full' })} · ${formatTime(appointment.startsAt, locale, appointment.timezone)} – ${formatTime(appointment.endsAt, locale, appointment.timezone)}`}
          />
          <Row
            icon={<MapPin className="size-4" />}
            value={[appointment.locationName, appointment.locationAddress].filter(Boolean).join(' · ')}
          />
          {appointment.resourceName && (
            <Row icon={<User className="size-4" />} value={appointment.resourceName} />
          )}
        </dl>

        <div className="mt-3 flex flex-wrap gap-2 text-sm text-slate-600">
          <span>{formatDuration(appointment.durationMinutes, locale)}</span>
          {appointment.priceCents > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="font-medium">
                {formatMoney(appointment.priceCents, appointment.currency, locale)}
              </span>
              <Badge className="bg-slate-100 text-slate-600">
                {t(`appointments.payment.${appointment.paymentStatus}`)}
              </Badge>
            </>
          )}
        </div>

        {appointment.notes && (
          <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{appointment.notes}</p>
        )}
      </Card>

      {['confirmed', 'pending', 'checked_in'].includes(appointment.status) && (
        <Card className="mt-4 text-center">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            {t('booking.accessCode')}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-widest">
            {appointment.accessCode}
          </p>
          <img
            src={api.url(`${basePath}/qr`)}
            alt={t('booking.accessCode')}
            className="mx-auto mt-3 size-44"
            loading="lazy"
          />
          <p className="mt-2 text-xs text-slate-500">{t('booking.accessCodeHint')}</p>
        </Card>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          icon={<CalendarDays className="size-4" />}
          onClick={() => void api.download(`${basePath}/ics`, `cita-${appointment.id}.ics`)}
        >
          {t('booking.addToCalendar')}
        </Button>
        <Button
          variant="secondary"
          icon={<Download className="size-4" />}
          onClick={() => void api.download(`${basePath}/receipt`, `resguardo-${appointment.id}.pdf`)}
        >
          {t('booking.downloadReceipt')}
        </Button>

        {canReview && (
          <Button
            variant="secondary"
            icon={<Star className="size-4" />}
            onClick={() => setReviewOpen(true)}
          >
            {t('appointments.rateVisit')}
          </Button>
        )}

        {canCancel && (
          <Button
            variant="danger"
            icon={<Trash2 className="size-4" />}
            onClick={() => setCancelOpen(true)}
          >
            {t('appointments.cancelAppointment')}
          </Button>
        )}
      </div>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('appointments.cancelAppointment')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-slate-600">{t('appointments.cancelConfirm')}</p>
        <ErrorMessage error={cancelMutation.error} />
        <Field label={t('appointments.cancelReason')}>
          <Textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
      </Modal>

      <Modal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={t('appointments.rateVisit')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviewOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={reviewMutation.isPending} onClick={() => reviewMutation.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={reviewMutation.error} />
        <Field label={t('appointments.rating')}>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setRating(value)}
                aria-label={`${value}`}
                className="p-1"
              >
                <Star
                  className={
                    value <= rating ? 'size-8 fill-amber-400 text-amber-400' : 'size-8 text-slate-300'
                  }
                />
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('appointments.comment')}>
          <Textarea value={comment} onChange={(event) => setComment(event.target.value)} />
        </Field>
      </Modal>
    </div>
  );
}

function Row({ icon, value }: { icon: React.ReactNode; value: string }) {
  return (
    <div className="flex items-start gap-2 text-slate-700">
      <span className="mt-0.5 shrink-0 text-slate-400" aria-hidden>
        {icon}
      </span>
      <span>{value}</span>
    </div>
  );
}
