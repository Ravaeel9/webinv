-- Właściciel aplikacji przestaje być użytkownikiem, a staje się
-- adresem e-mail. Kolejność kroków jest istotna: `DROP COLUMN` kasuje
-- dane, więc przepisanie adresów musi się odbyć, zanim kolumna zniknie.

-- 1. Nowa kolumna tekstowa.
ALTER TABLE "applications" ADD COLUMN "owner_email" CITEXT;

-- 2. Przepisanie obecnych właścicieli na e-mail (dokładnie to,
--    co dziś widać w słowniku użytkowników).
UPDATE "applications" a
   SET "owner_email" = u."email"
  FROM "users" u
 WHERE u."id" = a."owner_id";

-- 3. Stary indeks i kolumna z kluczem obcym.
DROP INDEX "applications_owner_id_idx";
ALTER TABLE "applications" DROP COLUMN "owner_id";

-- 4. Indeks w miejscu starego — filtrujemy po właścicielu.
CREATE INDEX "applications_owner_email_idx" ON "applications"("owner_email");