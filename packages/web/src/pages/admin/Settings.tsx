import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../stores/auth.ts';
import PagesTab from './Pages.tsx';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  LoadingBlock,
  PageHeader,
  Select,
  SuccessMessage,
  Switch,
  Tabs,
} from '../../components/ui.tsx';
import { Combobox } from '../../components/combobox.tsx';
import { CutoffSelect } from '../../components/cutoff-select.tsx';

interface OrganizationView {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  locale: string;
  currency: string;
  email: string | null;
  phone: string | null;
  settings: Record<string, any>;
}

const STRATEGIES = ['least_gap', 'least_busy', 'round_robin', 'first_available'] as const;

/** Ajustes de la organización: generales, reservas, acceso, marca y pagos. */
export default function Settings() {
  const { t } = useTranslation();
  const [tab, setTab] = useState('general');
  const organizationId = useAuth((state) => state.activeOrganizationId);

  const organization = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['organization', organizationId],
    queryFn: () => api.get<OrganizationView>(`/organizations/${organizationId}`),
  });

  return (
    <div>
      <PageHeader title={t('admin.settings.title')} />
      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'general', label: t('admin.settings.general') },
          { id: 'booking', label: t('admin.settings.booking') },
          { id: 'access', label: t('admin.settings.access') },
          { id: 'pages', label: t('admin.settings.pages') },
          { id: 'payments', label: t('admin.settings.payments') },
        ]}
      />
      {tab === 'payments' && <PaymentsTab />}
      {tab === 'pages' && <PagesTab slug={organization.data?.slug ?? null} />}
      {tab !== 'payments' && tab !== 'pages' && <OrganizationTab section={tab} />}
    </div>
  );
}

