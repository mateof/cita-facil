import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { isoNow } from '../../lib/dates.js';
import { cacheDelete, cacheGet, cacheSet, isRedisEnabled } from '../../lib/redis.js';

/**
 * Caché del estado de la sesión.
 *
 * La sesión vive en la tabla `sessions` y sobrevive a los reinicios; esto no
 * cambia dónde se guarda, solo evita ir a la base de datos en cada petición
 * autenticada. Sin Redis se consulta siempre, que es el comportamiento de
 * siempre.
 *
 * La revocación sigue siendo inmediata porque cerrar sesión borra la entrada
 * (ver `revokeSession`). El TTL solo acota cuánto puede tardar en notarse un
 * cambio hecho por fuera, como editar la fila a mano.
 */

function key(sessionId: string): string {
  return `session:${sessionId}`;
}

export interface SessionState {
  /** `true` si la sesión existe, no está revocada y no ha caducado. */
  active: boolean;
  expiresAt: string | null;
}

async function readFromDatabase(sessionId: string): Promise<SessionState> {
  const row = await db()
    .selectFrom('sessions')
    .select(['id', 'revoked_at', 'expires_at'])
    .where('id', '=', sessionId)
    .executeTakeFirst();

  if (!row || row.revoked_at || row.expires_at <= isoNow()) {
    return { active: false, expiresAt: row?.expires_at ?? null };
  }
  return { active: true, expiresAt: row.expires_at };
}

export async function sessionState(sessionId: string): Promise<SessionState> {
  if (!isRedisEnabled() || env.REDIS_SESSION_TTL <= 0) {
    return readFromDatabase(sessionId);
  }

  const cached = await cacheGet(key(sessionId));
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as SessionState;
      // Una sesión cacheada como activa puede haber caducado dentro del TTL.
      if (parsed.active && parsed.expiresAt && parsed.expiresAt <= isoNow()) {
        return { active: false, expiresAt: parsed.expiresAt };
      }
      return parsed;
    } catch {
      // Entrada corrupta: se rehace desde la base de datos.
    }
  }

  const state = await readFromDatabase(sessionId);
  // También se cachea el "no vale": es lo que evita que un token robado de una
  // sesión ya cerrada golpee la base de datos en cada intento.
  await cacheSet(key(sessionId), JSON.stringify(state), env.REDIS_SESSION_TTL);
  return state;
}

export async function forgetCachedSession(...sessionIds: string[]): Promise<void> {
  if (sessionIds.length === 0) return;
  await cacheDelete(...sessionIds.map(key));
}
