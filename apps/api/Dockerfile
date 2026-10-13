# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
#  API rejestru oprogramowania — NestJS + Prisma
#  Kontekst builda: katalog główny repo (npm workspaces)
# ─────────────────────────────────────────────────────────────

# ── Etap 1: zależności (dev) ──────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

# Limit sterty Node. `npm ci` w monorepo potrafi momentami zjeść
# 700–900 MB, a na VPS-ie z 1 GB RAM trzy równoległe instalacje
# zależności kończą się OOM-killem. Compose przekazuje tę wartość
# przez `build.args` (NODE_OPTIONS z .env/środowiska). Pusty ARG
# = dotychczasowe zachowanie, więc build poza Compose działa jak zawsze.
ARG NODE_OPTIONS
ENV NODE_OPTIONS=${NODE_OPTIONS}

# Prisma wymaga OpenSSL — biblioteki w runtime, nagłówki w buildzie
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Repo jest monorepo (npm workspaces), więc `npm ci` wymaga
# manifestu głównego, lockfile'a i manifestów obu pakietów.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --no-audit --no-fund

# ── Etap 2: build ─────────────────────────────────────────────
FROM deps AS build
WORKDIR /app

COPY apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY apps/api/src ./apps/api/src
COPY apps/api/scripts ./apps/api/scripts

# Prisma config wskazuje ścieżki względem siebie, więc pracujemy
# w katalogu pakietu — inaczej migracje szukałyby się w złym miejscu.
WORKDIR /app/apps/api
RUN npx prisma generate && npm run build

# ── Etap 3: produkcyjne zależności ─────────────────────────────
# Osobny etap, żeby warstwa z Prisma CLI i TypeScriptem nie trafiła
# do obrazu końcowego.
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app

# Jak w etapie deps — to `npm ci --omit=dev` jest tu najcięższym krokiem.
ARG NODE_OPTIONS
ENV NODE_OPTIONS=${NODE_OPTIONS}

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --no-audit --no-fund

# Prisma Client MUSI zostać wygenerowany w tym etapie, a nie w build.
# Etap `build` ma własne node_modules, więc wygenerowany klient
# nie trafiłby do obrazu końcowego — a `new PrismaClient()` pada wtedy
# rzutem „did not initialize yet". Generujemy tu, bo query engine
# musi pasować do platformy obrazu końcowego.
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/prisma.config.ts ./apps/api/prisma.config.ts
WORKDIR /app/apps/api
RUN npx prisma generate

WORKDIR /app
RUN npm cache clean --force

# ── Etap 4: obraz produkcyjny ─────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    PRISMA_GENERATE_SKIP_AUTOINSTALL=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/prisma ./prisma
COPY --from=build /app/apps/api/scripts ./scripts
COPY --from=build /app/apps/api/prisma.config.ts ./prisma.config.ts
COPY apps/api/package.json ./

# Nie uruchamiamy niczego jako root
RUN chown -R node:node /app
USER node

EXPOSE 3000

# Healthcheck — kontener musi być widziany jako zdrowy,
# zanim nginx ruszy proxy do niego
HEALTHCHECK --interval=10s --timeout=5s --start-period=40s --retries=12 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migracje przy starcie, potem aplikacja. Gdy migracja padnie,
# kontener się nie podniesie — lepiej brak usługi niż niespójne dane.
# Wypunkt wejścia to dist/main.js (nie dist/src/main.js) — `rootDir`
# w tsconfig to ./src, więc nest build nie dokłada tej warstwy.
CMD ["sh", "-c", "node scripts/migrate.mjs && node dist/main.js"]
