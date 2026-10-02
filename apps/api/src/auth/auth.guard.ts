import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import {
  PUBLIC_KEY,
  ROLES_KEY,
  PERMISSIONS_KEY,
  PASSWORD_CHANGE_KEY,
  type AuthUser,
} from './decorators';
import { roleHasPermission, type Permission } from './permissions';
import { SessionsService } from './sessions.service';

/**
 * Weryfikuje ciasteczko sesji i podpina użytkownika do żądania.
 *
 * Endpointy oznaczone @Public() przechodzą bez sprawdzania.
 * Ograniczenia ról (@Roles) sprawdzamy tu, żeby nie powtarzać tego
 * w każdym guardzie i nie zapomnieć w nowym kontrolerze.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<{
      cookies?: Record<string, string | undefined>;
      user?: AuthUser;
    }>();

    // Przy `@Public()` nie wymagamy sesji, ale wciąż ją próbujemy
    // odczytać i podpiąć do żądania. Bez tego endpoint publiczny nie
    // odróżniałby gościa od zalogowanego i musiałby ukrywać pola
    // również przed tymi, którzy mają do nich prawo.
    if (isPublic) {
      request.user = (await this.sessions.resolveFromCookie(request.cookies)) ?? undefined;
      return true;
    }

    const user = await this.sessions.resolveFromCookie(request.cookies);
    if (!user) {
      throw new UnauthorizedException('Sesja wygasła — zaloguj się ponownie.');
    }

    request.user = user;

    // Konto ze startowym (nadanym przez administratora) hasłem wstępuje
    // tylko do zmiany hasła, sesji i wylogowania. Wymuszamy to tutaj,
    // a nie w interfejsie — inaczej wywołanie API wprost omijałoby regułę.
    if (user.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean>(
        PASSWORD_CHANGE_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new ForbiddenException(
          'Musisz najpierw ustawić własne hasło.',
        );
      }
    }

    // Sprawdzenie ról
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.includes(user.role)) {
      throw new ForbiddenException('Brak uprawnień do tej operacji.');
    }

    // Sprawdzenie uprawnień
    const permissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (permissions?.length) {
      const allowed = permissions.some((p) => roleHasPermission(user.role, p));
      if (!allowed) {
        throw new ForbiddenException('Brak uprawnień do tej operacji.');
      }
    }

    return true;
  }
}
