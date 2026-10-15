/**
 * Uprawnienia — odwzorowanie ról na konkretne uprawnienia.
 *
 * Trzymamy to w jednym miejscu, bo pozwala to walidować przypisania
 * (np. nie da się nadać roli SUPER_ADMIN kontu innego super admina
 * przez zwykłego panel admina) i renderować UI bez duplikowania logiki.
 */
export const PERMISSIONS = {
  VIEWER: ['app:read', 'user:read', 'audit:read', 'ipam:read'],
  ADMIN: [
    'app:read',
    'app:write',
    'user:read',
    'audit:read',
    'ipam:read',
    'ipam:write',
    // Macierz uprawnień do aplikacji — dane osobowe osób, które nie mają
    // konta w panelu. Osobne uprawnienia, bo dziś tożsame z `app:write`,
    // ale pozwalają kiedyś oddać sam odczyt osobom z rolą VIEWER.
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
    // i skasować 30 przykładowych rekordów naraz. `ADMIN` ma
    // `app:write`, czyli może usunąć aplikację pojedynczo — to inna
    // skala i inna odpowiedzialność.
    'settings:write',
    // IPAM ma własne uprawnienia, a nie idzie pod `settings:write`:
    // adresy i podsieci to dane operacyjne, nie konfiguracja systemu.
    // `ADMIN` redaguje je już dziś, a `settings:write` zostaje
    // zastrzeżone dla operacji nieodwracalnych.
    'ipam:read',
    'ipam:write',
    // Macierz uprawnień — ta sama co w ADMIN: edycja macierzy jest
    // operacją na istniejącej aplikacji, więc nie jest zarezerwowana
    // dla super administratora.
    'access:read',
    'access:write',
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
  'settings:write',
  'ipam:read',
  'ipam:write',
  'access:read',
  'access:write',
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
