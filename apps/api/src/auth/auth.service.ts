import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionsService } from './sessions.service';
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from './password';
import type { LoginDto, ChangePasswordDto } from './dto/auth.dto';
import type { AuthUser } from './decorators';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Logowanie.
   *
   * Świadomie nie rozróżniamy komunikatów „konto nie istnieje" od
   * „złe hasło" — inaczej ktoś może zliczać, które nazwy są zajęte.
   */
  async login(
    dto: LoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<{ user: AuthUser; token: string; expiresAt: Date }> {
    const identifier = dto.username.trim();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ username: identifier }, { email: identifier }],
      },
    });

    const passwordOk = await verifyPassword(user?.passwordHash, dto.password);

    if (!user || !passwordOk) {
      await this.audit.record({
        action: 'auth.login_failed',
        entity: 'User',
        actorName: identifier.slice(0, 200),
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Nieprawidłowy login lub hasło.');
    }

    if (!user.isActive) {
      await this.audit.record({
        action: 'auth.login_blocked',
        entity: 'User',
        entityId: user.id,
        actorId: user.id,
        actorName: user.username,
        ip,
        userAgent,
      });
      throw new UnauthorizedException(
        'Konto zostało wyłączone. Skontaktuj się z administratorem.',
      );
    }

    const session = await this.sessions.create(user.id, ip, userAgent);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Leniwe sprzątanie wygasłych sesji — nie ma crona w tym projekcie,
    // więc robimy to tu, najwyżej raz na godzinę (limit w serwisie).
    await this.sessions.purgeExpiredAtMostHourly();

    await this.audit.record({
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorName: user.username,
      ip,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  /** Wylogowanie — usuwa sesję po stronie serwera. */
  async logout(token: string | undefined, actor?: AuthUser, ip?: string): Promise<void> {
    if (token) {
      await this.sessions.revoke(token);
    }
    if (actor) {
      await this.audit.record({
        action: 'auth.logout',
        entity: 'User',
        entityId: actor.id,
        actorId: actor.id,
        actorName: actor.username,
        ip,
      });
    }
  }

  /** Zmiana własnego hasła — po sukcesie unieważniamy pozostałe sesje. */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    ip?: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Konto nie istnieje.');
    }

    const ok = await verifyPassword(user.passwordHash, dto.currentPassword);
    if (!ok) {
      throw new UnauthorizedException('Aktualne hasło jest nieprawidłowe.');
    }

    const strength = validatePasswordStrength(dto.newPassword);
    if (!strength.ok) {
      throw new BadRequestException(
        `Nowe hasło nie spełnia wymagań: ${strength.errors.join(' ')}`,
      );
    }

    if (await verifyPassword(user.passwordHash, dto.newPassword)) {
      throw new BadRequestException('Nowe hasło musi różnić się od poprzedniego.');
    }

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        passwordChangedAt: new Date(),
      },
    });

    // Unieważniamy WSZYSTKIE sesje, w tym bieżącą, i wydajemy nową.
    // Gdyby ktoś przechwycił stare ciasteczko, właśnie je stracił.
    await this.sessions.revokeAllForUser(userId);
    const newSession = await this.sessions.create(userId, ip);

    await this.audit.record({
      action: 'auth.password_changed',
      entity: 'User',
      entityId: userId,
      actorId: userId,
      actorName: user.username,
      ip,
    });

    this.logger.log(`Zmieniono hasło dla ${user.username}`);

    return { token: newSession.token, expiresAt: newSession.expiresAt };
  }

  /**
   * Ustawia nowe hasło przez super admina (reset).
   * Sesje resetowanego użytkownika są natychmiast unieważniane.
   */
  async adminResetPassword(
    targetId: string,
    newPassword: string,
    actor: AuthUser,
    ip?: string,
  ): Promise<void> {
    const strength = validatePasswordStrength(newPassword);
    if (!strength.ok) {
      throw new BadRequestException(
        `Hasło nie spełnia wymagań: ${strength.errors.join(' ')}`,
      );
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException('Użytkownik nie istnieje.');
    }

    const passwordHash = await hashPassword(newPassword);

    await this.prisma.user.update({
      where: { id: targetId },
      data: {
        passwordHash,
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
    });

    const revoked = await this.sessions.revokeAllForUser(targetId);

    await this.audit.record({
      action: 'auth.password_reset',
      entity: 'User',
      entityId: targetId,
      actorId: actor.id,
      actorName: actor.username,
      changes: { mustChangePassword: { from: target.mustChangePassword, to: true } },
      ip,
    });

    this.logger.log(
      `Reset hasła: ${target.username} (przez ${actor.username}, unieważniono ${revoked} sesji)`,
    );
  }

  /** Sesje aktualnie zalogowanego użytkownika — do podglądu w UI. */
  async listSessions(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      select: {
        id: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        lastSeenAt: true,
        expiresAt: true,
      },
    });
  }

  /** Zakończenie wybranej sesji użytkownika. */
  async revokeSession(userId: string, sessionId: string, actor: AuthUser): Promise<void> {
    const { count } = await this.prisma.session.deleteMany({
      where: { id: sessionId, userId },
    });
    if (count === 0) {
      throw new NotFoundException('Sesja nie istnieje lub należy do innego konta.');
    }
    await this.audit.record({
      action: 'auth.session_revoked',
      entity: 'Session',
      entityId: sessionId,
      actorId: actor.id,
      actorName: actor.username,
    });
  }

  /** Wymuś zmianę hasła przy następnym logowaniu. */
  async requirePasswordChange(userId: string, actor: AuthUser): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Użytkownik nie istnieje.');

    await this.prisma.user.update({
      where: { id: userId },
      data: { mustChangePassword: true },
    });
    await this.sessions.revokeAllForUser(userId);

    await this.audit.record({
      action: 'auth.password_change_required',
      entity: 'User',
      entityId: userId,
      actorId: actor.id,
      actorName: actor.username,
    });
  }

  }
