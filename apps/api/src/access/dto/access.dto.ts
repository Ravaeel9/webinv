import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Poziomy dostępu — lista powtórzona ze schematu Prisma.
 *
 * Nie importujemy tu `AccessLevel` z `@prisma/client`, bo DTO żyje poza
 * warstwą bazy, a `@Matches(/^...$/)` daje dokładnie tę samą ochronę co
 * enum: wartość spoza listy nigdy nie dotrze do zapytania.
 */
export const ACCESS_LEVELS = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'] as const;

export type AccessLevelValue = (typeof ACCESS_LEVELS)[number];

export class CreatePersonDto {
  @IsString()
  @MinLength(1, { message: 'Podaj imię.' })
  @MaxLength(100, { message: 'Imię ma maksymalnie 100 znaków.' })
  firstName!: string;

  @IsString()
  @MinLength(1, { message: 'Podaj nazwisko.' })
  @MaxLength(100, { message: 'Nazwisko ma maksymalnie 100 znaków.' })
  lastName!: string;

  @IsEmail({}, { message: 'Podaj poprawny adres e-mail.' })
  @MaxLength(200, { message: 'Adres e-mail ma maksymalnie 200 znaków.' })
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Stanowisko ma maksymalnie 150 znaków.' })
  position?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'Dział ma maksymalnie 150 znaków.' })
  department?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive musi być true lub false.' })
  isActive?: boolean;
}

export class UpdatePersonDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  firstName?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  lastName?: string;

  @IsOptional() @IsEmail({}, { message: 'Podaj poprawny adres e-mail.' }) @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(150)
  position?: string;

  @IsOptional() @IsString() @MaxLength(150)
  department?: string;

  @IsOptional() @IsBoolean({ message: 'isActive musi być true lub false.' })
  isActive?: boolean;
}

/**
 * Nadanie dostępu osobie.
 *
 * Imię i nazwisko są opcjonalne, bo istniejącą osobę dodajemy samym
 * e-mailem — a wymuszanie jej nazwiska przy każdym kolejnym przypisaniu
 * kazałoby administratorowi przepisywać dane, które już w katalogu są.
 */
export class GrantAccessDto {
  @IsEmail({}, { message: 'Podaj poprawny adres e-mail.' })
  @MaxLength(200, { message: 'Adres e-mail ma maksymalnie 200 znaków.' })
  email!: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  firstName?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  lastName?: string;

  @IsOptional() @IsString() @MaxLength(150)
  position?: string;

  @IsOptional() @IsString() @MaxLength(150)
  department?: string;

  @IsOptional()
  @IsIn(ACCESS_LEVELS, { message: 'Nieznany poziom dostępu.' })
  level?: AccessLevelValue;

  @IsOptional()
  @IsDateString({}, { message: 'Podaj datę w formacie RRRR-MM-DD.' })
  expiresOn?: string;

  @IsOptional() @IsString() @MaxLength(2000, { message: 'Notatka ma maksymalnie 2000 znaków.' })
  note?: string;
}

export class UpdateGrantDto {
  @IsOptional()
  @IsIn(ACCESS_LEVELS, { message: 'Nieznany poziom dostępu.' })
  level?: AccessLevelValue;

  @IsOptional()
  @IsDateString({}, { message: 'Podaj datę w formacie RRRR-MM-DD.' })
  expiresOn?: string | null;

  @IsOptional() @IsString() @MaxLength(2000, { message: 'Notatka ma maksymalnie 2000 znaków.' })
  note?: string | null;
}

/**
 * Macierz zbiorcza i katalog osób przyjmują filtry w zapytaniu, a nie
 * w ciele — dlatego walidacja jest tu warunkowa. Pusty string znaczy
 * „brak filtra": przeglądarka wysyła puste pola z formularza.
 */
export class PersonQueryDto {
  @IsOptional() @IsString() @MaxLength(200)
  search?: string;

  @IsOptional() @IsString() @MaxLength(150)
  department?: string;

  @IsOptional() @IsString()
  sort?: string;

  @IsOptional()
  @IsIn(['true', 'false'], { message: 'includeInactive musi być true lub false.' })
  includeInactive?: string;
}

export class MatrixQueryDto {
  @IsOptional() @IsString() @MaxLength(64)
  applicationId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  personId?: string;

  @IsOptional() @IsString() @MaxLength(150)
  department?: string;

  @IsOptional()
  @IsIn(ACCESS_LEVELS, { message: 'Nieznany poziom dostępu.' })
  level?: AccessLevelValue;
}