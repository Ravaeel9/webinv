import {
  Controller,
  Get,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermission } from '../auth/decorators';
import { ROLE_LABELS } from '../auth/permissions';

/**
 * Buduje `where` dla listy zdarzeń.
 *
 * `entityId` jest tu celowo: panel „Historia zmian" na karcie aplikacji
 * prosi o jeden konkretny rekord, a bez tego parametru lista zwracała
 * ostatnie zdarzenia dowolnej encji — pokazane tak, jakby należały
 * do tego rekordu. Indeks `[entity, entityId]` w schemacie zakłada,
 * że zapytanie po obu polach będzie się zdarzać.
 *
 * Wyeksportowana dla testu — filtr jest granicą „tej a nie innej"
 * aplikacji, więc zasługuje na przypięcie przypadkiem.
 */
export function buildAuditWhere(filters: {
  entity?: string;
  entityId?: string;
  action?: string;
  actorId?: string;
}): Record<string, unknown> {
  const { entity, entityId, action, actorId } = filters;
  return {
    ...(entity ? { entity } : {}),
    ...(entityId ? { entityId } : {}),
    ...(action ? { action: { startsWith: action } } : {}),
    ...(actorId ? { actorId } : {}),
  };
}

@Controller('api/audit')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('audit:read')
  async list(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('entity') entity?: string,
    @Query('entityId', new ParseUUIDPipe({ optional: true })) entityId?: string,
    @Query('action') action?: string,
    @Query('actorId', new ParseUUIDPipe({ optional: true })) actorId?: string,
  ) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    const safePage = Math.max(page, 1);

    const where = buildAuditWhere({ entity, entityId, action, actorId });

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: safeLimit,
        skip: (safePage - 1) * safeLimit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map((i) => ({
        ...i,
        // Zmiany bywają ogromne — przycinamy na potrzeby listy
        changes:
          i.changes && JSON.stringify(i.changes).length > 2000
            ? { _truncated: true }
            : i.changes,
      })),
      total,
      page: safePage,
      limit: safeLimit,
      hasMore: safePage * safeLimit < total,
    };
  }

  /** Lista akcji i typów encji — do filtrów w UI. */
  @Get('meta')
  @RequirePermission('audit:read')
  async meta() {
    const [actions, entities] = await Promise.all([
      this.prisma.auditLog.groupBy({
        by: ['action'],
        _count: { _all: true },
        orderBy: { _count: { action: 'desc' } },
      }),
      this.prisma.auditLog.groupBy({
        by: ['entity'],
        _count: { _all: true },
        orderBy: { _count: { entity: 'desc' } },
      }),
    ]);
    return {
      actions: actions.map((a) => ({ key: a.action, count: a._count._all })),
      entities: entities.map((e) => ({ key: e.entity, count: e._count._all })),
      roleLabels: ROLE_LABELS,
    };
  }
}
