import type {
  AllowlistType,
  AuthSettings,
  CreateAllowlistEntryInput,
  LoginMethod,
  RegistrationMode,
} from '@cita-facil/shared';
import { env } from '../../config/env.js';
import { db } from '../../db/index.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { logger } from '../../lib/logger.js';
import { ConflictError, ForbiddenError } from '../../lib/errors.js';
import { getSetting, setSetting } from './service.js';

/**
 * Política de acceso de la instalación.
 *
 * Los valores viven en la tabla `settings` (ámbito global, sin organización) y
 * los puede cambiar el administrador de la plataforma desde el panel. Las
 * variables de entorno solo aportan el valor inicial de una instalación recién
 * creada: una vez que alguien toca la pantalla de acceso, manda la base de
 * datos. Así no hace falta reiniciar el proceso para cerrar el registro o
 * apagar un método de acceso.
 */

const NAMESPACE = 'auth';
const KEY = 'policy';

/**
 * Caché corta. Estos ajustes se consultan en cada intento de acceso, así que
 * releerlos de la base de datos cada vez sería una consulta por login; y a la
 * vez tienen que propagarse rápido cuando el administrador cierra el registro.
 * Treinta segundos es el punto medio razonable.
 */
const CACHE_TTL_MS = 30_000;
let cache: { value: AuthSettings; loadedAt: number } | null = null;

function defaultsFromEnv(): AuthSettings {
  const methods = env.AUTH_METHODS as readonly string[];
  return {
    methods: {
      password: methods.includes('password'),
      passkey: methods.includes('passkey'),
      certificate: methods.includes('certificate'),
      oidc: methods.includes('oidc') || methods.includes('clave'),
      google: methods.includes('google'),
    },
    registrationMode: env.REGISTRATION_MODE as RegistrationMode,
    autoProvisionCertificate: env.CERT_AUTO_PROVISION,
    autoProvisionSocial: true,
    requireVerifiedEmail: false,
    allowAnonymousBooking: env.ALLOW_ANONYMOUS_BOOKING,
    mfaRequiredForAdmins: env.MFA_REQUIRED_FOR_ADMINS,
    // Cerrado por defecto: en una instalación de un solo negocio, que
    // cualquier cliente pudiera crearse una organización sería un fallo.
    allowOrganizationSelfService: false,
    allowedEmailDomains: [],
  };
}

export async function getAuthSettings(): Promise<AuthSettings> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.value;

  const stored = await getSetting<Partial<AuthSettings> | null>(null, NAMESPACE, KEY, null);
  const defaults = defaultsFromEnv();

  const value: AuthSettings = {
    ...defaults,
    ...stored,
    methods: { ...defaults.methods, ...stored?.methods },
    allowedEmailDomains: stored?.allowedEmailDomains ?? defaults.allowedEmailDomains,
  };

  cache = { value, loadedAt: Date.now() };
  return value;
}

export async function saveAuthSettings(patch: Partial<AuthSettings>): Promise<AuthSettings> {
  const current = await getAuthSettings();
  const next: AuthSettings = {
    ...current,
    ...patch,
    methods: { ...current.methods, ...patch.methods },
  };

  if (!Object.values(next.methods).some(Boolean)) {
    throw new ConflictError(
      'Tiene que quedar al menos un método de acceso activo',
      'no_login_methods',
    );
  }

  await setSetting(null, NAMESPACE, KEY, next);
  cache = { value: next, loadedAt: Date.now() };
  logger.info({ registrationMode: next.registrationMode }, 'Política de acceso actualizada');
  return next;
}

/** Invalida la caché. Se usa en las pruebas y tras restaurar una copia. */
export function resetAuthSettingsCache(): void {
  cache = null;
}

export async function isLoginMethodEnabled(method: LoginMethod): Promise<boolean> {
  const settings = await getAuthSettings();
  return settings.methods[method] === true;
}

