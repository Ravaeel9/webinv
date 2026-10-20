/**
 * ESLint — jedna konfiguracja na całe repozytorium (flat config).
 *
 * Celowo bez reguł stylistycznych: formatowanie zostawiamy tsc i
 * przyzwyczajeniom zespołu, a lint łapie rzeczy, których typy nie
 * widzą — martwe zmienne, błędy hooków Reacta, przypadkowe `any`.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      'graphify-out/**',
      'docs/**',
      'backups/**',
    ],
  },

  // Wspólna baza TS — API i web.
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Uwagi w plikach bywają celowe (np. dokumentacja BOM-a w
      // `queries.ts`), więc nieregularne białe znaki łapiemy tylko w kodzie.
      'no-irregular-whitespace': ['error', { skipComments: true }],
			// Konwencja repo: przedrostek `_` oznacza świadomie nieużywany
			// argument (widać to już w testach przy atrapach).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Zależności są przypięte na słowo (AGENTS.md) — ostrzeżenia
      // o nieprecyzyjnych typach deklarowanych w `package.json`.
      '@typescript-eslint/no-require-imports': 'error',
    },
  },

  // NestJS API: moduły dekorowane przez refleksję mają puste konstruktory
  // właściwości (`private readonly prisma: PrismaService`), więc wyłączamy
  // regułę oczekującą użycia w ciele klasy.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-useless-constructor': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Skrypty uruchamiane w Node (migracje) i pliki działające globalnie
  // w przeglądarce (`public/`) nie mają modułu TS — dajemy im globals.
  {
    files: ['apps/api/scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },

  // Pliki konfiguracyjne działające w Node.
  {
    files: ['*.config.*', 'apps/*/vite.config.*'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // Web: React 19 — reguły hooków to najcenniejsze, co tu jest.
  {
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': 'warn',
      // NOWY plugin (v6) kategoryzuje każdą synchroniczną wstępną
      // aktualizację formularza w `useEffect` jako błąd. Wzorce istnieją
      // w kilku stronach i wymagają świadomego refaktoringu (inicjalizacja
      // danych z serwera), więc na razie są ostrzeżeniem — nie znikają
      // z radaru, ale nie blokują CI. Do zrobienia wraz rozbijaniem
      // „god files" (ApplicationFormPage itd.).
      'react-hooks/set-state-in-effect': 'warn',
      // `lib/auth.tsx` celowo zapisuje flagę „była sesja“ w renderze;
      // przeniesienie do `useEffect` zmienia kolejność względem resety
      // cache przy 401 — do przemyślenia osobno.
      'react-hooks/refs': 'warn',
    },
  },

  // Pliki konfiguracyjne działające w Node.
  {
    files: ['*.config.*', 'apps/*/vite.config.*'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
