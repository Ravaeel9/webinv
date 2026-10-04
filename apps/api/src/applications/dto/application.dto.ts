import { Transform } from 'class-transformer';
import { getMetadataStorage } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Walidacja formatu daty z <input type="date"> (RRRR-MM-DD). */
function MatchesDate() {
  return Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Data musi mieć format RRRR-MM-DD.',
  });
}

export const SECURITY_CLASSES = [
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'RESTRICTED',
] as const;

export const APP_STATUSES = [
  'PROD',
  'TEST',
  'DEV',
  'PLANNED',
  'DEPRECATED',
  'RETIRED',
] as const;

/**
 * Zamienia pusty string na `undefined` — formularze wysyłają "" dla niewypełnionych pól.
 *
 * `null` celowo zostaje `null`: w PATCH-u `undefined` znaczy „nie ruszaj
 * tego pola", a `null` znaczy „wyczyść". Gdyby tu też zamieniać `null`,
 * nie dałoby się wyczyścić pojedynczego pola inaczej niż pełnym rekordem.
 */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

/**
 * Liczba w ciele żądania (POST/PATCH).
 *
 * `""` i brak wartości to „nie ustawiaj", `null` to „wyczyść" —
 * stąd `undefined` i `null` muszą zostać rozróżnione.
 *
 * Świadomie bez `@Type(() => Number)`: ten dekorator działa **po**
 * transformacji i zamienia `''` na `0` (`Number('') === 0`), przez co
 * puste pole walidowało się jako „liczba poniżej 1". Jedna funkcja
 * robiąca jawną konwersję nie zależy od kolejności dekoratorów.
 */
const toOptionalNumber = ({ value }: { value: unknown }) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  return Number(value);
};

/**
 * Liczba w filtrze listy.
 *
 * Tu nie ma sensu „wyczyść", więc wszystkie puste wartości wracają
 * do wartości domyślnej (`limit` 50, `offset` 0, brak filtra dla reszty).
 */
const toQueryNumber =
  (fallback: number | undefined) =>
  ({ value }: { value: unknown }) => {
    if (value === '' || value === null || value === undefined) return fallback;
    return Number(value);
  };

export class CreateApplicationDto {
  @IsString()
  @MinLength(1, { message: 'Nazwa jest wymagana.' })
  // Tylko spacje to nie nazwa — bez tego rekord o nazwie "   " przeszedłby
  // walidację długości i trafił do bazy.
  @Matches(/\S/, { message: 'Nazwa nie może składać się z samych spacji.' })
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1, { message: 'Wersja jest wymagana.' })
  @Matches(/\S/, { message: 'Wersja nie może składać się z samych spacji.' })
  @MaxLength(100)
  version!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(10_000)
  purpose?: string;

  /**
   * Właściciel to sam adres e-mail, a nie konto w systemie.
   *
   * Dzięki temu właścicielem może być osoba z zewnątrz organizacji
   * albo ktoś, kto nie ma jeszcze konta. Nie ma więc sensu
   * sprawdzania, czy taki adres należy do `users`.
   */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEmail({}, { message: 'Właściciel musi być poprawnym adresem e-mail.' })
  @MaxLength(320, { message: 'Adres e-mail właściciela jest za długi.' })
  ownerEmail?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50, { message: 'Maksymalnie 50 administratorów.' })
  @IsUUID('4', { each: true, message: 'Nieprawidłowy identyfikator administratora.' })
  adminIds?: string[];

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MatchesDate()
  introducedOn?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MatchesDate()
  sunsetOn?: string;

  @IsOptional()
  @IsIn(SECURITY_CLASSES, { message: 'Nieznana klasyfikacja bezpieczeństwa.' })
  securityClass?: (typeof SECURITY_CLASSES)[number];

  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt({ message: 'Krytyczność musi być liczbą całkowitą.' })
  @Min(1, { message: 'Krytyczność: zakres 1-4.' })
  @Max(4, { message: 'Krytyczność: zakres 1-4.' })
  criticality?: number;

  @IsOptional()
  @IsIn(APP_STATUSES, { message: 'Nieznany status.' })
  status?: (typeof APP_STATUSES)[number];

  /**
   * Czy dostęp do aplikacji wymaga formalnego wniosku.
   *
   * `""`/brak = „nie ruszaj" (jak w `emptyToUndefined`), `true`/`'true'` =
   * zaznaczone. Boolean, nie nullable — „Nie" jest wartością domyślną,
   * więc brak pola w PATCH oznacza „zachowaj obecne".
   */
  @IsOptional()
  @Transform(({ value }) =>
    value === '' || value === undefined
      ? undefined
      : value === true || value === 'true',
  )
  @IsBoolean()
  accessRequestRequired?: boolean;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  vendor?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  license?: string;

  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt()
  @Min(0)
  licenseCount?: number;

  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Koszt musi być liczbą.' })
  @Min(0)
  annualCost?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  environmentIds?: string[];

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_protocol: false }, { message: 'Nieprawidłowy adres WWW.' })
  @MaxLength(500)
  websiteUrl?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_protocol: false }, { message: 'Nieprawidłowy adres dokumentacji.' })
  @MaxLength(500)
  docsUrl?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_protocol: false }, { message: 'Nieprawidłowy adres repozytorium.' })
  @MaxLength(500)
  repoUrl?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsUrl({ require_protocol: false }, { message: 'Nieprawidłowy adres runbooka.' })
  @MaxLength(500)
  runbookUrl?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(10_000)
  integrations?: string;
}