/** Lanza si el método está desactivado, con un código que el frontend traduce. */
export async function assertLoginMethodEnabled(method: LoginMethod): Promise<void> {
  if (!(await isLoginMethodEnabled(method))) {
    throw new ForbiddenError(
      'Ese método de acceso está desactivado en esta instalación',
      'login_method_disabled',
      { method },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Lista de autorizados                                                        */
/* -------------------------------------------------------------------------- */

export function normalizeAllowlistValue(type: AllowlistType, value: string): string {
  const clean = value.trim();
  switch (type) {
    case 'email':
      return clean.toLowerCase();
    case 'domain':
      return clean.toLowerCase().replace(/^@/, '');
    case 'nif':
      return clean.toUpperCase().replace(/[\s-]/g, '');
    default:
      return clean;
  }
}

export interface AllowlistMatch {
  id: string;
  type: AllowlistType;
  value: string;
  platformRole: string;
  organizationId: string | null;
  organizationRole: string | null;
  usedAt: string | null;
}

/** Busca a la persona en la lista por correo, por dominio del correo o por NIF. */
export async function findAllowlistEntry(identity: {
  email?: string | null;
  nif?: string | null;
}): Promise<AllowlistMatch | null> {
  const candidates: { type: AllowlistType; value: string }[] = [];

  if (identity.email) {
    const email = normalizeAllowlistValue('email', identity.email);
    candidates.push({ type: 'email', value: email });
    const domain = email.split('@')[1];
    if (domain) candidates.push({ type: 'domain', value: domain });
  }
  if (identity.nif) {
    candidates.push({ type: 'nif', value: normalizeAllowlistValue('nif', identity.nif) });
  }
  if (candidates.length === 0) return null;

  const rows = await db()
    .selectFrom('access_allowlist')
    .selectAll()
    .where(
      'value',
      'in',
      candidates.map((candidate) => candidate.value),
    )
    .execute();

  // Se prioriza la coincidencia más específica: correo, luego NIF, luego dominio.
  const priority: AllowlistType[] = ['email', 'nif', 'domain'];
  for (const type of priority) {
    const match = rows.find(
      (row) =>
        row.type === type &&
        candidates.some((candidate) => candidate.type === type && candidate.value === row.value),
    );
    if (match) {
      return {
        id: match.id,
        type: match.type as AllowlistType,
        value: match.value,
        platformRole: match.platform_role,
        organizationId: match.organization_id,
        organizationRole: match.organization_role,
        usedAt: match.used_at,
      };
    }
  }
  return null;
}

export async function markAllowlistEntryUsed(id: string, userId: string): Promise<void> {
  await db()
    .updateTable('access_allowlist')
    .set({ used_at: isoNow(), used_by: userId })
    .where('id', '=', id)
    // Las entradas por dominio valen para varias personas, así que solo se
    // marca la primera vez y no se invalida.
    .where('used_at', 'is', null)
    .execute();
}

export async function addAllowlistEntry(
  input: CreateAllowlistEntryInput,
  createdBy: string | null,
): Promise<{ id: string }> {
  const value = normalizeAllowlistValue(input.type, input.value);

  const existing = await db()
    .selectFrom('access_allowlist')
    .select(['id'])
    .where('type', '=', input.type)
    .where('value', '=', value)
    .executeTakeFirst();
  if (existing) return { id: existing.id };

  const id = newId();
  await db()
    .insertInto('access_allowlist')
    .values({
      id,
      type: input.type,
      value,
      note: input.note ?? null,
      platform_role: input.platformRole,
      organization_id: input.organizationId ?? null,
      organization_role: input.organizationRole ?? null,
      created_by: createdBy,
      used_at: null,
      used_by: null,
      created_at: isoNow(),
    })
    .execute();

  return { id };
}

/** Alta en bloque desde un texto pegado. Devuelve cuántas entradas nuevas hay. */
export async function addAllowlistEntries(
  input: {
    type: AllowlistType;
    values: string;
    note?: string;
    organizationId?: string;
    organizationRole?: string;
  },
  createdBy: string | null,
): Promise<{ added: number; skipped: number }> {
  const values = [...new Set(input.values.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean))];

  let added = 0;
  let skipped = 0;

  for (const value of values) {
    try {
      const normalized = normalizeAllowlistValue(input.type, value);
      const existing = await db()
        .selectFrom('access_allowlist')
        .select(['id'])
        .where('type', '=', input.type)
        .where('value', '=', normalized)
        .executeTakeFirst();

      if (existing) {
        skipped += 1;
        continue;
      }

      await db()
        .insertInto('access_allowlist')
        .values({
          id: newId(),
          type: input.type,
          value: normalized,
          note: input.note ?? null,
          platform_role: 'user',
          organization_id: input.organizationId ?? null,
          organization_role: input.organizationRole ?? null,
          created_by: createdBy,
          used_at: null,
          used_by: null,
          created_at: isoNow(),
        })
        .execute();
      added += 1;
    } catch (error) {
      logger.warn({ err: error, value }, 'Entrada de la lista descartada');
      skipped += 1;
    }
  }

  return { added, skipped };
}

export async function listAllowlist(options: { search?: string; limit?: number } = {}) {
  let query = db()
    .selectFrom('access_allowlist')
    .leftJoin('organizations', 'organizations.id', 'access_allowlist.organization_id')
    .select([
      'access_allowlist.id',
      'access_allowlist.type',
      'access_allowlist.value',
      'access_allowlist.note',
      'access_allowlist.platform_role',
      'access_allowlist.organization_id',
      'access_allowlist.organization_role',
      'access_allowlist.used_at',
      'access_allowlist.created_at',
      'organizations.name as organization_name',
    ]);

  if (options.search) {
    query = query.where('access_allowlist.value', 'like', `%${options.search.toLowerCase()}%`);
  }

  const rows = await query
    .orderBy('access_allowlist.created_at', 'desc')
    .limit(options.limit ?? 500)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    value: row.value,
    note: row.note,
    platformRole: row.platform_role,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    organizationRole: row.organization_role,
    usedAt: row.used_at,
    createdAt: row.created_at,
  }));
}

