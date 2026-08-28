import type {
  AuthTokens,
  LoginInput,
  LoginResponse,
  MfaMethod,
  RegisterInput,
  SessionUser,
} from '@cita-facil/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { hashToken, safeEqual } from '../../lib/crypto.js';
import { newId, randomToken, shortCode } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../lib/errors.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../../lib/password.js';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  totpUri,
  verifyTotp,
} from '../../lib/totp.js';
import { notify, notifyNow } from '../notifications/service.js';
import {
  REGISTRATION_DENIAL_MESSAGES,
  assertLoginMethodEnabled,
  decideRegistration,
  getAuthSettings,
  markAllowlistEntryUsed,
} from '../settings/access-policy.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByIdentity,
  findUserByNif,
  isLocked,
  linkIdentity,
  registerFailedLogin,
  toSessionUser,
  touchLogin,
  type UserRow,
} from '../users/repository.js';
import { consumeChallenge, createChallenge, peekChallenge } from './challenges.js';
import { verifyClientCertificate, type CertificateIdentity } from './certificate.js';
import { createSession, revokeSession, rotateSession, signAccessToken } from './tokens.js';

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
  locale?: string;
  /** Token de dispositivo de confianza para saltarse el segundo factor. */
  trustedDeviceToken?: string | null;
}

export interface AuthenticatedResult {
  tokens: AuthTokens;
  refreshToken: string;
  user: SessionUser;
  sessionId: string;
  /** Token de dispositivo de confianza recién emitido, si se pidió recordarlo. */
  trustedDeviceToken?: string;
}

/* -------------------------------------------------------------------------- */
/* Alta de usuario                                                             */
/* -------------------------------------------------------------------------- */

export async function register(
  input: RegisterInput,
  context: RequestContext = {},
): Promise<AuthenticatedResult> {
  await assertLoginMethodEnabled('password');

  const strength = checkPasswordStrength(input.password, env.PASSWORD_MIN_LENGTH);
  if (!strength.ok) throw new BadRequestError(strength.reason!, 'weak_password');

  // La política de alta de la instalación se comprueba antes que nada: si el
  // registro está cerrado no tiene sentido seguir.
  const decision = input.invitationToken
    ? { allowed: true, reason: 'invited' as const, entry: null }
    : await decideRegistration({ source: 'password', email: input.email });

  if (!decision.allowed) {
    throw new ForbiddenError(
      REGISTRATION_DENIAL_MESSAGES[decision.reason] ?? 'No se admiten altas nuevas',
      decision.reason,
    );
  }

  const existing = await findUserByEmail(input.email);
  if (existing) {
    // No se revela si el correo existe: se responde igual que en un alta
    // correcta y se avisa al titular real por email.
    await notify({
      event: 'account.welcome',
      userId: existing.id,
      locale: (existing.locale as SessionUser['locale']) ?? 'es',
      vars: {
        usuario: existing.name,
        organizacion: env.APP_NAME,
        enlace: `${env.APP_URL}/entrar`,
      },
    });
    throw new ConflictError('No se ha podido completar el alta', 'registration_failed');
  }

  const user = await createUser({
    email: input.email,
    name: input.name,
    phone: input.phone ?? null,
    passwordHash: await hashPassword(input.password),
    locale: input.locale ?? (context.locale as string) ?? env.DEFAULT_LOCALE,
    timezone: input.timezone ?? env.DEFAULT_TIMEZONE,
    emailVerified: false,
    platformRole: decision.entry?.platformRole,
  });

  await linkIdentity({ userId: user.id, provider: 'password', subject: user.email_key });

  // Una entrada de la lista de autorizados puede traer consigo el alta directa
  // en una organización, que es lo que evita tener que invitar dos veces.
  if (decision.entry) {
    await markAllowlistEntryUsed(decision.entry.id, user.id);
    if (decision.entry.organizationId && decision.entry.organizationRole) {
      await joinOrganization(user.id, decision.entry.organizationId, decision.entry.organizationRole);
    }
  }

  if (input.invitationToken) {
    await acceptInvitation(input.invitationToken, user.id);
  }

  await sendEmailVerification(user.id);
  await notify({
    event: 'account.welcome',
    userId: user.id,
    locale: user.locale as SessionUser['locale'],
    vars: { usuario: user.name, organizacion: env.APP_NAME, enlace: `${env.APP_URL}/mis-citas` },
  });

  return issueSession(user, 'password', true, context);
}

/* -------------------------------------------------------------------------- */
/* Inicio de sesión con contraseña                                             */
/* -------------------------------------------------------------------------- */

