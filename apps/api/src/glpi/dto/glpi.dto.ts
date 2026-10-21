/**
 * DTO integracji GLPI — walidacja wejścia z panelu.
 *
 * Reguła z AGENTS.md: walidacja danych wejściowych zawsze w serwisie,
 * **przed pierwszym zapisem**. DTO łapie kształt i długości (zanim
 * PostgreSQL odpowie obcym komunikatem), a reguły biznesowe (adresy
 * zaczynające się od http, kompletność konfiguracji) sprawdza serwis.
 */
import type { Sekcja, TypDostarczenia } from '../glpi.service';
import { TYPY_DOSTARCZENIA } from '../glpi.service';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsEmail,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const POZIOMY = ['OWNER', 'ADMIN', 'USER', 'READ_ONLY'] as const;

export class UstawieniaGlpiDto {
  @IsString({ message: 'Adres API GLPI jest wymagany.' })
  @MaxLength(500, { message: 'Adres API GLPI przekracza 500 znaków.' })
  apiUrl!: string;

  @IsString({ message: 'Client ID jest wymagany.' })
  @MaxLength(200, { message: 'Client ID przekracza 200 znaków.' })
  clientId!: string;

  /** Opcjonalne: brak pola znaczy „zostaw poprzedni sekret". */
  @IsOptional()
  @IsString({ message: 'Client secret musi być tekstem.' })
  @MaxLength(500, { message: 'Client secret przekracza 500 znaków.' })
  clientSecret?: string;

  @IsString({ message: 'Login OAuth jest wymagany.' })
  @MaxLength(200, { message: 'Login OAuth przekracza 200 znaków.' })
  login!: string;

  @IsOptional()
  @IsString({ message: 'Hasło OAuth musi być tekstem.' })
  @MaxLength(200, { message: 'Hasło OAuth przekracza 200 znaków.' })
  haslo?: string;

  @IsString({ message: 'Adres legacy API jest wymagany.' })
  @MaxLength(500, { message: 'Adres legacy API przekracza 500 znaków.' })
  legacyUrl!: string;

  @IsOptional()
  @IsString({ message: 'Token osobisty musi być tekstem.' })
  @MaxLength(200, { message: 'Token osobisty przekracza 200 znaków.' })
  userToken?: string;

  @IsOptional()
  @IsString({ message: 'App-Token musi być tekstem.' })
  @MaxLength(200, { message: 'App-Token przekracza 200 znaków.' })
  appToken?: string;

  @IsString({ message: 'Grupa nadrzędna jest wymagana.' })
  @MaxLength(100, { message: 'Grupa nadrzędna przekracza 100 znaków.' })
  parentGroup!: string;

  @IsIn(POZIOMY, { message: 'Nieznany poziom dostępu.' })
  accessLevel!: (typeof POZIOMY)[number];
}

export class WierszOsobyDto {
  @IsString() @MaxLength(100) firstName!: string;
  @IsString() @MaxLength(100) lastName!: string;
  @IsEmail({}, { message: 'Nieprawidłowy e-mail osoby.' }) @MaxLength(200) email!: string;
  @IsOptional() @IsString() @MaxLength(150) position!: string | null;
  @IsOptional() @IsString() @MaxLength(150) department!: string | null;
}

export class WierszOprogramowaniaDto {
  @IsString() @MaxLength(200) name!: string;
  @IsOptional() @IsString() @MaxLength(100) version!: string;

  /** Typ dostarczenia — opcjonalny: brak pola znaczy „zostaw domyślne". */
  @IsOptional()
  @IsIn(TYPY_DOSTARCZENIA, { message: 'Nieznany typ dostarczenia aplikacji.' })
  deliveryType!: TypDostarczenia;
}

export class WierszDostepuDto {
  @IsEmail({}, { message: 'Nieprawidłowy e-mail osoby w dostępie.' })
  @MaxLength(200)
  personEmail!: string;

  @IsString() @MaxLength(200) applicationName!: string;
}

export class ImportGlpiDto {
  @IsArray({ message: 'Sekcje importu muszą być listą.' })
  @ArrayMinSize(1, { message: 'Wybierz co najmniej jedną sekcję importu.' })
  @ArrayMaxSize(3, { message: 'Sekcje importu: persons, software, access.' })
  @IsIn(['persons', 'software', 'access'], {
    each: true,
    message: 'Nieznana sekcja importu.',
  })
  sections!: Sekcja[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000, { message: 'Import osób przekracza limit 5000 wierszy.' })
  @ValidateNested({ each: true })
  @Type(() => WierszOsobyDto)
  persons?: WierszOsobyDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000, { message: 'Import oprogramowania przekracza limit 5000 wierszy.' })
  @ValidateNested({ each: true })
  @Type(() => WierszOprogramowaniaDto)
  software?: WierszOprogramowaniaDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000, { message: 'Import dostępów przekracza limit 5000 wierszy.' })
  @ValidateNested({ each: true })
  @Type(() => WierszDostepuDto)
  access?: WierszDostepuDto[];
}
