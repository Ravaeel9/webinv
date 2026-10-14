import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIP,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateBy,
  ValidateNested,
} from 'class-validator';
import { isValidIpv4 } from '../cidr';
import { MAX_HOSTS, MAX_XML_BYTES } from '../nmap-xml';

function IsStrictIpv4() {
  return ValidateBy({
    name: 'isStrictIpv4',
    validator: {
      validate: (value: unknown) =>
        typeof value !== 'string' || isValidIpv4(value),
      defaultMessage: () =>
        'Nieprawidłowy adres IP — podaj cztery oktety 0–255, np. 10.20.1.15.',
    },
  });
}

const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' ? undefined : value;

export class PreviewImportDto {
  @IsString()
  @MaxLength(MAX_XML_BYTES, {
    message: 'Plik XML przekracza maksymalny rozmiar 5 MB.',
  })
  xml!: string;
}

export class ImportSelectionDto {
  @IsString()
  @MaxLength(18)
  @IsIP('4')
  @IsStrictIpv4()
  address!: string;

  @IsUUID('4', { message: 'Nieprawidłowy identyfikator podsieci.' })
  subnetId!: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class ApplyImportDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportSelectionDto)
  @ArrayMaxSize(MAX_HOSTS, {
    message: 'Maksymalnie 10 000 pozycji w jednym imporcie.',
  })
  selections!: ImportSelectionDto[];
}
