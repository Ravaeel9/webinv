-- Tryb demonstracyjny sterowany z panelu super administratora.
--
-- Dwie rzeczy, obie potrzebne po sobie:
--
-- 1. `settings` — trwały stan przełącznika. Wcześniej tryb demo sterowała
--    zmienna środowiskowa `SEED_DEMO_APPS`, której kontener nie ma
--    na dysku na trwałe, więc decyzja administratora ginęła z restartem.
--
-- 2. `applications.is_demo` — oznaczenie rekordu demonstracyjnego.
--    Bez niego „usuń dane demo" musiałby rozpoznawać je po nazwie
--    z kodu, a zmiana nazwy rekordu w interfejsie psułaby to
--    rozpoznawanie: wpis przestałby być demo i zostałby w bazie
--    na zawsze. Kolumna jest jedynym miejscem, które mówi wprost,
--    że rekord nie jest prawdziwy.
--
-- Istniejące 30 rekordów demonstracyjnych dostaje `is_demo = true`
-- na końcu tego skryptu. `DEFAULT false` zostaje celowo: przyszłe
-- rekordy tworzone przez człowieka nie mogą być demonstracyjne,
-- nawet jeśli ktoś zapomni o podaniu pola.

-- 1. Tabela ustawień. Klucz-wartość, bo ustawień jest mało i każde
--    ma inną interpretację wartości — kolumna per ustawienie
--    wymagałaby migracji przy każdym nowym przełączniku.
CREATE TABLE "settings" (
    "key"        TEXT NOT NULL,
    "value"      TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- 2. Oznaczenie rekordu demonstracyjnego.
ALTER TABLE "applications"
    ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;

-- Indeks częściowy, a nie zwykły na kolumnie: zapytania idą po
-- `is_demo = true`, a kolumna jest wypełniona głównie `false`.
-- Zwykły indeks B-tree na takiej kolumnie jest prawie bezużyteczny —
-- i przy każdym UPDATE aplikacji wpisy z `false` aktualizują jego liście.
CREATE INDEX "applications_is_demo_idx" ON "applications" ("is_demo")
    WHERE "is_demo" = true;

-- 3. Nadanie flagi istniejącym rekordom demonstracyjnym.
--
-- Po imionach, a nie po domenie adresów właściciela: domena
-- `@firma.pl` jest wartością zapisaną w polu, które ktoś może
-- zmienić, a po domenie skasowalibyśmy prawdziwy wpis.
--
-- Lista pochodzi z `apps/api/src/seed/demo-applications.ts` i
-- `demo-services.ts`. Kto dopisze do seedu nowy program demo, musi
-- dopisać go tutaj — inaczej jego dane nie dostaną flagi i przycisk
-- kasujący ich nie zobaczy. Test `demo-marker.test.ts` pilnuje,
-- że obie listy i ta migracja mają tę samą zawartość.
UPDATE "applications" AS a
SET "is_demo" = true
WHERE a."name" IN (
    -- demo-applications.ts (20)
    'Mozilla Firefox',
    '7-Zip',
    'VLC media player',
    'LibreOffice',
    'Notepad++',
    'KeePassXC',
    'Mozilla Thunderbird',
    'Visual Studio Code',
    'DBeaver Community',
    'WinSCP',
    'Zoom Workplace',
    'Microsoft Teams',
    'Jira Software',
    'Pandoc',
    'OBS Studio',
    'IntelliJ IDEA Community (darmowa edycja)',
    'PostgreSQL Workbench',
    'Cryptomator',
    'Adobe Acrobat Reader',
    'Okular'
    -- demo-services.ts (10)
    ,
    'Google Workspace',
    'Atlassian Confluence',
    'DocuSign',
    'Calendly',
    '1Password Business',
    'Nextcloud',
    'Grafana',
    'Keycloak',
    'Mattermost',
    'Forgejo'
);