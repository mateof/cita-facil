import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) compatible con Google Authenticator, Microsoft Authenticator,
 * Authy, 1Password y cualquier otra aplicación estándar.
 *
 * Se implementa aquí en lugar de añadir una dependencia porque el algoritmo son
 * treinta líneas sobre `node:crypto` y así no arrastramos paquetes sin
 * mantenimiento en un punto sensible de la autenticación.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export interface TotpOptions {
  /** Segundos de validez de cada código. */
  period?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
  /** Ventanas anteriores y posteriores que se aceptan, por desfase de reloj. */
  window?: number;
}

const DEFAULTS: Required<TotpOptions> = {
  period: 30,
  digits: 6,
  // SHA-1 es lo que implementan todas las aplicaciones de autenticación; no es
  // una decisión de seguridad sino de interoperabilidad.
  algorithm: 'sha1',
  window: 1,
};

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Secreto base32 no válido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** Genera un secreto de 20 bytes, el tamaño recomendado por la RFC 4226. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(secret: Buffer, counter: number, options: Required<TotpOptions>): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac(options.algorithm, secret).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** options.digits).padStart(options.digits, '0');
}

export function generateTotp(
  secretBase32: string,
  at: number = Date.now(),
  options: TotpOptions = {},
): string {
  const config = { ...DEFAULTS, ...options };
  const counter = Math.floor(at / 1000 / config.period);
  return hotp(base32Decode(secretBase32), counter, config);
}

/**
 * Verifica un código admitiendo `window` periodos de desfase en cada sentido.
 * La comparación es en tiempo constante para no filtrar información por el
 * tiempo de respuesta.
 */
export function verifyTotp(
  secretBase32: string,
  token: string,
  at: number = Date.now(),
  options: TotpOptions = {},
): boolean {
  const config = { ...DEFAULTS, ...options };
  const normalized = token.replace(/\s/g, '');
  if (normalized.length !== config.digits) return false;

  const secret = base32Decode(secretBase32);
  const counter = Math.floor(at / 1000 / config.period);
  const candidate = Buffer.from(normalized, 'utf8');

  let matched = false;
  for (let delta = -config.window; delta <= config.window; delta += 1) {
    const expected = Buffer.from(hotp(secret, counter + delta, config), 'utf8');
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) {
      matched = true;
    }
  }
  return matched;
}

/** URI `otpauth://` para el código QR de alta en la aplicación de autenticación. */
export function totpUri(params: {
  secret: string;
  accountName: string;
  issuer: string;
  digits?: number;
  period?: number;
}): string {
  const label = encodeURIComponent(`${params.issuer}:${params.accountName}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer: params.issuer,
    algorithm: 'SHA1',
    digits: String(params.digits ?? DEFAULTS.digits),
    period: String(params.period ?? DEFAULTS.period),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}

/** Códigos de recuperación de un solo uso para cuando se pierde el segundo factor. */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}
