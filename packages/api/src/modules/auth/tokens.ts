import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../../config/env.js';
import { deriveKey, hashToken } from '../../lib/crypto.js';
import { db } from '../../db/index.js';
import { newId, randomToken } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { UnauthorizedError } from '../../lib/errors.js';
import { forgetCachedSession } from './session-cache.js';

/**
 * Sesiones en dos piezas:
 *
 * - Un *access token* JWT firmado con HS256, de vida corta (15 minutos por
 *   defecto), que se valida sin tocar la base de datos.
 * - Un *refresh token* opaco y aleatorio, guardado solo como hash, con el que
 *   se renueva el anterior. Al estar en base de datos se puede revocar de
 *   verdad: cerrar sesión en un dispositivo tiene efecto inmediato.
 */

const ISSUER = 'cita-facil';
const AUDIENCE = 'cita-facil-api';
const signingKey = deriveKey('jwt');

export interface AccessTokenClaims extends JWTPayload {
  sub: string;
  sid: string;
  /** Método con el que se autenticó: password, passkey, certificate, oidc. */
  amr: string;
  /** `true` si la sesión ha superado el segundo factor. */
  mfa: boolean;
  role: string;
}

export async function signAccessToken(claims: {
  userId: string;
  sessionId: string;
  method: string;
  mfaSatisfied: boolean;
  platformRole: string;
}): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = env.ACCESS_TOKEN_TTL_MINUTES * 60;
  const token = await new SignJWT({
    sid: claims.sessionId,
    amr: claims.method,
    mfa: claims.mfaSatisfied,
    role: claims.platformRole,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(signingKey);
  return { token, expiresIn };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, signingKey, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    return payload as AccessTokenClaims;
  } catch {
    throw new UnauthorizedError('Token de acceso no válido o caducado', 'invalid_token');
  }
}

export interface CreatedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: string;
}

export async function createSession(params: {
  userId: string;
  method: string;
  mfaSatisfied: boolean;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<CreatedSession> {
  const sessionId = newId();
  const refreshToken = randomToken(48);
  const now = isoNow();
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  ).toISOString();

  await db()
    .insertInto('sessions')
    .values({
      id: sessionId,
      user_id: params.userId,
      refresh_token_hash: hashToken(refreshToken, 'refresh'),
      user_agent: params.userAgent?.slice(0, 400) ?? null,
      ip: params.ip ?? null,
      auth_method: params.method,
      mfa_satisfied: params.mfaSatisfied ? 1 : 0,
      expires_at: expiresAt,
      revoked_at: null,
      last_used_at: now,
      created_at: now,
    })
    .execute();

  return { sessionId, refreshToken, expiresAt };
}

/**
 * Renueva una sesión rotando el refresh token. La rotación es obligatoria: si
 * alguien roba un refresh token y lo usa, el legítimo dejará de funcionar y el
 * robo se hace visible.
 */
export async function rotateSession(refreshToken: string): Promise<{
  session: { id: string; userId: string; method: string; mfaSatisfied: boolean };
  refreshToken: string;
}> {
  const hash = hashToken(refreshToken, 'refresh');
  const session = await db()
    .selectFrom('sessions')
    .selectAll()
    .where('refresh_token_hash', '=', hash)
    .executeTakeFirst();

  if (!session || session.revoked_at || session.expires_at <= isoNow()) {
    throw new UnauthorizedError('La sesión ha caducado o ha sido revocada', 'invalid_session');
  }

  const next = randomToken(48);
  await db()
    .updateTable('sessions')
    .set({
      refresh_token_hash: hashToken(next, 'refresh'),
      last_used_at: isoNow(),
      expires_at: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000).toISOString(),
    })
    .where('id', '=', session.id)
    .execute();

  return {
    session: {
      id: session.id,
      userId: session.user_id,
      method: session.auth_method,
      mfaSatisfied: session.mfa_satisfied === 1,
    },
    refreshToken: next,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await db()
    .updateTable('sessions')
    .set({ revoked_at: isoNow() })
    .where('id', '=', sessionId)
    .execute();
  // La caché se borra en el momento: cerrar sesión tiene que notarse ya, no
  // cuando caduque la entrada.
  await forgetCachedSession(sessionId);
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
  let base = db().selectFrom('sessions').select('id').where('user_id', '=', userId);
  if (exceptSessionId) base = base.where('id', '!=', exceptSessionId);
  const afectadas = await base.where('revoked_at', 'is', null).execute();

  let query = db()
    .updateTable('sessions')
    .set({ revoked_at: isoNow() })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  if (exceptSessionId) query = query.where('id', '!=', exceptSessionId);
  const result = await query.executeTakeFirst();

  await forgetCachedSession(...afectadas.map((row) => row.id));
  return Number(result.numUpdatedRows ?? 0);
}

export async function isSessionActive(sessionId: string): Promise<boolean> {
  const row = await db()
    .selectFrom('sessions')
    .select(['id', 'revoked_at', 'expires_at'])
    .where('id', '=', sessionId)
    .executeTakeFirst();
  return Boolean(row && !row.revoked_at && row.expires_at > isoNow());
}

/** Elimina sesiones caducadas y retos consumidos. Lo llama el planificador. */
export async function purgeExpiredSessions(): Promise<number> {
  const now = isoNow();
  const sessions = await db().deleteFrom('sessions').where('expires_at', '<', now).executeTakeFirst();
  await db().deleteFrom('auth_challenges').where('expires_at', '<', now).execute();
  await db().deleteFrom('verification_tokens').where('expires_at', '<', now).execute();
  await db().deleteFrom('trusted_devices').where('expires_at', '<', now).execute();
  return Number(sessions.numDeletedRows ?? 0);
}
