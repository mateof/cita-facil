import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Ban, CalendarDays, Star, Ticket, X } from 'lucide-react';
import type { CustomerDetail, CustomerSummary } from '@cita-facil/shared';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { formatDate, formatDateTime, formatMoney, statusClass } from '../../lib/format.ts';
import type { Paged } from '../../lib/types.ts';
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
  StatTile,
  Textarea,
} from '../../components/ui.tsx';
import { EntityAvatar } from '../../components/avatar.tsx';

/**
 * Clientes del negocio.
 *
 * Es la pantalla del mostrador: quién viene, cuándo vino la última vez, qué ha
 * gastado, cuántas veces ha faltado y qué se anotó sobre esa persona. Todo sale
 * de las citas y los bonos que ya existen, así que no hay nada que mantener al
 * día a mano.
 *
 * Quien reserva sin cuenta no aparece aquí: no hay a quién agregar sus citas.
 * Sus datos están en la propia cita, en la pantalla de Citas.
 */

const INACTIVE_OPTIONS = [30, 60, 90, 180, 365];

export default function Customers() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);

  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [inactiveDays, setInactiveDays] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['customers', organizationId, search, tag, inactiveDays, sort, page],
    queryFn: () =>
      api.get<Paged<CustomerSummary>>(`/organizations/${organizationId}/customers`, {
        query: {
          query: search || undefined,
          tag: tag || undefined,
          inactiveDays: inactiveDays || undefined,
          sort,
          page,
        },
      }),
  });

  const tags = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['customer-tags', organizationId],
    queryFn: () => api.get<string[]>(`/organizations/${organizationId}/customer-tags`),
  });

  return (
    <div>
      <PageHeader
        title={t('admin.customers.title')}
        description={t('admin.customers.description')}
      />

      <Card className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t('common.search')} className="mb-0">
          <Input
            value={search}
            placeholder={t('admin.customers.searchHint')}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </Field>

        <Field label={t('admin.customers.tag')} className="mb-0">
          <Select
            value={tag}
            onChange={(event) => {
              setTag(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {tags.data?.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('admin.customers.inactive')} className="mb-0">
          <Select
            value={inactiveDays}
            onChange={(event) => {
              setInactiveDays(event.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {INACTIVE_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {t('admin.customers.inactiveDays', { count: days })}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('admin.customers.sort')} className="mb-0">
          <Select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value);
              setPage(1);
            }}
          >
            <option value="name">{t('admin.customers.sortName')}</option>
            <option value="recent">{t('admin.customers.sortRecent')}</option>
            <option value="appointments">{t('admin.customers.sortAppointments')}</option>
            <option value="spend">{t('admin.customers.sortSpend')}</option>
          </Select>
        </Field>
      </Card>

      <ErrorMessage error={error} />
      {isLoading && <LoadingBlock rows={4} />}

      {data?.items.length === 0 && (
        <EmptyState title={t('admin.customers.empty')} description={t('admin.customers.emptyHint')} />
      )}

      <ul className="space-y-2">
        {data?.items.map((customer) => (
          <Card as="li" key={customer.id}>
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-3 text-left"
              onClick={() => setOpenId(customer.id)}
            >
              <EntityAvatar
                name={customer.name}
                avatar={{
                  imageUrl: customer.imageUrl,
                  icon: customer.icon,
                  color: customer.color,
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{customer.name}</span>
                  {customer.tags.map((item) => (
                    <Badge key={item} className="bg-brand-soft text-brand">
                      {item}
                    </Badge>
                  ))}
                  {customer.stats.creditDebt > 0 && (
                    <Badge className="bg-amber-100 text-amber-800">
                      {t('admin.customers.debt', { count: customer.stats.creditDebt })}
                    </Badge>
                  )}
                </span>
                <span className="block truncate text-sm text-slate-500">
                  {customer.email ?? customer.phone ?? '—'}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                <span title={t('admin.customers.appointments')}>
                  {customer.stats.appointments} {t('admin.customers.appointmentsShort')}
                </span>
                {customer.stats.noShows > 0 && (
                  <span className="text-orange-700">
                    {customer.stats.noShows} {t('admin.customers.noShowsShort')}
                  </span>
                )}
                {customer.stats.creditBalance > 0 && (
                  <span className="text-emerald-700">
                    {customer.stats.creditBalance} {t('admin.customers.sessionsShort')}
                  </span>
                )}
                <span className="font-medium tabular-nums">
                  {formatMoney(customer.stats.spendCents, customer.stats.currency, locale)}
                </span>
              </span>

              <span className="w-full text-xs text-slate-500 sm:w-auto">
                {customer.stats.nextAppointmentAt
                  ? t('admin.customers.next', {
                      date: formatDate(customer.stats.nextAppointmentAt, locale, undefined, {
                        dateStyle: 'medium',
                      }),
                    })
                  : customer.stats.lastVisitAt
                    ? t('admin.customers.last', {
                        date: formatDate(customer.stats.lastVisitAt, locale, undefined, {
                          dateStyle: 'medium',
                        }),
                      })
                    : t('admin.customers.never')}
              </span>
            </button>
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

      <CustomerSheet
        userId={openId}
        organizationId={organizationId}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

/** Ficha completa. Se abre desde la lista y es donde se anota lo del mostrador. */
function CustomerSheet({
  userId,
  organizationId,
  onClose,
}: {
  userId: string | null;
  organizationId: string | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();

  const [notes, setNotes] = useState<string | null>(null);
  const [tags, setTags] = useState<string[] | null>(null);
  const [newTag, setNewTag] = useState('');

  const ficha = useQuery({
    enabled: Boolean(userId && organizationId),
    queryKey: ['customer', organizationId, userId],
    queryFn: () =>
      api.get<CustomerDetail>(`/organizations/${organizationId}/customers/${userId}`),
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch<CustomerDetail>(`/organizations/${organizationId}/customers/${userId}`, {
        notes: notes ?? '',
        tags: tags ?? [],
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['customer'] });
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      cerrar();
    },
  });

  const detalle = ficha.data;
  // Mientras no se toque nada se enseña lo guardado; al editar manda el
  // borrador, que es lo que permite cancelar sin haber pisado el original.
  const notasActuales = notes ?? detalle?.notes ?? '';
  const etiquetasActuales = tags ?? detalle?.tags ?? [];
  const editable = can('customer:write');
  const sucio = notes !== null || tags !== null;

  const cerrar = () => {
    setNotes(null);
    setTags(null);
    setNewTag('');
    onClose();
  };

  return (
    <Modal
      open={Boolean(userId)}
      onClose={cerrar}
      wide
      title={detalle?.name ?? t('admin.customers.title')}
      footer={
        <>
          <Button variant="ghost" onClick={cerrar}>
            {t('common.cancel')}
          </Button>
          {editable && (
            <Button loading={save.isPending} disabled={!sucio} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          )}
        </>
      }
    >
      {ficha.isLoading && <LoadingBlock rows={3} />}
      <ErrorMessage error={ficha.error ?? save.error} />

      {detalle && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <EntityAvatar
              name={detalle.name}
              size="lg"
              avatar={{ imageUrl: detalle.imageUrl, icon: detalle.icon, color: detalle.color }}
            />
            <div className="min-w-0">
              <p className="font-semibold">{detalle.name}</p>
              <p className="text-sm text-slate-500">{detalle.email ?? '—'}</p>
              <p className="text-sm text-slate-500">{detalle.phone ?? '—'}</p>
              {detalle.customerSince && (
                <p className="mt-1 text-xs text-slate-400">
                  {t('admin.customers.since', {
                    date: formatDate(detalle.customerSince, locale, undefined, {
                      dateStyle: 'medium',
                    }),
                  })}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label={t('admin.customers.appointments')}
              value={detalle.stats.appointments}
              hint={t('admin.customers.completedCount', { count: detalle.stats.completed })}
            />
            <StatTile
              label={t('admin.customers.noShows')}
              value={detalle.stats.noShows}
              tone={detalle.stats.noShows > 0 ? 'warning' : 'default'}
              hint={t('admin.customers.cancelledCount', { count: detalle.stats.cancelled })}
            />
            <StatTile
              label={t('admin.customers.spend')}
              value={formatMoney(detalle.stats.spendCents, detalle.stats.currency, locale)}
            />
            <StatTile
              label={t('admin.customers.sessions')}
              value={detalle.stats.creditBalance}
              tone={detalle.stats.creditDebt > 0 ? 'danger' : 'default'}
              hint={
                detalle.stats.creditDebt > 0
                  ? t('admin.customers.debt', { count: detalle.stats.creditDebt })
                  : undefined
              }
            />
          </div>

          <section>
            <h3 className="mb-2 font-semibold">{t('admin.customers.tags')}</h3>
            <div className="mb-2 flex flex-wrap gap-2">
              {etiquetasActuales.length === 0 && (
                <p className="text-sm text-slate-500">{t('admin.customers.noTags')}</p>
              )}
              {etiquetasActuales.map((item) => (
                <span key={item} className="badge bg-brand-soft text-brand">
                  {item}
                  {editable && (
                    <button
                      type="button"
                      className="ml-1 rounded-full p-0.5 hover:bg-white/60"
                      aria-label={t('common.delete')}
                      onClick={() => setTags(etiquetasActuales.filter((tag) => tag !== item))}
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {editable && (
              <div className="flex gap-2">
                <Input
                  value={newTag}
                  maxLength={40}
                  placeholder={t('admin.customers.newTag')}
                  aria-label={t('admin.customers.newTag')}
                  onChange={(event) => setNewTag(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const valor = newTag.trim();
                    if (valor && !etiquetasActuales.includes(valor)) {
                      setTags([...etiquetasActuales, valor]);
                    }
                    setNewTag('');
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => {
                    const valor = newTag.trim();
                    if (valor && !etiquetasActuales.includes(valor)) {
                      setTags([...etiquetasActuales, valor]);
                    }
                    setNewTag('');
                  }}
                >
                  {t('common.add')}
                </Button>
              </div>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-semibold">{t('admin.customers.notes')}</h3>
            <Field hint={t('admin.customers.notesHint')} className="mb-0">
              <Textarea
                rows={4}
                value={notasActuales}
                disabled={!editable}
                aria-label={t('admin.customers.notes')}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </section>

          <section>
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              <CalendarDays className="size-4 text-slate-400" aria-hidden />
              {t('admin.customers.history')}
            </h3>
            {detalle.appointments.length === 0 ? (
              <p className="text-sm text-slate-500">{t('admin.customers.noHistory')}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {detalle.appointments.map((cita) => (
                  <li key={cita.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="min-w-40 flex-1">
                      {formatDateTime(cita.startsAt, locale)}
                      <span className="block text-slate-500">
                        {cita.serviceName}
                        {cita.resourceName && ` · ${cita.resourceName}`}
                      </span>
                    </span>
                    <Badge className={statusClass(cita.status)}>
                      {t(`appointments.status.${cita.status}`)}
                    </Badge>
                    <span className="tabular-nums text-slate-600">
                      {formatMoney(cita.priceCents, detalle.stats.currency, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {detalle.wallets.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                <Ticket className="size-4 text-slate-400" aria-hidden />
                {t('admin.customers.credits')}
              </h3>
              <ul className="divide-y divide-slate-100">
                {detalle.wallets.map((wallet) => (
                  <li key={wallet.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{wallet.packName}</span>
                    <span className="text-slate-600">
                      {wallet.remaining}/{wallet.total}
                      {wallet.expiresAt &&
                        ` · ${formatDate(wallet.expiresAt, locale, undefined, { dateStyle: 'medium' })}`}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detalle.reviews.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 font-semibold">
                <Star className="size-4 text-slate-400" aria-hidden />
                {t('admin.customers.reviews')}
              </h3>
              <ul className="divide-y divide-slate-100">
                {detalle.reviews.map((review) => (
                  <li key={review.id} className="py-2 text-sm">
                    <span className="font-medium">{'★'.repeat(review.rating)}</span>
                    {review.serviceName && (
                      <span className="ml-2 text-slate-500">{review.serviceName}</span>
                    )}
                    {review.comment && <p className="text-slate-600">{review.comment}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!detalle.marketingOptIn && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Ban className="size-3.5" aria-hidden />
              {t('admin.customers.noMarketing')}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
