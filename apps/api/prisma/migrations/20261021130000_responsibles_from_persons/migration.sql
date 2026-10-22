-- „Odpowiedzialni" z katalogu osób.
--
-- Właściciel i administratorzy aplikacji przechodzą z wolnego e-maila
-- i kont panelu na relacje do `persons` — tego samego katalogu, z
-- którego bierze się macierz uprawnień. Dopasowanie po adresie e-mail
-- (`citext`, porównanie bez wielkości liter); skrzynki zespołowe bez
-- odpowiednika w katalogu celowo dają NULL, nie pseudo-osobę.
--
-- Kolejność jest warunkiem poprawności: dopóki FK `_AppAdmins_B_fkey`
-- wisi na `users(id)`, przepisanie kolumny B na identyfikatory osób
-- narusza klucz i wywala migrację. Dlatego ograniczenia zdejmiemy
-- PRZED backfillem administratorów, a odtworzymy na nowo, już na
-- osoby. Kolumnę `owner_email` kasujemy na samym końcu, po backfillu.

-- 1. Kolumna właściciela
ALTER TABLE "applications" ADD COLUMN "owner_person_id" UUID;
CREATE INDEX "applications_owner_person_id_idx"
  ON "applications"("owner_person_id");

-- 2. Backfill właścicieli: applications.owner_email → persons.email
UPDATE "applications" a
SET "owner_person_id" = p."id"
FROM "persons" p
WHERE a."owner_email" = p."email";

-- 3. Zdjęcie starych ograniczeń `_AppAdmins` PRZED przepisaniem
--    kolumny B (patrz komentarz nagłówkowy).
ALTER TABLE "_AppAdmins" DROP CONSTRAINT "_AppAdmins_AB_pkey";
ALTER TABLE "_AppAdmins" DROP CONSTRAINT "_AppAdmins_B_fkey";
DROP INDEX IF EXISTS "_AppAdmins_B_index";

-- 4. Backfill administratorów: konto panelu → osoba po e-mailu
UPDATE "_AppAdmins" m
SET "B" = p."id"
FROM "users" u
JOIN "persons" p ON p."email" = u."email"
WHERE m."B" = u."id";

-- 5. Wiersze bez dopasowania nie przechodzą FK na osoby — konto bez
--    odpowiadającej mu osoby zostaje wycięte; administratora bierze
--    się na nowo z katalogu, a wpis historyczny nie kłamie.
DELETE FROM "_AppAdmins" m
WHERE NOT EXISTS (SELECT 1 FROM "persons" p WHERE p."id" = m."B");

-- 6. Odtworzenie struktury `_AppAdmins` na osoby
CREATE INDEX "_AppAdmins_B_index" ON "_AppAdmins"("B");
ALTER TABLE "_AppAdmins" ADD CONSTRAINT "_AppAdmins_AB_pkey"
  PRIMARY KEY ("A", "B");
ALTER TABLE "_AppAdmins" ADD CONSTRAINT "_AppAdmins_B_fkey"
  FOREIGN KEY ("B") REFERENCES "persons"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. Właściciel: FK do osób (SetNull — usunięcie osoby z katalogu
--    to zdarzenie błędnych wpisów, aplikacja ma przetrwać)
ALTER TABLE "applications" ADD CONSTRAINT "applications_owner_person_id_fkey"
  FOREIGN KEY ("owner_person_id") REFERENCES "persons"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Stare pole i indeks — po backfillu, więc znika bezpiecznie
DROP INDEX "applications_owner_email_idx";
ALTER TABLE "applications" DROP COLUMN "owner_email";
