import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Building2 } from 'lucide-react';
import { api } from '../lib/api.ts';
import { useAuth } from '../stores/auth.ts';
import { Button, Card, ErrorMessage, Field, Input, Select } from './ui.tsx';
import { TemplatePicker } from './template-picker.tsx';

/**
 * Primer arranque del panel: todavía no hay ninguna organización.
 *
 * Sin esto, un administrador recién creado se encontraba el panel en blanco y
 * sin ninguna pista de qué hacer, porque todas las pantallas dependen de una
 * organización activa.
 */
export default function FirstOrganization() {
  const { t, i18n } = useTranslation();
  const reload = useAuth((state) => state.reload);
  const setActiveOrganization = useAuth((state) => state.setActiveOrganization);

  const [form, setForm] = useState({
    name: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Madrid',
    locale: i18n.language.slice(0, 2),
    currency: 'EUR',
  });
  const [template, setTemplate] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/organizations', { ...form, template: template ?? undefined }),
    onSuccess: async (organization) => {
      await reload();
      setActiveOrganization(organization.id);
    },
  });

  const timezones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Europe/Madrid', 'Atlantic/Canary', 'UTC'];

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <div className="mb-4 flex items-start gap-3">
          <span className="rounded-xl bg-brand-soft p-2.5 text-brand">
            <Building2 className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-lg font-bold">{t('admin.firstOrganization.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">{t('admin.firstOrganization.help')}</p>
          </div>
        </div>

        <ErrorMessage error={create.error} />

        <Field label={t('admin.firstOrganization.name')} required>
          <Input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder={t('admin.firstOrganization.namePlaceholder')}
            autoFocus
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        <Field label={t('admin.templates.label')} hint={t('admin.templates.hint')}>
          <TemplatePicker value={template} onChange={setTemplate} />
        </Field>

        <Button
          fullWidth
          loading={create.isPending}
          disabled={form.name.trim().length < 2}
          onClick={() => create.mutate()}
        >
          {t('admin.firstOrganization.action')}
        </Button>

        <p className="mt-3 text-xs text-slate-500">{t('admin.firstOrganization.next')}</p>
      </Card>
    </div>
  );
}
