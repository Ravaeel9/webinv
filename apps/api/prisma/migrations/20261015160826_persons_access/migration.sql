-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('OWNER', 'ADMIN', 'USER', 'READ_ONLY');

-- AlterTable
ALTER TABLE "settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" CITEXT NOT NULL,
    "position" VARCHAR(150),
    "department" VARCHAR(150),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_access" (
    "application_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "level" "AccessLevel" NOT NULL DEFAULT 'USER',
    "granted_on" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_on" DATE,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_access_pkey" PRIMARY KEY ("application_id","person_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "persons_email_key" ON "persons"("email");

-- CreateIndex
CREATE INDEX "persons_last_name_idx" ON "persons"("last_name");

-- CreateIndex
CREATE INDEX "application_access_person_id_idx" ON "application_access"("person_id");

-- CreateIndex
CREATE INDEX "application_access_expires_on_idx" ON "application_access"("expires_on");

-- AddForeignKey
ALTER TABLE "application_access" ADD CONSTRAINT "application_access_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_access" ADD CONSTRAINT "application_access_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
