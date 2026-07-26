import { createHash, randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError, ForbiddenError, ServiceUnavailableError } from '../../lib/errors.js';
import {
  createUser,
  findUserByEmail,
  findUserByIdentity,
  findUserByNif,
  linkIdentity,
} from '../users/repository.js';
import {
  REGISTRATION_DENIAL_MESSAGES,
  decideRegistration,
  markAllowlistEntryUsed,
} from '../settings/access-policy.js';
import { consumeChallenge, createChallenge } from './challenges.js';
import { issueSession, joinOrganization, type AuthenticatedResult, type RequestContext } from './service.js';

/**
 * Proveedores de identidad federados.
 *
 * Se soportan dos, con el mismo código porque los dos hablan OpenID Connect:
 *
 * - `oidc`: proveedor genérico, pensado para Cl@ve pero válido para Keycloak,
 *   Auth0, Entra ID o cualquier otro que publique su documento de descubrimiento.
 * - `google`: Google OAuth 2.0, que es OIDC con un emisor fijo y alguna
 *   particularidad propia (el parámetro `hd` para limitar el acceso a un
 *   dominio de Google Workspace).
 *
 * En ambos casos se usa el flujo de código de autorización con PKCE, que es el
 * recomendado también para clientes con secreto: si el código se intercepta,
 * sin el `code_verifier` no sirve de nada.
 */

export type SocialProvider = 'oidc' | 'google';

interface ProviderConfig {
  provider: SocialProvider;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string;
  label: string;
  /** Parámetros extra en la petición de autorización. */
  extraParams?: Record<string, string>;
  /** Dominios de Google Workspace admitidos. Vacío = todos. */
  hostedDomains?: string[];
}

const GOOGLE_ISSUER = 'https://accounts.google.com';

function configFor(provider: SocialProvider): ProviderConfig {
  if (provider === 'google') {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new ServiceUnavailableError(
        'El acceso con Google no está configurado',
        'google_not_configured',
      );
    }
    return {
      provider: 'google',
      issuer: GOOGLE_ISSUER,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI ?? `${env.APP_URL}/api/v1/auth/google/callback`,
      scopes: 'openid email profile',
      label: 'Google',
      extraParams: {
        // Sin `offline` no hace falta refresco: la sesión la gestiona esta
        // aplicación, no Google.
        access_type: 'online',
        // Deja elegir cuenta en lugar de entrar con la última usada, que es lo
        // que espera quien comparte ordenador.
        prompt: 'select_account',
      },
      hostedDomains: env.GOOGLE_HOSTED_DOMAINS
        ? env.GOOGLE_HOSTED_DOMAINS.split(',').map((domain) => domain.trim().toLowerCase())
        : [],
    };
  }

  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID) {
    throw new ServiceUnavailableError('OIDC no está configurado', 'oidc_not_configured');
  }
  return {
    provider: 'oidc',
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI ?? `${env.APP_URL}/api/v1/auth/oidc/callback`,
    scopes: env.OIDC_SCOPES,
    label: env.OIDC_LABEL,
  };
}

export function isProviderConfigured(provider: SocialProvider): boolean {
  return provider === 'google'
    ? Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
    : Boolean(env.OIDC_ISSUER && env.OIDC_CLIENT_ID);
}

export function isOidcConfigured(): boolean {
  return isProviderConfigured('oidc');
}

/* -------------------------------------------------------------------------- */
/* Descubrimiento                                                              */
/* -------------------------------------------------------------------------- */

interface DiscoveryDocument {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  issuer: string;
}

const discoveryCache = new Map<string, { document: DiscoveryDocument; loadedAt: number }>();

