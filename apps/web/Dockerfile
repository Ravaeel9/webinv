# ─────────────────────────────────────────────────────────────
#  Web — wieloetapowy build (build React → nginx)
# ─────────────────────────────────────────────────────────────

# ── Etap 1: deps ──────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Limit sterty Node — patrz komentarz w apps/api/Dockerfile.
# Ten etap to pełne `npm ci` dla obu workspace'ów.
ARG NODE_OPTIONS
ENV NODE_OPTIONS=${NODE_OPTIONS}

# Repo jest monorepo (npm workspaces), więc `npm ci` wymaga
# manifestu głównego, lockfile'a i manifestów obu pakietów.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/api/package.json ./apps/api/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ── Etap 2: build web ─────────────────────────────────────────
FROM node:22-bookworm-slim AS build-web
WORKDIR /app
ENV NODE_ENV=production

# Dziedziczone po etapie deps, ale wypisujemy jawnie: `tsc` i `vite
# build` też liczą się do zużycia RAM, a gdyby kiedyś build-web
# przestał dziedziczyć z deps, limit zniknąłby po cichu.
ARG NODE_OPTIONS
ENV NODE_OPTIONS=${NODE_OPTIONS}

# Kopiujemy deps
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY apps/web ./apps/web

# Podczas builda przekazujemy bazę URL API — w kontenerze nginx
# przekierowuje /api na backend, więc domyślna wartość wystarczy.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Wersja wplatana do interfejsu (plakietka w prawym dolnym rogu).
# Bez tego ARG-a plakietka nic nie pokazuje — `vite dev` i buildy
# uruchomione wprost przez compose nie mają bowiem skąd wziąć wersji.
ARG VITE_APP_VERSION=0.0.0-dev
ENV VITE_APP_VERSION=${VITE_APP_VERSION}

# TypeScript sprawdzamy osobno, żeby błąd w typach nie przepadał
# w głośnym błędzie bundlera.
RUN npx --workspace=@webinv/web tsc --noEmit \
    && npx --workspace=@webinv/web vite build

# ── Etap 3: runtime nginx ────────────────────────────────────
FROM nginx:alpine AS runtime

# Usuwamy domyślną konfigurację
RUN rm -f /etc/nginx/conf.d/default.conf

# Główna konfiguracja (kontekst main + http) i konfiguracja serwera.
# Oba pliki są potrzebne: dyrektywy kontekstu głównego, np.
# worker_rlimit_nofile, nginx dopuszcza wyłącznie w nginx.conf —
# w conf.d odmawia startu.
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Nagłówki bezpieczeństwa (w tym CSP) są w osobnym pliku, dołączanym
# przez `include` w kilku miejscach konfiguracji — powód w jego nagłówku.
# Ścieżka poza conf.d, żeby nie wylądował w `include *.conf` z http.
COPY nginx/snippets/security-headers.conf /etc/nginx/snippets/security-headers.conf

# Build statyczny
COPY --from=build-web /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