export async function loginWithPassword(
  input: LoginInput,
  context: RequestContext = {},
): Promise<LoginResponse & { result?: AuthenticatedResult }> {
  await assertLoginMethodEnabled('password');

  const user = await findUserByEmail(input.email);

  // Se hace igualmente una verificación falsa para que el tiempo de respuesta
  // no delate si el correo está registrado.
  if (!user || !user.password_hash) {
    await verifyPassword(
      '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0$0000000000000000000000000000000000000000000',
      input.password,
    );
    throw new UnauthorizedError('Credenciales incorrectas', 'invalid_credentials');
  }

  if (isLocked(user)) {
    throw new UnauthorizedError(
      'Cuenta bloqueada temporalmente por intentos fallidos',
      'account_locked',
    );
  }
  if (user.status === 'pending') {
    throw new ForbiddenError(
      'La cuenta está pendiente de activar. Revisa el correo con el enlace de activación.',
      'account_pending_activation',
    );
  }
  if (user.status !== 'active') {
    throw new ForbiddenError('La cuenta no está activa', 'account_inactive');
  }

  const valid = await verifyPassword(user.password_hash, input.password);
  if (!valid) {
    await registerFailedLogin(user.id, user.failed_login_count);
    throw new UnauthorizedError('Credenciales incorrectas', 'invalid_credentials');
  }

  return finishLogin(user, 'password', input.mfaCode, input.rememberDevice, context);
}

/**
 * Última fase común a todos los métodos: decide si hace falta segundo factor y,
 * si no, emite la sesión.
 */
export async function finishLogin(
  user: UserRow,
  method: string,
  mfaCode: string | undefined,
  rememberDevice: boolean | undefined,
  context: RequestContext,
): Promise<LoginResponse & { result?: AuthenticatedResult }> {
  const needsMfa = await requiresMfa(user);

  if (needsMfa) {
    if (await isTrustedDevice(user.id, context.trustedDeviceToken)) {
      const result = await issueSession(user, method, true, context);
      return { status: 'authenticated', tokens: result.tokens, user: result.user, result };
    }

    const methods = await availableMfaMethods(user);

    // Si el cliente ya manda el código (formulario de un solo paso), se valida
    // aquí mismo y se ahorra un viaje.
    if (mfaCode && methods.includes('totp') && user.mfa_totp_secret) {
      if (verifyTotp(user.mfa_totp_secret, mfaCode)) {
        const result = await issueSession(user, method, true, context, rememberDevice);
        return { status: 'authenticated', tokens: result.tokens, user: result.user, result };
      }
      throw new UnauthorizedError('Código de verificación incorrecto', 'invalid_mfa_code');
    }

    const challengeId = await startMfaChallenge(user, methods);
    return {
      status: 'mfa_required',
      challengeId,
      methods,
      hint: methods.includes('email') ? maskEmail(user.email) : null,
    };
  }

  const result = await issueSession(user, method, true, context, rememberDevice);
  return { status: 'authenticated', tokens: result.tokens, user: result.user, result };
}

async function requiresMfa(user: UserRow): Promise<boolean> {
  if (user.mfa_enabled === 1) return true;

  const settings = await getAuthSettings();
  if (!settings.mfaRequiredForAdmins) return false;

  if (user.platform_role === 'superadmin') return true;
  const membership = await db()
    .selectFrom('memberships')
    .select(['role'])
    .where('user_id', '=', user.id)
    .where('active', '=', 1)
    .where('role', 'in', ['owner', 'admin'])
    .executeTakeFirst();
  return Boolean(membership);
}

export async function availableMfaMethods(user: UserRow): Promise<MfaMethod[]> {
  const methods: MfaMethod[] = [];
  if (user.mfa_totp_secret) methods.push('totp');
  if (user.email && user.email_verified === 1) methods.push('email');

  const passkeys = await db()
    .selectFrom('webauthn_credentials')
    .select(['id'])
    .where('user_id', '=', user.id)
    .executeTakeFirst();
  if (passkeys) methods.push('webauthn');

  if (user.mfa_recovery_codes) methods.push('recovery_code');
  // Sin ningún método configurado, el correo es la vía de rescate.
  return methods.length > 0 ? methods : ['email'];
}

async function startMfaChallenge(user: UserRow, methods: MfaMethod[]): Promise<string> {
  const useEmailCode = !methods.includes('totp') && methods.includes('email');
  const code = useEmailCode ? String(Math.floor(100_000 + Math.random() * 900_000)) : undefined;

  const challengeId = await createChallenge({
    kind: 'mfa',
    userId: user.id,
    payload: { methods, userId: user.id },
    // El código del correo se guarda hasheado; el TOTP se valida contra el
    // secreto del usuario y no necesita código en el reto.
    code,
    ttlSeconds: 600,
  });

  if (code && user.email) {
    await notifyNow({
      event: 'auth.mfa_code',
      userId: user.id,
      locale: user.locale as SessionUser['locale'],
      channels: ['email'],
      vars: { codigo: code, usuario: user.name, organizacion: env.APP_NAME },
    });
  }

  return challengeId;
}

