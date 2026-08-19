import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Timer } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../stores/auth.ts';
import { Button, Card, ErrorMessage, Field, Input } from './ui.tsx';

/**
 * Coger turno sin cita previa desde la página del negocio.
 *
 * El identificador del turno se guarda en `localStorage` por organización: al
 * recargar o volver más tarde, la persona sigue viendo cuánto le queda en lugar
 * de creer que ha perdido el sitio. Es un dato de conveniencia, no de sesión;
 * quien lo pierda lo puede preguntar en el mostrador.
 */

interface Ticket {
  id: string;
  ticketNumber: number;
  ahead: number;
  estimatedWaitMinutes: number;
  status: string;
}

interface TicketStatus {
  ticketNumber: number;
  status: string;
  ahead: number;
  estimatedWaitMinutes: number;
}

const clave = (organizationId: string) => `cf_turno_${organizationId}`;

export function WalkInQueue({ organizationId }: { organizationId: string }) {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);

  const [entryId, setEntryId] = useState<string | null>(() => localStorage.getItem(clave(organizationId)));
  const [nombre, setNombre] = useState(user?.name ?? '');
  const [telefono, setTelefono] = useState(user?.phone ?? '');

  const turno = useQuery({
    enabled: Boolean(entryId),
    queryKey: ['queue-ticket', organizationId, entryId],
    queryFn: () =>
      api.get<TicketStatus>(`/public/organizations/${organizationId}/queue/${entryId}`),
    refetchInterval: 30_000,
    retry: false,
  });

  const coger = useMutation({
    mutationFn: () =>
      api.post<Ticket>(`/public/organizations/${organizationId}/queue`, {
        name: nombre || undefined,
        phone: telefono || undefined,
      }),
    onSuccess: (ticket) => {
      localStorage.setItem(clave(organizationId), ticket.id);
      setEntryId(ticket.id);
    },
  });

  const olvidar = () => {
    localStorage.removeItem(clave(organizationId));
    setEntryId(null);
  };

  // El turno cerrado deja de ocupar la pantalla: ya pasó.
  if (turno.data && ['done', 'left'].includes(turno.data.status)) {
    localStorage.removeItem(clave(organizationId));
  }

  if (entryId && turno.data && !['done', 'left'].includes(turno.data.status)) {
    return (
      <Card className="mt-6 border-brand/30 bg-brand-soft/40">
        <p className="text-xs uppercase tracking-wide text-slate-500">{t('queue.yourTicket')}</p>
        <p className="my-1 text-5xl font-black tabular-nums text-brand">
          {turno.data.ticketNumber}
        </p>

        {turno.data.status === 'called' ? (
          <p className="font-semibold text-emerald-700">{t('queue.itsYourTurn')}</p>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-slate-600">
            <Timer className="size-4" aria-hidden />
            {turno.data.ahead === 0
              ? t('queue.youAreNext')
              : t('queue.ahead', {
                  count: turno.data.ahead,
                  minutes: turno.data.estimatedWaitMinutes,
                })}
          </p>
        )}

        <Button variant="ghost" className="mt-3" onClick={olvidar}>
          {t('queue.forget')}
        </Button>
      </Card>
    );
  }

  return (
    <Card className="mt-6">
      <h2 className="font-semibold">{t('queue.takeTicket')}</h2>
      <p className="mb-3 text-sm text-slate-500">{t('queue.takeTicketHint')}</p>

      <ErrorMessage error={coger.error} />

      {!user && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('booking.yourName')} className="mb-0" required>
            <Input value={nombre} onChange={(event) => setNombre(event.target.value)} />
          </Field>
          <Field label={t('auth.phone')} hint={t('queue.phoneHint')} className="mb-0">
            <Input
              type="tel"
              value={telefono}
              onChange={(event) => setTelefono(event.target.value)}
            />
          </Field>
        </div>
      )}

      <Button
        className="mt-3"
        loading={coger.isPending}
        disabled={!user && nombre.trim().length < 2}
        onClick={() => coger.mutate()}
      >
        {t('queue.takeTicket')}
      </Button>
    </Card>
  );
}
