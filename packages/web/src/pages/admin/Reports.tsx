import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { addDaysIso, formatMoney, todayIso } from '../../lib/format.ts';
import { Download } from 'lucide-react';
import {
  Button,
  Card,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  StatTile,
} from '../../components/ui.tsx';

interface Summary {
  range: { from: string; to: string };
  currency: string;
  total: number;
  completed: number;
  cancelled: number;
  noShows: number;
  cancellationRate: number;
  noShowRate: number;
  revenueCents: number;
  expectedRevenueCents: number;
  averageTicketCents: number;
  bookedMinutes: number;
  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  /** El mismo número de días justo antes, para comparar. */
  previous: {
    range: { from: string; to: string };
    total: number;
    completed: number;
    revenueCents: number;
    noShowRate: number;
    cancellationRate: number;
    bookedMinutes: number;
  };
}

interface StaffRow {
  resourceId: string;
  name: string;
  staffName: string | null;
  commissionPercent: number;
  appointments: number;
  minutes: number;
  billedCents: number;
  collectedCents: number;
  commissionCents: number;
}

/**
 * Variación respecto al periodo anterior.
 *
 * Un número suelto no dice nada: "1.200 euros" se lee distinto si el periodo
 * anterior fueron 900 o 1.500. Sin dato anterior no se enseña flecha, que es
 * más honesto que pintar un +100 % desde cero.
 */
function Delta({ current, previous }: { current: number; previous: number }) {
  const { t } = useTranslation();
  if (previous === 0) return null;

  const cambio = Math.round(((current - previous) / previous) * 1000) / 10;
  if (cambio === 0) return <span className="text-slate-500">{t('admin.reports.same')}</span>;

  return (
    <span className={cambio > 0 ? 'text-emerald-600' : 'text-red-600'}>
      {cambio > 0 ? '\u25b2' : '\u25bc'} {Math.abs(cambio)}%
    </span>
  );
}

