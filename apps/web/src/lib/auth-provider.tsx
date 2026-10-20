import { useEffect, useRef, type ReactNode } from 'react';
import { Outlet } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { useLogin, useLogout, useMe } from './queries';
import { AuthContext, type AuthContextValue } from './auth';
import { can as roleCan } from '../types';

/**
 * Provider sesji — implementacja; kontekst i hook `useAuth` żyją
 * w `auth.tsx`. Plik eksportujący komponent i hook naraz psuje fast
 * refresh w dev (`react-refresh/only-export-components`).
 */
export function AuthProvider({ children }: { children?: ReactNode }) {
  const { data, isLoading, error } = useMe();
  const loginMutation = useLogin();
  const logoutMutation = useLogout();
  const queryClient = useQueryClient();

  const user = data?.user ?? null;

  /**
   * 401 oznacza, że nie ma sesji. Cache czyścimy tylko wtedy, gdy
   * sesja **znikła** — czyli użytkownik był zalogowany i nagle przestał.
   *
   * Dlaczego nie przy każdym 401: gość na publicznym `/aplikacje` dostaje
   * 401 z `/auth/me` przy każdym wejściu, a w cache nie ma wtedy nic
   * prywatnego do czyszczenia. Czyszczenie mimo to szkodziło: `removeQueries`
   * wywołuje `query.destroy()`, który anuluje zapytanie w locie
   * (`cancel({ silent: true })`). Obserwator strony zostawał w stanie
   * `pending` na zawsze, bo nikt nie odbudowywał mu zapytania —
   * spinner „Ładowanie…" kręcił się w nieskończoność, bez błędu.
   *
   * Dwa warunki, których nie wolno pominąć:
   *  - czyszczenie idzie w `useEffect`, nie w treść renderu —
   *    zmiana cache w fazie renderowania to błąd w Reaccie;
   *  - `resetQueries`, a nie `removeQueries` — `reset` zeruje stan
   *    i pozwala aktywnym zapytaniom dociągnąć dane ponownie,
   *    zamiast je cicho anulować. Wykluczamy `me`, bo to ono
   *    zwróciło 401 i jego odtworzenie zapętliłoby procedurę.
   */
  const unauthorized = error instanceof ApiError && error.isUnauthorized;
  const hadSession = useRef(false);
  // Śledzenie „była sesja" idzie w efekt: zapis refa w renderze nie jest
  // bezpieczny przy współbieżnych renderach — porzucony render może go
  // ustawić bez powodu. Efekt deklarujemy **przed** czyszczeniem, żeby w
  // jednym commicie kolejność zawsze była ta sama.
  useEffect(() => {
    if (user) hadSession.current = true;
  }, [user]);

  useEffect(() => {
    if (!unauthorized || !hadSession.current) return;
    hadSession.current = false;
    queryClient.resetQueries({
      predicate: (query) => query.queryKey[0] !== 'me',
    });
  }, [unauthorized, queryClient]);

  const value: AuthContextValue = {
    user,
    isLoading,
    mustChangePassword: user?.mustChangePassword ?? false,
    login: async (username, password) => {
      const result = await loginMutation.mutateAsync({
        username,
        password,
      });
      // Po udanym logowaniu pobieramy świeże dane sesji
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      return result.user;
    },
    logout: async () => {
      await logoutMutation.mutateAsync();
    },
    can: (permission) => (user ? roleCan(user.role, permission) : false),
  };

  return (
    <AuthContext.Provider value={value}>
      {/* Używane jako `element` trasy — wtedy wypuszczamy Outlet.
          Dzieci są opcjonalne, bo router nie przekazuje ich tutaj. */}
      {children ?? <Outlet />}
    </AuthContext.Provider>
  );
}
