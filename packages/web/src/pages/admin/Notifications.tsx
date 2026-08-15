import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import { formatDateTime, formatLeadTime } from '../../lib/format.ts';
import type { ReminderRule } from '../../lib/types.ts';
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
  Select,
  SuccessMessage,
  Tabs,
  Textarea,
} from '../../components/ui.tsx';

const CHANNELS = ['email', 'push', 'telegram', 'whatsapp', 'sms'] as const;

/** Plantillas de aviso, recordatorios por defecto e historial de envíos. */
export default function Notifications() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('templates');

  return (
    <div>
      <PageHeader title={t('admin.notificationsAdmin.title')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'templates', label: t('admin.notificationsAdmin.templates') },
          { id: 'reminders', label: t('admin.notificationsAdmin.defaultReminders') },
          { id: 'history', label: t('admin.notificationsAdmin.history') },
        ]}
      />
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'reminders' && <RemindersTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  );
}

interface Template {
  event: string;
  channel: string;
  locale: string;
  subject: string | null;
  body: string;
  customized: boolean;
  enabled: boolean;
}

function TemplatesTab() {
  const { t, i18n } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [locale, setLocale] = useState(i18n.language.slice(0, 2));
  const [editing, setEditing] = useState<Template | null>(null);
  const [testChannel, setTestChannel] = useState('email');
  const [tested, setTested] = useState(false);

  const templates = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['templates', organizationId, locale],
    queryFn: () =>
      api.get<{ items: Template[]; availableVariables: { name: string; description: string }[] }>(
        `/organizations/${organizationId}/notification-templates`,
        { query: { locale } },
      ),
  });

  const save = useMutation({
    mutationFn: (template: Template) =>
      api.put(`/organizations/${organizationId}/notification-templates`, {
        event: template.event,
        channel: template.channel,
        locale: template.locale,
        subject: template.subject ?? undefined,
        body: template.body,
        enabled: template.enabled,
      }),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const restore = useMutation({
    mutationFn: (template: Template) =>
      api.delete(`/organizations/${organizationId}/notification-templates`, {
        query: { event: template.event, channel: template.channel, locale: template.locale },
      } as never),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const sendTest = useMutation({
    mutationFn: () =>
      api.post(`/organizations/${organizationId}/notifications/test`, {
        channel: testChannel,
        event: 'appointment.reminder',
        locale,
      }),
    onSuccess: () => setTested(true),
  });

  const grouped = new Map<string, Template[]>();
  for (const template of templates.data?.items ?? []) {
    const list = grouped.get(template.event) ?? [];
    list.push(template);
    grouped.set(template.event, list);
  }

  return (
    <div>
      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('common.language')} className="mb-0 max-w-40">
            <Select value={locale} onChange={(event) => setLocale(event.target.value)}>
              <option value="es">Español</option>
              <option value="gl">Galego</option>
              <option value="en">English</option>
            </Select>
          </Field>

          <Field label={t('admin.notificationsAdmin.testSend')} className="mb-0 max-w-40">
            <Select value={testChannel} onChange={(event) => setTestChannel(event.target.value)}>
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {t(`profile.channel.${channel}`)}
                </option>
              ))}
            </Select>
          </Field>

          <Button
            variant="secondary"
            loading={sendTest.isPending}
            icon={<Send className="size-4" />}
            onClick={() => sendTest.mutate()}
          >
            {t('admin.notificationsAdmin.testSend')}
          </Button>
        </div>
        {tested && <SuccessMessage>{t('common.save')}</SuccessMessage>}
      </Card>

      {templates.isLoading && <LoadingBlock rows={4} />}

      <div className="space-y-3">
        {[...grouped.entries()].map(([event, items]) => (
          <Card key={event}>
            <h3 className="mb-2 font-mono text-sm font-semibold text-slate-700">{event}</h3>
            <ul className="flex flex-wrap gap-2">
              {items.map((template) => (
                <li key={template.channel}>
                  <button
                    type="button"
                    onClick={() => setEditing(template)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-brand"
                  >
                    {t(`profile.channel.${template.channel}`)}
                    {template.customized && (
                      <Badge className="bg-indigo-100 text-indigo-800">✎</Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        wide
        title={editing ? `${editing.event} · ${editing.channel}` : ''}
        footer={
          <>
            {editing?.customized && (
              <Button
                variant="ghost"
                icon={<RotateCcw className="size-4" />}
                loading={restore.isPending}
                onClick={() => editing && restore.mutate(editing)}
              >
                {t('admin.notificationsAdmin.restoreDefault')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={save.isPending} onClick={() => editing && save.mutate(editing)}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <ErrorMessage error={save.error} />

            {editing.channel === 'email' && (
              <Field label={t('admin.notificationsAdmin.subject')}>
                <Input
                  value={editing.subject ?? ''}
                  onChange={(event) => setEditing({ ...editing, subject: event.target.value })}
                />
              </Field>
            )}

            <Field label={t('admin.notificationsAdmin.body')}>
              <Textarea
                rows={10}
                value={editing.body}
                onChange={(event) => setEditing({ ...editing, body: event.target.value })}
                className="font-mono text-sm"
              />
            </Field>

            <p className="mb-2 text-sm font-medium">{t('admin.notificationsAdmin.variables')}</p>
            <ul className="flex flex-wrap gap-1.5">
              {templates.data?.availableVariables.map((variable) => (
                <li key={variable.name}>
                  <button
                    type="button"
                    title={variable.description}
                    onClick={() =>
                      setEditing({ ...editing, body: `${editing.body}{{${variable.name}}}` })
                    }
                    className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs hover:bg-slate-200"
                  >
                    {`{{${variable.name}}}`}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </div>
  );
}

function RemindersTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<ReminderRule[]>([]);
  const [saved, setSaved] = useState(false);

  const data = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['org-reminders', organizationId],
    queryFn: () => api.get<ReminderRule[]>(`/organizations/${organizationId}/reminder-rules`),
  });

  useEffect(() => {
    if (data.data) setRules(data.data);
  }, [data.data]);

  const save = useMutation({
    mutationFn: () => api.put(`/organizations/${organizationId}/reminder-rules`, { rules }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['org-reminders'] });
    },
  });

  return (
    <Card>
      <p className="mb-4 text-sm text-slate-500">{t('profile.remindersHint')}</p>
      {saved && <SuccessMessage>{t('common.save')}</SuccessMessage>}
      <ErrorMessage error={save.error} />

      <ul className="mb-4 space-y-3">
        {rules.map((rule, index) => (
          <li key={index} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Input
                type="number"
                min={0}
                value={rule.offsetMinutes}
                onChange={(event) =>
                  setRules(
                    rules.map((item, position) =>
                      position === index
                        ? { ...item, offsetMinutes: Number(event.target.value) }
                        : item,
                    ),
                  )
                }
                className="max-w-32"
              />
              <span className="flex-1 text-sm text-slate-500">
                {formatLeadTime(rule.offsetMinutes, locale)}
              </span>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                aria-label={t('common.delete')}
                onClick={() => setRules(rules.filter((_, position) => position !== index))}
              >
                <Trash2 className="size-4" />
              </button>
            </div>

            <div className="flex flex-wrap gap-3">
              {CHANNELS.map((channel) => (
                <label key={channel} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={rule.channels.includes(channel)}
                    onChange={(event) =>
                      setRules(
                        rules.map((item, position) =>
                          position === index
                            ? {
                                ...item,
                                channels: event.target.checked
                                  ? [...item.channels, channel]
                                  : item.channels.filter((value) => value !== channel),
                              }
                            : item,
                        ),
                      )
                    }
                    className="size-4 rounded border-slate-300"
                  />
                  {t(`profile.channel.${channel}`)}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          icon={<Plus className="size-4" />}
          onClick={() => setRules([...rules, { offsetMinutes: 1440, channels: ['email'], enabled: true }])}
        >
          {t('profile.addReminder')}
        </Button>
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </div>
    </Card>
  );
}

function HistoryTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const organizationId = useAuth((state) => state.activeOrganizationId);

  const history = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['notification-history', organizationId],
    queryFn: () =>
      api.get<{
        items: {
          id: string;
          event: string;
          channel: string;
          destination: string;
          status: string;
          attempts: number;
          last_error: string | null;
          scheduled_at: string;
          sent_at: string | null;
        }[];
      }>(`/organizations/${organizationId}/notifications`, { query: { pageSize: 100 } }),
  });

  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
            <th className="py-2 pr-3">{t('common.date')}</th>
            <th className="py-2 pr-3">Evento</th>
            <th className="py-2 pr-3">{t('profile.channels')}</th>
            <th className="py-2 pr-3">Destino</th>
            <th className="py-2">Estado</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {history.data?.items.map((item) => (
            <tr key={item.id}>
              <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                {formatDateTime(item.sent_at ?? item.scheduled_at, locale)}
              </td>
              <td className="py-2 pr-3 font-mono text-xs">{item.event}</td>
              <td className="py-2 pr-3">{t(`profile.channel.${item.channel}`)}</td>
              <td className="max-w-48 truncate py-2 pr-3 text-slate-500">{item.destination}</td>
              <td className="py-2">
                <Badge
                  className={
                    item.status === 'sent'
                      ? 'bg-emerald-100 text-emerald-800'
                      : item.status === 'failed'
                        ? 'bg-red-100 text-red-700'
                        : 'bg-slate-100 text-slate-600'
                  }
                >
                  {item.status}
                </Badge>
                {item.last_error && (
                  <span className="ml-2 text-xs text-red-600">{item.last_error.slice(0, 60)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
