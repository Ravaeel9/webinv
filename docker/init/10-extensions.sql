-- ─────────────────────────────────────────────────────────────
--  Inicjalizacja bazy — wykonywana RAZ przy pierwszym initdb.
--  Mountowana jako /docker-entrypoint-initdb.d/10-extensions.sql
-- ─────────────────────────────────────────────────────────────

-- citext: typ tekstu case-insensitive.
-- Używamy go dla username / email / nazwy aplikacji, żeby
-- "Jan" i "jan" nie mogły być jednocześnie w bazie — bez
-- pisania warunków w każdym zapytaniu.
--
-- Obraz postgres:17-alpine NIE zawiera tego rozszerzenia,
-- więc musimy je włączyć ręcznie.
CREATE EXTENSION IF NOT EXISTS citext;

-- uuid-ossp: generowanie UUID w SQL (np. przy skryptach
-- ad hoc). Prisma generuje identyfikatory po stronie aplikacji,
-- ale rozszerzenie nie przeszkadza i bywa przydatne.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
