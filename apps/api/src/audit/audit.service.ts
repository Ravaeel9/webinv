import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Pojedyncza zmiana pola: wartość przed i po edycji. */
export type FieldChange = { from: unknown; to: unknown };

/**
 * Mapa zmian z dziennika: `{ pole: { from, to } }`.
 *
 * Klucz `_truncated` nie jest zmianą — zawiera listę pól, których
 * wartość była za długa, żeby zapisać ją w całości. Jest tu zadeklarowany
 * jawnie, bo bez tego typowanie `changes._truncated` zwracałoby typ
 * zmiany (`{ from, to }`) i czytelnik by sądził, że to kolejna różnica.
 */
export type ChangeMap = Record<string, FieldChange> & {
  _truncated?: string[];
};

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  changes?: ChangeMap | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Maksymalna długość pojedynczej wartości w dzienniku.
 *
 * `changes` to kolumna JSON, więc nic nie powstrzymałoby zapisania
 * w niej całego opisu aplikacji — a zmiany zostają w bazie na zawsze.
 * Przycięta wartość dostaje dopisek, żeby czytelnik wiedział,
 * że to nie jest pełna treść.
 */
const MAX_VALUE_LENGTH = 200;

/** Klucz, pod którym w `changes` wymieniamy przycięte pola. */
const TRUNCATED_KEY = '_truncated';

/** Przycina długie wartości tekstowe, wskazując znakoboki. */
function truncateValue(value: unknown): unknown {
  if (typeof value !== 'string' || value.length <= MAX_VALUE_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_VALUE_LENGTH)}… [+${value.length - MAX_VALUE_LENGTH} znaków]`;
}

/**
 * Dziennik zdarzeń.
 *
 * Zapisujemy go „po best effort" — awaria logowania audytowego nie może
 * wywrócić operacji biznesowej, bo to dodałoby awarii i sfrustrowało
 * użytkownika, który np. edytował opis aplikacji. Błąd dostajemy w logi.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          actorId: entry.actorId ?? null,
          actorName: entry.actorName?.slice(0, 200) ?? null,
          // `as never` jest konieczne: kolumna `changes` jest typu Json,
          // a Prisma chce tu typu `Prisma.InputJsonValue`, który nie
          // akceptuje naszej struktury z `unknown` w wartościach.
          changes: (entry.changes ?? undefined) as never,
          ip: entry.ip?.slice(0, 64) ?? null,
          userAgent: entry.userAgent?.slice(0, 500) ?? null,
        },
      });
    } catch (err) {
      console.error('[audit] nie udało się zapisać zdarzenia', entry.action, err);
    }
  }

  /**
   * Buduje mapę zmian na podstawie obiektu przed i po.
   * Pomija pola, które nie zmieniły się (w tym relacje, które już
   * porównaliśmy po ID).
   *
   * Długie wartości tekstowe są przycinane. Jeśli cokolwiek ucięliśmy,
   * dopisujemy klucz `_truncated` z listą pól — interfejs pokazuje wtedy
   * zamiast różnicy komunikat, że zmiana była za długa, by ją pokazać.
   */
  static diff(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    ignore: string[] = ['updatedAt'],
  ): ChangeMap {
    const changes: ChangeMap = {};
    const truncated: string[] = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of keys) {
      if (ignore.includes(key)) continue;

      const from = before[key] ?? null;
      const to = after[key] ?? null;

      if (JSON.stringify(from) === JSON.stringify(to)) continue;

      const shortFrom = truncateValue(from);
      const shortTo = truncateValue(to);
      if (shortFrom !== from || shortTo !== to) truncated.push(key);

      changes[key] = { from: shortFrom, to: shortTo };
    }

    if (truncated.length > 0) {
      changes[TRUNCATED_KEY] = truncated;
    }

    return changes;
  }
}
