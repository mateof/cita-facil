import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { env } from '../config/env.js';

const MASTER_KEY = Buffer.from(env.APP_SECRET, 'utf8');

/**
 * Deriva una clave de 32 bytes para un propósito concreto. Cada uso (cifrado
 * de ajustes, firma de códigos de acceso, tokens de descarga, ...) recibe su
 * propia clave a partir del mismo secreto maestro, de forma que comprometer
 * una no compromete las demás.
 */
export function deriveKey(purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', MASTER_KEY, Buffer.alloc(0), `cita-facil:${purpose}`, length));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash con clave, para guardar tokens en base de datos sin poder revertirlos. */
export function hashToken(token: string, purpose = 'token'): string {
  return createHmac('sha256', deriveKey(`hash:${purpose}`)).update(token).digest('hex');
}

/** Comparación en tiempo constante, tolerante a longitudes distintas. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // Se compara igualmente contra sí mismo para no filtrar la longitud por tiempo.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

/** Firma HMAC en base64url, usada en códigos de acceso y webhooks. */
export function sign(payload: string, purpose = 'sign'): string {
  return createHmac('sha256', deriveKey(`sign:${purpose}`)).update(payload).digest('base64url');
}

export function verifySignature(payload: string, signature: string, purpose = 'sign'): boolean {
  return safeEqual(sign(payload, purpose), signature);
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Cifra un texto con AES-256-GCM. Formato del resultado:
 * `v1.<iv base64url>.<tag base64url>.<ciphertext base64url>`.
 */
export function encrypt(plaintext: string, purpose = 'settings'): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(`enc:${purpose}`), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decrypt(payload: string, purpose = 'settings'): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Formato de texto cifrado no reconocido');
  }
  const iv = Buffer.from(parts[1]!, 'base64url');
  const tag = Buffer.from(parts[2]!, 'base64url');
  const data = Buffer.from(parts[3]!, 'base64url');
  if (iv.length !== IV_LENGTH || tag.length !== TAG_LENGTH) {
    throw new Error('Texto cifrado corrupto');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(`enc:${purpose}`), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: string): boolean {
  return value.startsWith('v1.') && value.split('.').length === 4;
}

/** Cifra un flujo de bytes (backups). Devuelve iv + tag + datos concatenados. */
export function encryptBuffer(data: Buffer, purpose = 'backup'): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(`enc:${purpose}`), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

export function decryptBuffer(data: Buffer, purpose = 'backup'): Buffer {
  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const body = data.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(`enc:${purpose}`), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

export { randomBytes };
