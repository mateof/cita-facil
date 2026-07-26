import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Fingerprint, IdCard, KeyRound, LogIn } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api, setAccessToken } from '../lib/api.ts';
import { useAuth } from '../stores/auth.ts';
import { AuthLayout } from '../components/layout.tsx';
import { Button, Card, ErrorMessage, Field, Input } from '../components/ui.tsx';
import type { AuthMethods, SessionUser } from '../lib/types.ts';

/**
 * Pantalla de acceso.
 *
 * Los métodos disponibles los dicta el servidor (`/auth/methods`), así que una
 * instalación que solo admita certificado no muestra el formulario de
 * contraseña, y al revés.
 */
export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('volver') ?? '/mis-citas';

  const login = useAuth((state) => state.login);
  const completeMfa = useAuth((state) => state.completeMfa);
  const loginWithCertificate = useAuth((state) => state.loginWithCertificate);
  const reload = useAuth((state) => state.reload);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [challenge, setChallenge] = useState<{
    id: string;
    methods: string[];
    hint: string | null;
  } | null>(null);
  const [code, setCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);

  // El retorno de Google o Cl@ve trae el motivo del fallo en la URL, porque la
  // redirección ocurre en el navegador y no hay respuesta JSON que mostrar.
  const externalError = searchParams.get('error');

  const { data: methods } = useQuery({
    queryKey: ['auth-methods'],
    queryFn: () => api.get<AuthMethods>('/auth/methods'),
  });

  const handlePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy('password');
    try {
      const response = await login(email, password);
      if (response.status === 'mfa_required') {
        setChallenge({ id: response.challengeId, methods: response.methods, hint: response.hint });
      } else {
        navigate(returnTo, { replace: true });
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  const handleMfa = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    setBusy('mfa');
    try {
      await completeMfa({
        challengeId: challenge.id,
        method: challenge.methods.includes('totp') ? 'totp' : 'email',
        code,
        rememberDevice,
      });
      navigate(returnTo, { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  const handlePasskey = async () => {
    setError(null);
    setBusy('passkey');
    try {
      const start = await api.post<{ challengeId: string; options: never }>(
        '/auth/passkey/authenticate/start',
        email ? { email } : {},
      );
      const assertion = await startAuthentication({ optionsJSON: start.options });
      const result = await api.post<{ tokens: { accessToken: string }; user: SessionUser }>(
        '/auth/passkey/authenticate/finish',
        { challengeId: start.challengeId, response: assertion },
      );
      setAccessToken(result.tokens.accessToken);
      await reload();
      navigate(returnTo, { replace: true });
    } catch (caught) {
      // Cancelar el diálogo del navegador no es un error que haya que mostrar.
      if ((caught as { name?: string }).name !== 'NotAllowedError') setError(caught);
    } finally {
      setBusy(null);
    }
  };

  const handleCertificate = async () => {
    setError(null);
    setBusy('certificate');
    try {
      await loginWithCertificate();
      navigate(returnTo, { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(null);
    }
  };

  if (challenge) {
    return (
      <AuthLayout>
        <Card>
          <h1 className="mb-1 text-lg font-semibold">{t('auth.mfaTitle')}</h1>
          <p className="mb-4 text-sm text-slate-500">
            {challenge.methods.includes('totp')
              ? t('auth.mfaHelp')
              : t('auth.mfaEmailHelp', { hint: challenge.hint ?? '' })}
          </p>

          <ErrorMessage error={error} />

          <form onSubmit={handleMfa}>
            <Field label={t('auth.mfaCode')}>
              <Input
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={12}
                className="text-center text-2xl tracking-[0.3em]"
              />
            </Field>

            <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(event) => setRememberDevice(event.target.checked)}
                className="size-4 rounded border-slate-300"
              />
              {t('auth.rememberDevice')}
            </label>

            <Button type="submit" fullWidth loading={busy === 'mfa'}>
              {t('common.confirm')}
            </Button>
          </form>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <h1 className="mb-4 text-lg font-semibold">{t('auth.signIn')}</h1>

        <ErrorMessage error={error ?? (externalError ? { code: externalError } : null)} />

        {methods?.password !== false && (
          <form onSubmit={handlePassword}>
            <Field label={t('auth.email')}>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="username webauthn"
                required
              />
            </Field>
            <Field label={t('auth.password')}>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </Field>
            <Button type="submit" fullWidth loading={busy === 'password'} icon={<LogIn className="size-4" />}>
              {t('auth.signIn')}
            </Button>
          </form>
        )}

        {(methods?.passkey || methods?.certificate || methods?.oidc) && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-200" />
              {t('auth.orContinueWith')}
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            <div className="space-y-2">
              {methods?.passkey && (
                <Button
                  variant="secondary"
                  fullWidth
                  loading={busy === 'passkey'}
                  onClick={handlePasskey}
                  icon={<Fingerprint className="size-4" />}
                >
                  {t('auth.withPasskey')}
                </Button>
              )}

              {methods?.certificate && (
                <>
                  <Button
                    variant="secondary"
                    fullWidth
                    loading={busy === 'certificate'}
                    onClick={handleCertificate}
                    icon={<IdCard className="size-4" />}
                  >
                    {t('auth.withCertificate')}
                  </Button>
                  <p className="text-xs text-slate-500">{t('auth.certificateHelp')}</p>
                </>
              )}

              {methods?.google && (
                <a
                  href={`/api/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`}
                  className="btn-secondary w-full"
                >
                  <GoogleMark />
                  {t('auth.withGoogle')}
                </a>
              )}

              {methods?.oidc && (
                <a
                  href={`/api/v1/auth/oidc/start?returnTo=${encodeURIComponent(returnTo)}`}
                  className="btn-secondary w-full"
                >
                  <KeyRound className="size-4" aria-hidden />
                  {t('auth.withClave', { provider: methods.oidcLabel })}
                </a>
              )}
            </div>
          </>
        )}

        <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
          {methods?.password !== false && (
            <Link to="/recuperar" className="text-brand hover:underline">
              {t('auth.forgotPassword')}
            </Link>
          )}
          {methods?.registrationOpen ? (
            <span className="text-slate-500">
              {t('auth.noAccount')}{' '}
              <Link to="/registro" className="text-brand hover:underline">
                {t('auth.signUp')}
              </Link>
            </span>
          ) : (
            methods && (
              <span className="text-slate-500">{t('auth.registrationClosedHint')}</span>
            )
          )}
        </div>
      </Card>
    </AuthLayout>
  );
}

/**
 * Marca de Google. Se dibuja como SVG en línea porque las normas de la marca
 * exigen los cuatro colores oficiales y no vale un icono monocromo del set
 * general.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.1 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.2 5.6c4.2-3.9 6.7-9.7 6.7-16.6l.4-.4z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.6c-.5-1.4-.8-2.9-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.7l7.8-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.6 2.2-8.7 2.2-6.3 0-11.7-3.7-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
