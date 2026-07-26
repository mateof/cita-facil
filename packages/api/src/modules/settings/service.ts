import { db } from '../../db/index.js';
import { decrypt, encrypt, isEncrypted } from '../../lib/crypto.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';

/**
 * Ajustes por organización que no caben en columnas fijas: credenciales de
 * pasarela de pago, claves de integraciones, parámetros de marca.
 *
 * Los valores marcados como secretos se guardan cifrados con AES-256-GCM
 * usando una clave derivada de `APP_SECRET`. Una copia de la base de datos sin
 * el `.env` no sirve para cobrar en nombre de nadie.
 */

export async function getSetting<T>(
  organizationId: string | null,
  namespace: string,
  key: string,
  fallback: T,
): Promise<T> {
  let query = db()
    .selectFrom('settings')
    .select(['value_json', 'encrypted'])
    .where('namespace', '=', namespace)
    .where('key', '=', key);

  query = organizationId
    ? query.where('organization_id', '=', organizationId)
    : query.where('organization_id', 'is', null);

  const row = await query.executeTakeFirst();
  if (!row?.value_json) return fallback;

  try {
    const raw = row.encrypted === 1 && isEncrypted(row.value_json)
      ? decrypt(row.value_json)
      : row.value_json;
    return JSON.parse(raw) as T;
  } catch (error) {
    logger.error({ err: error, namespace, key }, 'No se pudo leer el ajuste');
    return fallback;
  }
}

export async function setSetting(
  organizationId: string | null,
  namespace: string,
  key: string,
  value: unknown,
  options: { secret?: boolean } = {},
): Promise<void> {
  const serialized = JSON.stringify(value);
  const stored = options.secret ? encrypt(serialized) : serialized;

  let existingQuery = db()
    .selectFrom('settings')
    .select(['id'])
    .where('namespace', '=', namespace)
    .where('key', '=', key);
  existingQuery = organizationId
    ? existingQuery.where('organization_id', '=', organizationId)
    : existingQuery.where('organization_id', 'is', null);

  const existing = await existingQuery.executeTakeFirst();

  if (existing) {
    await db()
      .updateTable('settings')
      .set({
        value_json: stored,
        encrypted: options.secret ? 1 : 0,
        updated_at: isoNow(),
      })
      .where('id', '=', existing.id)
      .execute();
    return;
  }

  await db()
    .insertInto('settings')
    .values({
      id: newId(),
      organization_id: organizationId,
      namespace,
      key,
      value_json: stored,
      encrypted: options.secret ? 1 : 0,
      updated_at: isoNow(),
    })
    .execute();
}

export async function deleteSetting(
  organizationId: string | null,
  namespace: string,
  key: string,
): Promise<void> {
  let query = db().deleteFrom('settings').where('namespace', '=', namespace).where('key', '=', key);
  query = organizationId
    ? query.where('organization_id', '=', organizationId)
    : query.where('organization_id', 'is', null);
  await query.execute();
}

/** Lista los ajustes de un espacio de nombres ocultando los secretos. */
export async function listSettings(
  organizationId: string | null,
  namespace: string,
): Promise<{ key: string; value: unknown; secret: boolean }[]> {
  let query = db()
    .selectFrom('settings')
    .select(['key', 'value_json', 'encrypted'])
    .where('namespace', '=', namespace);
  query = organizationId
    ? query.where('organization_id', '=', organizationId)
    : query.where('organization_id', 'is', null);

  const rows = await query.execute();
  return rows.map((row) => ({
    key: row.key,
    // Los secretos nunca se devuelven, solo se indica si están puestos.
    value: row.encrypted === 1 ? '••••••••' : row.value_json ? JSON.parse(row.value_json) : null,
    secret: row.encrypted === 1,
  }));
}
