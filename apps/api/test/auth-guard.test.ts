/**
 * AuthGuard — brama całego panelu.
 *
 * Guard musi rozstrzygnąć cztery rzeczy, zanim żądanie dotrze do
 * kontrolera: sesję, wymóg ustawienia własnego hasła, rolę i uprawnienie.
 * Historia pokazuje, dlaczego to wymaga testów: endpointy publiczne
 * mają widzieć gościa (a nie ślepo przepuszczać), a konto ze startowym
 * hasłem nie może przez API obchodzić wymogu jego zmiany.
 */
import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '../src/auth/auth.guard';
import {
  PUBLIC_KEY,
  ROLES_KEY,
  PERMISSIONS_KEY,
  PASSWORD_CHANGE_KEY,
  type AuthUser,
} from '../src/auth/decorators';

const USER: AuthUser = {
  id: randomUUID(),
  username: 'jan',
  email: 'jan@firma.pl',
  fullName: 'Jan Kowalski',
  role: 'VIEWER',
  mustChangePassword: false,
};

/**
 * Atrapa Reflector: klucze dekoratorów trzyma w mapie, a
 * `getAllAndOverride` zwraca wartość ustawioną dla handlera albo klasy —
 * wystarczy, bo guard i tak zawsze pyta o tę samą parę.
 */
function fakeReflector(ustawienia: Record<string, unknown> = {}) {
  const mapa = new Map(Object.entries(ustawienia));
  return {
    getAllAndOverride: (key: string) => mapa.get(key),
  } as never;
}

function fakeSessions(user: AuthUser | null) {
  return {
    resolveFromCookie: async () => user,
  } as never;
}

function kontekst() {
  const request: {
    cookies?: Record<string, string | undefined>;
    user?: AuthUser;
  } = { cookies: { sid: 'token' } };
  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => 'handler',
      getClass: () => 'class',
    } as never,
  };
}

function guard(
  ustawienia: Record<string, unknown>,
  user: AuthUser | null = USER,
) {
  return new AuthGuard(fakeReflector(ustawienia), fakeSessions(user));
}

describe('AuthGuard — sesja', () => {
  it('przepuszcza zalogowanego i podpina użytkownika do żądania', async () => {
    const { context, request } = kontekst();
    const wynik = await guard({}).canActivate(context);
    assert.equal(wynik, true);
    assert.deepEqual(request.user, USER);
  });

  it('bez sesji odrzuca 401', async () => {
    const { context } = kontekst();
    await assert.rejects(
      () => guard({}, null).canActivate(context),
      UnauthorizedException,
    );
  });

  it('endpoint publiczny działa bez sesji, ale wciąż rozpoznaje gościa', async () => {
    const { context, request } = kontekst();
    const g = guard({ [PUBLIC_KEY]: true }, null);

    assert.equal(await g.canActivate(context), true);
    assert.equal(request.user, undefined);
  });

  it('endpoint publiczny podpina sesję, jeśli jednak istnieje', async () => {
    const { context, request } = kontekst();
    const g = guard({ [PUBLIC_KEY]: true });

    assert.equal(await g.canActivate(context), true);
    assert.deepEqual(request.user, USER);
  });
});

describe('AuthGuard — startowe hasło', () => {
  const STARTOWE: AuthUser = { ...USER, mustChangePassword: true };

  it('konto ze startowym hasłem wstępuje tylko tam, gdzie wolno', async () => {
    const { context } = kontekst();
    const g = guard(
      { [PASSWORD_CHANGE_KEY]: true },
      STARTOWE,
    );
    assert.equal(await g.canActivate(context), true);
  });

  it('konto ze startowym hasłem nie obejdzie wymogu API-em', async () => {
    const { context } = kontekst();
    await assert.rejects(
      () => guard({}, STARTOWE).canActivate(context),
      ForbiddenException,
    );
  });
});

describe('AuthGuard — role i uprawnienia', () => {
  it('odrzuca rolę spoza listy @Roles', async () => {
    const { context } = kontekst();
    await assert.rejects(
      () =>
        guard(
          { [ROLES_KEY]: ['SUPER_ADMIN'] },
        ).canActivate(context),
      ForbiddenException,
    );
  });

  it('przepuszcza rolę z listy @Roles', async () => {
    const { context } = kontekst();
    const g = guard({ [ROLES_KEY]: ['ADMIN', 'VIEWER'] });
    assert.equal(await g.canActivate(context), true);
  });

  it('odrzuca uprawnienie, którego rola nie ma', async () => {
    const { context } = kontekst();
    await assert.rejects(
      () =>
        guard(
          { [PERMISSIONS_KEY]: ['settings:write'] },
        ).canActivate(context),
      ForbiddenException,
    );
  });

  it('przepuszcza, gdy choć jedno wymagane uprawnienie przysługuje', async () => {
    const { context } = kontekst();
    const g = guard({
      [PERMISSIONS_KEY]: ['app:read', 'settings:write'],
    });
    assert.equal(await g.canActivate(context), true);
  });
});
