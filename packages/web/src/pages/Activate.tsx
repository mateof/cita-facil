import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { api, setAccessToken } from '../lib/api.ts';
import { useAuth } from '../stores/auth.ts';
import { AuthLayout } from '../components/layout.tsx';
import {
  Button,
  Card,
  ErrorMessage,
  Field,
  Input,
  Spinner,
  SuccessMessage,
} from '../components/ui.tsx';
import type { SessionUser } from '../lib/types.ts';

interface TokenInfo {
  valid: boolean;
  name: string | null;
  email: string | null;
  expiresAt: string | null;
}

/**
 * Activación de una cuenta creada por el administrador.
 *
 * La persona llega desde el enlace del correo, elige su contraseña y entra
 * directamente: pedirle que vuelva a la pantalla de acceso a escribir lo que
 * acaba de teclear sería un paso de más sin ninguna ganancia.
 */
export default function Activate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reload = useAuth((state) => state.reload);
  const token = searchParams.get('token') ?? '';

  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false, name: null, email: null, expiresAt: null });
      return;
    }
    api
      .get<TokenInfo>('/auth/activate/check', { query: { token } })
      .then((result) => {
        setInfo(result);
        if (result.name) setName(result.name);
      })
      .catch(() => setInfo({ valid: false, name: null, email: null, expiresAt: null }));
  }, [token]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password !== repeat) return;

    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ tokens: { accessToken: string }; user: SessionUser }>(
        '/auth/activate',
        { token, password, name: name.trim() || undefined },
      );
      setAccessToken(result.tokens.accessToken);
      await reload();
      navigate('/mis-citas', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  if (!info) {
    return (
      <AuthLayout>
        <Card className="flex items-center justify-center gap-2 text-slate-500">
          <Spinner />
          {t('common.loading')}
        </Card>
      </AuthLayout>
    );
  }

  if (!info.valid) {
    return (
      <AuthLayout>
        <Card>
          <h1 className="mb-3 text-lg font-semibold">{t('auth.activateTitle')}</h1>
          <ErrorMessage error={{ code: 'activation_invalid' }} />
          <p className="mb-4 text-sm text-slate-500">{t('auth.activateExpiredHint')}</p>
          <Link to="/entrar" className="text-sm text-brand hover:underline">
            {t('auth.signIn')}
          </Link>
        </Card>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <Card>
        <h1 className="mb-1 text-lg font-semibold">{t('auth.activateTitle')}</h1>
        <p className="mb-4 text-sm text-slate-500">{t('auth.activateHelp')}</p>

        {info.email && <SuccessMessage>{info.email}</SuccessMessage>}
        <ErrorMessage error={error} />

        <form onSubmit={submit}>
          <Field label={t('auth.name')} required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              minLength={2}
              required
            />
          </Field>

          <Field label={t('auth.password')} required hint={t('auth.passwordHint')}>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
              autoFocus
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

          <Button
            type="submit"
            fullWidth
            loading={busy}
            disabled={password !== repeat || password.length < 10}
          >
            {t('auth.activateAction')}
          </Button>
        </form>
      </Card>
    </AuthLayout>
  );
}
