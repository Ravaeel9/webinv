/**
 * Tożsamość: role, konta panelu i macierz ról na uprawnienia.
 * Lustrzane odbicie `apps/api/src/auth/permissions.ts` — allele
 * zwiększenia braku synchronizacji pilnują testy eux-parity.
 */
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

/** Właściciel / administrator — pełny zestaw pól (applications APP_INCLUDE). */
export interface UserSummary {
  id: string;
  username: string;
  fullName: string;
  email: string;
}

/** Słownik do formularzy — GET /users/options (tylko konta aktywne). */
export interface UserOption {
  id: string;
  username: string;
  fullName: string;
  role: Role;
}

export interface UserListItem extends AuthUser {
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Tylko z listy — create/update zwracają rekord bez `_count`. */
  _count?: { sessions: number };
}

/** Uprawnienia — lustrzane odbicie apps/api/src/auth/permissions.ts */
export const PERMISSIONS = {
  VIEWER: ['app:read', 'user:read', 'ipam:read'],
  ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'audit:read',
    'ipam:read',
    'ipam:write',
    // Macierz uprawnień do aplikacji — dane osobowe osób spoza panelu.
    // Lustrzane odbicie `apps/api/src/auth/permissions.ts`.
    'access:read',
    'access:write',
  ],
  SUPER_ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'user:write',
    'audit:read',
    // Tylko super admin: `settings:write` pozwala wyłączyć tryb demo
    // i skasować 30 przykładowych rekordów naraz. Lustrzane odbicie
    // `apps/api/src/auth/permissions.ts`.
    'settings:write',
    // IPAM ma własne uprawnienia, a nie idzie pod `settings:write`:
    // adresy i podsieci to dane operacyjne, nie konfiguracja systemu.
    'ipam:read',
    'ipam:write',
    // Macierz uprawnień do aplikacji — dane osobowe osób spoza panelu.
    // Lustrzane odbicie `apps/api/src/auth/permissions.ts`.
    'access:read',
    'access:write',
  ],
} as const satisfies Record<Role, readonly string[]>;

export type Permission = (typeof PERMISSIONS)[Role][number];

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[role] as readonly string[]).includes(permission);
}

