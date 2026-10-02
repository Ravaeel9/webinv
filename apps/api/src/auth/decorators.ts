import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@prisma/client';
import type { Permission } from './permissions';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';
export const PUBLIC_KEY = 'isPublic';
export const PASSWORD_CHANGE_KEY = 'allowWhilePasswordChangeRequired';

/** Endpoint dostępny bez zalogowania (login, health). */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Endpoint dostępny, mimo że konto ma obowiązek zmiany hasła startowego.
 * Bez tego użytkownik z hasłem nadanym przez administratora utknąłby
 * w pętli: frontend każe mu iść do /konto, a API odrzuca wszystko.
 *
 * Oznaczamy tylko to, co musi działać: zmiana hasła, sesje i wylogowanie.
 */
export const AllowWhilePasswordChangeRequired = () =>
  SetMetadata(PASSWORD_CHANGE_KEY, true);

/** Wymagane role — wystarczy jedna z nich. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Wymagane uprawnienia — wystarczy jedno z nich. */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Użytkownik zalogowany w bieżącym żądaniu. */
export interface AuthUser {
  id: string;
  username: string;
  email: string;
  fullName: string;
  role: Role;
  mustChangePassword: boolean;
}

/** Wstrzyknięcie zalogowanego użytkownika do kontrolera. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    return data ? request.user?.[data] : request.user;
  },
);

/** Adres IP klienta (z nagłówków ustawionych przez nginx). */
export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<{
    ip?: string;
    headers: Record<string, string | undefined>;
  }>();
  return (
    request.headers['x-forwarded-for']?.split(',')[0]?.trim() ??
    request.headers['x-real-ip'] ??
    request.ip ??
    'unknown'
  );
});

/** User-Agent klienta. */
export const ClientUserAgent = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
    }>();
    return (request.headers['user-agent'] ?? '').slice(0, 500);
  },
);
