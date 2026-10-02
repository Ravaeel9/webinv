.PHONY: help install init up up-dev down restart logs ps build rebuild migrate generate dev dev-api dev-web typecheck psql shell db-shell backup restore reset clean

APP := webinv
COMPOSE := docker compose
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

init: ## Utwórz .env z losowymi sekretami (pierwsze uruchomienie)
	@test -f .env && { echo ".env już istnieje — pominięto"; exit 0; }
	@cp .env.example .env
	@echo "Uzupełniam losowe wartości..."
	@sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$$(openssl rand -hex 32)|" .env
	@sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$$(openssl rand -hex 24)|" .env
	@echo ""
	@echo "Gotowe. Ustaw SEED_ADMIN_PASSWORD w .env, potem: make up"

up: ## Zbuduj i uruchom cały stos (http://localhost:8080)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  Aplikacja:  http://localhost:$$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8080)"
	@echo "  Health:     http://localhost:$$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2 || echo 8080)/nginx-health"

up-dev: ## Jak up, ale baza wystawiona na porcie DB_DEV_PORT dla Prisma Studio
	$(COMPOSE_DEV) up -d --build
	@echo ""
	@echo "  Baza (dev): localhost:$(DB_DEV_PORT)"

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
	$(COMPOSE) build

rebuild: ## Przebuduj obrazy od zera, bez cache
	$(COMPOSE) build --no-cache

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
