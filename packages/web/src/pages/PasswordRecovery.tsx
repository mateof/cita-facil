import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api.ts';
import { AuthLayout } from '../components/layout.tsx';
import { Button, Card, ErrorMessage, Field, Input, SuccessMessage } from '../components/ui.tsx';

/** Solicitud de restablecimiento de contraseña. */
export function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/forgot', { email });
      setSent(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <h1 className="mb-4 text-lg font-semibold">{t('auth.resetPassword')}</h1>
        <ErrorMessage error={error} />

        {sent ? (
          <>
            <SuccessMessage>{t('auth.resetSent')}</SuccessMessage>
            <Link to="/entrar" className="text-sm text-brand hover:underline">
              {t('auth.signIn')}
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <Field label={t('auth.email')} required>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </Field>
            <Button type="submit" fullWidth loading={busy}>
              {t('common.confirm')}
            </Button>
          </form>
        )}
      </Card>
    </AuthLayout>
  );
}

/** Fijar una contraseña nueva a partir del enlace recibido por correo. */
export function ResetPassword() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== repeat) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/password/reset', { token, password });
      setDone(true);
      setTimeout(() => navigate('/entrar'), 2000);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <Card>
        <h1 className="mb-4 text-lg font-semibold">{t('auth.resetPassword')}</h1>
        <ErrorMessage error={error} />

        {done ? (
          <SuccessMessage>{t('profile.passwordChanged')}</SuccessMessage>
        ) : (
          <form onSubmit={submit}>
            <Field label={t('auth.newPassword')} required>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={10}
                required
              />
            </Field>
            <Field label={t('auth.confirmPassword')} required>
              <Input
                type="password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                autoComplete="new-password"
                required
              />
            </Field>
            <Button type="submit" fullWidth loading={busy} disabled={password !== repeat}>
              {t('common.save')}
            </Button>
          </form>
        )}
      </Card>
    </AuthLayout>
  );
}

/** Confirmación de la dirección de correo desde el enlace del mensaje. */
export function VerifyEmail() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setState('error');
      return;
    }
    api
      .post('/auth/email/verify', { token })
      .then(() => setState('ok'))
      .catch((caught) => {
        setError(caught);
        setState('error');
      });
  }, [searchParams]);

  return (
    <AuthLayout>
      <Card className="text-center">
        <h1 className="mb-4 text-lg font-semibold">{t('auth.verifyEmailTitle')}</h1>
        {state === 'loading' && <p className="text-slate-500">{t('common.loading')}</p>}
        {state === 'ok' && <SuccessMessage>{t('auth.verifyEmailDone')}</SuccessMessage>}
        {state === 'error' && <ErrorMessage error={error ?? { code: 'not_found' }} />}
        <Link to="/entrar" className="text-sm text-brand hover:underline">
          {t('auth.signIn')}
        </Link>
      </Card>
    </AuthLayout>
  );
}
