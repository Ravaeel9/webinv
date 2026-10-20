/**
 * API klienta — baza reeksportów.
 *
 * Moduły domeny (auth, settings, applications, ipam, users, audit,
 * access) trzymają właściwe hooki, a `qk` siedzi w `queries-keys.ts`,
 * bo inwalidacje też muszą je przywołać bez cyklu. Komponenty
 * importują stąd — jedna ścieżka importowa, jedna powierzchnia.
 */
export { qk } from './queries-keys';
export * from './queries-auth';
export * from './queries-settings';
export * from './queries-applications';
export * from './queries-ipam';
export * from './queries-users';
export * from './queries-audit';
export * from './queries-access';
