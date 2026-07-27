import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { listUploads, readUpload, restoreUpload } from '../uploads/service.js';
import { db } from '../../db/index.js';
import { deriveKey } from '../../lib/crypto.js';
import { isoNow } from '../../lib/dates.js';
import { newId } from '../../lib/ids.js';
import { logger } from '../../lib/logger.js';
import { NotFoundError, BadRequestError } from '../../lib/errors.js';

/**
 * Copias de seguridad lógicas.
 *
 * En lugar de volcar el fichero de la base de datos o de invocar `pg_dump`, se
 * exporta el contenido tabla a tabla en NDJSON comprimido. El coste es que la
 * restauración es más lenta que un volcado nativo, y a cambio se obtienen dos
 * cosas que importan aquí: el mismo formato de copia funciona en los cinco
 * motores, y una copia hecha en SQLite se puede restaurar en PostgreSQL, que es
 * justo el camino que sigue una instalación que empieza pequeña y crece.
 */

/** Orden de exportación. Al restaurar se recorre igual; al borrar, al revés. */
export const TABLE_ORDER = [
  'organizations',
  'locations',
  'settings',
  'users',
  'identities',
  'webauthn_credentials',
  'sessions',
  'auth_challenges',
  'trusted_devices',
  'verification_tokens',
  'memberships',
  'membership_locations',
  'invitations',
  'service_categories',
  'resources',
  'services',
  'service_resources',
  'schedules',
  'schedule_exceptions',
  'time_off',
  'appointment_recurrences',
  'appointments',
  'waitlist_entries',
  'reviews',
  'idempotency_keys',
  'notification_preferences',
  'notification_templates',
  'notifications',
  'reminder_rules',
  'push_devices',
  'messaging_links',
  'payments',
  'credit_packs',
  'credit_wallets',
  'credit_ledger',
  'api_keys',
  'webhook_endpoints',
  'webhook_deliveries',
  'audit_logs',
  'access_logs',
  'backups',
] as const;

/**
 * Columna por la que paginar cada tabla. SQL Server exige `ORDER BY` para poder
 * usar `OFFSET`, así que la exportación siempre ordena. Casi todas las tablas
 * tienen `id`; las dos de relación N:M no.
 */
const ORDER_COLUMN: Record<string, string> = {
  membership_locations: 'membership_id',
  service_resources: 'service_id',
};

const BACKUP_FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
/** Filas por lote al leer y al insertar. */
const BATCH_SIZE = 500;

