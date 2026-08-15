import { hash, verify, Algorithm } from '@node-rs/argon2';

/**
 * Parámetros de Argon2id. Son los recomendados por OWASP para servidores
 * generales: 19 MiB de memoria, 2 iteraciones y paralelismo 1. Suben el coste
 * de un ataque por fuerza bruta sin penalizar el login por encima de ~50 ms en
 * hardware modesto, que es lo que suele alojar una instalación autogestionada.
 */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    return false;
  }
}

/**
 * Contraseñas que aparecen en todas las listas de credenciales filtradas. Se
 * rechazan aunque cumplan la longitud mínima: son el primer intento de
 * cualquier ataque por diccionario.
 */
const BANNED = new Set([
  'contraseña',
  'contrasena1',
  '1234567890',
  '12345678901',
  '123456789012',
  'qwertyuiop',
  'password123',
  'passwordpassword',
  'administrador',
  'adminadmin1',
  'iloveyou123',
  'bienvenido1',
  'welcome1234',
  'letmein1234',
]);

export interface PasswordCheck {
  ok: boolean;
  reason?: string;
}

export function checkPasswordStrength(plain: string, minLength: number): PasswordCheck {
  if (plain.length < minLength) {
    return { ok: false, reason: `La contraseña debe tener al menos ${minLength} caracteres` };
  }
  const normalized = plain.toLowerCase();
  if (BANNED.has(normalized)) {
    return { ok: false, reason: 'Esa contraseña aparece en listas de credenciales filtradas' };
  }
  if (/^(.)\1+$/.test(plain)) {
    return { ok: false, reason: 'La contraseña no puede ser un único carácter repetido' };
  }
  const distinct = new Set(plain).size;
  if (distinct < 5) {
    return { ok: false, reason: 'La contraseña necesita más variedad de caracteres' };
  }
  return { ok: true };
}
