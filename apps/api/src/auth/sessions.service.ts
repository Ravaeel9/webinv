import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { sessionConfig } from '../config/configuration';
import { generateSessionToken, hashSessionToken } from './password';
import type { AuthUser } from './decorators';

type SessionCfg = ConfigType<typeof sessionConfig>;

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** Przedłużenie sesji przy aktywności (zamiast ustal sztywnego wygaśnięcia). */
const IDLE_TIMEOUT_DAYS = 2;

/** Jak często wolno zwalniać wygasłe sesje. */
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Błąd w jednej linii — do logów, nigdy do odpowiedzi klienta.
 *
 * `Error.message` sam w sobie często jest pusty (np. błędy Prisma
 * trzymają szczegóły w `code`/`meta`), więc samo `String(err)` potrafi
 * zostawić dziennik bez żadnej treści.
 */
function describe(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private lastPurgeAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(sessionConfig.KEY) private readonly cfg: SessionCfg,
  ) {}

  /** Tworzy nową sesję i zwraca surowy token (trafia wyłącznie do ciasteczka). */
  async create(
    userId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<IssuedSession> {
    const token = generateSessionToken();
    const ttlMs = this.cfg.ttlDays * 24 * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    await this.prisma.session.create({
      data: {
        tokenHash: hashSessionToken(token),
        userId,
        expiresAt,
        ip: ip?.slice(0, 64) ?? null,
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
    });

    return { token, expiresAt };
  }

  /**
   * Sprawdza ciasteczko i zwraca użytkownika, albo null.
   * Sesje wygasłe sprzątamy przy okazji.
   */
  async resolveFromCookie(
    cookies: Record<string, string | undefined> | undefined,
  ): Promise<AuthUser | null> {
    const token = cookies?.[this.cfg.cookieName];
    if (!token) return null;

    const tokenHash = hashSessionToken(token);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            fullName: true,
            role: true,
            isActive: true,
            mustChangePassword: true,
          },
        },
      },
    });

    if (!session) return null;

    const now = new Date();

    // Wygasła — usuwamy i zwracamy null
    if (session.expiresAt <= now) {
      await this.deleteQuietly(session.id);
      return null;
    }

    // Konto wyłączone — unieważniamy wszystkie jego sesje
    if (!session.user.isActive) {
      await this.revokeAllForUser(session.userId);
      return null;
    }

    // Idle timeout + odświeżenie znacznika aktywności
    const idleLimit = new Date(now.getTime() - IDLE_TIMEOUT_DAYS * 24 * 60 * 60 * 1000);
    if (session.lastSeenAt < idleLimit) {
      await this.deleteQuietly(session.id);
      return null;
    }

    await this.touchQuietly(session.id, now);

    return {
      id: session.user.id,
      username: session.user.username,
      email: session.user.email,
      fullName: session.user.fullName,
      role: session.user.role,
      mustChangePassword: session.user.mustChangePassword,
    };
  }

  /** Kończy pojedynczą sesję. */
  async revoke(token: string): Promise<void> {
    await this.deleteQuietly(undefined, hashSessionToken(token));
  }

  /**
   * Sprzątanie rekordu sesji, którego nie wolno przerwać błędem.
   *
   * Wszystkie te operacje są „najlepszego wysiłku”: użytkownik i tak
   * dostanie odpowiedź 401, bo sesja wygasła albo nie istnieje. Zwykłe
   * `await` bez obsługi błędu dałoby 500 zamiast 401.
   *
   * Ciche `.catch()` jest tu złym zamiennikiem tej odporności — zjada
   * również błędy bazy, przez co awaria połączenia z Postgresem
   * wyglądałaby jak „wylogowany użytkownik" i nikt by jej nie znalazł.
   * Dlatego błąd logujemy, a wynik ignorujemy.
   */
  private async deleteQuietly(id?: string, tokenHash?: string): Promise<void> {
    try {
      await this.prisma.session.delete({
        where: id ? { id } : { tokenHash: tokenHash! },
      });
    } catch (err) {
      this.logger.warn(`Nie udało się usunąć sesji: ${describe(err)}`);
    }
  }

  /** Odświeżenie znacznika aktywności — j.w., błąd nie blokuje żądania. */
  private async touchQuietly(id: string, now: Date): Promise<void> {
    try {
      await this.prisma.session.update({
        where: { id },
        data: { lastSeenAt: now },
      });
    } catch (err) {
      this.logger.warn(`Nie udało się odświeżyć sesji: ${describe(err)}`);
    }
  }

  /** Kończy wszystkie sesje użytkownika — po zmianie hasła lub blokadzie konta. */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({ where: { userId } });
    return count;
  }

  /**
   * Usuwa przeterminowane sesje.
   *
   * Wywoływane leniwie przy logowaniu (patrz `AuthService.login`), nie
   * cyklicznie — bez crona nie ma procesu, który by o tym pamiętał.
   * Dzięki temu tabela `Session` nie rośnie w nieskończoność.
   */
  async purgeExpired(): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    return count;
  }

  /**
   * Sprzątanie wygasłych sesji, najwyżej raz na godzinę.
   *
   * Licznik w pamięci procesu, nie w bazie: wystarczy, żeby przy
   * intensywnym ruchu nie odpytywać `DELETE` przy każdym logowaniu.
   * Po restarcie kontenera zegar startuje od zera — jedno zbędne
   * zapytanie, nie żaden błąd.
   */
  async purgeExpiredAtMostHourly(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPurgeAt < PURGE_INTERVAL_MS) return;
    this.lastPurgeAt = now;

    const purged = await this.purgeExpired();
    if (purged > 0) {
      this.logger.log(`Usunięto ${purged} przeterminowanych sesji`);
    }
  }

  /** Parametry ciasteczka właściwe dla tego środowiska. */
  cookieOptions(expiresAt: Date) {
    return {
      httpOnly: true,
      secure: this.cfg.cookieSecure,
      sameSite: 'lax' as const,
      path: '/',
      expires: expiresAt,
      // Nie udostępniamy ciasteczka aplikacji klienckiej w JS
      // Przeglądarka dostanie je tylko przez nagłówek Set-Cookie
    };
  }

  cookieName(): string {
    return this.cfg.cookieName;
  }
}
