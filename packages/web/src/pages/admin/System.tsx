import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Database, Download, HardDriveDownload, Play, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  LoadingBlock,
  Modal,
  PageHeader,
  StatTile,
  SuccessMessage,
} from '../../components/ui.tsx';

interface SystemStatus {
  app: { name: string; url: string; environment: string };
  database: { client: string; migrations: { name: string; executedAt: string | null }[] };
  counts: { organizations: number; users: number; appointments: number; pendingNotifications: number };
  scheduler: { enabled: boolean; jobs: { name: string; pattern: string | null; nextRun: string | null }[] };
  channels: Record<string, unknown>;
  payments: { enabled: boolean; provider: string };
  auth: { methods: string[]; trustedCertificateAuthorities: number; mfaRequiredForAdmins: boolean };
  process: { uptimeSeconds: number; memoryMb: number; nodeVersion: string };
}

interface BackupsResponse {
  config: {
    enabled: boolean;
    cron: string;
    directory: string;
    retentionDays: number;
    maxFiles: number;
    encrypted: boolean;
  };
  records: {
    id: string;
    filename: string;
    sizeBytes: number;
    status: string;
    trigger: string;
    encrypted: boolean;
    startedAt: string;
    finishedAt: string | null;
    error: string | null;
  }[];
  files: { filename: string; sizeBytes: number }[];
}

/** Estado de la instalación y copias de seguridad. Solo superadministrador. */
export default function System() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const queryClient = useQueryClient();
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['system-status'],
    queryFn: () => api.get<SystemStatus>('/admin/status'),
  });

  const backups = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<BackupsResponse>('/admin/backups'),
  });

  const create = useMutation({
    mutationFn: () => api.post('/admin/backups'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });

  const restore = useMutation({
    mutationFn: (filename: string) =>
      api.post<{ rows: number; tables: number }>(
        `/admin/backups/${encodeURIComponent(filename)}/restore`,
        { truncate: true, confirm: true },
      ),
    onSuccess: (data) => {
      setRestoring(null);
      setRestored(`${data.rows} filas en ${data.tables} tablas`);
      void queryClient.invalidateQueries();
    },
  });

  const remove = useMutation({
    mutationFn: (filename: string) =>
      api.delete(`/admin/backups/${encodeURIComponent(filename)}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['backups'] }),
  });

  return (
    <div>
      <PageHeader
        title={t('admin.system.title')}
        actions={
          <Button
            variant="secondary"
            icon={<RefreshCw className="size-4" />}
            onClick={() => void queryClient.invalidateQueries()}
          >
            {t('common.retry')}
          </Button>
        }
      />

      {status.isLoading && <LoadingBlock rows={3} />}
      <ErrorMessage error={status.error} />

      {status.data && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Organizaciones" value={status.data.counts.organizations} />
            <StatTile label="Usuarios" value={status.data.counts.users} />
            <StatTile label="Citas" value={status.data.counts.appointments} />
            <StatTile
              label="Avisos en cola"
              value={status.data.counts.pendingNotifications}
              tone={status.data.counts.pendingNotifications > 100 ? 'warning' : 'default'}
            />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <Database className="size-4 text-slate-400" aria-hidden />
                {t('admin.system.migrations')}
              </h2>
              <p className="mb-2 text-sm text-slate-500">
                Motor: <span className="font-mono">{status.data.database.client}</span>
              </p>
              <ul className="divide-y divide-slate-100 text-sm">
                {status.data.database.migrations.map((migration) => (
                  <li key={migration.name} className="flex justify-between py-1.5">
                    <span className="font-mono text-xs">{migration.name}</span>
                    {migration.executedAt ? (
                      <Badge className="bg-emerald-100 text-emerald-800">
                        {formatDateTime(migration.executedAt, locale)}
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-800">pendiente</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </Card>

            <Card>
              <h2 className="mb-3 flex items-center gap-2 font-semibold">
                <Play className="size-4 text-slate-400" aria-hidden />
                {t('admin.system.scheduler')}
              </h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {status.data.scheduler.jobs.map((job) => (
                  <li key={job.name} className="flex justify-between py-1.5">
                    <span>{job.name}</span>
                    <span className="text-slate-500">
                      {job.nextRun ? formatDateTime(job.nextRun, locale) : '—'}
                    </span>
                  </li>
                ))}
                {status.data.scheduler.jobs.length === 0 && (
                  <p className="py-2 text-slate-500">{t('common.empty')}</p>
                )}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Node {status.data.process.nodeVersion} · {status.data.process.memoryMb} MB ·{' '}
                {Math.round(status.data.process.uptimeSeconds / 60)} min activo
              </p>
            </Card>
          </div>
        </>
      )}

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <HardDriveDownload className="size-4 text-slate-400" aria-hidden />
            {t('admin.system.backups')}
          </h2>
          <Button loading={create.isPending} onClick={() => create.mutate()}>
            {t('admin.system.createBackup')}
          </Button>
        </div>

        {restored && <SuccessMessage>{restored}</SuccessMessage>}
        <ErrorMessage error={create.error ?? restore.error} />

        {backups.data && (
          <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            {backups.data.config.enabled ? '✓' : '✗'} automáticas ·{' '}
            <span className="font-mono">{backups.data.config.cron}</span> · retención{' '}
            {backups.data.config.retentionDays} días · máximo {backups.data.config.maxFiles} ficheros
            {backups.data.config.encrypted && ' · cifradas'}
          </p>
        )}

        <ul className="divide-y divide-slate-100">
          {backups.data?.files.map((file) => (
            <li key={file.filename} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-mono text-xs">{file.filename}</span>
                <span className="text-xs text-slate-500">
                  {(file.sizeBytes / 1024).toFixed(1)} KB
                </span>
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                  aria-label={t('common.download')}
                  onClick={() =>
                    void api.download(
                      `/admin/backups/${encodeURIComponent(file.filename)}/download`,
                      file.filename,
                    )
                  }
                >
                  <Download className="size-4" />
                </button>
                <Button variant="secondary" onClick={() => setRestoring(file.filename)}>
                  {t('admin.system.restore')}
                </Button>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('common.delete')}
                  onClick={() => remove.mutate(file.filename)}
                >
                  <Trash2 className="size-4" />
                </button>
              </span>
            </li>
          ))}
          {backups.data?.files.length === 0 && (
            <p className="py-3 text-sm text-slate-500">{t('common.empty')}</p>
          )}
        </ul>
      </Card>

      <Modal
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title={t('admin.system.restore')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoring(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={restore.isPending}
              onClick={() => restoring && restore.mutate(restoring)}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{t('admin.system.restoreWarning')}</p>
        <p className="mt-2 break-all font-mono text-xs text-slate-500">{restoring}</p>
      </Modal>
    </div>
  );
}
