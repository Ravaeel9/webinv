-- Weryfikacje dostępów — rejestr przeglądów macierzy uprawnień.
--
-- Jeden wpis = jedno potwierdzenie: „dnia X osoba Y sprawdziła, że
-- zapisane dostępy są aktualne". Zakres trójstopniowy (cała macierz /
-- aplikacja / pojedynczy grant), dlatego `application_id` i `person_id`
-- są nullable. Obok identyfikatorów migawki nazwisk — historia
-- przeżywa usunięcie osoby (SetNull) i konto weryfikującego (SetNull).

-- CreateEnum
CREATE TYPE "VerificationScope" AS ENUM ('MATRIX', 'APPLICATION', 'GRANT');

-- AlterTable — znacznik ostatniego przeglądu na granicie.
ALTER TABLE "application_access" ADD COLUMN "verified_on" DATE;

-- CreateTable
CREATE TABLE "access_verifications" (
    "id" UUID NOT NULL,
    "scope" "VerificationScope" NOT NULL,
    "verified_on" DATE NOT NULL,
    "note" TEXT,
    "application_id" UUID,
    "person_id" UUID,
    "person_name" VARCHAR(200),
    "actor_id" UUID,
    "actor_name" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_verifications_application_id_idx" ON "access_verifications"("application_id");

-- CreateIndex
CREATE INDEX "access_verifications_verified_on_idx" ON "access_verifications"("verified_on");

-- AddForeignKey
ALTER TABLE "access_verifications" ADD CONSTRAINT "access_verifications_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_verifications" ADD CONSTRAINT "access_verifications_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_verifications" ADD CONSTRAINT "access_verifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
