import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import {
  ValidateBy,
  ValidationArguments,
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { cidrErrorMessage, isValidIpv4 } from '../cidr';

/**
 * Sieć w zapisie CIDR — walidator deleguje do `cidrErrorMessage`.
 *
 * Komunikat jest DOKŁADNIE zwracaną wartością, bez otoczki: UI pokazuje
 * go wprost użytkownikowi, więc dorabianie własnej treści w DTO dałoby
 * dwa źródła prawdy o tym samym błędzie.
 *
 * Nietekstowe wartości przepuszczamy — oceni je `@IsString`, a nam
 * zależy na tym, by każde odrzucenie stąd miało komunikat z `cidr.ts`.
 */
function IsCidrNetwork() {
  return ValidateBy({
    name: 'isCidrNetwork',
    validator: {
      validate: (value: unknown) =>
        typeof value !== 'string' || cidrErrorMessage(value) === null,
      defaultMessage: ({ value }: ValidationArguments) =>
        typeof value === 'string'
          ? (cidrErrorMessage(value) ?? 'Wpisz adres sieci w formacie CIDR.')
          : 'Wpisz adres sieci w formacie CIDR.',
    },
  });
}

/**
 * Pojedynczy adres IPv4 bez maski — deleguje do `isValidIpv4`.
 *
 * Tamta funkcja zwraca sam `boolean`, więc komunikat piszemy tu sami —
 * tą samą polską składnią, co reszta walidatorów z `cidr.ts`. Rygor
 * oktetów (bez zer wiodących) odziedziczamy wprost z parsera.
 */
function IsIpv4Address() {
  return ValidateBy({
    name: 'isIpv4Address',
    validator: {
      validate: (value: unknown) =>
        typeof value !== 'string' || isValidIpv4(value),
      defaultMessage: () =>
        'Nieprawidłowy adres IP — podaj cztery oktety 0–255, np. 10.20.1.15.',
    },
  });
}

export const IP_STATUSES = ['FREE', 'IN_USE', 'DEPRECATED'] as const;

/**
 * Zamienia pusty string na `undefined` — formularze wysyłają "" dla niewypełnionych pól.
 *
 * `null` celowo zostaje `null`: w PATCH-u `undefined` znaczy „nie ruszaj
 * tego pola”, a `null` znaczy „wyczyść”.
 */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

/**
 * Liczba w ciele żądania (POST/PATCH).
 *
 * `""` i brak wartości to „nie ustawiaj”, `null` to „wyczyść”.
 * Bez `@Type(() => Number)`: działa **po** transformacji i zamienia
 * `''` na `0`, przez co puste pole VLAN walidowałoby się jako „poniżej 1”.
 */
const toOptionalNumber = ({ value }: { value: unknown }) => {
  if (value === '' || value === undefined) return undefined;
  if (value === null) return null;
  return Number(value);
};

export class CreateSubnetDto {
  @IsString()
  // Tylko spacje to nie nazwa — bez tego rekord o nazwie "   " trafiłby do bazy.
  @Matches(/\S/, { message: 'Nazwa nie może składać się z samych spacji.' })
  @MaxLength(200)
  name!: string;

  /**
   * 18 znaków to `255.255.255.255/32` plus zapas — dokładnie granica
   * kolumny `VarChar(18)` w schemacie.
   */
  @IsString()
  @MaxLength(18)
  @IsCidrNetwork()
  cidr!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * Kolor kafelka — nazwa tony w stylu `slate` (patrz domyślna wartość
   * kolumny w schemacie). Wspólnej listy kolorów po stronie API nie ma
   * (w interfejsie dawne `ENV_COLORS` usunięto jako martwy eksport), więc
   * pilnujemy tylko formatu: samych małych liter. Walidacja zakresu
   * miałaby sens dopiero przy zamkniętym palecie — tu kolor nic nie
   * znaczy poza wyglądem.
   */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Matches(/^[a-z]+$/, { message: 'Kolor musi być nazwą z małych liter, np. „sky”.' })
  @MaxLength(30)
  color?: string;

  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt({ message: 'VLAN musi być liczbą całkowitą.' })
  @Min(1, { message: 'VLAN musi być w zakresie 1–4094.' })
  @Max(4094, { message: 'VLAN musi być w zakresie 1–4094.' })
  vlan?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  location?: string;
}

/**
 * PATCH — ta sama definicja co POST, ale każde pole opcjonalne.
 *
 * `PartialType` przenosi też metadane własnych walidatorów (`ValidateBy`),
 * więc delegacja do `cidr.ts` działa także tutaj — pilnuje tego test
 * w `ipam-dto.test.ts`.
 */
export class UpdateSubnetDto extends PartialType(CreateSubnetDto) {}

export class CreateAddressDto {
  @IsString()
  @MaxLength(18)
  @IsIpv4Address()
  address!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsIn(IP_STATUSES, { message: 'Nieznany status adresu.' })
  status?: (typeof IP_STATUSES)[number];

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

/**
 * Pełna lista przypisań adresu do aplikacji — ustawianie zamiast patchowania.
 *
 * Pusta lista jest poprawna i znaczy „odpiąć wszystko”; stąd brak
 * `@ArrayMinSize`. Górny limit to ochrona przed przypadkowym (niezłym)
 * payloadem, nie reguła domenowa.
 */
export class SetApplicationIpAddressesDto {
  @IsArray()
  @ArrayMaxSize(100, { message: 'Maksymalnie 100 identyfikatorów adresów.' })
  @IsUUID('4', { each: true, message: 'Nieprawidłowy identyfikator adresu IP.' })
  ipAddressIds!: string[];
}
