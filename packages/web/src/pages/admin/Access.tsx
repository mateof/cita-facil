import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Copy, Mail, Plus, RefreshCw, Trash2, UserPlus } from 'lucide-react';
import { api } from '../../lib/api.ts';
import { formatDateTime } from '../../lib/format.ts';
import type { AllowlistEntry, AuthSettings, PlatformUser } from '../../lib/types.ts';
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
  Switch,
  Tabs,
  Textarea,
} from '../../components/ui.tsx';

const METHODS = ['password', 'passkey', 'certificate', 'google', 'oidc'] as const;
const MODES = ['open', 'allowlist', 'invite_only', 'closed'] as const;

/**
 * Acceso y registro de la instalación.
 *
 * Es una pantalla de plataforma, no de organización: aquí se decide quién
 * puede entrar y por qué medios en toda la aplicación.
 */
export default function Access() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('policy');

  return (
    <div>
      <PageHeader title={t('admin.access.title')} description={t('admin.access.description')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'policy', label: t('admin.access.policy') },
          { id: 'allowlist', label: t('admin.access.allowlist') },
          { id: 'users', label: t('admin.access.users') },
        ]}
      />
      {tab === 'policy' && <PolicyTab />}
      {tab === 'allowlist' && <AllowlistTab />}
      {tab === 'users' && <UsersTab />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PolicyTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<AuthSettings | null>(null);
  const [saved, setSaved] = useState(false);

  const settings = useQuery({
    queryKey: ['auth-settings'],
    queryFn: () => api.get<AuthSettings>('/admin/auth-settings'),
  });

  useEffect(() => {
    if (settings.data) setDraft(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put('/admin/auth-settings', {
        methods: draft!.methods,
        registrationMode: draft!.registrationMode,
        autoProvisionCertificate: draft!.autoProvisionCertificate,
        autoProvisionSocial: draft!.autoProvisionSocial,
        requireVerifiedEmail: draft!.requireVerifiedEmail,
        allowAnonymousBooking: draft!.allowAnonymousBooking,
        mfaRequiredForAdmins: draft!.mfaRequiredForAdmins,
        allowOrganizationSelfService: draft!.allowOrganizationSelfService,
        allowedEmailDomains: draft!.allowedEmailDomains,
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['auth-settings'] });
      void queryClient.invalidateQueries({ queryKey: ['auth-methods'] });
    },
  });

  if (!draft) return <LoadingBlock rows={3} />;

  const copy = (value: string) => void navigator.clipboard.writeText(value);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-semibold">{t('admin.access.methods')}</h2>
        <p className="mb-3 text-sm text-slate-500">{t('admin.access.methodsHint')}</p>

        {saved && <SuccessMessage>{t('common.save')}</SuccessMessage>}
        <ErrorMessage error={save.error} />

        <div className="divide-y divide-slate-100">
          {METHODS.map((method) => {
            const needsConfig = method === 'google' || method === 'oidc';
            const configured = needsConfig
              ? draft.configured[method as 'google' | 'oidc']
              : true;

            return (
              <div key={method}>
                <Switch
                  checked={draft.methods[method]}
                  disabled={needsConfig && !configured}
                  onChange={(value) =>
                    setDraft({ ...draft, methods: { ...draft.methods, [method]: value } })
                  }
                  label={t(`admin.access.method.${method}`)}
                  hint={
                    needsConfig && !configured
                      ? t('admin.access.notConfigured')
                      : t(`admin.access.methodHint.${method}`)
                  }
                />

                {method === 'google' && (
                  <div className="mb-3 ml-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-slate-50 px-2 py-1 font-mono text-xs">
                      {draft.googleRedirectUri}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(draft.googleRedirectUri)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
                      aria-label={t('common.copy')}
                    >
                      <Copy className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-semibold">{t('admin.access.registration')}</h2>
        <p className="mb-3 text-sm text-slate-500">{t('admin.access.registrationHint')}</p>

        <div className="space-y-2">
          {MODES.map((mode) => (
            <label
              key={mode}
              className={
                draft.registrationMode === mode
                  ? 'flex cursor-pointer gap-3 rounded-xl border border-brand bg-brand-soft p-3'
                  : 'flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 hover:border-slate-300'
              }
            >
              <input
                type="radio"
                name="registrationMode"
                checked={draft.registrationMode === mode}
                onChange={() => setDraft({ ...draft, registrationMode: mode })}
                className="mt-1 size-4"
              />
              <span>
                <span className="block text-sm font-medium">
                  {t(`admin.access.mode.${mode}`)}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {t(`admin.access.modeHint.${mode}`)}
                </span>
              </span>
            </label>
          ))}
        </div>

        <div className="mt-4 divide-y divide-slate-100">
          <Switch
            checked={draft.autoProvisionCertificate}
            onChange={(value) => setDraft({ ...draft, autoProvisionCertificate: value })}
            label={t('admin.access.autoProvisionCertificate')}
            hint={t('admin.access.autoProvisionCertificateHint')}
          />
          <Switch
            checked={draft.autoProvisionSocial}
            onChange={(value) => setDraft({ ...draft, autoProvisionSocial: value })}
            label={t('admin.access.autoProvisionSocial')}
            hint={t('admin.access.autoProvisionSocialHint')}
          />
          <Switch
            checked={draft.allowAnonymousBooking}
            onChange={(value) => setDraft({ ...draft, allowAnonymousBooking: value })}
            label={t('admin.access.allowAnonymousBooking')}
            hint={t('admin.access.allowAnonymousBookingHint')}
          />
          <Switch
            checked={draft.mfaRequiredForAdmins}
            onChange={(value) => setDraft({ ...draft, mfaRequiredForAdmins: value })}
            label={t('admin.access.mfaRequiredForAdmins')}
          />
          <Switch
            checked={draft.allowOrganizationSelfService}
            onChange={(value) => setDraft({ ...draft, allowOrganizationSelfService: value })}
            label={t('admin.access.allowOrganizationSelfService')}
            hint={t('admin.access.allowOrganizationSelfServiceHint')}
          />
        </div>

        <Field
          label={t('admin.access.allowedDomains')}
          hint={t('admin.access.allowedDomainsHint')}
          className="mt-4"
        >
          <Input
            value={draft.allowedEmailDomains.join(', ')}
            placeholder="ejemplo.es, otraempresa.com"
            onChange={(event) =>
              setDraft({
                ...draft,
                allowedEmailDomains: event.target.value
                  .split(/[\s,;]+/)
                  .map((value) => value.trim())
                  .filter(Boolean),
              })
            }
          />
        </Field>

        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {t('common.save')}
        </Button>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function AllowlistTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState({ type: 'email' as const, values: '', note: '' });

  const entries = useQuery({
    queryKey: ['allowlist', search],
    queryFn: () =>
      api.get<AllowlistEntry[]>('/admin/allowlist', { query: { search: search || undefined } }),
  });

  const add = useMutation({
    mutationFn: () =>
      api.post<{ added: number; skipped: number }>('/admin/allowlist/bulk', {
        type: draft.type,
        values: draft.values,
        note: draft.note || undefined,
      }),
    onSuccess: () => {
      setOpen(false);
      setDraft({ type: 'email', values: '', note: '' });
      void queryClient.invalidateQueries({ queryKey: ['allowlist'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/allowlist/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['allowlist'] }),
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Field label={t('common.search')} className="mb-0 w-64">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
          {t('common.add')}
        </Button>
      </div>

      <p className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        {t('admin.access.allowlistHint')}
      </p>

      <ErrorMessage error={remove.error} />
      {entries.isLoading && <LoadingBlock rows={3} />}

      {add.data && (
        <SuccessMessage>
          {t('admin.access.bulkResult', { added: add.data.added, skipped: add.data.skipped })}
        </SuccessMessage>
      )}

      <ul className="divide-y divide-slate-100">
        {entries.data?.map((entry) => (
          <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="flex items-center gap-2">
                <Badge className="bg-slate-100 text-slate-600">
                  {t(`admin.access.allowlistType.${entry.type}`)}
                </Badge>
                <span className="truncate font-mono text-sm">{entry.value}</span>
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {entry.note}
                {entry.organizationName && ` · ${entry.organizationName}`}
                {entry.usedAt && ` · ${t('admin.access.used')} ${formatDateTime(entry.usedAt, 'es')}`}
              </span>
            </span>
            <button
              type="button"
              className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
              aria-label={t('common.delete')}
              onClick={() => remove.mutate(entry.id)}
            >
              <Trash2 className="size-4" />
            </button>
          </li>
        ))}
        {entries.data?.length === 0 && (
          <p className="py-4 text-sm text-slate-500">{t('common.empty')}</p>
        )}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin.access.addToAllowlist')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={add.isPending} onClick={() => add.mutate()}>
              {t('common.add')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={add.error} />

        <Field label={t('admin.access.allowlistTypeLabel')}>
          <Select
            value={draft.type}
            onChange={(event) =>
              setDraft({ ...draft, type: event.target.value as typeof draft.type })
            }
          >
            <option value="email">{t('admin.access.allowlistType.email')}</option>
            <option value="domain">{t('admin.access.allowlistType.domain')}</option>
            <option value="nif">{t('admin.access.allowlistType.nif')}</option>
          </Select>
        </Field>

        <Field label={t('admin.access.values')} hint={t('admin.access.valuesHint')}>
          <Textarea
            rows={6}
            value={draft.values}
            onChange={(event) => setDraft({ ...draft, values: event.target.value })}
            placeholder={
              draft.type === 'email'
                ? 'ana@ejemplo.es\nluis@ejemplo.es'
                : draft.type === 'domain'
                  ? 'ejemplo.es'
                  : '12345678Z\nX1234567L'
            }
            className="font-mono text-sm"
          />
        </Field>

        <Field label={t('admin.schedules.reason')} className="mb-0">
          <Input
            value={draft.note}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </Field>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

function UsersTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; activationUrl: string } | null>(null);
  const [draft, setDraft] = useState({
    email: '',
    name: '',
    nif: '',
    platformRole: 'user',
    sendInvitation: true,
  });

  const users = useQuery({
    queryKey: ['platform-users', search],
    queryFn: () =>
      api.get<{ items: PlatformUser[]; total: number }>('/admin/users', {
        query: { search: search || undefined, pageSize: 100 },
      }),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ email: string; activationUrl: string }>('/admin/users', {
        email: draft.email,
        name: draft.name,
        nif: draft.nif || undefined,
        platformRole: draft.platformRole,
        sendInvitation: draft.sendInvitation,
      }),
    onSuccess: (data) => {
      setCreated(data);
      setOpen(false);
      setDraft({ email: '', name: '', nif: '', platformRole: 'user', sendInvitation: true });
      void queryClient.invalidateQueries({ queryKey: ['platform-users'] });
    },
  });

  const resend = useMutation({
    mutationFn: (id: string) =>
      api.post<{ email: string; activationUrl: string }>(`/admin/users/${id}/resend-activation`),
    onSuccess: (data) => setCreated(data),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/admin/users/${id}`, patch),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['platform-users'] }),
  });

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Field label={t('common.search')} className="mb-0 w-64">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} />
        </Field>
        <Button icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>
          {t('admin.access.createUser')}
        </Button>
      </div>

      {created && (
        <SuccessMessage>
          <p className="mb-2">{t('admin.access.activationLink', { email: created.email })}</p>
          <code className="block break-all rounded-lg bg-white/70 p-2 font-mono text-xs">
            {created.activationUrl}
          </code>
          <Button
            variant="ghost"
            className="mt-1"
            icon={<Copy className="size-4" />}
            onClick={() => void navigator.clipboard.writeText(created.activationUrl)}
          >
            {t('common.copy')}
          </Button>
        </SuccessMessage>
      )}

      <ErrorMessage error={update.error ?? resend.error} />
      {users.isLoading && <LoadingBlock rows={4} />}

      <ul className="divide-y divide-slate-100">
        {users.data?.items.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{user.name}</span>
                {user.platformRole === 'superadmin' && (
                  <Badge className="bg-indigo-100 text-indigo-800">
                    {t('admin.access.platformAdmin')}
                  </Badge>
                )}
                {user.status === 'pending' && (
                  <Badge className="bg-amber-100 text-amber-800">
                    {t('admin.access.pending')}
                  </Badge>
                )}
                {user.status === 'blocked' && (
                  <Badge className="bg-red-100 text-red-700">{t('admin.access.blocked')}</Badge>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-slate-500">
                {user.email}
                {user.nif && ` · ${user.nif}`}
                {user.lastLoginAt &&
                  ` · ${t('admin.access.lastLogin')} ${formatDateTime(user.lastLoginAt, locale)}`}
              </span>
            </span>

            <span className="flex items-center gap-1">
              {user.status === 'pending' && (
                <Button
                  variant="ghost"
                  icon={<Mail className="size-4" />}
                  loading={resend.isPending}
                  onClick={() => resend.mutate(user.id)}
                >
                  {t('admin.access.resend')}
                </Button>
              )}

              <Select
                value={user.platformRole}
                className="max-w-40"
                aria-label={t('admin.team.role')}
                onChange={(event) =>
                  update.mutate({ id: user.id, patch: { platformRole: event.target.value } })
                }
              >
                <option value="user">{t('admin.access.roleUser')}</option>
                <option value="superadmin">{t('admin.access.platformAdmin')}</option>
              </Select>

              <Button
                variant="ghost"
                icon={<RefreshCw className="size-4" />}
                onClick={() =>
                  update.mutate({
                    id: user.id,
                    patch: { status: user.status === 'blocked' ? 'active' : 'blocked' },
                  })
                }
              >
                {user.status === 'blocked' ? t('admin.access.unblock') : t('admin.access.block')}
              </Button>
            </span>
          </li>
        ))}
      </ul>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin.access.createUser')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <ErrorMessage error={create.error} />
        <p className="mb-4 text-sm text-slate-500">{t('admin.access.createUserHint')}</p>

        <Field label={t('auth.name')} required>
          <Input
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>

        <Field label={t('auth.email')} required>
          <Input
            type="email"
            value={draft.email}
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
          />
        </Field>

        <Field label="DNI / NIE" hint={t('admin.access.nifHint')}>
          <Input
            value={draft.nif}
            onChange={(event) => setDraft({ ...draft, nif: event.target.value.toUpperCase() })}
          />
        </Field>

        <Field label={t('admin.team.role')}>
          <Select
            value={draft.platformRole}
            onChange={(event) => setDraft({ ...draft, platformRole: event.target.value })}
          >
            <option value="user">{t('admin.access.roleUser')}</option>
            <option value="superadmin">{t('admin.access.platformAdmin')}</option>
          </Select>
        </Field>

        <Switch
          checked={draft.sendInvitation}
          onChange={(value) => setDraft({ ...draft, sendInvitation: value })}
          label={t('admin.access.sendInvitation')}
          hint={t('admin.access.sendInvitationHint')}
        />
      </Modal>
    </Card>
  );
}
