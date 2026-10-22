.PHONY: help install install-lowmem init up up-dev down restart update logs ps build rebuild release release-dry release-minor migrate generate db-up studio dev-api dev-web typecheck psql shell backup restore reset clean export-demo uninstall

# Ścieżka wydania żyje w scripts/release.sh, nie tutaj: kroków jest
# dużo i kolejność ma znaczenie (testy → wersja → commit → tag → build →
# weryfikacja → push). Rozbicie tego na cele make pozwoliłoby uruchomić
# pół drogi i zostać z obrazem, którego wersja nie pasuje do commita.

APP := webinv
# Budowanie serwisów po kolei zamiast równolegle. Na jednym vCPU
# nie przyspiesza, a mniej więcej dwukrotnie obniża szczytowe
# zużycie RAM — na VPS-ie z 1 GB to różnica między sukcesem
# a OOM-killem w trakcie `npm ci`.
COMPOSE := COMPOSE_PARALLEL_LIMIT=1 docker compose

# Wersja wplatana do obrazu frontendu (widoczna w prawym dolnym rogu
# interfejsu). Źródłem jest pole `version` w głównym package.json —
# jedyne miejsce, które trzeba zmienić przy wydaniu.
#
# `node -p` zamiast `grep`, bo package.json to JSON, a nie tekst do
# regexa. `$(shell …)` przelicza się przy każdym wywołaniu make, więc
# podniesienie wersji jest widoczne od razu, bez `make clean`.
VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0)
#
# Semantyka dopisku `-dev`: HEAD oznaczony tagiem `v$(VERSION)` to
# dokładnie stan wydania (`scripts/release.sh` taguje przed buildem),
# więc plakietka pokazuje czysty numer. Każdy późniejszy commit to
# build „pomiędzy wydaniami" — dostaje dopisek `-dev`, żeby z plakietki
# było widać, że nie pochodzi z żadnego tagu. Fallback `0.0.0-dev`
# wypada tylko poza repozytorium gita (brak node/gita), gdzie wersji
# i tak nie ma z czego odczytać.
APP_VERSION != if [ "$$(git describe --tags --exact-match 2>/dev/null)" = "v$(VERSION)" ]; then echo "$(VERSION)"; else echo "$(VERSION)-dev"; fi
# Nakładka deweloperska — wystawia bazę na porcie DB_DEV_PORT (55432),
# żeby dało się podłączyć Prisma Studio albo psql z maszyny.
# W produkcyjnym `make up` NIE jest używana — baza zostaje w sieci wewnętrznej.
COMPOSE_DEV := $(COMPOSE) -f docker-compose.yml -f docker-compose.dev.yml

