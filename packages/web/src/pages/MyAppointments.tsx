import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronRight, Clock, MapPin } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDate, formatTime, statusClass } from '../lib/format.ts';
import type { Appointment, Paged } from '../lib/types.ts';
import { Badge, EmptyState, LoadingBlock, PageHeader, Tabs } from '../components/ui.tsx';

/** Listado de citas del usuario, separadas en próximas y pasadas. */
export default function MyAppointments() {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<'upcoming' | 'past'>('upcoming');
  const locale = i18n.language.slice(0, 2);

  const { data, isLoading } = useQuery({
    queryKey: ['my-appointments', filter],
    queryFn: () => api.get<Paged<Appointment>>('/me/appointments', { query: { filter, pageSize: 50 } }),
  });

  return (
    <div>
      <PageHeader title={t('appointments.title')} />

      <Tabs
        active={filter}
        onChange={(id) => setFilter(id as 'upcoming' | 'past')}
        tabs={[
          { id: 'upcoming', label: t('appointments.upcoming') },
          { id: 'past', label: t('appointments.past') },
        ]}
      />

      {isLoading && <LoadingBlock rows={3} />}

      {!isLoading && (data?.items.length ?? 0) === 0 && (
        <EmptyState
          icon={<CalendarDays className="size-10" />}
          title={t('appointments.empty')}
          description={t('appointments.emptyHint')}
          action={
            <Link to="/" className="btn-primary">
              {t('nav.book')}
            </Link>
          }
        />
      )}

      <ul className="space-y-2">
        {data?.items.map((appointment) => (
          <li key={appointment.id}>
            <Link
              to={`/citas/${appointment.id}`}
              className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand"
            >
              <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-brand-soft py-2">
                <span className="text-[10px] uppercase text-brand">
                  {formatDate(appointment.startsAt, locale, appointment.timezone, { month: 'short' })}
                </span>
                <span className="text-xl font-bold tabular-nums text-brand">
                  {formatDate(appointment.startsAt, locale, appointment.timezone, { day: '2-digit' })}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-slate-900">{appointment.serviceName}</p>
                <p className="mt-0.5 flex items-center gap-1 text-sm text-slate-500">
                  <Clock className="size-3.5 shrink-0" aria-hidden />
                  {formatTime(appointment.startsAt, locale, appointment.timezone)}
                  <span className="mx-1">·</span>
                  <MapPin className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{appointment.locationName}</span>
                </p>
                <Badge className={`mt-1.5 ${statusClass(appointment.status)}`}>
                  {t(`appointments.status.${appointment.status}`)}
                </Badge>
              </div>

              <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
