import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { CalendarX2, Check, Search } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDate, formatMoney, formatTime, statusClass } from '../lib/format.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  PageHeader,
  SuccessMessage,
} from '../components/ui.tsx';

interface LookupResult {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  serviceName: string;
  organizationName: string;
  locationName: string;
  locationAddress: string | null;
  resourceName: string | null;
  customerName: string;
  partySize: number;
  accessCode: string;
  currency: string;
  attendanceConfirmedAt: string | null;
  noShowFeeCents: number;
  /** El negocio pide confirmación y la cita todavía admite respuesta. */
  canRespond: boolean;
}

interface DeclineResult extends LookupResult {
  late: boolean;
  feeCents: number;
}

/**
 * Consulta de una cita por su código, sin necesidad de cuenta.
 *
 * Es la vía de quien reservó como invitado, y también adonde llevan los enlaces
 * de "voy" y "no puedo ir" del recordatorio: con `?c=CODIGO&accion=confirmar`
 * la pantalla busca la cita y responde sola, para que el cliente no tenga que
 * hacer nada más que pulsar en el correo.
 */
export default function Lookup() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('c') ?? '');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [declined, setDeclined] = useState<DeclineResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const buscar = useCallback(async (valor: string): Promise<LookupResult | null> => {
    setBusy(true);
    setError(null);
    try {
      const encontrada = await api.get<LookupResult>('/public/appointments/lookup', {
        query: { code: valor.trim().toUpperCase() },
      });
      setResult(encontrada);
      return encontrada;
    } catch (caught) {
      setError(caught);
      setResult(null);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmar = useCallback(async (valor: string) => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api.post<LookupResult>('/public/appointments/confirm', {
          code: valor.trim().toUpperCase(),
        }),
      );
      setConfirmed(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }, []);

  const avisar = useCallback(async (valor: string) => {
    setBusy(true);
    setError(null);
    try {
      const respuesta = await api.post<DeclineResult>('/public/appointments/decline', {
        code: valor.trim().toUpperCase(),
      });
      setResult(respuesta);
      setDeclined(respuesta);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }, []);

  /*
   * Al llegar desde el correo se busca la cita, pero no se responde sola: un
   * cliente de correo que precarga enlaces cancelaría citas sin que nadie
   * pulsara nada. Lo que hace la dirección es dejar el botón a la vista.
   */
  const accion = searchParams.get('accion');
  useEffect(() => {
    const desdeElCorreo = searchParams.get('c');
    if (desdeElCorreo) void buscar(desdeElCorreo);
  }, [buscar, searchParams]);

  return (
    <div>
      <PageHeader title={t('appointments.lookupTitle')} description={t('appointments.lookupHelp')} />

      <Card>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void buscar(code);
          }}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <Field label={t('booking.accessCode')} className="mb-0 flex-1">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="XXXXXXXXXX"
              className="font-mono tracking-widest"
              maxLength={40}
              required
            />
          </Field>
          <Button type="submit" loading={busy} icon={<Search className="size-4" />}>
            {t('common.search')}
          </Button>
        </form>
      </Card>

      <div className="mt-4">
        <ErrorMessage error={error} />
      </div>

      {confirmed && <SuccessMessage>{t('appointments.attendanceThanks')}</SuccessMessage>}

      {declined && (
        <SuccessMessage>
          {declined.feeCents > 0
            ? t('appointments.declinedWithFee', {
                amount: formatMoney(declined.feeCents, declined.currency, locale),
              })
            : t('appointments.declined')}
        </SuccessMessage>
      )}

      {result && (
        <Card>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">{result.serviceName}</h2>
              <p className="text-sm text-slate-500">{result.organizationName}</p>
            </div>
            <Badge className={statusClass(result.status)}>
              {t(`appointments.status.${result.status}`)}
            </Badge>
          </div>

          <dl className="space-y-1.5 text-sm text-slate-700">
            <p>
              {formatDate(result.startsAt, locale, result.timezone, { dateStyle: 'full' })} ·{' '}
              {formatTime(result.startsAt, locale, result.timezone)}
            </p>
            <p>{[result.locationName, result.locationAddress].filter(Boolean).join(' · ')}</p>
            {result.resourceName && <p>{result.resourceName}</p>}
            <p className="text-slate-500">{result.customerName}</p>
          </dl>

          {result.attendanceConfirmedAt && (
            <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700">
              <Check className="size-4" aria-hidden />
              {t('appointments.attendanceConfirmed')}
            </p>
          )}

          {result.canRespond && (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button
                loading={busy}
                icon={<Check className="size-4" />}
                onClick={() => void confirmar(result.accessCode)}
              >
                {t('appointments.confirmAttendance')}
              </Button>
              <Button
                variant="secondary"
                loading={busy}
                icon={<CalendarX2 className="size-4" />}
                // El enlace del correo deja este botón resaltado, pero la
                // cancelación siempre la pulsa una persona.
                className={accion === 'cancelar' ? 'ring-2 ring-brand/30' : undefined}
                onClick={() => void avisar(result.accessCode)}
              >
                {t('appointments.cannotAttend')}
              </Button>
            </div>
          )}

          {result.noShowFeeCents > 0 && (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              {t('appointments.feePending', {
                amount: formatMoney(result.noShowFeeCents, result.currency, locale),
              })}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
