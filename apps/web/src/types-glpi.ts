/**
 * Integracja GLPI — ustawienia, import i mapowanie powodów odrzuceń.
 */
// ─── Integracja GLPI ──────────────────────────────────────────

import type { DeliveryType } from './types-application';

export type GlpiAccessLevel = 'OWNER' | 'ADMIN' | 'USER' | 'READ_ONLY';

/** Stan ustawień GLPI — sekrety wracają wyłącznie jako flagi `has*`. */
export interface GlpiSettingsState {
  apiUrl: string;
  clientId: string;
  login: string;
  legacyUrl: string;
  parentGroup: string;
  accessLevel: GlpiAccessLevel;
  hasClientSecret: boolean;
  hasPassword: boolean;
  hasUserToken: boolean;
  hasAppToken: boolean;
  skonfigurowano: boolean;
}

/** Zapis ustawień — sekrety opcjonalne: brak pola znaczy „zostaw". */
export interface GlpiSettingsInput {
  apiUrl: string;
  clientId: string;
  clientSecret?: string;
  login: string;
  haslo?: string;
  legacyUrl: string;
  userToken?: string;
  appToken?: string;
  parentGroup: string;
  accessLevel: GlpiAccessLevel;
}

export type GlpiSekcja = 'persons' | 'software' | 'access';

/** Wiersz podglądu osób z GLPI. */
export interface GlpiOsobaRow {
  status: 'NEW' | 'SKIP' | 'ERROR';
  glpiId: number;
  osoba: {
    firstName: string;
    lastName: string;
    email: string;
    position: string | null;
    department: string | null;
  } | null;
  reason: string | null;
}

/** Wiersz podglądu oprogramowania z GLPI. */
export interface GlpiSoftwareRow {
  status: 'NEW' | 'SKIP' | 'ERROR';
  glpiId: number;
  name: string;
  version: string;
  reason: string | null;
}

/** Podgląd importu GLPI — trzy sekcje, wzorzec podgląd → zatwierdzenie. */
export interface GlpiImportPreview {
  osoby: {
    rows: GlpiOsobaRow[];
    summary: { created: number; skipped: number; errors: number };
  };
  oprogramowanie: {
    rows: GlpiSoftwareRow[];
    summary: { created: number; skipped: number; errors: number };
  };
  dostepy: {
    aplikacje: Array<{
      status: 'NEW' | 'SKIP';
      glpiId: number;
      name: string;
      reason: string | null;
    }>;
    pary: Array<{
      status: 'NEW' | 'SKIP' | 'ERROR';
      personEmail: string;
      applicationName: string;
      reason: string | null;
    }>;
    summary: { created: number; skipped: number; errors: number };
  };
}

/** Payload zapisu — dane z podglądu; serwer i tak wszystko zrewaliduje. */
export interface GlpiImportPayload {
  sections: GlpiSekcja[];
  persons?: Array<{
    firstName: string;
    lastName: string;
    email: string;
    position: string | null;
    department: string | null;
  }>;
  /** Typ dostarczenia — brak pola znaczy „zostaw domyślne" (GENERAL_USE). */
  software?: Array<{ name: string; version: string; deliveryType?: DeliveryType }>;
  access?: Array<{ personEmail: string; applicationName: string }>;
}

/** Wynik zapisu — liczniki per sekcja. */
export type GlpiImportResult = Record<GlpiSekcja, { created: number; skipped: number }>;

/** Polskie tłumaczenia powodów pominięcia/odrzucenia wiersza. */
export const GLPI_POWODY: Record<string, string> = {
  ISTNIEJE: 'Już istnieje w web-inv',
  MISSING_EMAIL: 'Brak adresu e-mail w GLPI',
  MISSING_NAME: 'Brak nazwiska i imienia w GLPI',
  KONTO_USUNIETE: 'Konto w GLPI jest usunięte',
  PERSON_BRAK_EMAIl: 'Członek grupy bez adresu e-mail',
  PERSON_BRAK_W_KATALOGU: 'Osoby nie ma w katalogu web-inv',
  APP_BRAK_W_REJESTRZE: 'Aplikacji nie ma jeszcze w rejestrze',
};