export async function verifyMfa(
  params: { challengeId: string; method: MfaMethod; code: string; rememberDevice?: boolean },
  context: RequestContext = {},
): Promise<AuthenticatedResult> {
  const challenge = await peekChallenge<{ methods: MfaMethod[]; userId: string }>(
    params.challengeId,
    'mfa',
  );
  const user = challenge.userId ? await findUserById(challenge.userId) : undefined;
  if (!user) throw new UnauthorizedError('El proceso ha caducado', 'challenge_expired');

  switch (params.method) {
    case 'totp': {
      if (!user.mfa_totp_secret) {
        throw new BadRequestError('No hay aplicación de autenticación configurada', 'totp_not_set');
      }
      if (!verifyTotp(user.mfa_totp_secret, params.code)) {
        throw new UnauthorizedError('Código de verificación incorrecto', 'invalid_mfa_code');
      }
      await consumeChallenge(params.challengeId, 'mfa');
      break;
    }

    case 'email':
      // `consumeChallenge` compara el código guardado y controla los intentos.
      await consumeChallenge(params.challengeId, 'mfa', params.code);
      break;

    case 'recovery_code': {
      const consumed = await consumeRecoveryCode(user, params.code);
      if (!consumed) {
        throw new UnauthorizedError('Código de recuperación no válido', 'invalid_recovery_code');
      }
      await consumeChallenge(params.challengeId, 'mfa');
      break;
    }

    default:
      throw new BadRequestError('Método de segundo factor no soportado aquí', 'unsupported_method');
  }

  return issueSession(user, 'password', true, context, params.rememberDevice);
}

async function consumeRecoveryCode(user: UserRow, code: string): Promise<boolean> {
  if (!user.mfa_recovery_codes) return false;
  const stored = JSON.parse(user.mfa_recovery_codes) as string[];
  const normalized = code.trim().toUpperCase();
  const index = stored.findIndex((hash) => safeEqual(hash, hashToken(normalized, 'recovery')));
  if (index === -1) return false;

  stored.splice(index, 1);
  await db()
    .updateTable('users')
    .set({ mfa_recovery_codes: JSON.stringify(stored), updated_at: isoNow() })
    .where('id', '=', user.id)
    .execute();
  return true;
}

/* -------------------------------------------------------------------------- */
/* Emisión de sesión                                                           */
/* -------------------------------------------------------------------------- */

export async function issueSession(
  user: UserRow,
  method: string,
  mfaSatisfied: boolean,
  context: RequestContext,
  rememberDevice = false,
): Promise<AuthenticatedResult> {
  const session = await createSession({
    userId: user.id,
    method,
    mfaSatisfied,
    userAgent: context.userAgent ?? null,
    ip: context.ip ?? null,
  });

  const { token, expiresIn } = await signAccessToken({
    userId: user.id,
    sessionId: session.sessionId,
    method,
    mfaSatisfied,
    platformRole: user.platform_role,
  });

  await touchLogin(user.id);
  await notifyNewDeviceIfNeeded(user, context);

  let trustedDeviceToken: string | undefined;
  if (rememberDevice) {
    trustedDeviceToken = await rememberThisDevice(user.id, context);
  }

  return {
    tokens: { accessToken: token, expiresIn, refreshToken: session.refreshToken, tokenType: 'Bearer' },
    refreshToken: session.refreshToken,
    user: await toSessionUser(user),
    sessionId: session.sessionId,
    trustedDeviceToken,
  };
}

/** Avisa por correo la primera vez que se entra desde un agente desconocido. */
async function notifyNewDeviceIfNeeded(user: UserRow, context: RequestContext): Promise<void> {
  if (!context.userAgent || !user.email) return;

  const seen = await db()
    .selectFrom('sessions')
    .select(['id'])
    .where('user_id', '=', user.id)
    .where('user_agent', '=', context.userAgent.slice(0, 400))
    .limit(2)
    .execute();
  if (seen.length > 1) return;

  await notify({
    event: 'auth.new_device',
    userId: user.id,
    locale: user.locale as SessionUser['locale'],
    vars: {
      usuario: user.name,
      fechaHora: new Date().toLocaleString('es-ES'),
      dispositivo: context.userAgent.slice(0, 120),
      ip: context.ip ?? 'desconocida',
      enlace: `${env.APP_URL}/perfil/seguridad`,
    },
  }).catch((error) => logger.warn({ err: error }, 'No se pudo avisar del nuevo dispositivo'));
}

