import { randomBytes, randomUUID } from 'node:crypto';

/**
 * UUID v7: 48 bits de marca de tiempo en milisegundos seguidos de aleatoriedad.
 * A diferencia del v4, los identificadores generados consecutivamente quedan
 * ordenados, lo que mantiene compactos los índices de clave primaria en los
 * cuatro motores relacionales y permite ordenar por `id` como aproximación a
 * "por fecha de creación".
 */
export function uuidv7(): string {
  const timestamp = Date.now();
  const bytes = randomBytes(16);

  bytes[0] = (timestamp / 2 ** 40) & 0xff;
  bytes[1] = (timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp / 2 ** 24) & 0xff;
  bytes[3] = (timestamp / 2 ** 16) & 0xff;
  bytes[4] = (timestamp / 2 ** 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Versión 7 y variante RFC 4122.
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const newId = uuidv7;

/** Identificador aleatorio corto en base32 sin caracteres ambiguos. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function shortCode(length = 10): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return out;
}

/** Token opaco en base64url, apto para URL y cabeceras. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export { randomUUID };
