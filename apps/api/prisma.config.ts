import { defineConfig, env } from 'prisma/config';

/**
 * Konfiguracja CLI Prisma.
 *
 * W Prisma 6.19 `package.json#prisma` jest przestarzały, więc trzymamy
 * ustawienia tutaj. Używamy `process.env` zamiast helpera `env()`,
 * bo `prisma generate` nie potrzebuje adresu bazy — a `env()`
 * rzuciłoby wyjątkiem i zepsułoby build obrazu Docker.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  // Wymagane przez `migrations.initShadowDb` — bez tego CLI odmawia
  // wczytania configu (weryfikacja w Prisma 6.19.3).
  experimental: {
    externalTables: true,
  },
  migrations: {
    path: 'prisma/migrations',
    // Shadow database powstaje od zera, więc nie ma w niej rozszerzeń
    // włączonych przez skrypty initdb. Bez tego `migrate dev` odpada
    // na "type citext does not exist" podczas walidacji migracji.
    initShadowDb: `
      CREATE EXTENSION IF NOT EXISTS citext;
    `,
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
