import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, DoorOpen, KeyRound, Plus, Trash2, Webhook } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  SuccessMessage,
} from '../../components/ui.tsx';

const COMMON_SCOPES = [
  'appointment:read',
  'appointment:write',
  'appointment:cancel',
  'appointment:checkin',
  'service:read',
  'resource:read',
  'schedule:read',
  'customer:read',
  'report:read',
] as const;

interface IntegrationStatus {
  alexa: { enabled: boolean; endpoint: string; skillId: string | null };
  google: { enabled: boolean; endpoint: string };
  telegram: { enabled: boolean; bot: string | null; webhook: string };
  whatsapp: { enabled: boolean; webhook: string };
  mcp: { enabled: boolean; endpoint: string };
  webhooksOut: { enabled: boolean; events: string[] };
}

/** Claves de API, webhooks y estado de los asistentes. */
export default function Integrations() {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();

  const [keyOpen, setKeyOpen] = useState(false);
  const [keyDraft, setKeyDraft] = useState<{ name: string; scopes: string[] }>({
    name: '',
    scopes: ['appointment:checkin', 'appointment:read'],
  });
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const [hookOpen, setHookOpen] = useState(false);
  const [hookDraft, setHookDraft] = useState({ url: '', events: ['*'] });
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  const status = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['integrations', organizationId],
    queryFn: () => api.get<IntegrationStatus>(`/organizations/${organizationId}/integrations`),
  });

  const keys = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['api-keys', organizationId],
    queryFn: () =>
      api.get<
        { id: string; name: string; prefix: string; scopes: string[]; lastUsedAt: string | null; revokedAt: string | null }[]
      >(`/organizations/${organizationId}/api-keys`),
  });

  const webhooks = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['webhooks', organizationId],
    queryFn: () =>
      api.get<{
        availableEvents: string[];
        endpoints: { id: string; url: string; events: string[]; active: boolean; failureCount: number }[];
      }>(`/organizations/${organizationId}/webhooks`),
  });

  const createKey = useMutation({
    mutationFn: () => api.post<{ key: string }>(`/organizations/${organizationId}/api-keys`, keyDraft),
    onSuccess: (data) => {
      setCreatedKey(data.key);
      setKeyOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => api.delete(`/organizations/${organizationId}/api-keys/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  const createHook = useMutation({
    mutationFn: () =>
      api.post<{ id: string; secret: string }>(`/organizations/${organizationId}/webhooks`, hookDraft),
    onSuccess: (data) => {
      setCreatedSecret(data.secret);
      setHookOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const copy = (value: string) => void navigator.clipboard.writeText(value);

  return (
    <div>
      <PageHeader title={t('admin.integrations.title')} />

      {createdKey && (
        <SuccessMessage>
          <p className="mb-2">{t('admin.integrations.keyShownOnce')}</p>
          <code className="block break-all rounded-lg bg-white/70 p-2 font-mono text-xs">
            {createdKey}
          </code>
          <Button variant="ghost" className="mt-1" icon={<Copy className="size-4" />} onClick={() => copy(createdKey)}>
            {t('common.copy')}
          </Button>
        </SuccessMessage>
      )}

      {createdSecret && (
        <SuccessMessage>
          <p className="mb-2">{t('admin.integrations.secretShownOnce')}</p>
          <code className="block break-all rounded-lg bg-white/70 p-2 font-mono text-xs">
            {createdSecret}
          </code>
        </SuccessMessage>
      )}

      {/* Asistentes y accesos */}
      {status.data && (
        <Card className="mb-4">
          <h2 className="mb-3 font-semibold">{t('admin.integrations.assistants')}</h2>

          <div className="space-y-3 text-sm">
            <IntegrationRow
              label="Servidor MCP"
              enabled={status.data.mcp.enabled}
              value={status.data.mcp.endpoint}
              hint={t('admin.integrations.mcpHint')}
              onCopy={copy}
            />
            <IntegrationRow
              label="Alexa"
              enabled={status.data.alexa.enabled}
              value={status.data.alexa.endpoint}
              onCopy={copy}
            />
            <IntegrationRow
              label="Google"
              enabled={status.data.google.enabled}
              value={status.data.google.endpoint}
              onCopy={copy}
            />
            <IntegrationRow
              label="Telegram"
              enabled={status.data.telegram.enabled}
              value={status.data.telegram.webhook}
              onCopy={copy}
            />
            <IntegrationRow
              label="WhatsApp"
              enabled={status.data.whatsapp.enabled}
              value={status.data.whatsapp.webhook}
              onCopy={copy}
            />
          </div>
        </Card>
      )}

      {/* Claves de API */}
      <Card className="mb-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4 text-slate-400" aria-hidden />
            {t('admin.integrations.apiKeys')}
          </h2>
          <Button icon={<Plus className="size-4" />} onClick={() => setKeyOpen(true)}>
            {t('admin.integrations.newApiKey')}
          </Button>
        </div>

        <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <DoorOpen className="mr-1 inline size-3.5" aria-hidden />
          {t('admin.integrations.doorHint')}
        </p>

        {keys.isLoading && <LoadingBlock rows={2} />}
        <ErrorMessage error={revokeKey.error} />

        <ul className="divide-y divide-slate-100">
          {keys.data?.map((key) => (
            <li key={key.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block font-medium">{key.name}</span>
                <span className="block font-mono text-xs text-slate-500">{key.prefix}</span>
                <span className="mt-1 flex flex-wrap gap-1">
                  {key.scopes.slice(0, 4).map((scope) => (
                    <Badge key={scope} className="bg-slate-100 text-slate-600">
                      {scope}
                    </Badge>
                  ))}
                  {key.scopes.length > 4 && (
                    <Badge className="bg-slate-100 text-slate-600">+{key.scopes.length - 4}</Badge>
                  )}
                </span>
              </span>
              {key.revokedAt ? (
                <Badge className="bg-red-100 text-red-700">{t('common.no')}</Badge>
              ) : (
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('common.delete')}
                  onClick={() => revokeKey.mutate(key.id)}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      {/* Webhooks */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            <Webhook className="size-4 text-slate-400" aria-hidden />
            {t('admin.integrations.webhooks')}
          </h2>
          <Button icon={<Plus className="size-4" />} onClick={() => setHookOpen(true)}>
            {t('admin.integrations.newWebhook')}
          </Button>
        </div>

        <ul className="divide-y divide-slate-100">
          {webhooks.data?.endpoints.map((endpoint) => (
            <li key={endpoint.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate font-mono text-sm">{endpoint.url}</span>
                <span className="text-xs text-slate-500">{endpoint.events.join(', ')}</span>
              </span>
              <span className="flex items-center gap-2">
                {endpoint.failureCount > 0 && (
                  <Badge className="bg-amber-100 text-amber-800">{endpoint.failureCount}</Badge>
                )}
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    void api
                      .delete(`/organizations/${organizationId}/webhooks/${endpoint.id}`)
                      .then(() => queryClient.invalidateQueries({ queryKey: ['webhooks'] }))
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={keyOpen}
        onClose={() => setKeyOpen(false)}
        title={t('admin.integrations.newApiKey')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setKeyOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={createKey.isPending} onClick={() => createKey.mutate()}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={createKey.error} />
        <Field label={t('admin.services.name')} required>
          <Input
            value={keyDraft.name}
            onChange={(event) => setKeyDraft({ ...keyDraft, name: event.target.value })}
            placeholder="Puerta principal"
          />
        </Field>
        <Field label={t('admin.integrations.scopes')}>
          <div className="space-y-1.5 rounded-xl border border-slate-200 p-3">
            {COMMON_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 font-mono text-sm">
                <input
                  type="checkbox"
                  checked={keyDraft.scopes.includes(scope)}
                  onChange={(event) =>
                    setKeyDraft({
                      ...keyDraft,
                      scopes: event.target.checked
                        ? [...keyDraft.scopes, scope]
                        : keyDraft.scopes.filter((item) => item !== scope),
                    })
                  }
                  className="size-4 rounded border-slate-300"
                />
                {scope}
              </label>
            ))}
          </div>
        </Field>
      </Modal>

      <Modal
        open={hookOpen}
        onClose={() => setHookOpen(false)}
        title={t('admin.integrations.newWebhook')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setHookOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={createHook.isPending} onClick={() => createHook.mutate()}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={createHook.error} />
        <Field label="URL" required>
          <Input
            type="url"
            value={hookDraft.url}
            onChange={(event) => setHookDraft({ ...hookDraft, url: event.target.value })}
            placeholder="https://ejemplo.com/webhook"
          />
        </Field>
        <Field label={t('admin.integrations.events')}>
          <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={hookDraft.events.includes('*')}
                onChange={(event) => setHookDraft({ ...hookDraft, events: event.target.checked ? ['*'] : [] })}
                className="size-4 rounded border-slate-300"
              />
              {t('common.all')}
            </label>
            {webhooks.data?.availableEvents.map((event) => (
              <label key={event} className="flex items-center gap-2 font-mono text-sm">
                <input
                  type="checkbox"
                  disabled={hookDraft.events.includes('*')}
                  checked={hookDraft.events.includes(event)}
                  onChange={(changed) =>
                    setHookDraft({
                      ...hookDraft,
                      events: changed.target.checked
                        ? [...hookDraft.events, event]
                        : hookDraft.events.filter((item) => item !== event),
                    })
                  }
                  className="size-4 rounded border-slate-300"
                />
                {event}
              </label>
            ))}
          </div>
        </Field>
      </Modal>
    </div>
  );
}

function IntegrationRow({
  label,
  enabled,
  value,
  hint,
  onCopy,
}: {
  label: string;
  enabled: boolean;
  value: string;
  hint?: string;
  onCopy: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-slate-200 p-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium">{label}</span>
        <Badge className={enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}>
          {enabled ? t('common.yes') : t('common.no')}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs">
          {value}
        </code>
        <button
          type="button"
          onClick={() => onCopy(value)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          aria-label={t('common.copy')}
        >
          <Copy className="size-4" />
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
