import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/decorators';
import type {
  AccessPort,
  PersonOrderBy,
  PersonRow,
  PersonWhere,
  PersonWithCounts,
} from './access.port';

/**
 * Katalog osób i macierz uprawnień do aplikacji.
 *
 * Osobny serwis, a nie rozszerzenie `UsersService`, bo osoby z ewidencji
 * nie są kontami panelu: nie mają loginu, hasła, roli ani sesji. Trzymanie
 * ich w `users` wymuszałoby wypełnianie pól, które dla nich nie mają
 * znaczenia, a kasowanie konta gniecie historię macierzy.
 *
 * Reguły, które tu pilnujemy (w kolejności, w jakiej je sprawdzamy —
 * komunikat ma być pomocny, a nie tylko zgodny):
 *
 *  1. **E-mail to tożsamość.** Ponowna rejestracja zwraca 409 z id istniejącej
 *     osoby, żeby panel mógł zaproponować dodanie do macierzy.
 *  2. **Ta sama osoba nie wchodzi dwa razy do tej samej aplikacji** — 409.
 *  3. **Osoby nieaktywnej nie da się dodać do macierzy** — 400. Jej dotychczasowe
 *     przypisania zostają, bo odebranie dostępu to inna decyzja niż kasowanie.
 *  4. **Data wygaśnięcia w przeszłości** jest dozwolona przy edycji (porządkowanie
 *     danych) i odrzucona przy dodaniu (nowo nadany dostęp nie może być od razu
 *     wygasły).
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: AccessPort,
    private readonly audit: AuditService,
  ) {}

  // ─── Katalog osób ────────────────────────────────────────────

  /**
   * Lista osób. `search` szuka w nazwisku, imieniu i e-mailu; `department`
   * jest filtrem dokładnym, bo dział jest tekstem wpisywanym ręcznie.
   */
  async listPersons(filters: {
    search?: string;
    department?: string;
    includeInactive?: boolean;
    sort?: string;
  }): Promise<PersonWithCounts[]> {
    const where: PersonWhere = {};
    if (filters.includeInactive === false) where.isActive = true;
    if (filters.department) where.department = filters.department;

    const szukaj = filters.search?.trim();
    if (szukaj) {
      // `contains` z `mode: 'insensitive'` zamiast porównania w JS: baza
      // filtruje, a nie serwis, więc lista nie rośnie z rozmiarem katalogu.
      where.OR = [
        { firstName: { contains: szukaj, mode: 'insensitive' } },
        { lastName: { contains: szukaj, mode: 'insensitive' } },
        { email: { contains: szukaj, mode: 'insensitive' } },
      ];
    }

    return this.prisma.person.findMany({
      where,
      orderBy: this.sortOsoby(filters.sort),
    });
  }

  /**
   * Biała lista sortowania. Sortowanie po polskim nazwisku działa bez
   * znajomości reguł PostgreSQL, a nazwa spoza listy jest ignorowana —
   * dokładnie jak w `SORTABLE` modułu aplikacji.
   */
  private sortOsoby(sort?: string): PersonOrderBy {
    const dozwolone: PersonOrderBy[] = ['lastName', 'department', 'createdAt'];
    return dozwolone.includes(sort as PersonOrderBy) ? (sort as PersonOrderBy) : 'lastName';
  }

  async getPerson(id: string): Promise<PersonRow> {
    const osoba = await this.prisma.person.findUnique({ where: { id } });
    if (!osoba) throw new NotFoundException('Osoba nie istnieje.');
    return osoba;
  }

  async createPerson(
    dto: {
      firstName: string;
      lastName: string;
      email: string;
      position?: string;
      department?: string;
      isActive?: boolean;
    },
    actor: AuthUser,
    ip?: string,
  ): Promise<PersonRow> {
    const dane = this.walidujOsobe(dto);

    const istniejaca = await this.prisma.person.findFirst({
      where: { email: dane.email },
    });
    if (istniejaca) {
      throw new ConflictException(
        `Osoba z adresem „${dane.email}" już jest w katalogu (${istniejaca.id}). ` +
          'Dodaj ją do macierzy zamiast tworzyć nową.',
      );
    }

    const osoba = await this.prisma.person.create({ data: dane });

    await this.audit.record({
      action: 'person.created',
      entity: 'Person',
      entityId: osoba.id,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        email: { from: null, to: osoba.email },
        fullName: { from: null, to: `${osoba.firstName} ${osoba.lastName}` },
        department: { from: null, to: osoba.department },
      },
      ip,
    });

    return osoba;
  }

  /**
   * Edycja danych osoby. Budujemy `data` tylko z kluczy obecnych w `dto` —
   * `undefined` znaczy „nie ruszaj", a nie „wyczyść".
   */
  async updatePerson(
    id: string,
    dto: {
      firstName?: string;
      lastName?: string;
      email?: string;
      position?: string;
      department?: string;
      isActive?: boolean;
    },
    actor: AuthUser,
    ip?: string,
  ): Promise<PersonRow> {
    const przed = await this.getPerson(id);

    const data: Partial<PersonRow> = {};
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.email !== undefined) data.email = this.walidujEmail(dto.email);
    if (dto.position !== undefined) data.position = this.walidujTekst(dto.position, 'Stanowisko');
    if (dto.department !== undefined) data.department = this.walidujTekst(dto.department, 'Dział');
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    if (dto.email !== undefined && dto.email.toLowerCase() !== przed.email.toLowerCase()) {
      const istniejaca = await this.prisma.person.findFirst({
        where: { email: data.email },
      });
      if (istniejaca) {
        throw new ConflictException(
          `Osoba z adresem „${data.email}" już jest w katalogu (${istniejaca.id}).`,
        );
      }
    }

    const osoba = await this.prisma.person.update({ where: { id }, data });

    await this.audit.record({
      action: 'person.updated',
      entity: 'Person',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: AuditService.diff(
        przed as unknown as Record<string, unknown>,
        { ...przed, ...data } as unknown as Record<string, unknown>,
        ['updatedAt', 'createdAt', 'accessCount'],
      ),
      ip,
    });

    return osoba;
  }

  /**
   * Dezaktywacja — nie kasowanie. Osoba znika z listy wyboru, ale jej
   * przypisania w macierzach muszą zostać czytelne: to one są dowodem,
   * kto miał dostęp.
   */
  async deactivatePerson(id: string, actor: AuthUser, ip?: string): Promise<PersonRow> {
    const osoba = await this.getPerson(id);
    if (!osoba.isActive) return osoba;

    const po = await this.prisma.person.update({ where: { id }, data: { isActive: false } });

    await this.audit.record({
      action: 'person.deactivated',
      entity: 'Person',
      entityId: id,
      actorId: actor.id,
      actorName: actor.username,
      changes: {
        isActive: { from: true, to: false },
        fullName: { from: `${osoba.firstName} ${osoba.lastName}`, to: null },
      },
      ip,
    });

    return po;
  }

  // ─── Walidacja wspólna z importem CSV ────────────────────────

  /**
   * Wspólna walidacja osoby. Osobna funkcja, nie wbudowana w `createPerson`,
   * bo import z CSV waliduje dokładnie te same reguły dla wierszy, które
   * przeszły podgląd — jeśli reguły rozejdą się, podgląd obiecuje
   * poprawny wiersz, a zapis go odrzuca.
   *
   * Zwraca znormalizowane dane, więc serwis zapisuje to, co zwalidował,
   * a nie to, co przyszło z formularza.
   */
  walidujOsobe(dto: {
    firstName: string;
    lastName: string;
    email: string;
    position?: string;
    department?: string;
    isActive?: boolean;
  }): {
    firstName: string;
    lastName: string;
    email: string;
    position?: string;
    department?: string;
    isActive?: boolean;
  } {
    const firstName = (dto.firstName ?? '').trim();
    const lastName = (dto.lastName ?? '').trim();
    if (!firstName) throw new BadRequestException('Podaj imię.');
    if (firstName.length > 100) throw new BadRequestException('Imię ma maksymalnie 100 znaków.');
    if (!lastName) throw new BadRequestException('Podaj nazwisko.');
    if (lastName.length > 100) throw new BadRequestException('Nazwisko ma maksymalnie 100 znaków.');

    return {
      firstName,
      lastName,
      email: this.walidujEmail(dto.email),
      position: this.walidujTekst(dto.position, 'Stanowisko'),
      department: this.walidujTekst(dto.department, 'Dział'),
      ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
    };
  }

  walidujEmail(email: string): string {
    const wartosc = (email ?? '').trim();
    if (!wartosc) throw new BadRequestException('Podaj adres e-mail.');
    if (/\s/.test(wartosc)) {
      throw new BadRequestException('Adres e-mail nie może zawierać spacji.');
    }
    // Prosty kształt, a nie pełny parser: kolumna `email` jest `@db.Citext`
    // z unikalnością, więc wadliwy adres i tak nie zapisze się dwukrotnie.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wartosc)) {
      throw new BadRequestException(`„${wartosc}" nie wygląda na adres e-mail.`);
    }
    if (wartosc.length > 200) {
      throw new BadRequestException('Adres e-mail ma maksymalnie 200 znaków.');
    }
    return wartosc;
  }

  /** Pole opcjonalne: brak to `null`, nie pusty tekst. */
  private walidujTekst(wartosc: string | undefined, etykieta: string): string | undefined {
    if (wartosc === undefined) return undefined;
    const obcieta = wartosc.trim();
    if (!obcieta) return undefined;
    if (obcieta.length > 150) {
      throw new BadRequestException(`${etykieta} ma maksymalnie 150 znaków.`);
    }
    return obcieta;
  }
}