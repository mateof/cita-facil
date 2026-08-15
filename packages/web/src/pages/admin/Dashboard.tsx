import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays, Check, ChevronLeft, ChevronRight, LogIn, Phone, X } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import {
  addDaysIso,
  formatDate,
  formatMoney,
  formatTime,
  statusClass,
  todayIso,
} from '../../lib/format.ts';
import type { TodayPanel } from '../../lib/types.ts';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  LoadingBlock,
  PageHeader,
  StatTile,
} from '../../components/ui.tsx';

/**
 * Panel del día.
 *
 * Es la pantalla que se deja abierta en el mostrador: lo que hay hoy, quién ha
 * llegado y las acciones de un toque (registrar entrada, completar, marcar
 * falta) sin entrar en el detalle de cada cita.
 */
export default function Dashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => todayIso());

  const { data, isLoading, error } = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['today', organizationId, date],
    queryFn: () =>
      api.get<TodayPanel>(`/organizations/${organizationId}/reports/today`, { query: { date } }),
    refetchInterval: 60_000,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.post(`/organizations/${organizationId}/appointments/${id}/status`, { status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['today'] }),
  });

  if (!organizationId) return <p>{t('common.loading')}</p>;

  return (
    <div>
      <PageHeader
        title={t('admin.todayTitle')}
        description={data ? formatDate(`${date}T12:00:00Z`, locale, data.timezone) : undefined}
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              onClick={() => setDate(addDaysIso(date, -1))}
              aria-label={t('common.previous')}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="secondary" onClick={() => setDate(todayIso())}>
              {t('common.today')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDate(addDaysIso(date, 1))}
              aria-label={t('common.next')}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      <ErrorMessage error={error} />

      {data && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <StatTile label={t('admin.counts.total')} value={data.counts.total} />
          <StatTile
            label={t('admin.counts.pending')}
            value={data.counts.pending}
            tone={data.counts.pending > 0 ? 'warning' : 'default'}
          />
          <StatTile label={t('admin.counts.confirmed')} value={data.counts.confirmed} />
          <StatTile
            label={t('admin.counts.checkedIn')}
            value={data.counts.checkedIn}
            tone="positive"
          />
          <StatTile label={t('admin.counts.completed')} value={data.counts.completed} />
          <StatTile
            label={t('admin.counts.noShow')}
            value={data.counts.noShow}
            tone={data.counts.noShow > 0 ? 'danger' : 'default'}
          />
        </div>
      )}

      {isLoading && <LoadingBlock rows={4} />}

      {data && data.appointments.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="size-10" />}
          title={t('admin.todayEmpty')}
          action={
            <Link to="/admin/citas" className="btn-secondary">
              {t('nav.appointments')}
            </Link>
          }
        />
      )}

      <ul className="space-y-2">
        {data?.appointments.map((appointment) => (
          <Card as="li" key={appointment.id} className="flex flex-wrap items-center gap-3">
            <div
              className="w-1.5 self-stretch rounded-full"
              style={{ background: appointment.serviceColor ?? 'var(--brand)' }}
              aria-hidden
            />

            <div className="w-16 shrink-0">
              <p className="text-lg font-bold tabular-nums">
                {formatTime(appointment.startsAt, locale, data.timezone)}
              </p>
              <p className="text-xs text-slate-500">{appointment.durationMinutes} min</p>
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{appointment.customerName ?? '—'}</p>
              <p className="truncate text-sm text-slate-500">
                {appointment.serviceName}
                {appointment.resourceName && ` · ${appointment.resourceName}`}
                {appointment.partySize > 1 && ` · ${appointment.partySize} pax`}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {appointment.customerPhone && (
                <a
                  href={`tel:${appointment.customerPhone}`}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label={appointment.customerPhone}
                >
                  <Phone className="size-4" />
                </a>
              )}

              <Badge className={statusClass(appointment.status)}>
                {t(`appointments.status.${appointment.status}`)}
              </Badge>

              {appointment.priceCents > 0 && (
                <span className="hidden text-sm font-medium tabular-nums sm:inline">
                  {formatMoney(appointment.priceCents, 'EUR', locale)}
                </span>
              )}
            </div>

            <div className="flex w-full gap-2 sm:w-auto">
              {appointment.status === 'pending' && (
                <Button
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                  icon={<Check className="size-4" />}
                  onClick={() => changeStatus.mutate({ id: appointment.id, status: 'confirmed' })}
                >
                  {t('admin.approve')}
                </Button>
              )}

              {appointment.status === 'confirmed' && (
                <>
                  <Button
                    variant="secondary"
                    className="flex-1 sm:flex-none"
                    icon={<LogIn className="size-4" />}
                    onClick={() => changeStatus.mutate({ id: appointment.id, status: 'checked_in' })}
                  >
                    {t('admin.checkIn')}
                  </Button>
                  <Button
                    variant="ghost"
                    className="flex-1 sm:flex-none"
                    icon={<X className="size-4" />}
                    onClick={() => changeStatus.mutate({ id: appointment.id, status: 'no_show' })}
                  >
                    {t('admin.markNoShow')}
                  </Button>
                </>
              )}

              {['checked_in', 'in_progress'].includes(appointment.status) && (
                <Button
                  variant="secondary"
                  className="flex-1 sm:flex-none"
                  icon={<Check className="size-4" />}
                  onClick={() => changeStatus.mutate({ id: appointment.id, status: 'completed' })}
                >
                  {t('admin.complete')}
                </Button>
              )}
            </div>
          </Card>
        ))}
      </ul>
    </div>
  );
}