async function rememberThisDevice(userId: string, context: RequestContext): Promise<string> {
  const token = randomToken(32);
  await db()
    .insertInto('trusted_devices')
    .values({
      id: newId(),
      user_id: userId,
      token_hash: hashToken(token, 'trusted_device'),
      label: context.userAgent?.slice(0, 120) ?? null,
      expires_at: new Date(Date.now() + env.MFA_TRUSTED_DEVICE_DAYS * 86_400_000).toISOString(),
      created_at: isoNow(),
    })
    .execute();
  return token;
}

async function isTrustedDevice(userId: string, token?: string | null): Promise<boolean> {
  if (!token) return false;
  const row = await db()
    .selectFrom('trusted_devices')
    .select(['id', 'expires_at'])
    .where('user_id', '=', userId)
    .where('token_hash', '=', hashToken(token, 'trusted_device'))
    .executeTakeFirst();
  return Boolean(row && row.expires_at > isoNow());
}

/* -------------------------------------------------------------------------- */
/* Renovación y cierre                                                         */
/* -------------------------------------------------------------------------- */

export async function refresh(refreshToken: string): Promise<AuthenticatedResult> {
  const rotated = await rotateSession(refreshToken);
  const user = await findUserById(rotated.session.userId);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('La cuenta ya no está activa', 'account_inactive');
  }

  const { token, expiresIn } = await signAccessToken({
    userId: user.id,
    sessionId: rotated.session.id,
    method: rotated.session.method,
    mfaSatisfied: rotated.session.mfaSatisfied,
    platformRole: user.platform_role,
  });

  return {
    tokens: {
      accessToken: token,
      expiresIn,
      refreshToken: rotated.refreshToken,
      tokenType: 'Bearer',
    },
    refreshToken: rotated.refreshToken,
    user: await toSessionUser(user),
    sessionId: rotated.session.id,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await revokeSession(sessionId);
}

/* -------------------------------------------------------------------------- */
/* Verificación de correo y contraseñas                                        */
/* -------------------------------------------------------------------------- */

async function issueVerificationToken(
  userId: string,
  purpose: 'verify_email' | 'reset_password' | 'activate_account',
  ttlMinutes: number,
): Promise<string> {
  const token = randomToken(32);
  await db()
    .insertInto('verification_tokens')
    .values({
      id: newId(),
      user_id: userId,
      purpose,
      token_hash: hashToken(token, purpose),
      expires_at: new Date(Date.now() + ttlMinutes * 60_000).toISOString(),
      consumed_at: null,
      created_at: isoNow(),
    })
    .execute();
  return token;
}

export async function sendEmailVerification(userId: string): Promise<void> {
  const user = await findUserById(userId);
  if (!user?.email || user.email_verified === 1) return;

  const token = await issueVerificationToken(userId, 'verify_email', 24 * 60);
  await notify({
    event: 'auth.verify_email',
    userId,
    locale: user.locale as SessionUser['locale'],
    vars: {
      usuario: user.name,
      organizacion: env.APP_NAME,
      enlace: `${env.APP_URL}/verificar-correo?token=${token}`,
    },
  });
}

export async function verifyEmail(token: string): Promise<void> {
  const row = await db()
    .selectFrom('verification_tokens')
    .selectAll()
    .where('token_hash', '=', hashToken(token, 'verify_email'))
    .where('purpose', '=', 'verify_email')
    .executeTakeFirst();

  if (!row || row.consumed_at || row.expires_at <= isoNow()) {
    throw new BadRequestError('El enlace de verificación ha caducado', 'token_expired');
  }

  await db()
    .updateTable('verification_tokens')
    .set({ consumed_at: isoNow() })
    .where('id', '=', row.id)
    .execute();
  await db()
    .updateTable('users')
    .set({ email_verified: 1, updated_at: isoNow() })
    .where('id', '=', row.user_id)
    .execute();
}

