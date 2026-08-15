import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { buildApp } from './app.js';
import { closeDatabase, db, initDatabase } from './db/index.js';
import { closeRedis, initRedis } from './lib/redis.js';
import { ensureBootstrapAdmin, seedDemoData } from './db/seed.js';
import { startScheduler, stopScheduler } from './jobs/scheduler.js';

/**
 * Punto de entrada. El orden importa: primero la base de datos (que aplica las
 * migraciones si hace falta), luego el servidor HTTP y por último el
 * planificador, para que no empiece a despachar avisos antes de que el esquema
 * esté listo.
 */
async function main(): Promise<void> {
  await initDatabase();
  // Opcional: si no está configurado o no responde, se sigue sin él.
  await initRedis();
  await ensureBootstrapAdmin(db());

  if (env.DB_AUTO_SEED) {
    await seedDemoData(db());
  }

  const app = await buildApp();

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(
    { url: env.APP_URL, port: env.PORT, dbClient: env.DB_CLIENT },
    `${env.APP_NAME} en marcha`,
  );

  if (env.SCHEDULER_ENABLED) {
    startScheduler();
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Cerrando');
    stopScheduler();
    // `close` espera a que terminen las peticiones en curso antes de cortar.
    await app.close().catch((error) => logger.error({ err: error }, 'Error cerrando el servidor'));
    await closeDatabase().catch((error) => logger.error({ err: error }, 'Error cerrando la base de datos'));
    await closeRedis().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  logger.fatal({ err: error }, 'No se pudo arrancar la aplicación');
  process.exit(1);
});
