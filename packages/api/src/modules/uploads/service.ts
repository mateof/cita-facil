import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { newId } from '../../lib/ids.js';

/**
 * Ficheros subidos: por ahora solo imágenes de entidades (logotipos, fotos de
 * un servicio o de un recurso, avatares).
 *
 * Viven en el volumen de datos, junto a la base de datos, y los sirve el propio
 * API. No hay almacenamiento externo a propósito: la aplicación se despliega
 * autogestionada y añadir un bucket obligaría a configurar credenciales para
 * guardar cuatro logotipos.
 *
 * El nombre del fichero lo ponemos nosotros y nunca el cliente, así que no hay
 * forma de escaparse del directorio con un `../`. El tipo se comprueba por el
 * contenido, no por lo que diga la petición.
 */

/** Tipos admitidos, con su firma al principio del fichero. */
const TIPOS: { mime: string; ext: string; firma: (bytes: Buffer) => boolean }[] = [
  {
    mime: 'image/png',
    ext: 'png',
    firma: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    firma: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    firma: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    firma: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8'),
  },
];

/**
 * SVG queda fuera a propósito: es un documento que puede llevar `<script>`, y
 * estas imágenes se sirven desde el mismo dominio que la aplicación.
 */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** Carpeta raíz, resuelta una vez para poder comprobar que nada se sale de ella. */
function uploadsRoot(): string {
  return resolve(env.DATA_DIR, 'uploads');
}

/** `019fa0.../a1b2c3.webp`, tal y como se guarda en la base de datos. */
const RUTA_RE = /^[A-Za-z0-9_-]{1,64}\/[a-z0-9]{1,64}\.(png|jpg|webp|gif)$/;

export function isUploadPath(value: string): boolean {
  return RUTA_RE.test(value);
}

/** La dirección pública de un fichero ya guardado. */
export function urlForUpload(relativePath: string): string {
  return `/api/v1/uploads/${relativePath}`;
}

/** Saca la ruta relativa de una URL nuestra. Devuelve `null` si no lo es. */
export function uploadPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const prefijo = '/api/v1/uploads/';
  if (!url.startsWith(prefijo)) return null;
  const ruta = url.slice(prefijo.length);
  return isUploadPath(ruta) ? ruta : null;
}

export interface SaveUploadInput {
  /** Carpeta donde se agrupa. La organización, o `personas` para los avatares. */
  scope: string;
  bytes: Buffer;
}

export interface SavedUpload {
  path: string;
  url: string;
  bytes: number;
  mime: string;
}

export async function saveUpload({ scope, bytes }: SaveUploadInput): Promise<SavedUpload> {
  if (bytes.length === 0) {
    throw new BadRequestError('El fichero está vacío', 'empty_file');
  }
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new BadRequestError('La imagen no puede pasar de 2 MB', 'file_too_large');
  }

  const tipo = TIPOS.find((candidato) => candidato.firma(bytes));
  if (!tipo) {
    throw new BadRequestError(
      'Solo se admiten imágenes PNG, JPEG, WebP o GIF',
      'unsupported_file_type',
    );
  }

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(scope)) {
    throw new BadRequestError('Destino no válido', 'invalid_scope');
  }

  const nombre = `${newId().replace(/-/g, '').slice(0, 24)}.${tipo.ext}`;
  const carpeta = join(uploadsRoot(), scope);
  await mkdir(carpeta, { recursive: true });
  await writeFile(join(carpeta, nombre), bytes);

  const path = `${scope}/${nombre}`;
  logger.info({ path, bytes: bytes.length, mime: tipo.mime }, 'Imagen guardada');
  return { path, url: urlForUpload(path), bytes: bytes.length, mime: tipo.mime };
}

export interface UploadContent {
  bytes: Buffer;
  mime: string;
  etag: string;
}

export async function readUpload(relativePath: string): Promise<UploadContent> {
  if (!isUploadPath(relativePath)) {
    throw new NotFoundError('El fichero no existe', 'upload_not_found');
  }

  const destino = resolve(uploadsRoot(), relativePath);
  // Cinturón y tirantes: aunque el patrón ya lo impide, se comprueba que la
  // ruta resuelta sigue dentro de la carpeta.
  if (!destino.startsWith(uploadsRoot())) {
    throw new NotFoundError('El fichero no existe', 'upload_not_found');
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(destino);
  } catch {
    throw new NotFoundError('El fichero no existe', 'upload_not_found');
  }

  const extension = relativePath.slice(relativePath.lastIndexOf('.') + 1);
  const tipo = TIPOS.find((candidato) => candidato.ext === extension);
  return {
    bytes,
    mime: tipo?.mime ?? 'application/octet-stream',
    etag: createHash('sha256').update(bytes).digest('hex').slice(0, 32),
  };
}

/**
 * Borra un fichero que ya no usa nadie. No se queja si no existe: llega desde
 * el reemplazo de una imagen, y que falte no es motivo para no guardar la nueva.
 */
export async function deleteUpload(relativePath: string | null): Promise<void> {
  if (!relativePath || !isUploadPath(relativePath)) return;
  await rm(resolve(uploadsRoot(), relativePath), { force: true });
}

/** Todos los ficheros guardados, para incluirlos en las copias de seguridad. */
export async function listUploads(): Promise<string[]> {
  const raiz = uploadsRoot();
  let carpetas: string[];
  try {
    carpetas = await readdir(raiz);
  } catch {
    return [];
  }

  const rutas: string[] = [];
  for (const carpeta of carpetas) {
    const info = await stat(join(raiz, carpeta)).catch(() => null);
    if (!info?.isDirectory()) continue;
    for (const fichero of await readdir(join(raiz, carpeta))) {
      const ruta = `${carpeta}/${fichero}`;
      if (isUploadPath(ruta)) rutas.push(ruta);
    }
  }
  return rutas;
}

/** Escribe un fichero venido de una copia de seguridad. */
export async function restoreUpload(relativePath: string, bytes: Buffer): Promise<void> {
  if (!isUploadPath(relativePath)) return;
  const destino = resolve(uploadsRoot(), relativePath);
  if (!destino.startsWith(uploadsRoot())) return;
  await mkdir(join(destino, '..'), { recursive: true });
  await writeFile(destino, bytes);
}
