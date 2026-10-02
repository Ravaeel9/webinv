/**
 * Uprawnienia — odwzorowanie ról na konkretne uprawnienia.
 *
 * Trzymamy to w jednym miejscu, bo pozwala to walidować przypisania
 * (np. nie da się nadać roli SUPER_ADMIN kontu innego super admina
 * przez zwykłego panel admina) i renderować UI bez duplikowania logiki.
 */
export const PERMISSIONS = {
  VIEWER: ['app:read', 'user:read', 'audit:read'],
  ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'audit:read',
  ],
  SUPER_ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'user:write',
    'audit:read',
  ],
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS][number];

/** Nazwy ról — od najmniej do najbardziej uprzywilejowanej. */
export type Role = keyof typeof PERMISSIONS;

/**
 * Wszystkie uprawnienia, jakie w ogóle istnieją.
 *
 * Osobna lista, bo `keyof typeof PERMISSIONS.SUPER_ADMIN` daje indeksy
 * tablicy („0", „1", …), a nie nazwy uprawnień. Bez tej stałej
 * wypisanie kompletu uprawnień w teście albo walidacji wymagałoby
 * ręcznego powtórzenia — a pominięcie jednego po cichu osłabiłoby test.
 */
export const ALL_PERMISSIONS = [
  'app:read',
  'app:write',
  'user:read',
  'user:write',
  'audit:read',
] as const satisfies readonly Permission[];

/** Uprawnienia nadane roli, w kolejności z `PERMISSIONS`. */
export function permissionsFor(role: Role): readonly Permission[] {
  return PERMISSIONS[role] ?? [];
}

/** Czy rola posiada dane uprawnienie. */
export function roleHasPermission(
  role: Role,
  permission: Permission,
): boolean {
  return permissionsFor(role).includes(permission);
}

/** Etykiety do UI. */
export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super administrator',
  ADMIN: 'Administrator',
  VIEWER: 'Obserwator',
};
