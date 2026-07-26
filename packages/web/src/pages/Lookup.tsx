import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDate, formatTime, statusClass } from '../lib/format.ts';
import { Badge, Button, Card, ErrorMessage, Field, Input, PageHeader } from '../components/ui.tsx';

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
}

/**
 * Consulta de una cita por su código, sin necesidad de cuenta. Es la vía de
 * quien reservó como invitado y llega desde el enlace del correo.
 */
export default function Lookup() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('c') ?? '');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(
        await api.get<LookupResult>('/public/appointments/lookup', {
          query: { code: code.trim().toUpperCase() },
        }),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title={t('appointments.lookupTitle')} description={t('appointments.lookupHelp')} />

      <Card>
        <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
        </Card>
      )}
    </div>
  );
}
