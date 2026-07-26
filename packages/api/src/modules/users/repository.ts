import type { Selectable } from 'kysely';
import { permissionsForRole, type OrgRole, type SessionUser } from '@cita-facil/shared';
import { db } from '../../db/index.js';
import type { UsersTable } from '../../db/types.js';
import { newId } from '../../lib/ids.js';
import { isoNow } from '../../lib/dates.js';
import { env } from '../../config/env.js';

export type UserRow = Selectable<UsersTable>;

export async function findUserById(id: string): Promise<UserRow | undefined> {
  return db()
    .selectFrom('users')
    .selectAll()
    .where('id', '=', id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

export async function findUserByEmail(email: string): Promise<UserRow | undefined> {
  return db()
    .selectFrom('users')
    .selectAll()
    .where('email_key', '=', email.trim().toLowerCase())
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

export async function findUserByNif(nif: string): Promise<UserRow | undefined> {
  return db()
    .selectFrom('users')
    .selectAll()
    .where('nif_key', '=', nif.trim().toUpperCase())
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
}

export interface CreateUserInput {
  email?: string | null;
  name: string;
  givenName?: string | null;
  familyName?: string | null;
  nif?: string | null;
  phone?: string | null;
  passwordHash?: string | null;
  locale?: string;
  timezone?: string;
  emailVerified?: boolean;
  platformRole?: string;
  status?: string;
}

/**
 * Crea un usuario. `email_key` y `nif_key` son copias no nulas de email y NIF
 * (o el propio id cuando faltan) porque SQL Server considera iguales dos NULL
 * en un índice único y no permitiría más de un usuario sin correo.
 */
export async function createUser(input: CreateUserInput): Promise<UserRow> {
  const id = newId();
  const now = isoNow();
  const email = input.email?.trim().toLowerCase() ?? null;
  const nif = input.nif?.trim().toUpperCase() ?? null;

  const row: UserRow = {
    id,
    email,
    email_key: email ?? id,
    email_verified: input.emailVerified ? 1 : 0,
    phone: input.phone ?? null,
    phone_verified: 0,
    password_hash: input.passwordHash ?? null,
    name: input.name,
    given_name: input.givenName ?? null,
    family_name: input.familyName ?? null,
    nif,
    nif_key: nif ?? id,
    locale: input.locale ?? env.DEFAULT_LOCALE,
    timezone: input.timezone ?? env.DEFAULT_TIMEZONE,
    avatar_url: null,
    platform_role: input.platformRole ?? 'user',
    status: input.status ?? 'active',
    mfa_enabled: 0,
    mfa_totp_secret: null,
    mfa_recovery_codes: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    no_show_count: 0,
    last_login_at: null,
    failed_login_count: 0,
    locked_until: null,
    marketing_opt_in: 0,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await db().insertInto('users').values(row).execute();
  return row;
}

export async function touchLogin(userId: string): Promise<void> {
  await db()
    .updateTable('users')
    .set({ last_login_at: isoNow(), failed_login_count: 0, locked_until: null })
    .where('id', '=', userId)
    .execute();
}

/**
 * Registra un intento fallido y bloquea temporalmente la cuenta tras varios.
 * El bloqueo es progresivo para frenar la fuerza bruta sin dejar la cuenta
 * inutilizable ante un ataque de denegación dirigido a un usuario concreto.
 */
export async function registerFailedLogin(userId: string, current: number): Promise<void> {
  const attempts = current + 1;
  const lockMinutes = attempts >= 10 ? 60 : attempts >= 5 ? 5 : 0;
  await db()
    .updateTable('users')
    .set({
      failed_login_count: attempts,
      locked_until:
        lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60_000).toISOString() : null,
    })
    .where('id', '=', userId)
    .execute();
}

export function isLocked(user: UserRow): boolean {
  return Boolean(user.locked_until && user.locked_until > isoNow());
}

export interface MembershipView {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: OrgRole;
  locationIds: string[];
  permissions: string[];
}

export async function membershipsOf(userId: string): Promise<MembershipView[]> {
  const rows = await db()
    .selectFrom('memberships')
    .innerJoin('organizations', 'organizations.id', 'memberships.organization_id')
    .select([
      'memberships.id as membership_id',
      'memberships.organization_id',
      'memberships.role',
      'organizations.name as organization_name',
      'organizations.slug as organization_slug',
    ])
    .where('memberships.user_id', '=', userId)
    .where('memberships.active', '=', 1)
    .where('organizations.deleted_at', 'is', null)
    .execute();

  if (rows.length === 0) return [];

  const locationRows = await db()
    .selectFrom('membership_locations')
    .select(['membership_id', 'location_id'])
    .where(
      'membership_id',
      'in',
      rows.map((row) => row.membership_id),
    )
    .execute();

  const byMembership = new Map<string, string[]>();
  for (const row of locationRows) {
    const list = byMembership.get(row.membership_id) ?? [];
    list.push(row.location_id);
    byMembership.set(row.membership_id, list);
  }

  return rows.map((row) => {
    const role = row.role as OrgRole;
    return {
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationSlug: row.organization_slug,
      role,
      locationIds: byMembership.get(row.membership_id) ?? [],
      permissions: [...permissionsForRole(role)],
    };
  });
}

export async function identityProvidersOf(userId: string): Promise<string[]> {
  const rows = await db()
    .selectFrom('identities')
    .select(['provider'])
    .where('user_id', '=', userId)
    .execute();
  return [...new Set(rows.map((row) => row.provider))];
}

/** Proyección del usuario que consume el frontend tras autenticarse. */
export async function toSessionUser(user: UserRow): Promise<SessionUser> {
  const [memberships, providers] = await Promise.all([
    membershipsOf(user.id),
    identityProvidersOf(user.id),
  ]);

  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    name: user.name,
    nif: user.nif,
    locale: user.locale as SessionUser['locale'],
    timezone: user.timezone,
    avatarUrl: user.avatar_url,
    platformRole: user.platform_role === 'superadmin' ? 'superadmin' : 'user',
    mfaEnabled: user.mfa_enabled === 1,
    emailVerified: user.email_verified === 1,
    identityProviders: providers,
    memberships,
  };
}

export async function linkIdentity(params: {
  userId: string;
  provider: string;
  subject: string;
  issuer?: string | null;
  metadata?: unknown;
}): Promise<void> {
  const existing = await db()
    .selectFrom('identities')
    .select(['id'])
    .where('provider', '=', params.provider)
    .where('subject', '=', params.subject)
    .executeTakeFirst();

  if (existing) {
    await db()
      .updateTable('identities')
      .set({ last_used_at: isoNow() })
      .where('id', '=', existing.id)
      .execute();
    return;
  }

  await db()
    .insertInto('identities')
    .values({
      id: newId(),
      user_id: params.userId,
      provider: params.provider,
      subject: params.subject,
      issuer: params.issuer ?? null,
      metadata_json: params.metadata ? JSON.stringify(params.metadata) : null,
      last_used_at: isoNow(),
      created_at: isoNow(),
    })
    .execute();
}

export async function findUserByIdentity(
  provider: string,
  subject: string,
): Promise<UserRow | undefined> {
  const identity = await db()
    .selectFrom('identities')
    .select(['user_id'])
    .where('provider', '=', provider)
    .where('subject', '=', subject)
    .executeTakeFirst();
  if (!identity) return undefined;
  return findUserById(identity.user_id);
}
