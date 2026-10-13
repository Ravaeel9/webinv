-- Katalog podsieci i adresów IP.
--
-- Trzy tabele: podsieć trzyma zakres (`cidr`), adresy należą do podsieci,
-- a przypisanie adresu do aplikacji jest osobną tabelą, bo wiele aplikacji
-- może odpowiadać pod jednym IP (VIP) i jedna aplikacja mieć ich kilka.
--
-- Świadomie nie ruszamy tu `settings.updated_at`: `prisma migrate diff`
-- zgłasza dla niego `DROP DEFAULT`, ale to rozjazd spisany jeszcze przed
-- tym zadaniem (migracja ustawień pisała kolumnę ręcznie). Poprawka do
-- niego należy do osobnej migracji, inaczej ta ukryłaby błąd w środku
-- zmiany, o której nie jest.
--
-- Wygenerowane przez `prisma migrate diff` (prisma 6.19.3).

-- CreateEnum
CREATE TYPE "IpStatus" AS ENUM ('FREE', 'IN_USE', 'DEPRECATED');

-- CreateTable
CREATE TABLE "subnets" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "cidr" VARCHAR(18) NOT NULL,
    "description" TEXT,
    "color" VARCHAR(30) NOT NULL DEFAULT 'slate',
    "vlan" SMALLINT,
    "location" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subnets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ip_addresses" (
    "id" UUID NOT NULL,
    "subnet_id" UUID NOT NULL,
    "address" VARCHAR(18) NOT NULL,
    "status" "IpStatus" NOT NULL DEFAULT 'FREE',
    "description" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ip_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_ip_addresses" (
    "application_id" UUID NOT NULL,
    "ip_address_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_ip_addresses_pkey" PRIMARY KEY ("application_id","ip_address_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subnets_name_key" ON "subnets"("name");

-- CreateIndex
CREATE INDEX "ip_addresses_status_idx" ON "ip_addresses"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ip_addresses_subnet_id_address_key" ON "ip_addresses"("subnet_id", "address");

-- CreateIndex
CREATE INDEX "application_ip_addresses_ip_address_id_idx" ON "application_ip_addresses"("ip_address_id");

-- AddForeignKey
ALTER TABLE "ip_addresses" ADD CONSTRAINT "ip_addresses_subnet_id_fkey" FOREIGN KEY ("subnet_id") REFERENCES "subnets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_ip_addresses" ADD CONSTRAINT "application_ip_addresses_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_ip_addresses" ADD CONSTRAINT "application_ip_addresses_ip_address_id_fkey" FOREIGN KEY ("ip_address_id") REFERENCES "ip_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