export interface BackupRecord {
  id: string;
  filename: string;
  sizeBytes: number;
  dbClient: string;
  format: string;
  encrypted: boolean;
  checksum: string | null;
  trigger: string;
  status: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export function backupDir(): string {
  return resolve(env.BACKUP_DIR);
}

async function ensureBackupDir(): Promise<string> {
  const dir = backupDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

function backupFilename(encrypted: boolean): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `cita-facil-${stamp}.ndjson.gz${encrypted ? '.enc' : ''}`;
}

/** Genera las líneas NDJSON del volcado, tabla a tabla y por lotes. */
async function* exportLines(): AsyncGenerator<string> {
  yield `${JSON.stringify({
    type: 'header',
    version: BACKUP_FORMAT_VERSION,
    createdAt: isoNow(),
    dbClient: env.DB_CLIENT,
    appName: env.APP_NAME,
    tables: TABLE_ORDER,
  })}\n`;

  for (const table of TABLE_ORDER) {
    // La tabla de copias se exporta vacía: su contenido describe copias del
    // sistema de ficheros de origen y no tiene sentido arrastrarlo.
    if (table === 'backups') {
      yield `${JSON.stringify({ type: 'table', table, rows: 0 })}\n`;
      continue;
    }

    let offset = 0;
    let total = 0;
    const rows: unknown[] = [];
    for (;;) {
      const batch = await db()
        .selectFrom(table as never)
        .selectAll()
        .orderBy((ORDER_COLUMN[table] ?? 'id') as never)
        .limit(BATCH_SIZE)
        .offset(offset)
        .execute();
      if (batch.length === 0) break;
      rows.push(...batch);
      offset += batch.length;
      total += batch.length;
      if (batch.length < BATCH_SIZE) break;
    }

    yield `${JSON.stringify({ type: 'table', table, rows: total })}\n`;
    for (const row of rows) {
      yield `${JSON.stringify({ type: 'row', table, data: row })}\n`;
    }
  }

  // Las imágenes de las entidades viven en el disco, no en la base de datos, y
  // sin ellas una copia restaurada dejaría a los servicios y a los negocios sin
  // su logotipo. Van en base64 al final, que es donde menos estorban si alguien
  // lee el fichero a mano.
  for (const ruta of await listUploads()) {
    const contenido = await readUpload(ruta).catch(() => null);
    if (!contenido) continue;
    yield `${JSON.stringify({ type: 'file', path: ruta, data: contenido.bytes.toString('base64') })}\n`;
  }

  yield `${JSON.stringify({ type: 'end' })}\n`;
}

export interface CreateBackupOptions {
  trigger?: 'manual' | 'scheduled' | 'cli';
  encrypt?: boolean;
}

export async function createBackup(options: CreateBackupOptions = {}): Promise<BackupRecord> {
  const dir = await ensureBackupDir();
  const encrypt = options.encrypt ?? env.BACKUP_ENCRYPT;
  const filename = backupFilename(encrypt);
  const target = join(dir, filename);
  const id = newId();
  const startedAt = isoNow();

  await db()
    .insertInto('backups')
    .values({
      id,
      filename,
      size_bytes: 0,
      db_client: env.DB_CLIENT,
      format: encrypt ? 'ndjson.gz.enc' : 'ndjson.gz',
      encrypted: encrypt ? 1 : 0,
      checksum: null,
      trigger: options.trigger ?? 'manual',
      status: 'running',
      error: null,
      started_at: startedAt,
      finished_at: null,
    })
    .execute();

  try {
    const hash = createHash('sha256');
    const source = Readable.from(exportLines());
    const gzip = createGzip({ level: 6 });

    if (encrypt) {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv('aes-256-gcm', deriveKey('enc:backup'), iv);
      const out = createWriteStream(target);
      out.write(iv);
      // El hash se calcula sobre el texto plano comprimido, antes de cifrar,
      // para poder verificar la integridad del contenido tras descifrar.
      gzip.on('data', (chunk: Buffer) => hash.update(chunk));
      await pipeline(source, gzip, cipher, out, { end: false });
      out.write(cipher.getAuthTag());
      await new Promise<void>((done, fail) => out.end((error?: Error) => (error ? fail(error) : done())));
    } else {
      gzip.on('data', (chunk: Buffer) => hash.update(chunk));
      await pipeline(source, gzip, createWriteStream(target));
    }

    const info = await stat(target);
    const record = {
      size_bytes: info.size,
      checksum: hash.digest('hex'),
      status: 'completed',
      finished_at: isoNow(),
    };
    await db().updateTable('backups').set(record).where('id', '=', id).execute();

    logger.info({ filename, sizeBytes: info.size, encrypt }, 'Copia de seguridad creada');
    await pruneBackups();

    return {
      id,
      filename,
      sizeBytes: info.size,
      dbClient: env.DB_CLIENT,
      format: encrypt ? 'ndjson.gz.enc' : 'ndjson.gz',
      encrypted: encrypt,
      checksum: record.checksum,
      trigger: options.trigger ?? 'manual',
      status: 'completed',
      error: null,
      startedAt,
      finishedAt: record.finished_at,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db()
      .updateTable('backups')
      .set({ status: 'failed', error: message.slice(0, 1000), finished_at: isoNow() })
      .where('id', '=', id)
      .execute();
    await rm(target, { force: true });
    logger.error({ err: error, filename }, 'Fallo al crear la copia de seguridad');
    throw error;
  }
}

/** Abre el fichero de copia y devuelve un flujo de texto NDJSON descomprimido. */
async function openBackupStream(target: string, encrypted: boolean): Promise<NodeJS.ReadableStream> {
  if (!encrypted) {
    return createReadStream(target).pipe(createGunzip());
  }

  const info = await stat(target);
  const iv = await readRange(target, 0, IV_LENGTH - 1);
  const tag = await readRange(target, info.size - TAG_LENGTH, info.size - 1);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey('enc:backup'), iv);
  decipher.setAuthTag(tag);
  return createReadStream(target, { start: IV_LENGTH, end: info.size - TAG_LENGTH - 1 })
    .pipe(decipher)
    .pipe(createGunzip());
}

interface BackupHeader {
  version: number;
  createdAt: string;
  dbClient: string;
  tables: string[];
}

/** Lee solo la primera línea de la copia, que es su encabezado. */
async function readBackupHeader(target: string, encrypted: boolean): Promise<BackupHeader> {
  const stream = await openBackupStream(target, encrypted);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of reader) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as BackupHeader & { type?: string };
      if (entry.type !== 'header') break;
      return entry;
    }
  } finally {
    reader.close();
    (stream as unknown as { destroy?: () => void }).destroy?.();
  }

  throw new BadRequestError('La copia no tiene encabezado válido', 'backup_invalid');
}