/**
 * Solicitud de restablecimiento. Devuelve siempre sin error, exista o no la
 * cuenta, para no permitir enumerar direcciones registradas.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await findUserByEmail(email);
  if (!user || !user.email) return;

  const token = await issueVerificationToken(user.id, 'reset_password', 60);
  await notify({
    event: 'auth.reset_password',
    userId: user.id,
    locale: user.locale as SessionUser['locale'],
    vars: {
      usuario: user.name,
      organizacion: env.APP_NAME,
      enlace: `${env.APP_URL}/nueva-contrasena?token=${token}`,
    },
  });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const strength = checkPasswordStrength(password, env.PASSWORD_MIN_LENGTH);
  if (!strength.ok) throw new BadRequestError(strength.reason!, 'weak_password');

  const row = await db()
    .selectFrom('verification_tokens')
    .selectAll()
    .where('token_hash', '=', hashToken(token, 'reset_password'))
    .where('purpose', '=', 'reset_password')
    .executeTakeFirst();

  if (!row || row.consumed_at || row.expires_at <= isoNow()) {
    throw new BadRequestError('El enlace ha caducado, pide uno nuevo', 'token_expired');
  }

  await db()
    .updateTable('verification_tokens')
    .set({ consumed_at: isoNow() })
    .where('id', '=', row.id)
    .execute();

  await db()
    .updateTable('users')
    .set({
      password_hash: await hashPassword(password),
      failed_login_count: 0,
      locked_until: null,
      updated_at: isoNow(),
    })
    .where('id', '=', row.user_id)
    .execute();

  // Cambiar la contraseña cierra el resto de sesiones: si alguien había
  // entrado, deja de tener acceso.
  await db()
    .updateTable('sessions')
    .set({ revoked_at: isoNow() })
    .where('user_id', '=', row.user_id)
    .where('revoked_at', 'is', null)
    .execute();

  await linkIdentity({
    userId: row.user_id,
    provider: 'password',
    subject: (await findUserById(row.user_id))?.email_key ?? row.user_id,
  });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuario no encontrado');

  if (user.password_hash && !(await verifyPassword(user.password_hash, currentPassword))) {
    throw new UnauthorizedError('La contraseña actual no es correcta', 'invalid_credentials');
  }

  const strength = checkPasswordStrength(newPassword, env.PASSWORD_MIN_LENGTH);
  if (!strength.ok) throw new BadRequestError(strength.reason!, 'weak_password');

  await db()
    .updateTable('users')
    .set({ password_hash: await hashPassword(newPassword), updated_at: isoNow() })
    .where('id', '=', userId)
    .execute();

  await linkIdentity({ userId, provider: 'password', subject: user.email_key });
}

/* -------------------------------------------------------------------------- */
/* Segundo factor: alta y baja                                                 */
/* -------------------------------------------------------------------------- */

export interface TotpEnrollment {
  secret: string;
  uri: string;
}

export async function startTotpEnrollment(userId: string): Promise<TotpEnrollment> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuario no encontrado');

  const secret = generateTotpSecret();
  // Se guarda ya, pero `mfa_enabled` sigue a 0 hasta confirmar con un código:
  // así no se puede dejar la cuenta bloqueada por una configuración a medias.
  await db()
    .updateTable('users')
    .set({ mfa_totp_secret: secret, updated_at: isoNow() })
    .where('id', '=', userId)
    .execute();

  return {
    secret,
    uri: totpUri({
      secret,
      accountName: user.email ?? user.name,
      issuer: env.APP_NAME,
    }),
  };
}

export async function confirmTotpEnrollment(userId: string, code: string): Promise<string[]> {
  const user = await findUserById(userId);
  if (!user?.mfa_totp_secret) {
    throw new BadRequestError('No hay ninguna configuración de TOTP en curso', 'totp_not_started');
  }
  if (!verifyTotp(user.mfa_totp_secret, code)) {
    throw new UnauthorizedError('El código no coincide', 'invalid_mfa_code');
  }

  const codes = generateRecoveryCodes(10);
  await db()
    .updateTable('users')
    .set({
      mfa_enabled: 1,
      mfa_recovery_codes: JSON.stringify(codes.map((c) => hashToken(c, 'recovery'))),
      updated_at: isoNow(),
    })
    .where('id', '=', userId)
    .execute();

  return codes;
}

export async function disableMfa(userId: string, password: string): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuario no encontrado');
  if (user.password_hash && !(await verifyPassword(user.password_hash, password))) {
    throw new UnauthorizedError('La contraseña no es correcta', 'invalid_credentials');
  }
  if (await requiresMfa({ ...user, mfa_enabled: 0 })) {
    throw new ForbiddenError(
      'La política de la instalación exige segundo factor para administradores',
      'mfa_required_by_policy',
    );
  }

  await db()
    .updateTable('users')
    .set({
      mfa_enabled: 0,
      mfa_totp_secret: null,
      mfa_recovery_codes: null,
      updated_at: isoNow(),
    })
    .where('id', '=', userId)
    .execute();
}

export async function regenerateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes(10);
  await db()
    .updateTable('users')
    .set({
      mfa_recovery_codes: JSON.stringify(codes.map((c) => hashToken(c, 'recovery'))),
      updated_at: isoNow(),
    })
    .where('id', '=', userId)
    .execute();
  return codes;
}

/* -------------------------------------------------------------------------- */
/* Certificado electrónico                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Entrada con DNIe o certificado FNMT. La identidad viene del certificado, así
 * que no hay contraseña que comprobar; el segundo factor se considera cubierto
 * por el propio PIN del certificado, que es lo que exige el estándar.
 */
