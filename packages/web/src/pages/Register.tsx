import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../stores/auth.ts';
import { AuthLayout } from '../components/layout.tsx';
import { Button, Card, ErrorMessage, Field, Input } from '../components/ui.tsx';

export default function Register() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const register = useAuth((state) => state.register);

  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', repeat: '' });
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = form.repeat.length > 0 && form.password !== form.repeat;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (mismatch || !accepted) return;

    setError(null);
    setBusy(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
        acceptTerms: true,
      });
      navigate(searchParams.get('volver') ?? '/mis-citas', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <h1 className="mb-4 text-lg font-semibold">{t('auth.signUp')}</h1>
        <ErrorMessage error={error} />

        <form onSubmit={submit}>
          <Field label={t('auth.name')} required>
            <Input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              autoComplete="name"
              required
              minLength={2}
            />
          </Field>

          <Field label={t('auth.email')} required>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
              autoComplete="email"
              required
            />
          </Field>

          <Field label={`${t('auth.phone')} (${t('common.optional')})`}>
            <Input
              type="tel"
              value={form.phone}
              onChange={(event) => setForm({ ...form, phone: event.target.value })}
              autoComplete="tel"
            />
          </Field>

          <Field label={t('auth.password')} required hint="Mínimo 10 caracteres">
            <Input
              type="password"
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              autoComplete="new-password"
              required
              minLength={10}
            />
          </Field>

          <Field
            label={t('auth.confirmPassword')}
            required
            error={mismatch ? t('auth.confirmPassword') : undefined}
          >
            <Input
              type="password"
              value={form.repeat}
              onChange={(event) => setForm({ ...form, repeat: event.target.value })}
              autoComplete="new-password"
              required
            />
          </Field>

          <label className="mb-4 flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300"
              required
            />
            {t('auth.acceptTerms')}
          </label>

          <Button type="submit" fullWidth loading={busy} disabled={!accepted || mismatch}>
            {t('auth.signUp')}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-slate-500">
          {t('auth.hasAccount')}{' '}
          <Link to="/entrar" className="text-brand hover:underline">
            {t('auth.signIn')}
          </Link>
        </p>
      </Card>
    </AuthLayout>
  );
}
