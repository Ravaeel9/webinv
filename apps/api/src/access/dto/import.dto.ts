import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_CSV_BYTES, MAX_PERSON_ROWS } from '../csv';

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