export async function loginWithCertificate(
  pem: string,
  context: RequestContext = {},
): Promise<AuthenticatedResult> {
  await assertLoginMethodEnabled('certificate');

  const identity = await verifyClientCertificate(pem);
  const user = await findOrProvisionCertificateUser(identity, context);

  if (user.status !== 'active') {
    throw new ForbiddenError('La cuenta no está activa', 'account_inactive');
  }

  await linkIdentity({
    userId: user.id,
    provider: 'certificate',
    subject: identity.nif,
    issuer: identity.issuer,
    metadata: { serialNumber: identity.serialNumber, fingerprint: identity.fingerprint },
  });

  return issueSession(user, 'certificate', true, context);
}

/**
 * Vincula un DNIe o certificado a la cuenta que ya tiene la sesión abierta.
 *
 * Es la única forma de que el documento llegue a una cuenta, y a propósito. El
 * acceso por certificado busca cuenta por NIF, así que si el documento pudiera
 * escribirse a mano en el perfil bastaría con poner el DNI de otra persona para
 * que, cuando esa persona entrara con su DNIe, aterrizase en la cuenta del
 * impostor. Aquí el documento no se declara: se demuestra.
 *
 * Se rechaza si el documento ya está en otra cuenta, y también si esta cuenta
 * llevaba otro distinto: un DNI no cambia, y dos seguidos significan que hay
 * dos personas de por medio.
 */
export async function linkCertificateToUser(user: UserRow, pem: string): Promise<UserRow> {
  await assertLoginMethodEnabled('certificate');
  return linkVerifiedCertificate(user, await verifyClientCertificate(pem));
}

/**
 * Las reglas del vínculo, ya con el certificado comprobado.
 *
 * Va aparte para poder probarlas: montar una autoridad de certificación en las
 * pruebas solo para llegar hasta aquí escondería justo lo que importa, que es a
 * quién se le deja quedarse con qué documento.
 */
export async function linkVerifiedCertificate(
  user: UserRow,
  identity: CertificateIdentity,
): Promise<UserRow> {
  const byIdentity = await findUserByIdentity('certificate', identity.nif);
  if (byIdentity && byIdentity.id !== user.id) {
    throw new ConflictError('Ese documento ya está vinculado a otra cuenta', 'nif_taken');
  }

  const byNif = await findUserByNif(identity.nif);
  if (byNif && byNif.id !== user.id) {
    throw new ConflictError('Ya existe una cuenta con ese documento', 'nif_taken');
  }

  if (user.nif && user.nif !== identity.nif) {
    throw new ConflictError(
      'Esta cuenta ya tiene otro documento vinculado',
      'nif_mismatch',
    );
  }

  if (user.nif !== identity.nif) {
    await db()
      .updateTable('users')
      .set({ nif: identity.nif, nif_key: identity.nif, updated_at: isoNow() })
      .where('id', '=', user.id)
      .execute();
  }

  await linkIdentity({
    userId: user.id,
    provider: 'certificate',
    subject: identity.nif,
    issuer: identity.issuer,
    metadata: { serialNumber: identity.serialNumber, fingerprint: identity.fingerprint },
  });

  logger.info({ userId: user.id, issuer: identity.issuer }, 'Certificado vinculado al perfil');

  return { ...user, nif: identity.nif, nif_key: identity.nif };
}

async function findOrProvisionCertificateUser(
  identity: CertificateIdentity,
  context: RequestContext,
): Promise<UserRow> {
  const byIdentity = await findUserByIdentity('certificate', identity.nif);
  if (byIdentity) return byIdentity;

  const byNif = await findUserByNif(identity.nif);
  if (byNif) return byNif;

  if (identity.email) {
    const byEmail = await findUserByEmail(identity.email);
    if (byEmail) {
      // Se enlaza el NIF a la cuenta que ya tenía ese correo.
      await db()
        .updateTable('users')
        .set({ nif: identity.nif, nif_key: identity.nif, updated_at: isoNow() })
        .where('id', '=', byEmail.id)
        .execute();
      return { ...byEmail, nif: identity.nif, nif_key: identity.nif };
    }
  }

  // No hay cuenta: la política de la instalación decide si se crea una.
  const decision = await decideRegistration({
    source: 'certificate',
    email: identity.email,
    nif: identity.nif,
  });

  if (!decision.allowed) {
    throw new ForbiddenError(
      decision.reason === 'not_allowlisted'
        ? 'Tu documento no está autorizado en esta instalación'
        : (REGISTRATION_DENIAL_MESSAGES[decision.reason] ??
          'No hay ninguna cuenta asociada a este certificado'),
      decision.reason === 'not_allowlisted' ? 'cert_not_allowlisted' : decision.reason,
    );
  }

  logger.info({ nif: identity.nif, issuer: identity.issuer }, 'Alta automática por certificado');
  const user = await createUser({
    email: identity.email,
    name: identity.name,
    givenName: identity.givenName,
    familyName: identity.familyName,
    nif: identity.nif,
    locale: context.locale ?? env.DEFAULT_LOCALE,
    emailVerified: Boolean(identity.email),
    platformRole: decision.entry?.platformRole,
  });

  if (decision.entry) {
    await markAllowlistEntryUsed(decision.entry.id, user.id);
    if (decision.entry.organizationId && decision.entry.organizationRole) {
      await joinOrganization(user.id, decision.entry.organizationId, decision.entry.organizationRole);
    }
  }

  return user;
}