async function readRange(path: string, start: number, end: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of createReadStream(path, { start, end })) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export interface RestoreOptions {
  /** Vacía las tablas antes de insertar. Sin esto solo se añaden filas. */
  truncate?: boolean;
  /** Tablas a excluir de la restauración. */
  skipTables?: string[];
}

export interface RestoreResult {
  tables: number;
  rows: number;
  skipped: string[];
  /** Imágenes de entidades restauradas junto a las tablas. */
  files: number;
}

/**
 * Restaura una copia. Es una operación destructiva con `truncate: true`, así
 * que antes de vaciar nada se genera una copia de seguridad automática de
 * seguridad, salvo que la copia esté corrupta y falle la lectura del encabezado.
 */
export async function restoreBackup(
  filename: string,
  options: RestoreOptions = {},
): Promise<RestoreResult> {
  const target = join(backupDir(), sanitizeFilename(filename));
  const info = await stat(target).catch(() => null);
  if (!info) throw new NotFoundError('La copia de seguridad no existe');

  const encrypted = filename.endsWith('.enc');
  const skip = new Set(options.skipTables ?? []);

  // El encabezado se valida con una lectura previa y aparte. Es importante que
  // ocurra ANTES de vaciar nada: una copia corrupta o de otra versión no debe
  // llegar a borrar los datos actuales. Además, abrir el flujo definitivo solo
  // cuando se va a consumir evita perder líneas mientras se hace la copia de
  // seguridad previa, que tarda.
  const header = await readBackupHeader(target, encrypted);
  if (header.version !== BACKUP_FORMAT_VERSION) {
    throw new BadRequestError(
      `Formato de copia no compatible (versión ${header.version}, se esperaba ${BACKUP_FORMAT_VERSION})`,
    );
  }

  if (options.truncate) {
    await createBackup({ trigger: 'manual' }).catch((error) => {
      logger.warn({ err: error }, 'No se pudo crear la copia previa a la restauración');
    });
    for (const table of [...TABLE_ORDER].reverse()) {
      if (skip.has(table)) continue;
      await db().deleteFrom(table as never).execute();
    }
  }

  const stream = await openBackupStream(target, encrypted);
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  const buffers = new Map<string, Record<string, unknown>[]>();
  const seenTables = new Set<string>();
  let rows = 0;
  let files = 0;

  const flush = async (table: string): Promise<void> => {
    const pending = buffers.get(table);
    if (!pending || pending.length === 0) return;
    await db().insertInto(table as never).values(pending as never).execute();
    buffers.set(table, []);
  };

  for await (const line of reader) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as Record<string, any>;

    if (entry.type === 'header' || entry.type === 'table' || entry.type === 'end') continue;
    if (entry.type === 'file') {
      await restoreUpload(entry.path as string, Buffer.from(entry.data as string, 'base64'));
      files += 1;
      continue;
    }
    if (entry.type === 'row') {
      const table = entry.table as string;
      if (skip.has(table)) continue;
      seenTables.add(table);
      const pending = buffers.get(table) ?? [];
      pending.push(entry.data as Record<string, unknown>);
      buffers.set(table, pending);
      rows += 1;
      if (pending.length >= BATCH_SIZE) await flush(table);
    }
  }

  // Se vuelca en el orden canónico para respetar las claves ajenas.
  for (const table of TABLE_ORDER) {
    await flush(table);
  }

  logger.warn({ filename, rows, files, tables: seenTables.size }, 'Copia restaurada');
  return { tables: seenTables.size, rows, files, skipped: [...skip] };
}

