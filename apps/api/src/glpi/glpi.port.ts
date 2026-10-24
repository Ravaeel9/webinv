/**
 * Port bazy i dziennika dla serwisu GLPI — wąski interfejs, który
 * Prisma realizuje w produkcji (przez token `GLPI_PORT`, wzorzec
 * `ACCESS_PORT`), a test wypełnia atrapą. Nazwy modeli muszą się
 * zgadzać z Prisma, bo serwis woła `this.prisma.setting` itd.
 *
 * Dziennik zdarzeń idzie **osobno** (`AuditService` wstrzyknięty
 * obok) — tak samo jak w `SettingsService`.
 */
export type GlpiPort = {
  setting: {
    findUnique(args: {
      where: { key: string };
    }): Promise<{ value: string } | null>;
    upsert(args: {
      where: { key: string };
      update: { value: string };
      create: { key: string; value: string };
    }): Promise<unknown>;
  };
  person: {
    findFirst(args: { where: { email: string } }): Promise<{ id: string } | null>;
    create(args: {
      data: {
        firstName: string;
        lastName: string;
        email: string;
        position: string | null;
        department: string | null;
      };
    }): Promise<{ id: string }>;
  };
  application: {
    findFirst(args: {
      where: { name: string; deletedAt?: null };
    }): Promise<{ id: string; deletedAt: Date | null } | null>;
    create(args: {
      data: {
        name: string;
        version: string;
        description: string | null;
        deliveryType: 'GENERAL_USE' | 'SELF_HOSTED' | 'SAAS' | 'VENDOR_MANAGED';
        accessRequestRequired?: boolean;
        createdById: string | null;
      };
    }): Promise<{ id: string }>;
  };
  applicationAccess: {
    findFirst(args: {
      // Filtry skalarne — `findFirst` nie przyjmuje skrótu klucza
      // złożonego (ta składnia jest tylko dla `findUnique`/`upsert`).
      where: { applicationId: string; personId: string };
    }): Promise<{ applicationId: string; personId: string } | null>;
    create(args: {
      data: {
        applicationId: string;
        personId: string;
        level: string;
        note: string | null;
      };
    }): Promise<unknown>;
  };
  $transaction<T>(operacja: () => Promise<T>): Promise<T>;
};

/** Token DI — pod nim podajemy `PrismaService` (jak `ACCESS_PORT`). */
export const GLPI_PORT = 'GLPI_PORT';
