import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import type { AuthenticatedResult, RequestContext } from '../modules/auth/service.js';

/** Parámetro de ruta común a casi todos los endpoints del panel. */
export const organizationParams = z.object({ organizationId: z.string().min(1) });
export const idParams = z.object({ id: z.string().min(1) });
export const organizationAndIdParams = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
});

export function orgId(request: FastifyRequest): string {
  return (request.params as { organizationId: string }).organizationId;
}

export function requestContext(request: FastifyRequest): RequestContext {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'] ?? null,
    locale: request.locale,
    trustedDeviceToken: (request.cookies as Record<string, string> | undefined)?.cf_trusted ?? null,
  };
}

/** `true` si quien hace la petición es personal de la organización. */
export function isStaffOf(request: FastifyRequest, organizationId: string): boolean {
  if (request.auth.platformRole === 'superadmin') return true;
  const access = request.auth.organizations.get(organizationId);
  return Boolean(access);
}

const REFRESH_COOKIE = 'cf_refresh';
const TRUSTED_COOKIE = 'cf_trusted';

/**
 * Deja la sesión en cookies además de devolver los tokens en el cuerpo.
 *
 * El refresh token va en cookie `httpOnly`: así el JavaScript de la página no
 * puede leerlo y un XSS no se lleva la sesión de larga duración. El access
 * token, de vida corta, viaja en el cuerpo para que el cliente lo mande en la
 * cabecera `Authorization`, lo que además evita CSRF en las llamadas al API.
 */
export function setSessionCookies(reply: FastifyReply, result: AuthenticatedResult): void {
  reply.setCookie(REFRESH_COOKIE, result.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    domain: env.COOKIE_DOMAIN,
    path: '/api/v1/auth',
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400,
  });

  reply.setCookie(env.SESSION_COOKIE_NAME, result.tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.COOKIE_SECURE,
    domain: env.COOKIE_DOMAIN,
    path: '/',
    maxAge: result.tokens.expiresIn,
  });

  if (result.trustedDeviceToken) {
    reply.setCookie(TRUSTED_COOKIE, result.trustedDeviceToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: env.COOKIE_SECURE,
      domain: env.COOKIE_DOMAIN,
      path: '/api/v1/auth',
      maxAge: env.MFA_TRUSTED_DEVICE_DAYS * 86_400,
    });
  }
}

export function clearSessionCookies(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  reply.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
}

export function readRefreshToken(request: FastifyRequest, body?: { refreshToken?: string }): string | null {
  return (
    body?.refreshToken ??
    (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE] ??
    null
  );
}

/** Respuesta uniforme de sesión iniciada. */
export function sessionPayload(result: AuthenticatedResult) {
  return {
    status: 'authenticated' as const,
    tokens: {
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      tokenType: 'Bearer' as const,
    },
    user: result.user,
  };
}
