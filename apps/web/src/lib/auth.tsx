import { createContext, useContext } from 'react';
import type { AuthUser, Permission } from '../types';

export interface AuthContextValue {
  user: AuthUser | null;
  /** Trwa wczytywanie sesji — wtedy nie renderujemy jeszcze formularza. */
  isLoading: boolean;
  /** Użytkownik zalogowany, ale musi zmienić hasło startowe. */
  mustChangePassword: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth musi być użyte wewnątrz <AuthProvider>');
  }
  return context;
}
