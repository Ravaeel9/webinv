import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { MAX_CSV_BYTES, MAX_PERSON_ROWS } from '../csv';
import { MAX_MATRIX_ROWS } from '../matrix-csv';
import { ACCESS_LEVELS, type AccessLevelValue } from './access.dto';

/**
 * Mapowanie kolumn: pole osoby → nagłówek z pliku.
 *
 * Nagłówek to obcy tekst, więc jest walidowany jako tekst, a nie jako nazwa
 * pola — nie może sterować tym, co znajdzie się w zapytaniu.
 */
export class HeaderMappingDto {
  @IsOptional() @IsString() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(200)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  lastName?: string;

  @IsOptional() @IsString() @MaxLength(200)
  position?: string;

  @IsOptional() @IsString() @MaxLength(200)
  department?: string;

  @IsOptional() @IsString() @MaxLength(200)
  isActive?: string;
}

/**
 * Import CSV.
 *
 * Plik leci jako **tekst w JSON**, a nie jako `multipart` — dokładnie tak,
 * jak przy imporcie nmap. Dzięki temu nie ma jednorazowych plików na dysku,
 * a limit rozmiaru jest zwykłym `@MaxLength`.
 *
 * `HeaderMappingDto` jest zadeklarowane **wyżej** w tym pliku celowo:
 * TypeScript przy dekoratorach `@Type(() => X)` emituje `design:type: X`
 * w emitowanym kodzie, a `X` musi wtedy już istnieć. Klasy deklarowanej niżej
 * nie ma jeszcze w zmiennych modułu w chwili, gdy liczy się metadane — i
 * produkcyjny obraz padał na `Cannot access 'HeaderMappingDto' before
 * initialization`, podczas gdy testy przez `tsx` przechodziły (esbuild nie
 * emituje `design:type`). Kolejność deklaracji pilnuje test w
 * `access-dto.test.ts`.
 */
export class PreviewPersonsImportDto {
  @IsString()
  @MaxLength(MAX_CSV_BYTES, { message: 'Plik przekracza maksymalny rozmiar 2 MB.' })
  csv!: string;

  /**
   * Poprawione przez administratora przypisanie kolumn. Pusta wartość pola
   * znaczy „ta kolumna nie wypełnia tego pola”, a nie „wyczyść”.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => HeaderMappingDto)
  mapping?: HeaderMappingDto;
}

/**
 * Wiersz przy zapisie.
 *
 * Świadomie bez pola `errors` z podglądu: serwis ma walidować wiersz od nowa,
 * a nie ufać temu, co przeglądarka zadeklarowała jako poprawne.
 */
export class ImportPersonRowDto {
  @IsEmail({}, { message: 'Wiersz ma niepoprawny adres e-mail.' })
  @MaxLength(200)
  email!: string;

  @IsString() @MaxLength(100)
  firstName!: string;

  @IsString() @MaxLength(100)
  lastName!: string;

  @IsOptional() @IsString() @MaxLength(150)
  position?: string;

  @IsOptional() @IsString() @MaxLength(150)
  department?: string;

  @IsOptional()
  @IsBoolean({ message: 'isActive musi być true lub false.' })
  isActive?: boolean;
}

export class ApplyPersonsImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportPersonRowDto)
  @ArrayMaxSize(MAX_PERSON_ROWS, {
    message: `Import przekracza limit ${MAX_PERSON_ROWS} wierszy.`,
  })
  rows!: ImportPersonRowDto[];
}

/**
 * Import macierzy uprawnień z CSV — okrężny z eksportem.
 *
 * `MatrixImportRowDto` jest zadeklarowane **wyżej** niż `ApplyMatrixImportDto`
 * z tego samego powodu co `HeaderMappingDto` wyżej: `@Type(() => X)` emituje
 * `design:type`, a klasa użyta nim musi już istnieć (kolejność pilnuje test
 * w `access-dto.test.ts`).
 *
 * Wiersz jest świadomie **bez** pól `errors`/`status` z podglądu: payload
 * między podglądem a zapisem jest niezaufany, serwis waliduje każdy wiersz
 * od nowa. Ścieżki błędów parsera (np. `ROW_WIDTH`) w payloadzie w ogóle
 * nie występują — zapis bierze dane wierszy, nie raport z podglądu.
 */
export class MatrixImportRowDto {
  @IsEmail({}, { message: 'Wiersz ma niepoprawny adres e-mail.' })
  @MaxLength(200)
  email!: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  firstName?: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  lastName?: string;

  @IsOptional() @IsString() @MaxLength(150)
  position?: string;

  @IsOptional() @IsString() @MaxLength(150)
  department?: string;

  @IsIn(ACCESS_LEVELS, { message: 'Nieznany poziom dostępu.' })
  level!: AccessLevelValue;

  @IsDateString({}, { message: 'Podaj datę w formacie RRRR-MM-DD.' })
  @IsOptional()
  expiresOn?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  note?: string;

  /** Nazwa aplikacji z pliku — w trybie pojedynczym niepotrzebna (kontrola APP_MISMATCH w serwisie). */
  @IsOptional() @IsString() @MaxLength(200)
  applicationName?: string;
}

export class PreviewMatrixImportDto {
  @IsString()
  @MaxLength(MAX_CSV_BYTES, { message: 'Plik przekracza maksymalny rozmiar 2 MB.' })
  csv!: string;

  /** Tryb pojedynczej aplikacji — eksport karty aplikacji importowany do niej samej. */
  @IsOptional() @IsUUID()
  applicationId?: string;
}

export class ApplyMatrixImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MatrixImportRowDto)
  @ArrayMaxSize(MAX_MATRIX_ROWS, {
    message: `Import przekracza limit ${MAX_MATRIX_ROWS} wierszy.`,
  })
  rows!: MatrixImportRowDto[];

  @IsOptional() @IsUUID()
  applicationId?: string;
}