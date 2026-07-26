import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { addDaysIso, formatDate, minutesToTime, statusClass, todayIso } from '../../lib/format.ts';
import type { AdminResource, TodayPanel } from '../../lib/types.ts';
import { Button, Card, LoadingBlock, PageHeader, Select } from '../../components/ui.tsx';

/**
 * Agenda del día en columnas por recurso.
 *
 * Se dibuja con posiciones absolutas sobre una rejilla de minutos en lugar de
 * con una tabla: es lo que permite que dos citas solapadas se vean encajadas y
 * que una cita de 20 minutos ocupe exactamente un tercio de la fila de una hora.
 */

const PIXELS_PER_MINUTE = 1.4;

export default function Agenda() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const [date, setDate] = useState(() => todayIso());
  const [locationId, setLocationId] = useState<string>('');

  const locations = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['locations', organizationId],
    queryFn: () =>
      api.get<{ id: string; name: string }[]>(`/organizations/${organizationId}/locations`),
  });

  const resources = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['resources', organizationId, locationId],
    queryFn: () =>
      api.get<AdminResource[]>(`/organizations/${organizationId}/resources`, {
        query: { onlyActive: true, locationId: locationId || undefined },
      }),
  });

  const day = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['agenda', organizationId, date, locationId],
    queryFn: () =>
      api.get<TodayPanel>(`/organizations/${organizationId}/reports/today`, {
        query: { date, locationId: locationId || undefined },
      }),
  });

  const appointments = (day.data?.appointments ?? []).filter(
    (appointment) => !['cancelled', 'rejected', 'expired'].includes(appointment.status),
  );

  /* La rejilla se ajusta a lo que hay: no tiene sentido pintar de 0 a 24 h. */
  const { startMinute, endMinute } = useMemo(() => {
    if (appointments.length === 0) return { startMinute: 8 * 60, endMinute: 21 * 60 };
    const starts = appointments.map((appointment) => appointment.localStartMinute);
    const ends = appointments.map(
      (appointment) => appointment.localStartMinute + appointment.durationMinutes,
    );
    return {
      startMinute: Math.max(0, Math.floor(Math.min(...starts) / 60) * 60 - 60),
      endMinute: Math.min(1440, Math.ceil(Math.max(...ends) / 60) * 60 + 60),
    };
  }, [appointments]);

  const hours: number[] = [];
  for (let minute = startMinute; minute <= endMinute; minute += 60) hours.push(minute);

  const columns =
    resources.data && resources.data.length > 0
      ? resources.data
      : [{ id: '', name: t('nav.agenda'), locationId: '' } as AdminResource];

  return (
    <div>
      <PageHeader
        title={t('nav.agenda')}
        description={day.data ? formatDate(`${date}T12:00:00Z`, locale, day.data.timezone) : undefined}
        actions={
          <div className="flex items-center gap-1">
            {(locations.data?.length ?? 0) > 1 && (
              <Select
                value={locationId}
                onChange={(event) => setLocationId(event.target.value)}
                className="max-w-44"
              >
                <option value="">{t('common.all')}</option>
                {locations.data?.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </Select>
            )}
            <Button variant="secondary" onClick={() => setDate(addDaysIso(date, -1))} aria-label={t('common.previous')}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button variant="secondary" onClick={() => setDate(todayIso())}>
              {t('common.today')}
            </Button>
            <Button variant="secondary" onClick={() => setDate(addDaysIso(date, 1))} aria-label={t('common.next')}>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        }
      />

      {day.isLoading && <LoadingBlock rows={4} />}

      {day.data && (
        <Card className="overflow-hidden p-0">
          <div className="scroll-thin overflow-x-auto">
            <div className="flex min-w-max">
              {/* Regleta de horas. */}
              <div className="w-14 shrink-0 border-r border-slate-200 bg-slate-50">
                <div className="h-10 border-b border-slate-200" />
                <div className="relative" style={{ height: (endMinute - startMinute) * PIXELS_PER_MINUTE }}>
                  {hours.map((minute) => (
                    <div
                      key={minute}
                      className="absolute right-1 -translate-y-1/2 text-xs tabular-nums text-slate-400"
                      style={{ top: (minute - startMinute) * PIXELS_PER_MINUTE }}
                    >
                      {minutesToTime(minute)}
                    </div>
                  ))}
                </div>
              </div>

              {columns.map((resource) => {
                const items = appointments.filter((appointment) =>
                  resource.id ? appointment.resourceName === resource.name : true,
                );

                return (
                  <div key={resource.id || 'all'} className="w-56 shrink-0 border-r border-slate-100">
                    <div className="flex h-10 items-center justify-center border-b border-slate-200 bg-slate-50 px-2 text-sm font-medium">
                      <span className="truncate">{resource.name}</span>
                    </div>

                    <div
                      className="relative"
                      style={{ height: (endMinute - startMinute) * PIXELS_PER_MINUTE }}
                    >
                      {hours.map((minute) => (
                        <div
                          key={minute}
                          className="absolute inset-x-0 border-t border-slate-100"
                          style={{ top: (minute - startMinute) * PIXELS_PER_MINUTE }}
                        />
                      ))}

                      {items.map((appointment) => (
                        <div
                          key={appointment.id}
                          className={clsx(
                            'absolute inset-x-1 overflow-hidden rounded-lg border-l-4 px-2 py-1 text-xs shadow-sm',
                            statusClass(appointment.status),
                          )}
                          style={{
                            top: (appointment.localStartMinute - startMinute) * PIXELS_PER_MINUTE,
                            height: Math.max(appointment.durationMinutes * PIXELS_PER_MINUTE - 2, 22),
                            borderLeftColor: appointment.serviceColor ?? 'var(--brand)',
                          }}
                          title={`${appointment.customerName} · ${appointment.serviceName}`}
                        >
                          <p className="truncate font-semibold">{appointment.customerName}</p>
                          <p className="truncate opacity-80">{appointment.serviceName}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
