import type { OrgRole } from './enums.js';

/**
 * Catálogo de permisos. El control de acceso es por permiso, no por rol: los
 * roles son simplemente conjuntos de permisos predefinidos. Así se pueden
 * añadir roles personalizados más adelante sin tocar los endpoints.
 */
export const PERMISSIONS = [
  'org:read',
  'org:update',
  'org:delete',
  'org:billing',
  'member:read',
  'member:invite',
  'member:update',
  'member:remove',
  'location:read',
  'location:write',
  'resource:read',
  'resource:write',
  'service:read',
  'service:write',
  'schedule:read',
  'schedule:write',
  'appointment:read', // ver todas las citas de la organización
  'appointment:read:own', // ver solo las citas propias (como profesional)
  'appointment:write',
  'appointment:cancel',
  'appointment:checkin',
  'customer:read',
  'customer:write',
  'payment:read',
  'payment:refund',
  'credit:read', // ver bonos emitidos y su saldo
  'credit:write', // crear tipos de bono, emitirlos y ajustarlos
  'notification:read',
  'notification:write',
  'notification:send',
  'report:read',
  'settings:read',
  'settings:write',
  'integration:read',
  'integration:write',
  'apikey:read',
  'apikey:write',
  'backup:read',
  'backup:write',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: Permission[] = [
  'org:read',
  'location:read',
  'resource:read',
  'service:read',
  'schedule:read',
  'appointment:read:own',
  'appointment:write',
  'appointment:cancel',
  'appointment:checkin',
  'customer:read',
  // El mostrador necesita ver si a alguien le quedan sesiones, aunque no pueda
  // emitir bonos ni cambiarlos.
  'credit:read',
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  'member:read',
  'appointment:read',
  'customer:write',
  'schedule:write',
  'resource:write',
  'service:write',
  'payment:read',
  'credit:write',
  'notification:read',
  'notification:send',
  'report:read',
  'settings:read',
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  'org:update',
  'member:invite',
  'member:update',
  'member:remove',
  'location:write',
  'payment:refund',
  'notification:write',
  'settings:write',
  'integration:read',
  'integration:write',
  'apikey:read',
  'apikey:write',
  'backup:read',
  'backup:write',
  'audit:read',
];

const OWNER_PERMISSIONS: Permission[] = [...ADMIN_PERMISSIONS, 'org:delete', 'org:billing'];

export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  owner: dedupe(OWNER_PERMISSIONS),
  admin: dedupe(ADMIN_PERMISSIONS),
  manager: dedupe(MANAGER_PERMISSIONS),
  staff: dedupe(STAFF_PERMISSIONS),
};

function dedupe(list: Permission[]): readonly Permission[] {
  return Object.freeze([...new Set(list)]);
}

export function permissionsForRole(role: OrgRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function roleHasPermission(role: OrgRole, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** Jerarquía numérica, útil para impedir que un admin edite a un owner. */
export const ROLE_RANK: Record<OrgRole, number> = {
  owner: 40,
  admin: 30,
  manager: 20,
  staff: 10,
};
