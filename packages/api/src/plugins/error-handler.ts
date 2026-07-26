import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

/**
 * Respuesta de error homogénea:
 *
 *   { "error": { "code": "slot_unavailable", "message": "...", "details": ..., "requestId": "..." } }
 *
 * El `code` es estable y es lo que traduce el frontend; el `message` viene en
 * castellano y sirve para clientes que no traducen y para depurar.
 */
const errorHandlerPlugin: FastifyPluginAsync = async (app) => {
  // El manejador de "no encontrado" lo instala `buildApp`, porque depende de
  // si se está sirviendo el frontend: en ese caso las rutas del cliente tienen
  // que devolver el `index.html` en lugar de un 404.
  app.setErrorHandler((error: any, request, reply) => {
    const requestId = request.id;

    if (hasZodFastifySchemaValidationErrors(error)) {
      request.log.info({ err: error }, 'Validación fallida');
      return reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Los datos enviados no son válidos',
          details: error.validation.map((issue) => ({
            path: issue.instancePath,
            message: issue.message,
          })),
          requestId,
        },
      });
    }

    if (error instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Los datos enviados no son válidos',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          requestId,
        },
      });
    }

    if (error instanceof AppError) {
      if (error.statusCode >= 500) {
        request.log.error({ err: error }, 'Error de aplicación');
      } else {
        request.log.info({ err: error, code: error.code }, 'Error controlado');
      }
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        },
      });
    }

    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: {
          code: 'rate_limited',
          message: 'Demasiadas peticiones, inténtalo dentro de un momento',
          requestId,
        },
      });
    }

    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code ?? 'bad_request',
          message: error.message,
          requestId,
        },
      });
    }

    request.log.error({ err: error }, 'Error no controlado');
    return reply.status(500).send({
      error: {
        code: 'internal_error',
        message: 'Se ha producido un error inesperado',
        // La traza solo se expone fuera de producción.
        details: env.isProduction ? undefined : { stack: error.stack },
        requestId,
      },
    });
  });
};

export default fp(errorHandlerPlugin, { name: 'error-handler' });
