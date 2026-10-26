-- Twardnienie rejestru przeglądów po recenzji bezpieczeństwa.
--
-- 1. Migawka nazwiska: DTO dopuszcza imię i nazwisko po 100 znaków
--    każde, więc poprawny zapis `imię nazwisko` może mieć 201 znaków —
--    ponad kolumnę VARCHAR(200). Na żywej bazie był to nieobsłużony
--    błąd zapisu, którego atrapa testowa nie odwzorowuje.
-- 2. Indeks po `created_at`: blokada 24 h między przeglądami filtruje
--    po tej kolumnie przy każdym zapisie — bez indeksu pełny skan.

ALTER TABLE "access_verifications" ALTER COLUMN "person_name" TYPE VARCHAR(255);

-- CreateIndex
CREATE INDEX "access_verifications_created_at_idx" ON "access_verifications"("created_at");