async function loadDiscovery(config: ProviderConfig): Promise<DiscoveryDocument> {
  const cached = discoveryCache.get(config.issuer);
  if (cached && Date.now() - cached.loadedAt < 3_600_000) return cached.document;

  const url = `${config.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new ServiceUnavailableError(
      `No se pudo leer la configuración del proveedor (${response.status})`,
      'oidc_discovery_failed',
    );
  }

  const document = (await response.json()) as DiscoveryDocument;
  discoveryCache.set(config.issuer, { document, loadedAt: Date.now() });
  return document;
}

/* -------------------------------------------------------------------------- */
/* Inicio                                                                      */
/* -------------------------------------------------------------------------- */

export interface SocialLoginStart {
  authorizationUrl: string;
  state: string;
}

export async function startSocialLogin(
  provider: SocialProvider,
  returnTo?: string,
): Promise<SocialLoginStart> {
  const config = configFor(provider);
  const document = await loadDiscovery(config);

  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const nonce = randomBytes(16).toString('base64url');

  const state = await createChallenge({
    kind: 'oidc_state',
    payload: { provider, codeVerifier, nonce, returnTo: returnTo ?? '/' },
    ttlSeconds: 600,
  });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    ...config.extraParams,
  });

  // `hd` hace que Google solo ofrezca cuentas del dominio indicado. Es una
  // ayuda de interfaz, no una garantía: la comprobación real se hace después
  // sobre la reclamación `hd` del token.
  if (config.provider === 'google' && config.hostedDomains?.length === 1) {
    params.set('hd', config.hostedDomains[0]!);
  }

  return { authorizationUrl: `${document.authorization_endpoint}?${params.toString()}`, state };
}

/** Compatibilidad con el nombre anterior. */
export const startOidcLogin = (returnTo?: string) => startSocialLogin('oidc', returnTo);

/* -------------------------------------------------------------------------- */
/* Retorno                                                                     */
/* -------------------------------------------------------------------------- */

interface OidcClaims {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  /** Dominio de Google Workspace de la cuenta. */
  hd?: string;
  /** Cl@ve devuelve el documento en varios nombres según el perfil. */
  nif?: string;
  dni?: string;
  document_number?: string;
  locale?: string;
}

export async function completeSocialLogin(
  params: { code: string; state: string },
  context: RequestContext = {},
): Promise<{ result: AuthenticatedResult; returnTo: string; provider: SocialProvider }> {
  const challenge = await consumeChallenge<{
    provider?: SocialProvider;
    codeVerifier: string;
    nonce: string;
    returnTo: string;
  }>(params.state, 'oidc_state');

  const provider = challenge.payload.provider ?? 'oidc';
  const config = configFor(provider);
  const document = await loadDiscovery(config);

  const response = await fetch(document.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      ...(config.clientSecret ? { client_secret: config.clientSecret } : {}),
      code_verifier: challenge.payload.codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    logger.error(
      { provider, status: response.status, body: await response.text() },
      'Error canjeando el código de autorización',
    );
    throw new BadRequestError('El proveedor de identidad rechazó la petición', 'oidc_token_failed');
  }

  const tokens = (await response.json()) as { id_token?: string; access_token?: string };
  const claims = await readClaims(tokens, document);

  assertClaims(claims, config);

  const nif = (claims.nif ?? claims.dni ?? claims.document_number ?? '').toUpperCase() || null;
  const email = claims.email?.toLowerCase() ?? null;

  let user =
    (await findUserByIdentity(provider, claims.sub)) ??
    (nif ? await findUserByNif(nif) : undefined) ??
    (email ? await findUserByEmail(email) : undefined);

  if (!user) {
    // Cuenta nueva: hay que comprobar la política de alta de la instalación.
    const decision = await decideRegistration({ source: provider, email, nif });
    if (!decision.allowed) {
      throw new ForbiddenError(
        REGISTRATION_DENIAL_MESSAGES[decision.reason] ?? 'No se admiten altas nuevas',
        decision.reason,
      );
    }

    user = await createUser({
      email,
      name:
        claims.name ??
        ([claims.given_name, claims.family_name].filter(Boolean).join(' ') || claims.sub),
      givenName: claims.given_name ?? null,
      familyName: claims.family_name ?? null,
      nif,
      locale: claims.locale ?? context.locale ?? env.DEFAULT_LOCALE,
      emailVerified: Boolean(claims.email_verified),
      platformRole: decision.entry?.platformRole,
    });

    if (decision.entry) {
      await markAllowlistEntryUsed(decision.entry.id, user.id);
      if (decision.entry.organizationId && decision.entry.organizationRole) {
        await joinOrganization(
          user.id,
          decision.entry.organizationId,
          decision.entry.organizationRole,
        );
      }
    }
  }

  await linkIdentity({
    userId: user.id,
    provider,
    subject: claims.sub,
    issuer: document.issuer,
    metadata: { email, picture: claims.picture ?? null },
  });

  // El proveedor ya ha aplicado sus propias políticas de autenticación,
  // incluido el segundo factor si lo tiene configurado.
  const result = await issueSession(user, provider, true, context);
  return { result, returnTo: challenge.payload.returnTo, provider };
}

export const completeOidcLogin = (
  params: { code: string; state: string },
  context: RequestContext = {},
) => completeSocialLogin(params, context);

/**
 * Comprueba emisor, destinatario y caducidad, y el dominio de Workspace cuando
 * se ha configurado. La firma del `id_token` no se verifica porque el token se
 * ha obtenido por canal directo TLS contra el propio endpoint del emisor, que
 * es el caso en que la especificación permite omitirla.
 */
function assertClaims(claims: OidcClaims, config: ProviderConfig): void {
  if (claims.iss) {
    const issuer = claims.iss.replace(/\/$/, '');
    const expected = config.issuer.replace(/\/$/, '');
    // Google emite tanto `accounts.google.com` como `https://accounts.google.com`.
    const acceptable = [expected, expected.replace(/^https:\/\//, '')];
    if (!acceptable.includes(issuer) && !acceptable.includes(`https://${issuer}`)) {
      throw new BadRequestError('El emisor del token no es el esperado', 'oidc_bad_issuer');
    }
  }

  if (claims.aud) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(config.clientId)) {
      throw new BadRequestError('El token no es para esta aplicación', 'oidc_bad_audience');
    }
  }

  if (claims.exp && claims.exp * 1000 < Date.now()) {
    throw new BadRequestError('El token del proveedor ha caducado', 'oidc_token_expired');
  }

  if (config.provider === 'google' && config.hostedDomains && config.hostedDomains.length > 0) {
    const domain = (claims.hd ?? claims.email?.split('@')[1] ?? '').toLowerCase();
    if (!config.hostedDomains.includes(domain)) {
      throw new ForbiddenError(
        'Solo se admiten cuentas de los dominios autorizados',
        'google_domain_not_allowed',
      );
    }
  }
}

async function readClaims(
  tokens: { id_token?: string; access_token?: string },
  document: DiscoveryDocument,
): Promise<OidcClaims> {
  if (tokens.id_token) {
    const payload = tokens.id_token.split('.')[1];
    if (payload) {
      return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as OidcClaims;
    }
  }

  if (tokens.access_token && document.userinfo_endpoint) {
    const response = await fetch(document.userinfo_endpoint, {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return (await response.json()) as OidcClaims;
  }

  throw new BadRequestError('El proveedor no devolvió información del usuario', 'oidc_no_claims');
}
