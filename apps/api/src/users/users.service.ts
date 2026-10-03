import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionsService } from '../auth/sessions.service';
import { hashPassword, validatePasswordStrength } from '../auth/password';
import type { CreateUserDto, UpdateUserDto } from '../auth/dto/auth.dto';
import type { AuthUser } from '../auth/decorators';

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionsService,
  ) {}

  async list(includeInactive = true) {
    return this.prisma.user.findMany({
      where: includeInactive ? undefined : { isActive: true },
      select: {
        ...USER_SELECT,
        // Ile ma sesji — pokazujemy w panelu
        _count: { select: { sessions: true } },
      },
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });
  }

  async get(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { ...USER_SELECT, _count: { select: { sessions: true } } },
    });
    if (!user) throw new NotFoundException('Użytkownik nie istnieje.');
    return user;
  }

  async create(dto: CreateUserDto, actor: AuthUser, ip?: string) {
    const strength = validatePasswordStrength(dto.password);
    if (!strength.ok) {
      throw new BadRequestException(
        `Hasło nie spełnia wymagań: ${strength.errors.join(' ')}`,
      );
    }

    // Sprawdź duplikaty zanim odpalimy drogie hashowanie
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ username: dto.username }, { email: dto.email }] },
      select: { username: true, email: true },
    });
    if (existing) {
      if (existing.username.toLowerCase() === dto.username.toLowerCase()) {
        throw new ConflictException(`Nazwa użytkownika „${dto.username}" jest zajęta.`);
      }
      throw new ConflictException(`Adres e-mail „${dto.email}" jest już zarejestrowany.`);
    }

    const passwordHash = await hashPassword(dto.password);

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        email: dto.email,
        fullName: dto.fullName,
        passwordHash,
        role: dto.role ?? 'VIEWER',
        mustChangePassword: true,
        passwordChangedAt: new Date(),
      },
      select: USER_SELECT,
    });

    await this.audit.record({
      action: 'user.created',
      entity: 'User',
      entityId: user.id,
      actorId: actor.id,
      actorName: actor.username,
      changes: { username: { from: null, to: user.username }, role: { from: null, to: user.role } },
      ip,
    });

    return user;
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    actor: AuthUser,
    ip?: string,
  ) {
    const before = await this.prisma.user.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Użytkownik nie istnieje.');

    // Ochrona przed sytuacją, w której zostaje się bez super admina
    if (before.role === 'SUPER_ADMIN' && dto.role && dto.role !== 'SUPER_ADMIN') {
      const count = await this.prisma.user.count({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      if (count <= 1) {
        throw new BadRequestException(
          'To jedyne aktywne konto super administratora — nie można zdegradować roli.',
        );
      }
    }

    // Nie pozwalamy deaktywować samego siebie
    if (before.id === actor.id && dto.isActive === false) {
      throw new BadRequestException('Nie można wyłączyć własnego konta.');
    }

    if (before.id === actor.id && dto.role && dto.role !== before.role) {
      throw new BadRequestException('Nie można zmienić własnej roli.');
    }

    // Duplikaty po zmianie
    if (dto.username || dto.email) {
      const clash = await this.prisma.user.findFirst({
        where: {
          id: { not: id },
          OR: [
            ...(dto.username ? [{ username: dto.username }] : []),
            ...(dto.email ? [{ email: dto.email }] : []),
          ],
        },
        select: { username: true, email: true },
      });
      if (clash) throw new ConflictException('Nazwa użytkownika lub e-mail jest zajęty.');
    }

    const data: Record<string, unknown> = {};
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const user = await this.prisma.user.update({
      where: { id },
      data: data as never,
      select: USER_SELECT,
    });

    // Wyłączone konto traci wszystkie sesje natychmiast
    let revoked = 0;
    if (dto.isActive === false) {
      revoked = await this.sessions.revokeAllForUser(id);
    }
    // Zmiana rola też unieważnia sesje — stare uprawnienia nie mogą działać
    if (dto.role !== undefined && dto.role !== before.role) {
      revoked += await this.sessions.revokeAllForUser(id);
    }

    await this.audit.record({
      action: 'user.updated',
      entity: 'User',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: AuditService.diff(
        before as unknown as Record<string, unknown>,
        { ...before, ...data } as unknown as Record<string, unknown>,
        ['passwordHash', 'updatedAt', 'passwordChangedAt'],
      ),
      ip,
    });

    if (revoked > 0) {
      // `await` — bez niego zapis audytu jest asynchroniczny i ginie,
      // gdy proces zakończy się albo baza nie odpowie. Wydarzenie
      // „unieważniono sesje" jest jednym z najważniejszych w dzienniku,
      // więc nie może być jedynym, które ginie po cichu.
      await this.audit.record({
        action: 'user.sessions_revoked',
        entity: 'User',
        entityId: id,
        actorId: actor.id,
        actorName: actor.username,
        changes: { count: { from: null, to: revoked } },
        ip,
      });
    }

    return user;
  }

  /**
   * Usuwa konto — ale tylko jeśli nie jest ostatnim super adminem
   * i nie ma przypisanych aplikacji jako właściciel/administrator.
   * W praktyce prawie zawsze lepiej wyłączyć konto (isActive=false).
   */
  async remove(id: string, actor: AuthUser, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Użytkownik nie istnieje.');

    if (user.id === actor.id) {
      throw new BadRequestException('Nie można usunąć własnego konta.');
    }

    if (user.role === 'SUPER_ADMIN') {
      const count = await this.prisma.user.count({
        where: { role: 'SUPER_ADMIN', isActive: true },
      });
      if (count <= 1) {
        throw new BadRequestException('To jedyne aktywne konto super administratora.');
      }
    }

    const owned = await this.prisma.application.count({
      where: { ownerId: id, deletedAt: null },
    });
    if (owned > 0) {
      throw new BadRequestException(
        `Użytkownik jest właścicielem ${owned} aplikacji. Przenieś własność albo wyłącz konto.`,
      );
    }

    await this.sessions.revokeAllForUser(id);
    await this.prisma.user.delete({ where: { id } });

    await this.audit.record({
      action: 'user.deleted',
      entity: 'User',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: { username: { from: user.username, to: null } },
      ip,
    });
  }

  /** Prosty słownik użytkowników do wyboru ownera/administratora w formularzu. */
  async options() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, username: true, fullName: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }
}
