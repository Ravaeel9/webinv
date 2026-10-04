-- Przebudowa kategorii oprogramowania na typ dostarczenia.
--
-- Dotąd `category` była wolnym tekstem i w praktyce trzymała domenę
-- biznesową („Finanse", „HR"). Wymagania są inne: rejestr musi rozróżniać
-- program na stanowisku od usługi hostowanej, a dla usługi opisać hosting
-- i wsparcie. Stare wartości są niejednoznaczne (nikt nie wie, czy
-- „Infrastruktura" to domena czy typ dostarczenia), więc nie próbujemy
-- ich zgadywać — kolumna znika, a każdy rekord dostaje jawny default,
-- który poprawisz w formularzu.

-- 1. Typy enums. Tworzone przed kolumnami, bo `delivery_type` ma
--    domyślną wartość z tego typu.
CREATE TYPE "DeliveryType" AS ENUM (
    'GENERAL_USE',
    'SELF_HOSTED',
    'SAAS',
    'VENDOR_MANAGED'
);

CREATE TYPE "SupportOwnerType" AS ENUM ('INTERNAL', 'VENDOR');

CREATE TYPE "SupportChannel" AS ENUM (
    'EMAIL',
    'PHONE',
    'PORTAL',
    'CHAT',
    'ON_SITE'
);

-- 2. Nowe kolumny. Wszystkie z wyjątkiem `delivery_type` są opcjonalne:
--    pola wsparcia wypełnia się dla usług, a dla programu na stanowisku
--    nie mają w ogóle zastosowania. Żadna z nich nie jest wymagana —
--    brak kontaktu do wsparcia nie może blokować zapisu rejestru.
ALTER TABLE "applications"
    ADD COLUMN "delivery_type" "DeliveryType" NOT NULL DEFAULT 'GENERAL_USE',
    ADD COLUMN "base_url" VARCHAR(500),
    ADD COLUMN "hosting_location" VARCHAR(200),
    ADD COLUMN "admin_team" VARCHAR(200),
    ADD COLUMN "support_owner_type" "SupportOwnerType",
    ADD COLUMN "support_owner_name" VARCHAR(200),
    ADD COLUMN "support_email" CITEXT,
    ADD COLUMN "support_url" VARCHAR(500),
    ADD COLUMN "support_channel" "SupportChannel",
    ADD COLUMN "support_notes" TEXT;

-- 3. Indeks na typ dostarczenia — zastępuje indeks po kategorii, który
--    obsługiwał dokładnie ten sam filtr na liście.
CREATE INDEX "applications_delivery_type_idx" ON "applications"("delivery_type");

-- 4. Stara kolumna. Kolejność ma znaczenie: indeks musi zniknąć przed
--    kolumną, inaczej Postgres odmówi usunięcia kolumny z indeksem.
DROP INDEX "applications_category_idx";

ALTER TABLE "applications" DROP COLUMN "category";