/* -------------------------------------------------------------------------- */
/* Alta creada por el administrador                                            */
/* -------------------------------------------------------------------------- */

export interface AdminCreatedUser {
  userId: string;
  email: string;
  /** Enlace de activación. Se devuelve para poder entregarlo a mano. */
  activationUrl: string;
  expiresAt: string;
}

/**
 * Crea una cuenta desde el panel y envía el enlace para que la persona elija su
 * contraseña.
 *
 * La cuenta nace en estado `pending` y sin contraseña: hasta que no se activa
 * no se puede entrar con ella, así que un correo que se pierda no deja una
 * cuenta accesible con una contraseña provisional que nadie ha cambiado.
 */
export async function adminCreateUser(
  input: {
    email: string;
    name: string;
    nif?: string;
    phone?: string;
    locale?: string;
    platformRole?: string;
    organizationId?: string;
    organizationRole?: string;
    sendInvitation?: boolean;
    expiresInDays?: number;
  },
  actorId: string | null,
): Promise<AdminCreatedUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await findUserByEmail(email);
  if (existing) {
    throw new ConflictError('Ya existe una cuenta con ese correo', 'email_taken');
  }
  if (input.nif) {
    const byNif = await findUserByNif(input.nif);
    if (byNif) throw new ConflictError('Ya existe una cuenta con ese documento', 'nif_taken');
  }

  const user = await createUser({
    email,
    name: input.name,
    nif: input.nif ?? null,
    phone: input.phone ?? null,
    locale: input.locale ?? env.DEFAULT_LOCALE,
    platformRole: input.platformRole ?? 'user',
    status: 'pending',
    // El correo lo confirma la propia activación: quien abre el enlace
    // demuestra que controla el buzón.
    emailVerified: false,
  });

  if (input.organizationId && input.organizationRole) {
    await joinOrganization(user.id, input.organizationId, input.organizationRole);
  }

  const ttlMinutes = (input.expiresInDays ?? 14) * 24 * 60;
  const token = await issueVerificationToken(user.id, 'activate_account', ttlMinutes);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const activationUrl = `${env.APP_URL}/activar?token=${token}`;

  if (input.sendInvitation !== false) {
    await notify({
      event: 'auth.activate_account',
      userId: user.id,
      locale: (input.locale as never) ?? env.DEFAULT_LOCALE,
      to: { email },
      vars: {
        usuario: input.name,
        organizacion: env.APP_NAME,
        enlace: activationUrl,
        caducidad: new Date(expiresAt).toLocaleDateString('es-ES'),
      },
    });
  }

  await recordUserAudit(actorId, user.id, 'user.create');
  logger.info({ email, actorId }, 'Cuenta creada por el administrador');

  return { userId: user.id, email, activationUrl, expiresAt };
}

/** Vuelve a emitir el enlace de activación de una cuenta pendiente. */
export async function resendActivation(userId: string): Promise<AdminCreatedUser> {
  const user = await findUserById(userId);
  if (!user) throw new NotFoundError('Usuario no encontrado');
  if (user.status !== 'pending') {
    throw new ConflictError('La cuenta ya está activada', 'account_already_active');
  }
  if (!user.email) {
    throw new BadRequestError('La cuenta no tiene correo al que enviar el enlace', 'no_email');
  }

  const ttlMinutes = 14 * 24 * 60;
  const token = await issueVerificationToken(user.id, 'activate_account', ttlMinutes);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const activationUrl = `${env.APP_URL}/activar?token=${token}`;

  await notify({
    event: 'auth.activate_account',
    userId: user.id,
    locale: user.locale as never,
    to: { email: user.email },
    vars: {
      usuario: user.name,
      organizacion: env.APP_NAME,
      enlace: activationUrl,
      caducidad: new Date(expiresAt).toLocaleDateString('es-ES'),
    },
  });

  return { userId: user.id, email: user.email, activationUrl, expiresAt };
}

/**
 * Activa la cuenta con el token del correo y deja la sesión iniciada, para que
 * la persona entre directamente sin tener que volver a escribir sus datos.
 */