function OrganizationTab({ section }: { section: string }) {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<OrganizationView | null>(null);
  const [saved, setSaved] = useState(false);

  const organization = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['organization', organizationId],
    queryFn: () => api.get<OrganizationView>(`/organizations/${organizationId}`),
  });

  useEffect(() => {
    if (organization.data) setDraft(organization.data);
  }, [organization.data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/organizations/${organizationId}`, {
        name: draft!.name,
        timezone: draft!.timezone,
        locale: draft!.locale,
        currency: draft!.currency,
        email: draft!.email ?? undefined,
        phone: draft!.phone ?? undefined,
        settings: draft!.settings,
      }),
    onSuccess: () => {
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });

  if (!draft) return <LoadingBlock rows={3} />;

  const setSetting = (key: string, value: unknown) =>
    setDraft({ ...draft, settings: { ...draft.settings, [key]: value } });

  const timezones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Europe/Madrid', 'Atlantic/Canary'];

  return (
    <Card>
      {saved && <SuccessMessage>{t('common.save')}</SuccessMessage>}
      <ErrorMessage error={save.error} />

      {section === 'general' && (
        <>
          <Field label={t('admin.services.name')}>
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('profile.timezone')}>
              <Combobox
                value={draft.timezone}
                options={timezones.map((zone) => ({ id: zone, label: zone }))}
                onChange={(zone) => setDraft({ ...draft, timezone: zone ?? draft.timezone })}
              />
            </Field>

            <Field label={t('common.language')}>
              <Select
                value={draft.locale}
                onChange={(event) => setDraft({ ...draft, locale: event.target.value })}
              >
                <option value="es">Español</option>
                <option value="gl">Galego</option>
                <option value="en">English</option>
              </Select>
            </Field>

            <Field label="Moneda">
              <Select
                value={draft.currency}
                onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
                <option value="GBP">GBP</option>
              </Select>
            </Field>

            <Field label={t('admin.settings.brandColor')}>
              <Input
                type="color"
                value={draft.settings.brandColor ?? '#2563eb'}
                onChange={(event) => setSetting('brandColor', event.target.value)}
                className="h-11 p-1"
              />
            </Field>

            <Field label={t('auth.email')}>
              <Input
                type="email"
                value={draft.email ?? ''}
                onChange={(event) => setDraft({ ...draft, email: event.target.value })}
              />
            </Field>

            <Field label={t('auth.phone')}>
              <Input
                type="tel"
                value={draft.phone ?? ''}
                onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
              />
            </Field>
          </div>
        </>
      )}

      {section === 'booking' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('admin.settings.holdMinutes')}>
              <Input
                type="number"
                min={1}
                max={60}
                value={draft.settings.holdMinutes ?? 10}
                onChange={(event) => setSetting('holdMinutes', Number(event.target.value))}
              />
            </Field>

            <Field label={t('admin.settings.slotGranularity')}>
              <Select
                value={draft.settings.slotGranularityMinutes ?? 15}
                onChange={(event) =>
                  setSetting('slotGranularityMinutes', Number(event.target.value))
                }
              >
                {[5, 10, 15, 20, 30, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('admin.settings.allocationStrategy')}>
              <Select
                value={draft.settings.allocationStrategy ?? 'least_gap'}
                onChange={(event) => setSetting('allocationStrategy', event.target.value)}
              >
                {STRATEGIES.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {t(`admin.settings.strategies.${strategy}`)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('admin.settings.maxActive')}>
              <Input
                type="number"
                min={0}
                value={draft.settings.maxActiveAppointmentsPerCustomer ?? 0}
                onChange={(event) =>
                  setSetting('maxActiveAppointmentsPerCustomer', Number(event.target.value))
                }
              />
            </Field>

            <Field label={t('admin.settings.noShowThreshold')}>
              <Input
                type="number"
                min={0}
                value={draft.settings.noShowBlockThreshold ?? 0}
                onChange={(event) => setSetting('noShowBlockThreshold', Number(event.target.value))}
              />
            </Field>

            <Field label={`${t('admin.settings.autoNoShow')} (min)`}>
              <Input
                type="number"
                min={0}
                value={draft.settings.autoNoShowAfterMinutes ?? 0}
                onChange={(event) =>
                  setSetting('autoNoShowAfterMinutes', Number(event.target.value))
                }
              />
            </Field>

            <Field label={t('admin.rules.noShowFee')} hint={t('admin.rules.noShowFeeHint')}>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={(draft.settings.noShowFeeCents ?? 0) / 100}
                onChange={(event) =>
                  setSetting('noShowFeeCents', Math.round(Number(event.target.value) * 100))
                }
              />
            </Field>

            <Field label={t('admin.rules.minAdvance')} hint={t('admin.rules.minAdvanceHint')}>
              <CutoffSelect
                value={draft.settings.minAdvanceMinutes ?? 0}
                onChange={(value) => setSetting('minAdvanceMinutes', value ?? 0)}
              />
            </Field>

            <Field label={t('admin.rules.cancelCutoff')} hint={t('admin.rules.cancelCutoffHint')}>
              <CutoffSelect
                value={draft.settings.cancellationCutoffMinutes ?? 0}
                onChange={(value) => setSetting('cancellationCutoffMinutes', value ?? 0)}
              />
            </Field>

            <Field label={t('admin.rules.chargeMode')} hint={t('admin.rules.chargeModeHint')}>
              <Select
                value={draft.settings.creditChargeMode ?? 'booking'}
                onChange={(event) => setSetting('creditChargeMode', event.target.value)}
              >
                <option value="booking">{t('admin.rules.chargeBooking')}</option>
                <option value="completion">{t('admin.rules.chargeCompletion')}</option>
              </Select>
            </Field>

            <Switch
              checked={draft.settings.allowCreditDebt === true}
              onChange={(value) => setSetting('allowCreditDebt', value)}
              label={t('admin.rules.allowDebt')}
              hint={t('admin.rules.allowDebtHint')}
            />

            {draft.settings.allowCreditDebt === true && (
              <Field label={t('admin.rules.maxDebt')}>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={draft.settings.maxCreditDebt ?? 2}
                  onChange={(event) => setSetting('maxCreditDebt', Number(event.target.value))}
                />
              </Field>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            <Switch
              checked={draft.settings.publicBookingEnabled !== false}
              onChange={(value) => setSetting('publicBookingEnabled', value)}
              label={t('admin.settings.publicBooking')}
            />
            <Switch
              checked={draft.settings.allowGuestBooking === true}
              onChange={(value) => setSetting('allowGuestBooking', value)}
              label={t('admin.settings.allowGuestBooking')}
            />
            <Switch
              checked={draft.settings.requireVerifiedEmail !== false}
              onChange={(value) => setSetting('requireVerifiedEmail', value)}
              label={t('admin.settings.requireVerifiedEmail')}
            />
            <Switch
              checked={draft.settings.showResourceNames !== false}
              onChange={(value) => setSetting('showResourceNames', value)}
              label={t('admin.settings.showResourceNames')}
            />
            <Switch
              checked={draft.settings.waitlistEnabled !== false}
              onChange={(value) => setSetting('waitlistEnabled', value)}
              label={t('admin.settings.waitlistEnabled')}
            />
            <Switch
              checked={draft.settings.reviewsEnabled !== false}
              onChange={(value) => setSetting('reviewsEnabled', value)}
              label={t('admin.settings.reviewsEnabled')}
            />
            <Switch
              checked={draft.settings.attendanceConfirmationEnabled === true}
              onChange={(value) => setSetting('attendanceConfirmationEnabled', value)}
              label={t('admin.rules.attendanceConfirmation')}
              hint={t('admin.rules.attendanceConfirmationHint')}
            />
          </div>
        </>
      )}

      {section === 'access' && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={`${t('admin.settings.accessGraceBefore')} (min)`}>
              <Input
                type="number"
                min={0}
                value={draft.settings.accessGraceBeforeMinutes ?? 15}
                onChange={(event) =>
                  setSetting('accessGraceBeforeMinutes', Number(event.target.value))
                }
              />
            </Field>
            <Field label={`${t('admin.settings.accessGraceAfter')} (min)`}>
              <Input
                type="number"
                min={0}
                value={draft.settings.accessGraceAfterMinutes ?? 15}
                onChange={(event) =>
                  setSetting('accessGraceAfterMinutes', Number(event.target.value))
                }
              />
            </Field>
          </div>
          <Switch
            checked={draft.settings.accessSingleUse === true}
            onChange={(value) => setSetting('accessSingleUse', value)}
            label={t('admin.settings.accessSingleUse')}
          />
        </>
      )}

      <Button className="mt-4" loading={save.isPending} onClick={() => save.mutate()}>
        {t('common.save')}
      </Button>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */

interface PaymentSettingsView {
  enabled: boolean;
  defaultProvider: string;
  stripe: { configured: boolean; publishableKey: string | null; webhookConfigured: boolean };
  redsys: { configured: boolean; merchantCode: string | null; terminal: string; environment: string };
}

function PaymentsTab() {
  const { t } = useTranslation();
  const organizationId = useAuth((state) => state.activeOrganizationId);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({
    enabled: false,
    defaultProvider: 'stripe',
    stripeSecretKey: '',
    stripePublishableKey: '',
    stripeWebhookSecret: '',
    redsysMerchantCode: '',
    redsysTerminal: '001',
    redsysSecretKey: '',
    redsysEnvironment: 'test',
  });

  const settings = useQuery({
    enabled: Boolean(organizationId),
    queryKey: ['payment-settings', organizationId],
    queryFn: () =>
      api.get<PaymentSettingsView>(`/organizations/${organizationId}/payments/settings`),
  });

  useEffect(() => {
    if (settings.data) {
      setForm((current) => ({
        ...current,
        enabled: settings.data.enabled,
        defaultProvider: settings.data.defaultProvider,
        stripePublishableKey: settings.data.stripe.publishableKey ?? '',
        redsysMerchantCode: settings.data.redsys.merchantCode ?? '',
        redsysTerminal: settings.data.redsys.terminal,
        redsysEnvironment: settings.data.redsys.environment,
      }));
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/organizations/${organizationId}/payments/settings`, {
        enabled: form.enabled,
        defaultProvider: form.defaultProvider,
        stripe: {
          publishableKey: form.stripePublishableKey || undefined,
          secretKey: form.stripeSecretKey || undefined,
          webhookSecret: form.stripeWebhookSecret || undefined,
        },
        redsys: {
          merchantCode: form.redsysMerchantCode || undefined,
          terminal: form.redsysTerminal,
          secretKey: form.redsysSecretKey || undefined,
          environment: form.redsysEnvironment,
        },
      }),
    onSuccess: () => setSaved(true),
  });

  return (
    <Card>
      {saved && <SuccessMessage>{t('common.save')}</SuccessMessage>}
      <ErrorMessage error={save.error} />

      <Switch
        checked={form.enabled}
        onChange={(value) => setForm({ ...form, enabled: value })}
        label={t('admin.settings.payments')}
      />

      <Field label="Pasarela por defecto" className="mt-3">
        <Select
          value={form.defaultProvider}
          onChange={(event) => setForm({ ...form, defaultProvider: event.target.value })}
        >
          <option value="stripe">Stripe</option>
          <option value="redsys">Redsys</option>
          <option value="manual">Manual</option>
        </Select>
      </Field>

      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">Stripe</legend>
        <Field label="Clave publicable">
          <Input
            value={form.stripePublishableKey}
            onChange={(event) => setForm({ ...form, stripePublishableKey: event.target.value })}
            placeholder="pk_live_…"
          />
        </Field>
        <Field
          label="Clave secreta"
          hint={settings.data?.stripe.configured ? 'Ya configurada; deja vacío para no cambiarla' : undefined}
        >
          <Input
            type="password"
            value={form.stripeSecretKey}
            onChange={(event) => setForm({ ...form, stripeSecretKey: event.target.value })}
            placeholder="sk_live_…"
          />
        </Field>
        <Field label="Secreto del webhook" className="mb-0">
          <Input
            type="password"
            value={form.stripeWebhookSecret}
            onChange={(event) => setForm({ ...form, stripeWebhookSecret: event.target.value })}
            placeholder="whsec_…"
          />
        </Field>
      </fieldset>

      <fieldset className="mb-4 rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-sm font-semibold">Redsys</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código de comercio" className="mb-0">
            <Input
              value={form.redsysMerchantCode}
              onChange={(event) => setForm({ ...form, redsysMerchantCode: event.target.value })}
            />
          </Field>
          <Field label="Terminal" className="mb-0">
            <Input
              value={form.redsysTerminal}
              onChange={(event) => setForm({ ...form, redsysTerminal: event.target.value })}
            />
          </Field>
          <Field label="Clave secreta" className="mb-0">
            <Input
              type="password"
              value={form.redsysSecretKey}
              onChange={(event) => setForm({ ...form, redsysSecretKey: event.target.value })}
            />
          </Field>
          <Field label="Entorno" className="mb-0">
            <Select
              value={form.redsysEnvironment}
              onChange={(event) => setForm({ ...form, redsysEnvironment: event.target.value })}
            >
              <option value="test">Pruebas</option>
              <option value="live">Producción</option>
            </Select>
          </Field>
        </div>
      </fieldset>

      <Button loading={save.isPending} onClick={() => save.mutate()}>
        {t('common.save')}
      </Button>
    </Card>
  );
}