/**
 * PATCH — ta sama definicja co POST, ale każde pole opcjonalne.
 *
 * `PartialType` dodaje `@IsOptional()` do wszystkich pól i przenosi
 * walidację z klasy bazowej, więc nie powtarzamy tu dwudziestu
 * dekoratorów. Wymagane pola (`name`, `version`) sprawdza serwis —
 * na etapie usługi wiemy już, że to tworzenie, a nie aktualizacja.
 */
export class UpdateApplicationDto extends PartialType(CreateApplicationDto) {}

/**
 * Nazwy pól zadeklarowanych w DTO.
 *
 * `PartialType` kopiuje wyłącznie metadane walidacji — nie tworzy
 * właściwości na prototypie. Dlatego `klucz in dtoInstance` sprawdzałoby
 * tylko to, co faktycznie przyszło w ładunku, a nie to, co klasa deklaruje.
 * To jedyny poprawny sposób, żeby porównać pole mapowane przez serwis
 * z deklaracją (używane przez `mapPatchDto`).
 *
 * Zbieramy z metadanych walidacji, a nie z `Object.keys(instancji)` —
 * lista jest wtedy stała niezależnie od danych w żądaniu.
 */
export function declaredFields(cls: Function): Set<string> {
  return new Set(
    getMetadataStorage()
      // Podpis wg źródeł class-validator 0.14:
      // (target, targetSchema, always, strictGroups, groups?)
      // Puste `targetSchema` i oba przełączniki `false` = brak filtrowania,
      // czyli komplet metadanych walidacji klasy wraz z odziedziczonymi.
      .getTargetValidationMetadatas(cls, '', false, false)
      .map((meta) => meta.propertyName),
  );
}

/** Pola zadeklarowane w `CreateApplicationDto` — łącznie z `name` i `version`. */
export const CREATE_FIELDS = declaredFields(CreateApplicationDto);

export class ListApplicationsQuery {
  /** Wyszukiwanie pełnotekstowe po nazwie, wersji, opisie, kategorii. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  status?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  securityClass?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsEmail({}, { message: 'Filtr właściciela musi być poprawnym adresem e-mail.' })
  ownerEmail?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  environmentId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? undefined : value))
  @IsString()
  category?: string;

  @IsOptional()
  @Transform(toQueryNumber(undefined))
  @IsInt()
  @Min(1)
  @Max(4)
  criticality?: number;

  /** Pokaż też usunięte (soft-deleted). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeDeleted?: boolean;

  /**
   * Tylko aplikacje bez właściciela.
   *
   * Osobny parametr, a nie `ownerEmail=''`, bo pusty string jest
   * niejednoznaczny: „puste pole” znaczy co innego niż
   * „nieprzypisane”. Karta „Bez właściciela” na pulpicie
   * linkuje właśnie tutaj.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  missingOwner?: boolean;

  /**
   * Rozmiar strony (Prisma `take`).
   *
   * Nazwane `limit`, a nie `page`, bo to liczba rekordów, nie numer
   * strony — numer strony sugerowałby pomnożenie przez rozmiar.
   */
  @IsOptional()
  @Transform(toQueryNumber(50))
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;

  @IsOptional()
  @Transform(toQueryNumber(0))
  @IsInt()
  @Min(0)
  offset = 0;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort?: string;
}
