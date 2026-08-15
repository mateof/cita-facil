import { pino } from 'pino';
import { env } from '../config/env.js';

/**
 * Logger compartido. Fastify recibe esta misma instancia para que las trazas
 * del arranque, del planificador y de las peticiones salgan por el mismo sitio.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-client-cert"]',
      'password',
      '*.password',
      '*.passwordHash',
      '*.refreshToken',
      '*.accessToken',
      '*.secret',
    ],
    censor: '[oculto]',
  },
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
});

export type Logger = typeof logger;
