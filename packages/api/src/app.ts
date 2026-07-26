import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { redisClient } from './lib/redis.js';
import authPlugin from './plugins/auth.js';
import errorHandlerPlugin from './plugins/error-handler.js';
import { registerRoutes } from './routes/index.js';

/**
 * Construcción de la aplicación.
 *
 * El frontend compilado se sirve desde este mismo proceso y puerto: el
 * navegador pide `/` y recibe la SPA, y `/api/v1/...` va al backend. Se puede
 * desacoplar poniendo `SERVE_WEB=false` y publicando `packages/web/dist` en
 * otro sitio, sin tocar código.
 */
export async function buildApp(): Promise<FastifyInstance> {
  // El tipo que infiere Fastify queda ligado a la instancia concreta de pino;
  // se normaliza a `FastifyInstance` para que los plugins y las rutas usen el
  // tipo genérico y no haya que propagar el del logger por toda la aplicación.
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: env.TRUST_PROXY,
    disableRequestLogging: env.LOG_LEVEL !== 'debug' && env.LOG_LEVEL !== 'trace',
    bodyLimit: 5 * 1024 * 1024,
    // Cabecera estándar de trazabilidad si el proxy la envía.
    genReqId: (request) =>
      (request.headers['x-request-id'] as string | undefined) ??
      `req_${Math.random().toString(36).slice(2, 12)}`,
  }) as unknown as FastifyInstance;

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);

  await app.register(helmet, {
    // La SPA necesita poder cargar sus propios recursos y conectarse al API.
    contentSecurityPolicy: env.isProduction
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
            connectSrc: ["'self'", 'https:'],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : true,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });

  await app.register(cookie, {
    secret: env.APP_SECRET,
    parseOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE,
      domain: env.COOKIE_DOMAIN,
      path: '/',
    },
  });

  await app.register(formbody);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_MAX,
    timeWindow: env.RATE_LIMIT_WINDOW,
    // Con Redis el cupo es común a todas las instancias; sin él cada proceso
    // cuenta el suyo, que es lo que hacía hasta ahora.
    ...(redisClient() ? { redis: redisClient()! } : {}),
    // Las claves de API tienen su propio cupo, más generoso, porque una puerta
    // consultando cada pocos segundos no es un abuso.
    keyGenerator: (request) => {
      const apiKey = request.headers['x-api-key'];
      return typeof apiKey === 'string' ? `key:${apiKey.slice(0, 24)}` : request.ip;
    },
    allowList: (request) => request.url.startsWith('/health'),
  });

  await app.register(authPlugin);

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: `${env.APP_NAME} API`,
        description:
          'API de gestión de citas. Autenticación por token de sesión (Bearer) o por clave de API de organización (cabecera x-api-key).',
        version: '1.0.0',
      },
      servers: [{ url: env.APP_URL }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
        },
      },
      tags: [
        { name: 'auth', description: 'Autenticación y sesiones' },
        { name: 'perfil', description: 'Datos y preferencias del usuario' },
        { name: 'catalogo', description: 'Organizaciones, sedes, recursos y servicios' },
        { name: 'disponibilidad', description: 'Consulta de huecos libres' },
        { name: 'citas', description: 'Reserva y gestión de citas' },
        { name: 'acceso', description: 'Validación de acceso físico' },
        { name: 'notificaciones', description: 'Avisos y recordatorios' },
        { name: 'pagos', description: 'Cobros y devoluciones' },
        { name: 'informes', description: 'Estadísticas' },
        { name: 'administracion', description: 'Copias de seguridad y mantenimiento' },
        { name: 'integraciones', description: 'Claves de API, webhooks y asistentes' },
        { name: 'publico', description: 'Endpoints sin autenticación para la página de reservas' },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  await app.register(registerRoutes, { prefix: '/api/v1' });

  app.get('/health', { schema: { hide: true } }, async () => ({
    status: 'ok',
    name: env.APP_NAME,
    version: '1.0.0',
    time: new Date().toISOString(),
  }));

  const servingWeb = env.SERVE_WEB ? await registerWebApp(app) : false;

  app.setNotFoundHandler((request, reply) => {
    // Con el frontend integrado, cualquier ruta que no sea del API la resuelve
    // el enrutador del cliente, así que se devuelve la aplicación.
    if (servingWeb && !request.url.startsWith('/api/') && request.method === 'GET') {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({
      error: {
        code: 'not_found',
        message: `No existe la ruta ${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  return app;
}

/**
 * Ficheros con el contenido en el nombre, que se pueden cachear para siempre.
 *
 * Vite los nombra `index-BtlG3XDX.js`: el separador es un guion y el resumen no
 * es hexadecimal. Buscar `nombre.hash.js` no encontraba ninguno, así que todo
 * el paquete se estaba sirviendo sin caché de largo plazo.
 */
const HASHED_ASSET = /-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

/**
 * Sirve la SPA compilada. Devuelve `true` si se ha montado, para que el
 * manejador de rutas desconocidas sepa si puede caer en `index.html`.
 */
async function registerWebApp(app: FastifyInstance): Promise<boolean> {
  const distPath = resolve(
    env.WEB_DIST_PATH ?? join(process.cwd(), 'packages', 'web', 'dist'),
  );

  if (!existsSync(join(distPath, 'index.html'))) {
    app.log.warn(
      { distPath },
      'No se encuentra el frontend compilado. Ejecuta "npm run build" o pon SERVE_WEB=false',
    );
    return false;
  }

  await app.register(fastifyStatic, {
    root: distPath,
    prefix: '/',
    // Los ficheros con hash en el nombre se pueden cachear indefinidamente;
    // index.html no, o los clientes se quedarían con una versión antigua.
    // Desde @fastify/static 10 el primer argumento es la respuesta de Fastify,
    // no la de Node: se ponen cabeceras con `header`, no con `setHeader`.
    setHeaders: (reply, path) => {
      if (path.endsWith('index.html')) {
        reply.header('cache-control', 'no-cache');
      } else if (HASHED_ASSET.test(path)) {
        reply.header('cache-control', 'public, max-age=31536000, immutable');
      }
    },
  });

  app.log.info({ distPath }, 'Frontend servido desde el propio proceso');
  return true;
}
