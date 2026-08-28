import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { startRegistration } from '@simplewebauthn/browser';
import { Fingerprint, IdCard, Monitor, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../stores/auth.ts';
import { formatDateTime, formatLeadTime } from '../lib/format.ts';
import type { ReminderRule } from '../lib/types.ts';
import {
  Badge,
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  SuccessMessage,
  Tabs,
} from '../components/ui.tsx';

const CHANNELS = ['email', 'push', 'telegram', 'whatsapp'] as const;

/** Perfil del usuario: datos, seguridad, avisos y privacidad. */
export default function Profile() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('personal');

  return (
    <div>
      <PageHeader title={t('profile.title')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'personal', label: t('profile.personalData') },
          { id: 'security', label: t('profile.security') },
          { id: 'notifications', label: t('profile.notifications') },
          { id: 'privacy', label: t('profile.privacy') },
        ]}
      />

      {tab === 'personal' && <PersonalTab />}
      {tab === 'security' && <SecurityTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'privacy' && <PrivacyTab />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PersonalTab() {
  const { t, i18n } = useTranslation();
  const user = useAuth((state) => state.user);
  const reload = useAuth((state) => state.reload);
  const [form, setForm] = useState({
    name: user?.name ?? '',
    phone: user?.phone ?? '',
    locale: user?.locale ?? 'es',
    timezone: user?.timezone ?? 'Europe/Madrid',
  });
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.patch('/me', form),
    onSuccess: async () => {
      setSaved(true);
      await reload();
      if (form.locale !== i18n.language.slice(0, 2)) void i18n.changeLanguage(form.locale);
    },
  });

  const timezones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Europe/Madrid', 'Atlantic/Canary', 'UTC'];

  return (
    <Card>
      {saved && <SuccessMessage>{t('common.save')}</SuccessMessage>}
      <ErrorMessage error={mutation.error} />

      <Field label={t('auth.name')}>
        <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
      </Field>

      <Field label={t('auth.email')}>
        <Input value={user?.email ?? ''} disabled />
        {user && !user.emailVerified && (
          <button
            type="button"
            className="mt-1 text-xs text-brand hover:underline"
            onClick={() => void api.post('/auth/email/resend')}
          >
            {t('auth.verifyEmailSent')}
          </button>
        )}
      </Field>

      <DocumentField />

      <Field label={t('auth.phone')}>
        <Input
          type="tel"
          value={form.phone ?? ''}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />
      </Field>

      <Field label={t('common.language')}>
        <Select
          value={form.locale}
          onChange={(event) => setForm({ ...form, locale: event.target.value })}
        >
          <option value="es">Español</option>
          <option value="gl">Galego</option>
          <option value="en">English</option>
        </Select>
      </Field>

      <Field label={t('profile.timezone')}>
        <Select
          value={form.timezone}
          onChange={(event) => setForm({ ...form, timezone: event.target.value })}
        >
          {timezones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </Select>
      </Field>

      <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
        {t('common.save')}
      </Button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * El DNI de la cuenta, que no se escribe: se demuestra con el certificado.
 *
 * El acceso por DNIe busca cuenta por documento, así que un campo de texto
 * libre dejaría poner el DNI de otra persona y quedarse con su acceso cuando
 * esa persona entrara con su tarjeta. Vinculando el certificado, en cambio, el
 * documento llega probado, y a partir de ahí entrar con DNIe encuentra esta
 * cuenta en vez de crear una nueva.
 */
function DocumentField() {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const reload = useAuth((state) => state.reload);

  /*
   * El certificado no lo pide la aplicación, lo pide el servidor durante el
   * apretón de manos TLS. Sin HTTPS el navegador nunca llega a preguntar por
   * él, así que pulsar solo puede acabar en "no se ha recibido ningún
   * certificado". Misma regla que en la pantalla de acceso.
   */
  const posible = window.location.protocol === 'https:';

  const vincular = useMutation({
    mutationFn: () => api.post('/me/identities/certificate'),
    onSuccess: () => reload(),
  });

  if (user?.nif) {
    return (
      <Field label={t('profile.document')} hint={t('profile.documentVerified')}>
        <Input value={user.nif} disabled />
      </Field>
    );
  }

  /*
   * Sin documento no hay campo que rellenar, así que tampoco `Field`: lo que
   * hay es una acción. `Field` además etiqueta clonando a su único hijo, y aquí
   * son varios.
   */
  return (
    <div className="mb-4">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">
        {t('profile.document')}
      </span>
      <p className="mb-2 text-xs text-slate-500">{t('profile.documentHint')}</p>
      <ErrorMessage error={vincular.error} />
      <Button
        variant="secondary"
        disabled={!posible}
        loading={vincular.isPending}
        onClick={() => vincular.mutate()}
        icon={<IdCard className="size-4" />}
      >
        {t('profile.linkCertificate')}
      </Button>
      <p className="mt-1 text-xs text-slate-500">
        {posible ? t('profile.linkCertificateHelp') : t('auth.certificateNeedsHttps')}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SecurityTab() {
  const { t } = useTranslation();
  const user = useAuth((state) => state.user);
  const reload = useAuth((state) => state.reload);
  const queryClient = useQueryClient();

  const [passwords, setPasswords] = useState({ current: '', next: '' });
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [totpOpen, setTotpOpen] = useState(false);
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const passkeys = useQuery({
    queryKey: ['passkeys'],
    queryFn: () =>
      api.get<
        { id: string; deviceName: string | null; createdAt: string; lastUsedAt: string | null }[]
      >('/me/passkeys'),
  });

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () =>
      api.get<
        {
          id: string;
          userAgent: string | null;
          ip: string | null;
          method: string;
          current: boolean;
          lastUsedAt: string;
        }[]
      >('/me/sessions'),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api.post('/auth/password/change', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      }),
    onSuccess: () => {
      setPasswordSaved(true);
      setPasswords({ current: '', next: '' });
    },
  });

  const startTotp = useMutation({
    mutationFn: () => api.post<{ secret: string; uri: string }>('/auth/mfa/totp/start'),
    onSuccess: (data) => {
      setTotp(data);
      setTotpOpen(true);
    },
  });

  const confirmTotp = useMutation({
    mutationFn: () =>
      api.post<{ recoveryCodes: string[] }>('/auth/mfa/totp/confirm', { code: totpCode }),
    onSuccess: async (data) => {
      setRecoveryCodes(data.recoveryCodes);
      setTotpOpen(false);
      await reload();
    },
  });

  const addPasskey = useMutation({
    mutationFn: async () => {
      const start = await api.post<{ challengeId: string; options: never }>(
        '/auth/passkey/register/start',
      );
      const attestation = await startRegistration({ optionsJSON: start.options });
      return api.post('/auth/passkey/register/finish', {
        challengeId: start.challengeId,
        response: attestation,
        deviceName: navigator.platform || 'Este dispositivo',
      });
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['passkeys'] }),
  });

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 font-semibold">{t('profile.changePassword')}</h2>
        {passwordSaved && <SuccessMessage>{t('profile.passwordChanged')}</SuccessMessage>}
        <ErrorMessage error={changePassword.error} />
        <Field label={t('auth.currentPassword')}>
          <Input
            type="password"
            autoComplete="current-password"
            value={passwords.current}
            onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
          />
        </Field>
        <Field label={t('auth.newPassword')}>
          <Input
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={passwords.next}
            onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
          />
        </Field>
        <Button
          loading={changePassword.isPending}
          disabled={passwords.next.length < 10}
          onClick={() => changePassword.mutate()}
        >
          {t('common.save')}
        </Button>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t('profile.twoFactor')}</h2>
          <Badge className={user?.mfaEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100'}>
            {user?.mfaEnabled ? t('profile.twoFactorOn') : t('profile.twoFactorOff')}
          </Badge>
        </div>

        <ErrorMessage error={startTotp.error} />

        {recoveryCodes && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-2 text-sm font-medium text-amber-900">{t('profile.recoveryCodes')}</p>
            <p className="mb-3 text-xs text-amber-800">{t('profile.recoveryCodesHint')}</p>
            <ul className="grid grid-cols-2 gap-1 font-mono text-sm">
              {recoveryCodes.map((code) => (
                <li key={code}>{code}</li>
              ))}
            </ul>
          </div>
        )}

        {!user?.mfaEnabled && (
          <Button
            variant="secondary"
            loading={startTotp.isPending}
            onClick={() => startTotp.mutate()}
            icon={<ShieldCheck className="size-4" />}
          >
            {t('profile.enableTwoFactor')}
          </Button>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t('profile.passkeys')}</h2>
          <Button
            variant="secondary"
            loading={addPasskey.isPending}
            onClick={() => addPasskey.mutate()}
            icon={<Plus className="size-4" />}
          >
            {t('profile.addPasskey')}
          </Button>
        </div>
        <ErrorMessage error={addPasskey.error} />

        {(passkeys.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">{t('profile.noPasskeys')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {passkeys.data?.map((passkey) => (
              <li key={passkey.id} className="flex items-center justify-between py-2.5">
                <span className="flex items-center gap-2 text-sm">
                  <Fingerprint className="size-4 text-slate-400" aria-hidden />
                  {passkey.deviceName ?? 'Passkey'}
                </span>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('common.delete')}
                  onClick={() =>
                    void api
                      .delete(`/me/passkeys/${passkey.id}`)
                      .then(() => queryClient.invalidateQueries({ queryKey: ['passkeys'] }))
                  }
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t('profile.sessions')}</h2>
          <Button
            variant="ghost"
            onClick={() =>
              void api
                .post('/me/sessions/revoke-all')
                .then(() => queryClient.invalidateQueries({ queryKey: ['sessions'] }))
            }
          >
            {t('profile.closeOtherSessions')}
          </Button>
        </div>

        <ul className="divide-y divide-slate-100">
          {sessions.data?.map((session) => (
            <li key={session.id} className="flex items-start justify-between gap-3 py-2.5">
              <span className="min-w-0 text-sm">
                <span className="flex items-center gap-2 font-medium">
                  <Monitor className="size-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="truncate">{session.userAgent ?? session.method}</span>
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {session.ip} · {formatDateTime(session.lastUsedAt, 'es')}
                </span>
              </span>
              {session.current && (
                <Badge className="bg-emerald-100 text-emerald-800">
                  {t('profile.currentSession')}
                </Badge>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Modal
        open={totpOpen}
        onClose={() => setTotpOpen(false)}
        title={t('profile.twoFactor')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setTotpOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={confirmTotp.isPending} onClick={() => confirmTotp.mutate()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-slate-600">{t('profile.twoFactorScan')}</p>
        {totp && (
          <>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(totp.uri)}`}
              alt=""
              className="mx-auto mb-3 size-48 rounded-xl border border-slate-200"
              onError={(event) => {
                // Sin acceso a internet el QR externo falla; la clave manual
                // siempre funciona, así que se oculta la imagen y ya está.
                event.currentTarget.style.display = 'none';
              }}
            />
            <p className="mb-1 text-xs text-slate-500">{t('profile.twoFactorManual')}</p>
            <p className="mb-4 break-all rounded-lg bg-slate-100 p-2 font-mono text-sm">
              {totp.secret}
            </p>
          </>
        )}
        <ErrorMessage error={confirmTotp.error} />
        <Field label={t('profile.twoFactorConfirm')}>
          <Input
            value={totpCode}
            onChange={(event) => setTotpCode(event.target.value)}
            inputMode="numeric"
            maxLength={6}
            className="text-center text-2xl tracking-[0.3em]"
          />
        </Field>
      </Modal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function NotificationsTab() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language.slice(0, 2);
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const rules = useQuery({
    queryKey: ['my-reminders'],
    queryFn: () => api.get<ReminderRule[]>('/me/reminder-rules'),
  });

  const [draft, setDraft] = useState<ReminderRule[] | null>(null);
  const current = draft ?? rules.data ?? [];

  const save = useMutation({
    mutationFn: () => api.put('/me/reminder-rules', { rules: current }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['my-reminders'] });
    },
  });

  const telegram = useMutation({
    mutationFn: () =>
      api.post<{ code: string; instructions: string }>('/me/messaging/telegram/code'),
  });

  const update = (index: number, patch: Partial<ReminderRule>) => {
    setDraft(current.map((rule, position) => (position === index ? { ...rule, ...patch } : rule)));
  };

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 font-semibold">{t('profile.reminders')}</h2>
        <p className="mb-4 text-sm text-slate-500">{t('profile.remindersHint')}</p>

        {saved && <SuccessMessage>{t('common.save')}</SuccessMessage>}
        <ErrorMessage error={save.error} />

        <ul className="mb-4 space-y-3">
          {current.map((rule, index) => (
            <li key={index} className="rounded-xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Select
                  value={rule.offsetMinutes}
                  onChange={(event) => update(index, { offsetMinutes: Number(event.target.value) })}
                  className="max-w-48"
                >
                  {[15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {formatLeadTime(minutes, locale)}
                    </option>
                  ))}
                </Select>
                <button
                  type="button"
                  className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label={t('common.delete')}
                  onClick={() => setDraft(current.filter((_, position) => position !== index))}
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
                        update(index, {
                          channels: event.target.checked
                            ? [...rule.channels, channel]
                            : rule.channels.filter((item) => item !== channel),
                        })
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
            onClick={() =>
              setDraft([...current, { offsetMinutes: 60, channels: ['email'], enabled: true }])
            }
          >
            {t('profile.addReminder')}
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 font-semibold">Telegram</h2>
        {telegram.data ? (
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-sm text-slate-600">{t('profile.telegramCode')}</p>
            <p className="mt-1 font-mono text-2xl font-bold tracking-widest">{telegram.data.code}</p>
            <p className="mt-2 text-xs text-slate-500">{telegram.data.instructions}</p>
          </div>
        ) : (
          <Button
            variant="secondary"
            loading={telegram.isPending}
            onClick={() => telegram.mutate()}
            icon={<Send className="size-4" />}
          >
            {t('profile.linkTelegram')}
          </Button>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function PrivacyTab() {
  const { t } = useTranslation();
  const logout = useAuth((state) => state.logout);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const remove = useMutation({
    mutationFn: () => api.delete('/me', { body: { confirm: true } } as never),
    onSuccess: () => void logout(),
  });

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 font-semibold">{t('profile.exportData')}</h2>
        <p className="mb-3 text-sm text-slate-500">
          Descarga en JSON toda la información asociada a tu cuenta.
        </p>
        <Button variant="secondary" onClick={() => void api.download('/me/export', 'mis-datos.json')}>
          {t('common.download')}
        </Button>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold text-red-700">{t('profile.deleteAccount')}</h2>
        <p className="mb-3 text-sm text-slate-500">{t('profile.deleteAccountWarning')}</p>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          {t('profile.deleteAccount')}
        </Button>
      </Card>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={t('profile.deleteAccount')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">{t('profile.deleteAccountWarning')}</p>
        <ErrorMessage error={remove.error} />
      </Modal>
    </div>
  );
}
