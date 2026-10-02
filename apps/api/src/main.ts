import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Nginx stoi przed nami i przekazuje nagłówki X-Forwarded-*
      trustProxy: true,
      bodyLimit: 2 * 1024 * 1024, // 2 MB
      logger:
        process.env.NODE_ENV === 'development'
          ? { level: 'info' }
          : { level: 'warn' },
    }),
    { bufferLogs: false },
  );

  const config = app.get(ConfigService);

  // ── Ciasteczka (sesje) ─────────────────────────────────────
  await app.register(fastifyCookie, {
    // Ciasteczka ustawiamy ręcznie z flagą httpOnly — secret nie jest
    // potrzebny, bo token i tak jest losowy i hashowany w bazie
    parseOptions: { path: '/' },
  });

  // ── Nagłówki bezpieczeństwa ───────────────────────────────
  // Większość ustawień powtarza nginx; tu mamy je też dla devu
  // bez proxy, żeby nie dało się „wyłączyć" ich poza kontenerem.
  //
  // CSP wyłączone świadomie: API zwraca wyłącznie JSON, a polityka
  // CSP obowiązuje dokument, nie odpowiedź na `fetch`. Ustawia ją
  // nginx (`nginx/snippets/security-headers.conf`) — tam też obowiązuje
  // dla dokumentu HTML, którego nikt poza nginx nie serwuje.
  // Wersja domyślna helmet zawiera `upgrade-insecure-requests`, co przy
  // wdrożeniu bez TLS próbowałoby przepisywać zasoby na https://.
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    global: true,
  });

  // ── CORS ───────────────────────────────────────────────────
  const allowedOrigins = config.get<string[]>('app.corsOrigins', []);

  app.enableCors({
    // Gdy lista pusta: same-origin (tak jak stawia nginx)
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400,
  });

  // ── Walidacja ──────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // usuń pola spoza DTO
      forbidNonWhitelisted: true, // …i zgłoś je jako błąd
      transform: true, // zamień na typy zgodne z DTO
      // `enableImplicitConversion` celowo wyłączone.
      //
      // Konwersja domyślna bierze typ z metadanych `design:type` i działa
      // **przed** własnym `@Transform`. Dla pola zapisanego bez wartości
      // początkowej (`criticality?: number`) `design:type` to `Number`,
      // więc `?criticality=` zamieniało się w `0` zanim w ogóle doszło do
      // naszej obsługi pustej wartości — i walidacja odrzucała żądanie.
      // Każde pole, które potrzebuje konwersji, ma własny `@Transform`,
      // więc włączenie tego przełącznika niczego by nie wniosło, a
      // wprowadzałoby zależność od kolejności, której nie widać w kodzie.
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  // ── Wyłącz śledzenie błędów poza produkcją ─────────────────
  app.enableShutdownHooks();

  const port = config.get<number>('app.port', 3000);
  await app.listen(port, '0.0.0.0');

  logger.log(`API nasłuchuje na http://0.0.0.0:${port}`);
  logger.log(`Środowisko: ${config.get('app.nodeEnv')}`);
  logger.log(
    `CORS: ${allowedOrigins.length > 0 ? allowedOrigins.join(', ') : 'wyłączony (same-origin)'}`,
  );

  // ── Sprzątanie ────────────────────────────────────────────
  const prisma = app.get(PrismaService);
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Otrzymano ${signal} — zamykam aplikację...`);
    try {
      await prisma.$disconnect();
    } catch (err) {
      logger.error('Błąd przy zamykaniu połączenia z bazą', err);
    }
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error('Nie udało się uruchomić aplikacji', err);
  process.exit(1);
});
