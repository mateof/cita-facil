// Import con nombre y no por defecto: bajo `module: NodeNext`, la exportación
// por defecto de `ioredis` se resuelve como espacio de nombres y no se puede
// instanciar.
import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Redis opcional.
 *
 * Sin `REDIS_URL` la aplicación se comporta exactamente igual que hasta ahora:
 * el limitador de peticiones cuenta en memoria del proceso y cada petición
 * autenticada comprueba la sesión contra la base de datos. Redis no guarda
 * nada que no esté ya en SQL, así que perderlo entero no pierde sesiones: solo
 * se vuelve a consultar la base de datos.
 *
 * Aporta dos cosas en una instalación con varias instancias o con mucho
 * tráfico: el cupo del limitador pasa a ser común (si no, cada instancia
 * permite el suyo) y la comprobación de sesión deja de ser una consulta por
 * petición.
 *
 * Si está configurado pero no responde, se registra el aviso y se sigue sin él.
 * Un Redis caído no puede tumbar las reservas.
 */

/**
 * Lo que necesita la caché. Es un subconjunto de `ioredis` para poder sustituir
 * el cliente en las pruebas sin levantar un servidor.
 */
export interface CacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
}

let client: CacheClient | null = null;
/** Solo cuando es un Redis de verdad: el limitador necesita la instancia. */
let realClient: Redis | null = null;
let disabledReason: string | null = null;

export function isRedisEnabled(): boolean {
  return client !== null;
}

/** El cliente, o `null` si no hay Redis. Lo usa el limitador de peticiones. */
export function redisClient(): Redis | null {
  return realClient;
}

/** Sustituye el cliente por un doble en las pruebas. `null` lo desactiva. */
export function setRedisForTests(fake: CacheClient | null): void {
  client = fake;
  realClient = null;
  disabledReason = fake ? null : 'sin configurar';
}

export async function initRedis(): Promise<boolean> {
  if (!env.REDIS_URL) {
    disabledReason = 'sin configurar';
    return false;
  }
  if (client) return true;

  const instance = new Redis(env.REDIS_URL, {
    keyPrefix: env.REDIS_PREFIX,
    // Que un Redis lento no deje peticiones colgadas: mejor seguir sin caché.
    connectTimeout: 3000,
    commandTimeout: 1000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: (times: number) => Math.min(times * 500, 10_000),
  });

  // Sin este manejador, un corte de red tumbaría el proceso con un error no
  // capturado del socket.
  instance.on('error', (error: Error) => {
    logger.warn({ err: error }, 'Error de Redis; se sigue funcionando sin caché');
  });

  try {
    await instance.connect();
    await instance.ping();
    client = instance;
    realClient = instance;
    logger.info({ prefix: env.REDIS_PREFIX }, 'Redis conectado');
    return true;
  } catch (error) {
    disabledReason = 'no responde';
    logger.warn(
      { err: error, url: env.REDIS_URL.replace(/:\/\/.*@/, '://***@') },
      'Redis configurado pero inalcanzable; se continúa sin él',
    );
    instance.disconnect();
    return false;
  }
}

export async function closeRedis(): Promise<void> {
  const instance = realClient;
  client = null;
  realClient = null;
  if (!instance) return;
  await instance.quit().catch(() => instance.disconnect());
}

export function redisStatus(): { enabled: boolean; reason: string | null } {
  return { enabled: client !== null, reason: client ? null : disabledReason };
}

/* -------------------------------------------------------------------------- */
/* Operaciones tolerantes a fallo                                              */
/* -------------------------------------------------------------------------- */

/**
 * Todas devuelven como si no hubiera nada cacheado cuando Redis falla. Quien
 * las llama tiene que funcionar igual sin ellas.
 */
export async function cacheGet(key: string): Promise<string | null> {
  if (!client) return null;
  try {
    return await client.get(key);
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!client || ttlSeconds <= 0) return;
  try {
    await client.set(key, value, 'EX', ttlSeconds);
  } catch {
    // Sin caché se sigue igual.
  }
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  if (!client || keys.length === 0) return;
  try {
    await client.del(...keys);
  } catch {
    // Peor caso: la entrada caduca sola por TTL.
  }
}
