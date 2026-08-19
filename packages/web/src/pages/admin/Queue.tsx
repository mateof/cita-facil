import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { BellRing, Check, MonitorPlay, UserMinus, UserPlus } from 'lucide-react';
import type { QueueEntry, QueueView } from '@cita-facil/shared';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { formatTime } from '../../lib/format.ts';
import type { AdminService, PublicOrganization } from '../../lib/types.ts';
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
} from '../../components/ui.tsx';

/**
 * Cola sin cita previa.
 *
 * La pantalla del mostrador de un negocio que trabaja por orden de llegada:
 * quién ha llegado, cuánto le queda y a quién le toca. Se refresca sola cada
 * quince segundos porque hay dos personas mirándola a la vez, la de recepción y
 * la de la sala.
 */
export default function Queue() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const organizations = useAuth((state) => state.organizations);
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '', serviceId: '', note: '' });

  const slug = organizations.find((item) => item.id === organizationId)?.slug;

  const cola = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['queue', organizationId],
    queryFn: () => api.get<QueueView>(`/organizations/${organizationId}/queue`),
    // El mostrador y la sala miran lo mismo a la vez; sin refresco, uno de los
    // dos trabaja con una cola que ya no existe.
    refetchInterval: 15_000,
  });

  const publica = useQuery({
    enabled: Boolean(slug),
    queryKey: ['public-org', slug],
    queryFn: () => api.get<PublicOrganization>(`/public/organizations/${slug}`),
  });

  const services = useQuery({
    enabled: Boolean(organizationId) && addOpen,
    queryKey: ['services', organizationId],
    queryFn: () =>
      api.get<AdminService[]>(`/organizations/${organizationId}/services`, {
        query: { onlyActive: true },
      }),
  });

  const refrescar = () => void queryClient.invalidateQueries({ queryKey: ['queue'] });

  const apuntar = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${organizationId}/queue`, {
        name: draft.name,
        phone: draft.phone || undefined,
        serviceId: draft.serviceId || undefined,
        note: draft.note || undefined,
      }),
    onSuccess: () => {
      setAddOpen(false);
      setDraft({ name: '', phone: '', serviceId: '', note: '' });
      refrescar();
    },
  });

  const llamarSiguiente = useMutation({
    mutationFn: () => api.post(`/organizations/${organizationId}/queue/next`, {}),
    onSuccess: refrescar,
  });

  const cambiar = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/organizations/${organizationId}/queue/${id}`, { status }),
    onSuccess: refrescar,
  });

  const activa = publica.data?.organization.walkInQueueEnabled ?? true;

  const fila = (entry: QueueEntry, acciones: { label: string; status: string; icon: ReactNode }[]) => (
    <Card as="li" key={entry.id} className="flex flex-wrap items-center gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-lg font-bold text-brand tabular-nums">
        {entry.ticketNumber}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{entry.name}</span>
          {entry.partySize > 1 && (
            <Badge className="bg-slate-100">{t('admin.queue.people', { count: entry.partySize })}</Badge>
          )}
          {entry.source === 'online' && (
            <Badge className="bg-slate-100 text-slate-600">{t('admin.queue.online')}</Badge>
          )}
        </span>
        <span className="block text-sm text-slate-500">
          {formatTime(entry.joinedAt, locale)}
          {entry.serviceName && ` · ${entry.serviceName}`}
          {entry.phone && ` · ${entry.phone}`}
          {entry.note && ` · ${entry.note}`}
        </span>
      </span>

      {entry.status === 'waiting' && (
        <span className="text-sm text-slate-500">
          {entry.ahead === 0
            ? t('admin.queue.next')
            : t('admin.queue.wait', {
                count: entry.ahead,
                minutes: entry.estimatedWaitMinutes,
              })}
        </span>
      )}

      <span className="flex gap-2">
        {acciones.map((accion) => (
          <Button
            key={accion.status}
            variant={accion.status === 'left' ? 'ghost' : 'secondary'}
            icon={accion.icon}
            onClick={() => cambiar.mutate({ id: entry.id, status: accion.status })}
          >
            {accion.label}
          </Button>
        ))}
      </span>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={t('admin.queue.title')}
        description={t('admin.queue.description')}
        actions={
          <>
            {slug && (
              <Button
                variant="secondary"
                icon={<MonitorPlay className="size-4" />}
                onClick={() => window.open(`/${slug}/turnos`, '_blank', 'noopener')}
              >
                {t('admin.queue.display')}
              </Button>
            )}
            <Button icon={<UserPlus className="size-4" />} onClick={() => setAddOpen(true)}>
              {t('admin.queue.add')}
            </Button>
          </>
        }
      />

      <ErrorMessage error={cola.error ?? cambiar.error ?? llamarSiguiente.error} />

      {!activa && (
        <EmptyState title={t('admin.queue.disabled')} description={t('admin.queue.disabledHint')} />
      )}

      {cola.isLoading && <LoadingBlock rows={3} />}

      {activa && cola.data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Button
              icon={<BellRing className="size-4" />}
              loading={llamarSiguiente.isPending}
              disabled={cola.data.waiting.length === 0}
              onClick={() => llamarSiguiente.mutate()}
            >
              {t('admin.queue.callNext')}
            </Button>
            <span className="text-sm text-slate-500">
              {t('admin.queue.waitingCount', { count: cola.data.waiting.length })}
            </span>
          </div>

          {(cola.data.called.length > 0 || cola.data.serving.length > 0) && (
            <section className="mb-5">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {t('admin.queue.attending')}
              </h2>
              <ul className="space-y-2">
                {cola.data.called.map((entry) =>
                  fila(entry, [
                    {
                      label: t('admin.queue.serving'),
                      status: 'serving',
                      icon: <Check className="size-4" />,
                    },
                    {
                      label: t('admin.queue.left'),
                      status: 'left',
                      icon: <UserMinus className="size-4" />,
                    },
                  ]),
                )}
                {cola.data.serving.map((entry) =>
                  fila(entry, [
                    {
                      label: t('admin.queue.done'),
                      status: 'done',
                      icon: <Check className="size-4" />,
                    },
                  ]),
                )}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {t('admin.queue.waiting')}
            </h2>
            {cola.data.waiting.length === 0 ? (
              <EmptyState title={t('admin.queue.empty')} />
            ) : (
              <ul className="space-y-2">
                {cola.data.waiting.map((entry) =>
                  fila(entry, [
                    {
                      label: t('admin.queue.call'),
                      status: 'called',
                      icon: <BellRing className="size-4" />,
                    },
                    {
                      label: t('admin.queue.left'),
                      status: 'left',
                      icon: <UserMinus className="size-4" />,
                    },
                  ]),
                )}
              </ul>
            )}
          </section>

          {cola.data.closed.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                {t('admin.queue.closed')}
              </h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {cola.data.closed.map((entry) => (
                  <li key={entry.id} className="flex items-center gap-3 py-2">
                    <span className="w-8 tabular-nums text-slate-500">{entry.ticketNumber}</span>
                    <span className="flex-1">{entry.name}</span>
                    <Badge className="bg-slate-100 text-slate-600">
                      {t(`admin.queue.status.${entry.status}`)}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t('admin.queue.add')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={apuntar.isPending}
              disabled={draft.name.trim().length < 2}
              onClick={() => apuntar.mutate()}
            >
              {t('admin.queue.add')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={apuntar.error} />
        <Field label={t('admin.customer')} required>
          <Input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field label={t('auth.phone')} hint={t('admin.queue.phoneHint')}>
          <Input
            type="tel"
            value={draft.phone}
            onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
          />
        </Field>
        <Field label={t('booking.service')}>
          <Select
            value={draft.serviceId}
            onChange={(event) => setDraft({ ...draft, serviceId: event.target.value })}
          >
            <option value="">{t('common.none')}</option>
            {services.data?.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('admin.internalNotes')}>
          <Input
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </Field>
      </Modal>
    </div>
  );
}
