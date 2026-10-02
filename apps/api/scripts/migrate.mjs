#!/usr/bin/env node
/**
 * Migracja bazy danych — uruchamiana przy starcie kontenera API,
 * zanim Nest wstanie. Migracje z katalogu prisma/migrations
 * stosujemy przez `prisma migrate deploy` (bez pytania o interakcję),
 * bo `migrate dev` jest przeznaczone do prac lokalnych i tworzyłoby
 * shadow database.
 *
 * Plik ma rozszerzenie .mjs, bo aplikacja jest modułem CommonJS
 * (brak "type": "module" w package.json), a ten skrypt pisze
 * składnią ESM.
 */
import { execSync } from 'node:child_process';

console.log('[migrate] stosowanie migracji (prisma migrate deploy)...');

try {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: process.env,
  });
  console.log('[migrate] OK');
} catch {
  console.error(
    '[migrate] FAILED — kontener się nie uruchomi.\n' +
      '[migrate] Migracja nie została w pełni zastosowana, więc nie\n' +
      '[migrate] puszczamy dalej: lepiej brak usługi niż niespójne dane.',
  );
  process.exit(1);
}
