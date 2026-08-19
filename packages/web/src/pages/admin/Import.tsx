import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileUp, Play, Upload } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Select,
  SuccessMessage,
  Textarea,
} from '../../components/ui.tsx';

interface RowResult {
  row: number;
  status: 'created' | 'updated' | 'skipped' | 'error';
  message?: string;
  name?: string;
}

interface Report {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
  results: RowResult[];
}

/**
 * Importación desde CSV.
 *
 * El recorrido es en dos pasos a propósito: primero se ensaya y se lee el
 * informe, y solo entonces aparece el botón que escribe. Importar mal mil filas
 * se arregla mucho peor que revisarlas antes.
 */
export function ImportTab() {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [tipo, setTipo] = useState<'customers' | 'appointments'>('customers');
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<Report | null>(null);

  const ejecutar = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<Report>(`/organizations/${organizationId}/import/${tipo}`, { csv, dryRun }),
    onSuccess: (resultado) => {
      setReport(resultado);
      if (!resultado.dryRun) {
        void queryClient.invalidateQueries({ queryKey: ['customers'] });
        void queryClient.invalidateQueries({ queryKey: ['admin-appointments'] });
      }
    },
  });

  const leerFichero = (file: File) => {
    const lector = new FileReader();
    lector.onload = () => {
      setCsv(String(lector.result ?? ''));
      setReport(null);
    };
    // Las hojas de cálculo españolas suelen guardar en UTF-8; si no lo está, se
    // ve en la vista previa antes de escribir nada.
    lector.readAsText(file, 'utf-8');
  };

  const tono = (status: RowResult['status']) =>
    status === 'error'
      ? 'bg-red-100 text-red-700'
      : status === 'created'
        ? 'bg-emerald-100 text-emerald-800'
        : status === 'updated'
          ? 'bg-blue-100 text-blue-800'
          : 'bg-slate-100 text-slate-600';

  return (
    <div>
      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('admin.import.what')} className="mb-0">
            <Select
              value={tipo}
              onChange={(event) => {
                setTipo(event.target.value as typeof tipo);
                setReport(null);
              }}
            >
              <option value="customers">{t('admin.import.customers')}</option>
              <option value="appointments">{t('admin.import.appointments')}</option>
            </Select>
          </Field>

          <Field label={t('admin.import.file')} className="mb-0">
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv,text/plain"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) leerFichero(file);
                }}
              />
              <Button
                variant="secondary"
                icon={<FileUp className="size-4" />}
                onClick={() => fileRef.current?.click()}
              >
                {t('admin.import.choose')}
              </Button>
            </div>
          </Field>
        </div>

        <p className="mt-3 text-sm text-slate-500">
          {tipo === 'customers' ? t('admin.import.columnsCustomers') : t('admin.import.columnsAppointments')}
        </p>
      </Card>

      <Field label={t('admin.import.paste')} hint={t('admin.import.pasteHint')}>
        <Textarea
          rows={8}
          className="font-mono text-xs"
          value={csv}
          onChange={(event) => {
            setCsv(event.target.value);
            setReport(null);
          }}
        />
      </Field>

      <ErrorMessage error={ejecutar.error} />

      <div className="mb-4 flex flex-wrap gap-2">
        <Button
          icon={<Play className="size-4" />}
          loading={ejecutar.isPending}
          disabled={csv.trim().length === 0}
          onClick={() => ejecutar.mutate(true)}
        >
          {t('admin.import.dryRun')}
        </Button>

        {/* El botón que escribe solo aparece después de un ensayo. */}
        {report?.dryRun && (
          <Button
            variant="secondary"
            icon={<Upload className="size-4" />}
            loading={ejecutar.isPending}
            onClick={() => ejecutar.mutate(false)}
          >
            {t('admin.import.run')}
          </Button>
        )}
      </div>

      {report && !report.dryRun && (
        <SuccessMessage>
          {t('admin.import.done', { created: report.created, updated: report.updated })}
        </SuccessMessage>
      )}

      {report && (
        <Card>
          <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span>{t('admin.import.total', { count: report.total })}</span>
            <span className="text-emerald-700">
              {t('admin.import.created', { count: report.created })}
            </span>
            <span className="text-blue-700">
              {t('admin.import.updated', { count: report.updated })}
            </span>
            {report.errors > 0 && (
              <span className="text-red-700">
                {t('admin.import.errors', { count: report.errors })}
              </span>
            )}
          </p>

          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
            {report.results.map((resultado) => (
              <li key={resultado.row} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-12 tabular-nums text-slate-400">{resultado.row}</span>
                <Badge className={tono(resultado.status)}>
                  {t(`admin.import.status.${resultado.status}`)}
                </Badge>
                <span className="flex-1">{resultado.name}</span>
                {resultado.message && (
                  <span className="text-red-700">{resultado.message}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
