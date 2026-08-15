import { db } from '../../db/index.js';
import { hashToken } from '../../lib/crypto.js';
import { isoNow } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { BadRequestError, UnauthorizedError } from '../../lib/errors.js';

/**
 * Retos de corta vida usados por el flujo de autenticación: segundo factor
 * pendiente, retos de WebAuthn, `state` de OIDC y códigos de vinculación de
 * mensajería. Todos comparten tabla porque comparten ciclo de vida (se crean,
 * caducan y se consumen una sola vez) y así hay un único sitio donde purgarlos.
 */

export type ChallengeKind =
  | 'mfa'
  | 'webauthn_registration'
  | 'webauthn_authentication'
  | 'oidc_state'
  | 'messaging_link';

export interface Challenge<T = unknown> {
  id: string;
  userId: string | null;
  kind: ChallengeKind;
  payload: T;
  attempts: number;
}

export interface CreateChallengeInput<T> {
  kind: ChallengeKind;
  userId?: string | null;
  payload?: T;
  /** Código que el usuario tendrá que introducir; se guarda solo su hash. */
  code?: string;
  ttlSeconds?: number;
}

export async function createChallenge<T>(input: CreateChallengeInput<T>): Promise<string> {
  const id = newId();
  await db()
    .insertInto('auth_challenges')
    .values({
      id,
      user_id: input.userId ?? null,
      kind: input.kind,
      payload_json: input.payload === undefined ? null : JSON.stringify(input.payload),
      code_hash: input.code ? hashToken(input.code, 'challenge') : null,
      attempts: 0,
      expires_at: new Date(Date.now() + (input.ttlSeconds ?? 600) * 1000).toISOString(),
      consumed_at: null,
      created_at: isoNow(),
    })
    .execute();
  return id;
}

async function load(id: string, kind: ChallengeKind) {
  const row = await db()
    .selectFrom('auth_challenges')
    .selectAll()
    .where('id', '=', id)
    .where('kind', '=', kind)
    .executeTakeFirst();

  if (!row || row.consumed_at || row.expires_at <= isoNow()) {
    throw new UnauthorizedError('El proceso ha caducado, vuelve a empezar', 'challenge_expired');
  }
  return row;
}

export async function peekChallenge<T>(id: string, kind: ChallengeKind): Promise<Challenge<T>> {
  const row = await load(id, kind);
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as ChallengeKind,
    payload: (row.payload_json ? JSON.parse(row.payload_json) : null) as T,
    attempts: row.attempts,
  };
}

/**
 * Consume un reto. Si lleva código asociado lo comprueba y descuenta intentos:
 * a los cinco fallos el reto se invalida, para que un código de seis dígitos no
 * se pueda adivinar por fuerza bruta.
 */
export async function consumeChallenge<T>(
  id: string,
  kind: ChallengeKind,
  code?: string,
): Promise<Challenge<T>> {
  const row = await load(id, kind);

  if (row.code_hash) {
    if (!code) throw new BadRequestError('Falta el código de verificación', 'code_required');
    if (row.attempts >= 5) {
      await db()
        .updateTable('auth_challenges')
        .set({ consumed_at: isoNow() })
        .where('id', '=', id)
        .execute();
      throw new UnauthorizedError('Demasiados intentos fallidos', 'too_many_attempts');
    }
    if (hashToken(code.trim(), 'challenge') !== row.code_hash) {
      await db()
        .updateTable('auth_challenges')
        .set({ attempts: row.attempts + 1 })
        .where('id', '=', id)
        .execute();
      throw new UnauthorizedError('Código incorrecto', 'invalid_code');
    }
  }

  await db()
    .updateTable('auth_challenges')
    .set({ consumed_at: isoNow() })
    .where('id', '=', id)
    .execute();

  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind as ChallengeKind,
    payload: (row.payload_json ? JSON.parse(row.payload_json) : null) as T,
    attempts: row.attempts,
  };
}

export async function invalidateChallenges(userId: string, kind: ChallengeKind): Promise<void> {
  await db()
    .updateTable('auth_challenges')
    .set({ consumed_at: isoNow() })
    .where('user_id', '=', userId)
    .where('kind', '=', kind)
    .where('consumed_at', 'is', null)
    .execute();
}