# Port bazy z .env (albo 55432, jeśli nie ustawiono)
DB_DEV_PORT ?= $(shell grep -E '^DB_DEV_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 55432)

# URL do bazy dla poleceń Prisma uruchamianych poza Dockerem
DEV_DB_URL = postgresql://$(shell grep -E '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2 || echo webinv):$(shell grep -E '^POSTGRES_PASSWORD=' .env 2>/dev/null | cut -d= -f2)@localhost:$(DB_DEV_PORT)/$(shell grep -E '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2 || echo webinv)?schema=public

help: ## Pokaż tę pomoc
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ─── Uruchamianie ─────────────────────────────────────────────

install: ## Instalacja na serwerze: kreator ./install.sh (konfiguracja + start)
	@./install.sh

install-lowmem: ## Instalacja na VPS-ie z ~1 GB RAM (limit sterty Node, build po kolei)
	@./install.sh --low-memory

init: ## Utwórz .env z losowymi sekretami (pierwsze uruchomienie)
	@test -f .env && { echo ".env już istnieje — pominięto"; exit 0; }
	@cp .env.example .env
	@echo "Uzupełniam losowe wartości..."
	@sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$$(openssl rand -hex 32)|" .env
	@sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$(openssl rand -hex 24)|" .env
	@echo ""
	@echo "Gotowe. Ustaw SEED_ADMIN_PASSWORD w .env, potem: make up"

up: ## Zbuduj i uruchom cały stos (http://localhost:8080)
	APP_VERSION=$(APP_VERSION) $(COMPOSE) up -d --build
	@echo ""
	@echo "  Aplikacja:  http://localhost:$$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8080)"
	@echo "  Wersja:     $(APP_VERSION)"
	@echo "  Health:     http://localhost:$$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8080)/nginx-health"

up-dev: ## Jak up, ale baza wystawiona na porcie DB_DEV_PORT dla Prisma Studio
	APP_VERSION=$(APP_VERSION) $(COMPOSE_DEV) up -d --build
	@echo ""
	@echo "  Baza (dev): localhost:$(DB_DEV_PORT)"
	@echo "  Wersja:     $(APP_VERSION)"

# Skrypt sam zna kolejność kroków aktualizacji (kopia → checkout
# na tag → build → weryfikacja) — patrz komentarz nad `release`.
update: ## Aktualizacja na serwerze do najnowszego taga wydania
	@./scripts/update.sh

down: ## Zatrzymaj kontenery (dane zostają)
	$(COMPOSE) down

restart: ## Restart bez przebudowy
	$(COMPOSE) restart

ps: ## Status kontenerów
	$(COMPOSE) ps

logs: ## Logi (make logs api=api)
	$(COMPOSE) logs -f --tail=100 $(or $(api),)

# ─── Build ────────────────────────────────────────────────────

build: ## Zbuduj obrazy
	APP_VERSION=$(APP_VERSION) $(COMPOSE) build

rebuild: ## Przebuduj obrazy od zera, bez cache
	APP_VERSION=$(APP_VERSION) $(COMPOSE) build --no-cache

release: ## Wydanie: podbij wersję, zbuduj, uruchom, zweryfikuj i wypchnij
	@./scripts/release.sh

release-dry: ## Pokaż, co zrobi make release, niczego nie zmieniając
	@./scripts/release.sh --dry

# Osobny cel, bo `make release` nie przyjmuje argumentów — release.sh
# jest jedynym miejscem, które zna kolejność kroków wydania.
release-minor: ## Wydanie podbijające minor (zmiana API lub modelu danych)
	@./scripts/release.sh --minor

# ─── Dane demonstracyjne (eksport z działającej instancji) ────

# Zrzut JSON powstaje jednym zapytaniem w kontenerze bazy — nie wymaga
# wystawiania portu ani Prisma poza Dockerem. Skrypt eksportu czyta go
# ze standardowego wejścia i podmienia dane między znacznikami w plikach
# demo-access.ts i demo-ipam.ts. Zapytanie trzeba aktualizować razem
# ze schematem (nazwy tabel w FROM), ale celowo NIE z modelem eksportu:
# skrypt waliduje kształt i mówi wprost, czego brakuje.
export-demo: ## Odśwież dane demo w repo z bazy działającej instancji
	@$(COMPOSE) exec -T db psql -U $${POSTGRES_USER:-webinv} -d $${POSTGRES_DB:-webinv} -At \
	  -c "SELECT json_build_object( \
	        'persons',    (SELECT json_agg(json_build_object( \
	                        'firstName', p.first_name, 'lastName', p.last_name, \
	                        'email', p.email, 'position', p.position, \
	                        'department', p.department, 'isActive', p.is_active) \
	                       ORDER BY p.email) FROM persons p), \
	        'grants',     (SELECT json_agg(json_build_object( \
	                        'application', a.name, 'email', p.email, \
	                        'level', aa.level, \
	                        'expiresOn', to_char(aa.expires_on, 'YYYY-MM-DD'), \
	                        'note', aa.note) \
	                       ORDER BY a.name, p.email) \
	                       FROM application_access aa \
	                       JOIN persons p ON p.id = aa.person_id \
	                       JOIN applications a ON a.id = aa.application_id), \
	        'subnets',    (SELECT json_agg(json_build_object( \
	                        'name', s.name, 'cidr', s.cidr, 'description', s.description, \
	                        'color', s.color, 'vlan', s.vlan, 'location', s.location, \
	                        'addresses', (SELECT json_agg(json_build_object( \
	                                        'address', i.address, 'status', i.status, \
	                                        'description', i.description) \
	                                      ORDER BY i.address) FROM ip_addresses i \
	                                      WHERE i.subnet_id = s.id)) \
	                       ORDER BY s.name) FROM subnets s), \
	        'appLinks',   (SELECT json_agg(json_build_object( \
	                        'application', a.name, 'subnet', s.name, \
	                        'address', i.address) \
	                       ORDER BY a.name) \
	                       FROM application_ip_addresses x \
	                       JOIN applications a ON a.id = x.application_id \
	                       JOIN ip_addresses i ON i.id = x.ip_address_id \
	                       JOIN subnets s ON s.id = i.subnet_id) \
	      )::text" \
	  | npx tsx apps/api/scripts/export-demo.ts

# ─── Prisma (poza Dockerem — baza musi być włączona) ──────────
db-up: ## Włącz samą bazę z portem dev (do migracji i Prisma Studio)
	$(COMPOSE_DEV) up -d db

migrate: ## Wygeneruj i zastosuj migrację (dev, poza Dockerem)
	@cd apps/api && DATABASE_URL="$(DEV_DB_URL)" npx prisma migrate dev

generate: ## Wygeneruj klienta Prisma
	@cd apps/api && npx prisma generate

studio: ## Otwórz Prisma Studio na porcie 5555
	@cd apps/api && DATABASE_URL="$(DEV_DB_URL)" npx prisma studio --port 5555

# ─── Praca lokalna (bez Dockera) ──────────────────────────────

dev-api: ## API w trybie watch (potrzebna działająca baza)
	@cd apps/api && npm run start:dev

dev-web: ## Vite dev server na porcie 5173
	@cd apps/web && npm run dev

typecheck: ## Sprawdź typy w obu pakietach
	npm run typecheck --workspaces --if-present

# ─── Dostęp do danych ─────────────────────────────────────────

psql: ## Otwórz psql w kontenerze bazy
	$(COMPOSE) exec db psql -U $${POSTGRES_USER:-webinv} -d $${POSTGRES_DB:-webinv}

shell: ## Shell w kontenerze API
	$(COMPOSE) exec api sh

backup: ## Kopia bazy do ./backups/
	@mkdir -p backups
	@$(COMPOSE) exec -T db pg_dump -U $${POSTGRES_USER:-webinv} -d $${POSTGRES_DB:-webinv} \
		| gzip > backups/backup-$$(date +%Y%m%d-%H%M%S).sql.gz
	@ls -lh backups/ | tail -3

restore: ## Przywróć z: make restore f=backups/backup-XXX.sql.gz
	@test -n "$(f)" || { echo "Użyj: make restore f=backups/backup-XXX.sql.gz"; exit 1; }
	gunzip -c "$(f)" | $(COMPOSE) exec -T db psql -U $${POSTGRES_USER:-webinv} -d $${POSTGRES_DB:-webinv}

# ─── Sprzątanie (UWAGA: kasuje dane) ──────────────────────────

reset: ## USUŃ bazę i przelicz od zera (pyta o potwierdzenie)
	@read -p "To usunie CAŁĄ bazę danych. Na pewno? [y/N] " a; [ "$$a" = "y" ]
	$(COMPOSE) down -v
	@echo "Baza usunięta. Uruchom: make up"

clean: ## Usuń obrazy i nieużywane wolumeny tego projektu
	$(COMPOSE) down -v --remove-orphans

uninstall: ## Usuń projekt z maszyny (Docker + katalog — pyta o potwierdzenie)
	@./scripts/uninstall.sh
