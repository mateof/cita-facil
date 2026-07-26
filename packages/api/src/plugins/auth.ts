import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { OrgRole, Permission } from '@cita-facil/shared';
import { permissionsForRole } from '@cita-facil/shared';
import { env } from '../config/env.js';
import { db } from '../db/index.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { hashToken } from '../lib/crypto.js';
import { isoNow } from '../lib/dates.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { sessionState } from '../modules/auth/session-cache.js';
import { findUserById, membershipsOf, type UserRow } from '../modules/users/repository.js';

/**
 * Contexto de autenticación de la petición.
 *
 * Hay tres formas de identificarse: token de usuario (JWT de sesión), clave de
 * API de una organización (integraciones máquina a máquina, como el control de
 * accesos de una puerta) y anónimo (reserva pública sin cuenta). El resto de la
 * aplicación no distingue de dónde vino la identidad, solo consulta permisos.
 */

export interface OrgAccess {
  organizationId: string;
  role: OrgRole;
  permissions: Set<string>;
  /** Vacío significa acceso a todas las sedes de la organización. */
  locationIds: string[];
}

export interface AuthContext {
  type: 'user' | 'apikey' | 'anonymous';
  userId: string | null;
  user: UserRow | null;
  sessionId: string | null;
  platformRole: 'superadmin' | 'user';
  /** Método con el que se autenticó, para políticas que lo exijan. */
  method: string | null;
  mfaSatisfied: boolean;
  apiKey: { id: string; organizationId: string; scopes: string[] } | null;
  organizations: Map<string, OrgAccess>;
}

const ANONYMOUS: AuthContext = {
  type: 'anonymous',
  userId: null,
  user: null,
  sessionId: null,
  platformRole: 'user',
  method: null,
  mfaSatisfied: false,
  apiKey: null,
  organizations: new Map(),
};

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext;
    /** Usuario autenticado o error 401. */
    requireUser(): UserRow;
    /** Comprueba un permiso dentro de una organización o error 403. */
    requirePermission(organizationId: string, permission: Permission): OrgAccess;
    /** Acceso a la organización sin exigir un permiso concreto. */
    requireOrg(organizationId: string): OrgAccess;
    /** Idioma resuelto de la petición. */
    locale: string;
  }
}

async function contextFromBearer(token: string): Promise<AuthContext> {
  const claims = await verifyAccessToken(token);

  const user = await findUserById(claims.sub);
  if (!user || user.status !== 'active') {
    throw new UnauthorizedError('La cuenta ya no está activa', 'account_inactive');
  }

  // El token es válido criptográficamente, pero la sesión puede haberse
  // revocado (cierre de sesión, cambio de contraseña). Se comprueba en cada
  // petición porque revocar de verdad importa más que ahorrar una consulta.
  // Con Redis la comprobación sale de la caché, y cerrar sesión la borra.
  const session = await sessionState(claims.sid);
  if (!session.active) {
    throw new UnauthorizedError('La sesión ha caducado', 'session_expired');
  }

  const memberships = await membershipsOf(user.id);
  const organizations = new Map<string, OrgAccess>();
  for (const membership of memberships) {
    organizations.set(membership.organizationId, {
      organizationId: membership.organizationId,
      role: membership.role,
      permissions: new Set(membership.permissions),
      locationIds: membership.locationIds,
    });
  }

  return {
    type: 'user',
    userId: user.id,
    user,
    sessionId: claims.sid,
    platformRole: user.platform_role === 'superadmin' ? 'superadmin' : 'user',
    method: claims.amr,
    mfaSatisfied: claims.mfa === true,
    apiKey: null,
    organizations,
  };
}

/**
 * Claves de API con formato `cf_<prefijo>_<secreto>`. El prefijo permite
 * localizar la fila sin buscar por el hash completo, y el secreto se compara
 * contra su HMAC.
 */