export async function listBackups(): Promise<BackupRecord[]> {
  const rows = await db()
    .selectFrom('backups')
    .selectAll()
    .orderBy('started_at', 'desc')
    .limit(200)
    .execute();
  return rows.map((row) => ({
    id: row.id,
    filename: row.filename,
    sizeBytes: Number(row.size_bytes),
    dbClient: row.db_client,
    format: row.format,
    encrypted: row.encrypted === 1,
    checksum: row.checksum,
    trigger: row.trigger,
    status: row.status,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

/** Ficheros de copia presentes en disco, aunque no estén en la tabla. */
export async function listBackupFiles(): Promise<{ filename: string; sizeBytes: number }[]> {
  const dir = await ensureBackupDir();
  const entries = await readdir(dir).catch(() => []);
  const files: { filename: string; sizeBytes: number }[] = [];
  for (const entry of entries) {
    if (!entry.includes('.ndjson.gz')) continue;
    const info = await stat(join(dir, entry));
    files.push({ filename: entry, sizeBytes: info.size });
  }
  return files.sort((a, b) => b.filename.localeCompare(a.filename));
}

export async function deleteBackup(filename: string): Promise<void> {
  const safe = sanitizeFilename(filename);
  await rm(join(backupDir(), safe), { force: true });
  await db().deleteFrom('backups').where('filename', '=', safe).execute();
}

export function backupPath(filename: string): string {
  return join(backupDir(), sanitizeFilename(filename));
}

/** Aplica la política de retención por antigüedad y por número de ficheros. */
export async function pruneBackups(): Promise<number> {
  const files = await listBackupFiles();
  const cutoff = Date.now() - env.BACKUP_RETENTION_DAYS * 86_400_000;
  let removed = 0;

  for (const [index, file] of files.entries()) {
    const stamp = extractTimestamp(file.filename);
    const tooOld = env.BACKUP_RETENTION_DAYS > 0 && stamp !== null && stamp < cutoff;
    const tooMany = env.BACKUP_MAX_FILES > 0 && index >= env.BACKUP_MAX_FILES;
    if (tooOld || tooMany) {
      await deleteBackup(file.filename);
      removed += 1;
    }
  }
  if (removed > 0) logger.info({ removed }, 'Copias antiguas eliminadas');
  return removed;
}

function extractTimestamp(filename: string): number | null {
  const match = /cita-facil-(.+?)\.ndjson/.exec(filename);
  if (!match) return null;
  const iso = match[1]!.replace(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1-$2-$3T$4:$5:$6.$7Z',
  );
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Evita el salto de directorio en nombres recibidos por la API. */
function sanitizeFilename(filename: string): string {
  const base = filename.replace(/[/\\]/g, '');
  if (!base || base.startsWith('.')) throw new BadRequestError('Nombre de copia no válido');
  return base;
}
