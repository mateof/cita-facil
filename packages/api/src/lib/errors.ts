/**
 * Errores de aplicación. Todos llevan un código estable que el frontend usa
 * para traducir el mensaje, de modo que la cadena en castellano del servidor
 * es solo una ayuda para depurar y para clientes que no traducen.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Petición no válida', code = 'bad_request', details?: unknown) {
    super(400, code, message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autenticado', code = 'unauthorized', details?: unknown) {
    super(401, code, message, details);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Sin permisos suficientes', code = 'forbidden', details?: unknown) {
    super(403, code, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado', code = 'not_found', details?: unknown) {
    super(404, code, message, details);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflicto con el estado actual', code = 'conflict', details?: unknown) {
    super(409, code, message, details);
  }
}

/** El hueco ya no está libre: es el conflicto más frecuente al reservar. */
export class SlotUnavailableError extends ConflictError {
  constructor(message = 'El horario solicitado ya no está disponible', details?: unknown) {
    super(message, 'slot_unavailable', details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiadas peticiones', code = 'rate_limited', details?: unknown) {
    super(429, code, message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Datos no válidos', details?: unknown) {
    super(422, 'validation_error', message, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Servicio no disponible', code = 'service_unavailable', details?: unknown) {
    super(503, code, message, details);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