async function contextFromApiKey(rawKey: string, ip: string | null): Promise<AuthContext> {
  const parts = rawKey.split('_');
  if (parts.length < 3 || parts[0] !== 'cf') {
    throw new UnauthorizedError('Clave de API con formato no válido', 'invalid_api_key');
  }
  const prefix = parts[1]!;

  const candidates = await db()
    .selectFrom('api_keys')
    .selectAll()
    .where('prefix', '=', prefix)
    .where('revoked_at', 'is', null)
    .execute();

  const hash = hashToken(rawKey, 'apikey');
  const key = candidates.find((candidate) => candidate.key_hash === hash);

  if (!key) throw new UnauthorizedError('Clave de API no válida', 'invalid_api_key');
  if (key.expires_at && key.expires_at <= isoNow()) {
    throw new UnauthorizedError('Clave de API caducada', 'expired_api_key');
  }

  if (key.ip_allowlist_json) {
    const allowed = JSON.parse(key.ip_allowlist_json) as string[];
    if (allowed.length > 0 && (!ip || !ipAllowed(ip, allowed))) {
      throw new ForbiddenError('IP no autorizada para esta clave', 'ip_not_allowed');
    }
  }

  await db()
    .updateTable('api_keys')
    .set({ last_used_at: isoNow() })
    .where('id', '=', key.id)
    .execute();

  const scopes = JSON.parse(key.scopes_json) as string[];
  const organizations = new Map<string, OrgAccess>();
  organizations.set(key.organization_id, {
    organizationId: key.organization_id,
    role: 'admin',
    // Los permisos de una clave son exactamente sus scopes, nunca los del rol.
    permissions: new Set(scopes),
    locationIds: [],
  });

  return {
    type: 'apikey',
    userId: null,
    user: null,
    sessionId: null,
    platformRole: 'user',
    method: 'apikey',
    mfaSatisfied: true,
    apiKey: { id: key.id, organizationId: key.organization_id, scopes },
    organizations,
  };
}

/** Comprobación sencilla de IP exacta o de prefijo CIDR /8, /16 y /24. */
function ipAllowed(ip: string, allowed: string[]): boolean {
  for (const entry of allowed) {
    if (entry === ip) return true;
    const [network, bits] = entry.split('/');
    if (!network || !bits) continue;
    const size = Number(bits);
    if (![8, 16, 24].includes(size)) continue;
    const octets = size / 8;
    if (ip.split('.').slice(0, octets).join('.') === network.split('.').slice(0, octets).join('.')) {
      return true;
    }
  }
  return false;
}

function resolveLocale(request: FastifyRequest, user: UserRow | null): string {
  const explicit = (request.query as Record<string, string> | undefined)?.lang;
  if (explicit && ['es', 'gl', 'en'].includes(explicit)) return explicit;
  if (user?.locale) return user.locale;

  const header = request.headers['accept-language'];
  if (typeof header === 'string') {
    for (const part of header.split(',')) {
      const tag = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
      if (tag && ['es', 'gl', 'en'].includes(tag)) return tag;
    }
  }
  return env.DEFAULT_LOCALE;
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('auth', null as never);
  app.decorateRequest('locale', env.DEFAULT_LOCALE);

  app.decorateRequest('requireUser', function (this: FastifyRequest): UserRow {
    if (!this.auth.user) {
      throw new UnauthorizedError('Hay que iniciar sesión para hacer esto', 'authentication_required');
    }
    return this.auth.user;
  });

  app.decorateRequest(
    'requireOrg',
    function (this: FastifyRequest, organizationId: string): OrgAccess {
      const access = this.auth.organizations.get(organizationId);
      if (access) return access;

      // El superadministrador de la instalación entra en cualquier organización.
      if (this.auth.platformRole === 'superadmin') {
        return {
          organizationId,
          role: 'owner',
          permissions: new Set(permissionsForRole('owner')),
          locationIds: [],
        };
      }
      if (this.auth.type === 'anonymous') {
        throw new UnauthorizedError('Hay que iniciar sesión', 'authentication_required');
      }
      throw new ForbiddenError('No tienes acceso a esta organización', 'organization_forbidden');
    },
  );

  app.decorateRequest(
    'requirePermission',
    function (this: FastifyRequest, organizationId: string, permission: Permission): OrgAccess {
      const access = this.requireOrg(organizationId);
      if (!access.permissions.has(permission)) {
        throw new ForbiddenError(`Falta el permiso ${permission}`, 'permission_denied', {
          permission,
        });
      }
      return access;
    },
  );

  app.addHook('onRequest', async (request) => {
    request.auth = ANONYMOUS;

    const header = request.headers.authorization;
    const apiKeyHeader = request.headers['x-api-key'];
    const cookieToken = (request.cookies as Record<string, string> | undefined)?.[
      env.SESSION_COOKIE_NAME
    ];

    try {
      if (typeof apiKeyHeader === 'string' && apiKeyHeader.length > 0) {
        request.auth = await contextFromApiKey(apiKeyHeader, request.ip);
      } else if (header?.startsWith('Bearer ')) {
        request.auth = await contextFromBearer(header.slice(7).trim());
      } else if (cookieToken) {
        request.auth = await contextFromBearer(cookieToken);
      }
    } catch (error) {
      // Una credencial inválida no tumba la petición aquí: los endpoints
      // públicos siguen funcionando y los protegidos fallarán en `requireUser`.
      // La excepción son las credenciales presentadas de forma explícita, que
      // sí se rechazan para no dejar al cliente creyendo que está identificado.
      if (header || apiKeyHeader) throw error;
      request.auth = ANONYMOUS;
    }

    request.locale = resolveLocale(request, request.auth.user);
  });
};

export default fp(authPlugin, { name: 'auth' });