export async function removeAllowlistEntry(id: string): Promise<void> {
  await db().deleteFrom('access_allowlist').where('id', '=', id).execute();
}

/* -------------------------------------------------------------------------- */
/* Decisión de alta                                                            */
/* -------------------------------------------------------------------------- */

export type RegistrationSource = 'password' | 'certificate' | 'oidc' | 'google' | 'invitation';

export interface RegistrationDecision {
  allowed: boolean;
  /** Código estable para que el frontend explique el motivo. */
  reason:
    | 'open'
    | 'allowlisted'
    | 'invited'
    | 'registration_closed'
    | 'not_allowlisted'
    | 'domain_not_allowed'
    | 'auto_provision_disabled';
  entry: AllowlistMatch | null;
}

/**
 * Decide si una persona puede crear cuenta.
 *
 * La regla no depende solo del modo de registro sino también de por dónde
 * llega: con `invite_only` nadie se da de alta solo, pero una cuenta creada por
 * el administrador sí se activa; y con certificado hay un interruptor propio,
 * porque el caso "cualquiera con DNIe válido entra" es habitual en lo público y
 * catastrófico en un negocio privado.
 */
export async function decideRegistration(params: {
  source: RegistrationSource;
  email?: string | null;
  nif?: string | null;
}): Promise<RegistrationDecision> {
  const settings = await getAuthSettings();

  if (params.source === 'invitation') {
    return { allowed: true, reason: 'invited', entry: null };
  }

  if (settings.registrationMode === 'closed') {
    return { allowed: false, reason: 'registration_closed', entry: null };
  }

  if (settings.registrationMode === 'invite_only') {
    // Aun así se admite a quien esté explícitamente en la lista: es lo que
    // permite preautorizar a alguien sin tener que crearle la cuenta a mano.
    const entry = await findAllowlistEntry(params);
    return entry
      ? { allowed: true, reason: 'allowlisted', entry }
      : { allowed: false, reason: 'registration_closed', entry: null };
  }

  if (settings.registrationMode === 'allowlist') {
    const entry = await findAllowlistEntry(params);
    if (entry) return { allowed: true, reason: 'allowlisted', entry };

    // Sin coincidencia, todavía puede pasar si la instalación permite el alta
    // automática por certificado o por proveedor externo.
    const autoProvision =
      params.source === 'certificate'
        ? settings.autoProvisionCertificate
        : params.source === 'oidc' || params.source === 'google'
          ? settings.autoProvisionSocial
          : false;

    return autoProvision
      ? { allowed: true, reason: 'open', entry: null }
      : { allowed: false, reason: 'not_allowlisted', entry: null };
  }

  // Modo abierto: solo queda comprobar la restricción por dominio de correo.
  if (settings.allowedEmailDomains.length > 0 && params.email) {
    const domain = params.email.toLowerCase().split('@')[1] ?? '';
    const allowed = settings.allowedEmailDomains.some(
      (candidate) => candidate.toLowerCase().replace(/^@/, '') === domain,
    );
    if (!allowed) return { allowed: false, reason: 'domain_not_allowed', entry: null };
  }

  return { allowed: true, reason: 'open', entry: null };
}

/** Mensaje en castellano para cada motivo de rechazo. */
export const REGISTRATION_DENIAL_MESSAGES: Record<string, string> = {
  registration_closed: 'El alta de cuentas nuevas está cerrada en esta instalación',
  not_allowlisted: 'Tu cuenta no está autorizada. Ponte en contacto con el administrador.',
  domain_not_allowed: 'Solo se admiten cuentas de los dominios de correo autorizados',
  auto_provision_disabled: 'No hay ninguna cuenta asociada a esa identidad',
};