export async function activateAccount(
  params: { token: string; password: string; name?: string },
  context: RequestContext = {},
): Promise<AuthenticatedResult> {
  const strength = checkPasswordStrength(params.password, env.PASSWORD_MIN_LENGTH);
  if (!strength.ok) throw new BadRequestError(strength.reason!, 'weak_password');

  const row = await db()
    .selectFrom('verification_tokens')
    .selectAll()
    .where('token_hash', '=', hashToken(params.token, 'activate_account'))
    .where('purpose', '=', 'activate_account')
    .executeTakeFirst();

  if (!row || row.consumed_at || row.expires_at <= isoNow()) {
    throw new BadRequestError(
      'El enlace de activación ha caducado o ya se ha usado',
      'activation_invalid',
    );
  }

  await db()
    .updateTable('verification_tokens')
    .set({ consumed_at: isoNow() })
    .where('id', '=', row.id)
    .execute();

  await db()
    .updateTable('users')
    .set({
      password_hash: await hashPassword(params.password),
      status: 'active',
      email_verified: 1,
      ...(params.name ? { name: params.name } : {}),
      updated_at: isoNow(),
    })
    .where('id', '=', row.user_id)
    .execute();

  const user = await findUserById(row.user_id);
  if (!user) throw new NotFoundError('Usuario no encontrado');

  await linkIdentity({ userId: user.id, provider: 'password', subject: user.email_key });

  return issueSession(user, 'password', true, context);
}

/**
 * Describe un enlace de activación sin consumirlo, para que la pantalla pueda
 * saludar por su nombre y avisar antes de tiempo si ya no vale.
 */
export async function describeActivationToken(
  token: string,
): Promise<{ valid: boolean; name: string | null; email: string | null; expiresAt: string | null }> {
  const row = await db()
    .selectFrom('verification_tokens')
    .innerJoin('users', 'users.id', 'verification_tokens.user_id')
    .select([
      'verification_tokens.expires_at',
      'verification_tokens.consumed_at',
      'users.name',
      'users.email',
    ])
    .where('verification_tokens.token_hash', '=', hashToken(token, 'activate_account'))
    .where('verification_tokens.purpose', '=', 'activate_account')
    .executeTakeFirst();

  if (!row || row.consumed_at || row.expires_at <= isoNow()) {
    return { valid: false, name: null, email: null, expiresAt: null };
  }
  return { valid: true, name: row.name, email: row.email, expiresAt: row.expires_at };
}

/** Añade a alguien a una organización si no estaba ya. */
export async function joinOrganization(
  userId: string,
  organizationId: string,
  role: string,
): Promise<void> {
  const existing = await db()
    .selectFrom('memberships')
    .select(['id'])
    .where('organization_id', '=', organizationId)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing) return;

  await db()
    .insertInto('memberships')
    .values({
      id: newId(),
      organization_id: organizationId,
      user_id: userId,
      role,
      job_title: null,
      bookable: 0,
      active: 1,
      created_at: isoNow(),
      updated_at: isoNow(),
    })
    .execute();
}

async function recordUserAudit(
  actorId: string | null,
  userId: string,
  action: string,
): Promise<void> {
  const { recordAudit } = await import('../audit/service.js');
  await recordAudit({
    actorId,
    actorType: 'system',
    action,
    entityType: 'user',
    entityId: userId,
  });
}

/* -------------------------------------------------------------------------- */
/* Invitaciones                                                                */
/* -------------------------------------------------------------------------- */

export async function acceptInvitation(token: string, userId: string): Promise<string> {
  const invitation = await db()
    .selectFrom('invitations')
    .selectAll()
    .where('token_hash', '=', hashToken(token, 'invitation'))
    .executeTakeFirst();

  if (!invitation || invitation.accepted_at || invitation.expires_at <= isoNow()) {
    throw new BadRequestError('La invitación ha caducado o ya se usó', 'invitation_invalid');
  }

  const existing = await db()
    .selectFrom('memberships')
    .select(['id'])
    .where('organization_id', '=', invitation.organization_id)
    .where('user_id', '=', userId)
    .executeTakeFirst();

  const membershipId = existing?.id ?? newId();
  if (!existing) {
    await db()
      .insertInto('memberships')
      .values({
        id: membershipId,
        organization_id: invitation.organization_id,
        user_id: userId,
        role: invitation.role,
        job_title: null,
        bookable: 0,
        active: 1,
        created_at: isoNow(),
        updated_at: isoNow(),
      })
      .execute();
  }

  const locationIds = invitation.location_ids_json
    ? (JSON.parse(invitation.location_ids_json) as string[])
    : [];
  if (locationIds.length > 0) {
    await db()
      .insertInto('membership_locations')
      .values(locationIds.map((locationId) => ({ membership_id: membershipId, location_id: locationId })))
      .execute();
  }

  await db()
    .updateTable('invitations')
    .set({ accepted_at: isoNow() })
    .where('id', '=', invitation.id)
    .execute();

  return invitation.organization_id;
}

/** `mateo@ejemplo.com` -> `ma***@ejemplo.com` */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return null;
  return `${local.slice(0, 2)}***@${domain}`;
}

export { shortCode };
