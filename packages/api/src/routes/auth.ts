import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  activateAccountSchema,
  certificateLoginSchema,
  changePasswordSchema,
  loginSchema,
  mfaEnrollTotpSchema,
  mfaVerifySchema,
  passkeyAuthenticationSchema,
  passkeyRegistrationSchema,
  refreshSchema,
  registerSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '@cita-facil/shared';
import { env } from '../config/env.js';
import { UnauthorizedError } from '../lib/errors.js';
import {
  activateAccount,
  changePassword,
  confirmTotpEnrollment,
  describeActivationToken,
  disableMfa,
  loginWithCertificate,
  loginWithPassword,
  logout,
  refresh,
  regenerateRecoveryCodes,
  register,
  requestPasswordReset,
  resetPassword,
  sendEmailVerification,
  startTotpEnrollment,
  verifyEmail,
  verifyMfa,
} from '../modules/auth/service.js';
import {
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  startPasskeyAuthentication,
  startPasskeyRegistration,
} from '../modules/auth/passkeys.js';
import {
  completeSocialLogin,
  isProviderConfigured,
  startSocialLogin,
  type SocialProvider,
} from '../modules/auth/oidc.js';
import {
  assertLoginMethodEnabled,
  getAuthSettings,
} from '../modules/settings/access-policy.js';
import {
  certificateFromRequest,
  clearSessionCookies,
  readRefreshToken,
  requestContext,
  sessionPayload,
  setSessionCookies,
} from './helpers.js';

/**
 * Endpoints de autenticación.
 *
 * Los que aceptan credenciales llevan un límite de peticiones más estricto que
 * el general: es la primera línea contra el relleno de credenciales.
 */
const authRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  const strictLimit = {
    config: {
      rateLimit: { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: '1 minute' },
    },
  };

  /* ------------------------------------------------------------- Métodos */

  app.get(
    '/methods',
    {
      schema: {
        tags: ['auth'],
        summary: 'Métodos de acceso habilitados en esta instalación',
        description:
          'Lo consulta la pantalla de acceso para pintar solo lo que está activo. Un método aparece como habilitado si el administrador lo ha activado y además está configurado.',
      },
    },
    async () => {
      const settings = await getAuthSettings();
      return {
        password: settings.methods.password,
        passkey: settings.methods.passkey,
        certificate: settings.methods.certificate,
        oidc: settings.methods.oidc && isProviderConfigured('oidc'),
        google: settings.methods.google && isProviderConfigured('google'),
        oidcLabel: env.OIDC_LABEL,
        registrationMode: settings.registrationMode,
        // El alta por formulario solo tiene sentido si además hay contraseña.
        registrationOpen:
          settings.methods.password &&
          (settings.registrationMode === 'open' || settings.registrationMode === 'allowlist'),
        allowAnonymousBooking: settings.allowAnonymousBooking,
      };
    },
  );

  /* ------------------------------------------------------- Alta y acceso */

  app.post(
    '/register',
    { ...strictLimit, schema: { tags: ['auth'], summary: 'Crear cuenta', body: registerSchema } },
    async (request, reply) => {
      const result = await register(request.body, requestContext(request));
      setSessionCookies(reply, result);
      return reply.status(201).send(sessionPayload(result));
    },
  );

  app.post(
    '/login',
    { ...strictLimit, schema: { tags: ['auth'], summary: 'Iniciar sesión', body: loginSchema } },
    async (request, reply) => {
      const response = await loginWithPassword(request.body, requestContext(request));
      if (response.status === 'mfa_required') {
        return reply.send({
          status: 'mfa_required',
          challengeId: response.challengeId,
          methods: response.methods,
          hint: response.hint,
        });
      }
      setSessionCookies(reply, response.result!);
      return reply.send(sessionPayload(response.result!));
    },
  );

  app.post(
    '/mfa/verify',
    { ...strictLimit, schema: { tags: ['auth'], summary: 'Validar el segundo factor', body: mfaVerifySchema } },
    async (request, reply) => {
      const result = await verifyMfa(request.body, requestContext(request));
      setSessionCookies(reply, result);
      return reply.send(sessionPayload(result));
    },
  );

  app.post(
    '/refresh',
    {
      schema: {
        tags: ['auth'],
        summary: 'Renovar la sesión',
        description:
          'Sin cuerpo, usa la cookie de refresco. El cuerpo solo hace falta en clientes que no manejen cookies.',
        // `nullish` y no `optional`: cuando no hay cuerpo, Fastify entrega
        // `null`, y `optional` solo admite `undefined`. Con `optional` esta
        // llamada devolvía 422 y la sesión se perdía al recargar la página.
        body: refreshSchema.nullish(),
      },
    },
    async (request, reply) => {
      const token = readRefreshToken(request, request.body ?? undefined);
      if (!token) throw new UnauthorizedError('No hay sesión que renovar', 'no_refresh_token');
      const result = await refresh(token);
      setSessionCookies(reply, result);
      return reply.send(sessionPayload(result));
    },
  );

  app.post(
    '/logout',
    { schema: { tags: ['auth'], summary: 'Cerrar sesión' } },
    async (request, reply) => {
      if (request.auth.sessionId) await logout(request.auth.sessionId);
      clearSessionCookies(reply);
      return reply.send({ ok: true });
    },
  );

  /* ------------------------------------------------- Certificado y DNIe */

  app.post(
    '/certificate',
    {
      ...strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Entrar con DNI electrónico o certificado FNMT',
        description:
          'El certificado lo aporta el proxy inverso en la cabecera configurada en CERT_HEADER tras completar el saludo TLS con petición de certificado de cliente.',
        body: certificateLoginSchema.nullish(),
      },
    },
    async (request, reply) => {
      const pem = certificateFromRequest(request, request.body);
      const result = await loginWithCertificate(pem, requestContext(request));
      setSessionCookies(reply, result);
      return reply.send(sessionPayload(result));
    },
  );

  /* ------------------------------------------------------------ Passkeys */

  app.post(
    '/passkey/authenticate/start',
    {
      schema: {
        tags: ['auth'],
        summary: 'Iniciar autenticación con passkey',
        body: z.object({ email: z.string().email().optional() }).nullish(),
      },
    },
    async (request) => {
      await assertLoginMethodEnabled('passkey');
      return startPasskeyAuthentication(request.body?.email);
    },
  );

  app.post(
    '/passkey/authenticate/finish',
    {
      schema: {
        tags: ['auth'],
        summary: 'Completar autenticación con passkey',
        body: passkeyAuthenticationSchema,
      },
    },
    async (request, reply) => {
      const response = await finishPasskeyAuthentication(
        { challengeId: request.body.challengeId, response: request.body.response },
        requestContext(request),
      );
      if (response.status === 'mfa_required') return reply.send(response);
      setSessionCookies(reply, response.result!);
      return reply.send(sessionPayload(response.result!));
    },
  );

  app.post(
    '/passkey/register/start',
    { schema: { tags: ['auth'], summary: 'Registrar una passkey nueva' } },
    async (request) => {
      const user = request.requireUser();
      return startPasskeyRegistration(user.id);
    },
  );

  app.post(
    '/passkey/register/finish',
    {
      schema: {
        tags: ['auth'],
        summary: 'Confirmar el registro de la passkey',
        body: passkeyRegistrationSchema.extend({ challengeId: z.string() }),
      },
    },
    async (request) => {
      request.requireUser();
      return finishPasskeyRegistration({
        challengeId: request.body.challengeId,
        response: request.body.response,
        deviceName: request.body.deviceName,
      });
    },
  );

  /* ---------------------------------------------------------- OIDC/Cl@ve */

  /**
   * Cl@ve, Google y cualquier otro proveedor federado comparten flujo. Se
   * exponen rutas separadas por proveedor en lugar de una genérica con
   * parámetro porque la URI de retorno hay que darla de alta literalmente en el
   * panel del proveedor, y una ruta fija es más fácil de copiar sin equivocarse.
   */
  const startQuery = z.object({ returnTo: z.string().max(200).optional() });
  const callbackQuery = z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
  });

  app.get(
    '/oidc/start',
    {
      schema: {
        tags: ['auth'],
        summary: 'Redirigir al proveedor de identidad configurado (Cl@ve u otro)',
        querystring: startQuery,
      },
    },
    async (request, reply) => {
      await assertLoginMethodEnabled('oidc');
      const { authorizationUrl } = await startSocialLogin('oidc', request.query.returnTo);
      return reply.redirect(authorizationUrl);
    },
  );

  app.get(
    '/google/start',
    {
      schema: {
        tags: ['auth'],
        summary: 'Redirigir a Google',
        description:
          'Da de alta esta URI de retorno en Google Cloud: <APP_URL>/api/v1/auth/google/callback',
        querystring: startQuery,
      },
    },
    async (request, reply) => {
      await assertLoginMethodEnabled('google');
      const { authorizationUrl } = await startSocialLogin('google', request.query.returnTo);
      return reply.redirect(authorizationUrl);
    },
  );

  /**
   * Retorno del proveedor. Llega en el navegador, así que los errores se
   * cuentan redirigiendo a la pantalla de acceso con un código y no
   * devolviendo JSON, que el usuario vería como una página en blanco.
   */
  const handleCallback = async (
    provider: SocialProvider,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const query = request.query as { code?: string; state?: string; error?: string };

    if (query.error || !query.code || !query.state) {
      return reply.redirect(`${env.APP_URL}/entrar?error=${provider}`);
    }

    try {
      const { result, returnTo } = await completeSocialLogin(
        { code: query.code, state: query.state },
        requestContext(request),
      );
      setSessionCookies(reply, result);
      return reply.redirect(`${env.APP_URL}${returnTo.startsWith('/') ? returnTo : '/'}`);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'oidc_failed';
      request.log.warn({ err: error, provider }, 'Fallo en el retorno del proveedor');
      return reply.redirect(`${env.APP_URL}/entrar?error=${encodeURIComponent(code)}`);
    }
  };

  app.get(
    '/oidc/callback',
    {
      schema: {
        tags: ['auth'],
        summary: 'Retorno del proveedor de identidad',
        querystring: callbackQuery,
      },
    },
    (request, reply) => handleCallback('oidc', request, reply),
  );

  app.get(
    '/google/callback',
    { schema: { tags: ['auth'], summary: 'Retorno de Google', querystring: callbackQuery } },
    (request, reply) => handleCallback('google', request, reply),
  );

  /* ---------------------------------------------------------- Contraseña */

  app.post(
    '/password/forgot',
    {
      ...strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Solicitar restablecimiento de contraseña',
        body: requestPasswordResetSchema,
      },
    },
    async (request) => {
      await requestPasswordReset(request.body.email);
      // Se responde igual exista o no la cuenta.
      return { ok: true };
    },
  );

  app.post(
    '/password/reset',
    {
      ...strictLimit,
      schema: { tags: ['auth'], summary: 'Fijar una contraseña nueva', body: resetPasswordSchema },
    },
    async (request) => {
      await resetPassword(request.body.token, request.body.password);
      return { ok: true };
    },
  );

  app.post(
    '/activate',
    {
      ...strictLimit,
      schema: {
        tags: ['auth'],
        summary: 'Activar una cuenta creada por el administrador',
        description:
          'Con el token del correo de invitación, la persona elige su contraseña y la cuenta pasa a activa. La sesión queda iniciada.',
        body: activateAccountSchema,
      },
    },
    async (request, reply) => {
      const result = await activateAccount(request.body, requestContext(request));
      setSessionCookies(reply, result);
      return reply.send(sessionPayload(result));
    },
  );

  app.get(
    '/activate/check',
    {
      schema: {
        tags: ['auth'],
        summary: 'Comprobar si un enlace de activación sigue siendo válido',
        querystring: z.object({ token: z.string().min(10).max(500) }),
      },
    },
    async (request) => {
      const target = await describeActivationToken(request.query.token);
      return target;
    },
  );

  app.post(
    '/password/change',
    { schema: { tags: ['auth'], summary: 'Cambiar la contraseña', body: changePasswordSchema } },
    async (request) => {
      const user = request.requireUser();
      await changePassword(user.id, request.body.currentPassword, request.body.newPassword);
      return { ok: true };
    },
  );

  /* ------------------------------------------------------ Correo y 2FA */

  app.post(
    '/email/verify',
    { schema: { tags: ['auth'], summary: 'Confirmar la dirección de correo', body: verifyEmailSchema } },
    async (request) => {
      await verifyEmail(request.body.token);
      return { ok: true };
    },
  );

  app.post(
    '/email/resend',
    { ...strictLimit, schema: { tags: ['auth'], summary: 'Reenviar el correo de verificación' } },
    async (request) => {
      const user = request.requireUser();
      await sendEmailVerification(user.id);
      return { ok: true };
    },
  );

  app.post(
    '/mfa/totp/start',
    { schema: { tags: ['auth'], summary: 'Empezar el alta de la app de autenticación' } },
    async (request) => {
      const user = request.requireUser();
      return startTotpEnrollment(user.id);
    },
  );

  app.post(
    '/mfa/totp/confirm',
    {
      schema: {
        tags: ['auth'],
        summary: 'Confirmar el alta con un código',
        body: mfaEnrollTotpSchema,
      },
    },
    async (request) => {
      const user = request.requireUser();
      const recoveryCodes = await confirmTotpEnrollment(user.id, request.body.code);
      return { ok: true, recoveryCodes };
    },
  );

  app.post(
    '/mfa/disable',
    {
      schema: {
        tags: ['auth'],
        summary: 'Desactivar el segundo factor',
        body: z.object({ password: z.string().min(1) }),
      },
    },
    async (request) => {
      const user = request.requireUser();
      await disableMfa(user.id, request.body.password);
      return { ok: true };
    },
  );

  app.post(
    '/mfa/recovery-codes',
    { schema: { tags: ['auth'], summary: 'Generar códigos de recuperación nuevos' } },
    async (request) => {
      const user = request.requireUser();
      return { recoveryCodes: await regenerateRecoveryCodes(user.id) };
    },
  );
};

export default authRoutes;