/** Informes de actividad, ocupación e ingresos. */
export default function Reports() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);

  const [from, setFrom] = useState(addDaysIso(todayIso(), -29));
  const [to, setTo] = useState(todayIso());
  const query = { from, to };

  const summary = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['report-summary', organizationId, from, to],
    queryFn: () =>
      api.get<Summary>(`/organizations/${organizationId}/reports/summary`, { query }),
  });

  const daily = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['report-daily', organizationId, from, to],
    queryFn: () =>
      api.get<{ series: { date: string; total: number; revenueCents: number }[]; currency: string }>(
        `/organizations/${organizationId}/reports/daily`,
        { query },
      ),
  });

  const services = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['report-services', organizationId, from, to],
    queryFn: () =>
      api.get<{ serviceId: string; name: string; total: number; revenueCents: number }[]>(
        `/organizations/${organizationId}/reports/services`,
        { query },
      ),
  });

  const resources = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['report-resources', organizationId, from, to],
    queryFn: () =>
      api.get<
        {
          resourceId: string;
          name: string;
          appointments: number;
          bookedMinutes: number;
          availableMinutes: number;
          occupancyRate: number;
          revenueCents: number;
        }[]
      >(`/organizations/${organizationId}/reports/resources`, { query }),
  });

  const staff = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['report-staff', organizationId, from, to],
    queryFn: () =>
      api.get<{ items: StaffRow[]; currency: string }>(
        `/organizations/${organizationId}/reports/staff`,
        { query },
      ),
  });

  const hours = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['report-hours', organizationId, from, to],
    queryFn: () =>
      api.get<{ hour: number; total: number }[]>(
        `/organizations/${organizationId}/reports/hours`,
        { query },
      ),
  });

  const currency = summary.data?.currency ?? 'EUR';

  return (
    <div>
      <PageHeader title={t('admin.reports.title')} />

      <Card className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:max-w-md sm:grid-cols-2">
          <Field label={t('common.from')} className="mb-0">
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label={t('common.to')} className="mb-0">
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          {(['daily', 'services', 'resources', 'staff', 'hours'] as const).map((tipo) => (
            <Button
              key={tipo}
              variant="secondary"
              icon={<Download className="size-4" />}
              onClick={() =>
                void api.download(
                  `/organizations/${organizationId}/reports/export?type=${tipo}&from=${from}&to=${to}`,
                  `${tipo}-${from}-${to}.csv`,
                )
              }
            >
              {t(`admin.reports.export.${tipo}`)}
            </Button>
          ))}
        </div>
      </Card>

      {summary.isLoading && <LoadingBlock rows={2} />}

      {summary.data && (
        <>
          <div className="mb-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label={t('admin.reports.appointments')} value={summary.data.total} />
            <StatTile
              label={t('admin.reports.revenue')}
              value={formatMoney(summary.data.revenueCents, currency, locale)}
              hint={`${t('admin.reports.expectedRevenue')}: ${formatMoney(summary.data.expectedRevenueCents, currency, locale)}`}
              tone="positive"
            />
            <StatTile
              label={t('admin.reports.cancellationRate')}
              value={`${summary.data.cancellationRate}%`}
              tone={summary.data.cancellationRate > 20 ? 'warning' : 'default'}
            />
            <StatTile
              label={t('admin.reports.noShowRate')}
              value={`${summary.data.noShowRate}%`}
              tone={summary.data.noShowRate > 10 ? 'danger' : 'default'}
            />
          </div>

          <p className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500">
            <span>{t('admin.reports.comparedTo')}</span>
            <span className="inline-flex items-center gap-1">
              {t('admin.reports.appointments')}:{' '}
              <Delta current={summary.data.total} previous={summary.data.previous.total} />
            </span>
            <span className="inline-flex items-center gap-1">
              {t('admin.reports.revenue')}:{' '}
              <Delta
                current={summary.data.revenueCents}
                previous={summary.data.previous.revenueCents}
              />
            </span>
          </p>
        </>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <h2 className="mb-3 font-semibold">{t('admin.reports.staff')}</h2>
          {staff.data?.items.length === 0 && (
            <p className="text-sm text-slate-500">{t('common.empty')}</p>
          )}
          {(staff.data?.items.length ?? 0) > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3 font-medium">{t('admin.reports.professional')}</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      {t('admin.reports.appointments')}
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">{t('admin.reports.billed')}</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      {t('admin.reports.collected')}
                    </th>
                    <th className="py-2 pr-3 text-right font-medium">
                      {t('admin.reports.commission')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staff.data?.items.map((row) => (
                    <tr key={row.resourceId}>
                      <td className="py-2 pr-3">
                        {row.staffName ?? row.name}
                        {row.commissionPercent > 0 && (
                          <span className="ml-2 text-xs text-slate-500">
                            {row.commissionPercent}%
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.appointments}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMoney(row.billedCents, currency, locale)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatMoney(row.collectedCents, currency, locale)}
                      </td>
                      <td className="py-2 pr-3 text-right font-medium tabular-nums">
                        {formatMoney(row.commissionCents, currency, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* La comisión se calcula sobre lo cobrado, no sobre lo agendado:
                  repartir dinero que todavía no ha entrado es un pagaré. */}
              <p className="mt-2 text-xs text-slate-500">{t('admin.reports.commissionHint')}</p>
            </div>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">{t('admin.reports.appointments')}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={daily.data?.series ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value: string) => value.slice(5)}
                />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  dot={false}
                  name={t('admin.reports.appointments')}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('admin.reports.byHour')}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hours.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="total" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('admin.reports.topServices')}</h2>
          <ul className="divide-y divide-slate-100">
            {services.data?.slice(0, 10).map((service) => (
              <li key={service.serviceId} className="flex justify-between py-2 text-sm">
                <span className="truncate">{service.name}</span>
                <span className="shrink-0 tabular-nums text-slate-600">
                  {service.total} · {formatMoney(service.revenueCents, currency, locale)}
                </span>
              </li>
            ))}
            {services.data?.length === 0 && <p className="text-sm text-slate-500">{t('common.empty')}</p>}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('admin.reports.occupancy')}</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={resources.data ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => `${String(value)}%`} />
                <Bar dataKey="occupancyRate" radius={[0, 4, 4, 0]}>
                  {(resources.data ?? []).map((resource) => (
                    <Cell
                      key={resource.resourceId}
                      // Se marca en ámbar la ocupación baja: es donde hay margen
                      // de mejora, y en rojo la saturada.
                      fill={
                        resource.occupancyRate > 90
                          ? '#dc2626'
                          : resource.occupancyRate < 35
                            ? '#f59e0b'
                            : 'var(--brand)'
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
