-- „Odpowiedzialni" z katalogu osób.
--
-- Właściciel i administratorzy aplikacji przechodzą z wolnego e-maila
-- i kont panelu na relacje do `persons` — tego samego katalogu, z
-- którego bierze się macierz uprawnień. Dopasowanie po adresie e-mail
-- (`citext`, porównanie bez wielkości liter); szkrzynki zespołowe bez
-- odpowiednika w katalogu celowo dają NULL, nie pseudo-osobę.
--
-- Kolejność jest warunkiem poprawności: najpierw nowe kolumny i
-- backfill, struktura `_AppAdmins` przechodzi na osoby jeszcze ZEW
-- mając stare dane, dopiero na końcu witamy stary kolumnę.

-- 1. Kolumna właściciela
ALTER TABLE "applications" ADD COLUMN "owner_person_id" UUID;
CREATE INDEX "applications_owner_person_id_idx"
  ON "applications"("owner_person_id");

-- 2. Backfill właścicieli: applications.owner_email → persons.email
UPDATE "applications" a
SET "owner_person_id" = p."id"
FROM "persons" p
WHERE a."owner_email" = p."email";

-- 3. Backfill administratorów: konto panelu → osoba po e-mailu
UPDATE "_AppAdmins" m
SET "B" = p."id"
FROM "users" u
JOIN "persons" p ON p."email" = u."email"
WHERE m."B" = u."id";

-- 4. Wiersze bez dopasowania nie mogą przejść FK na osoby — konto bez
--    odpowiadającej mu osoby coś ważącego dzisiaj, admin będzie
--    przypadki odbierz forme dopiero w nowej integracji.
DELETE FROM "_AppAdmins" m
WHERE NOT EXISTS (SELECT 1 FROM "persons" p WHERE p."id" = m."B");

-- 5. Przełączenie struktury `_AppAdmins` na osoby
ALTER TABLE "_AppAdmins" DROP CONSTRAINT "_AppAdmins_AB_pkey";
ALTER TABLE "_AppAdmins" DROP CONSTRAINT "_AppAdmins_B_fkey";
-- Indeks z inicjalnej migracji siedzi na starej kolumnie B (konta users);
-- bez tego DROP nowy indeks o tej samej nazwie nie powstanie.
DROP INDEX IF EXISTS "_AppAdmins_B_index";
CREATE INDEX "_AppAdmins_B_index" ON "_AppAdmins"("B");
ALTER TABLE "_AppAdmins" ADD CONSTRAINT "_AppAdmins_AB_pkey"
  PRIMARY KEY ("A", "B");
ALTER TABLE "_AppAdmins" ADD CONSTRAINT "_AppAdmins_B_fkey"
  FOREIGN KEY ("B") REFERENCES "persons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Właściciel relacja FK przed wycofaniem starego pola
ALTER TABLE "applications" ADD CONSTRAINT "applications_owner_person_id_fkey"
  FOREIGN KEY ("owner_person_id") REFERENCES "persons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Stare pole i indeks — po backfillu, więc znika bezpiecznie
DROP INDEX "applications_owner_email_idx";
ALTER TABLE "applications" DROP COLUMN "owner_email";
