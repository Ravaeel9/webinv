import {
  IsString,
  MinLength,
  MaxLength,
  IsOptional,
  IsEmail,
  IsBoolean,
  Matches,
} from 'class-validator';

export class LoginDto {
  @IsString()
  @MinLength(1, { message: 'Podaj nazwę użytkownika lub e-mail.' })
  @MaxLength(200, { message: 'Zbyt długa wartość.' })
  username!: string;

  @IsString()
  @MinLength(1, { message: 'Podaj hasło.' })
  @MaxLength(200, { message: 'Zbyt długa wartość.' })
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Podaj aktualne hasło.' })
  currentPassword!: string;

  @IsString()
  @MinLength(12, { message: 'Nowe hasło musi mieć co najmniej 12 znaków.' })
  @MaxLength(200, { message: 'Maksymalnie 200 znaków.' })
  newPassword!: string;
}

export class CreateUserDto {
  @IsString()
  @MinLength(3, { message: 'Nazwa użytkownika: minimum 3 znaki.' })
  @MaxLength(64, { message: 'Maksymalnie 64 znaki.' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'Nazwa użytkownika może zawierać tylko litery, cyfry oraz znaki . _ -',
  })
  username!: string;

  @IsEmail({}, { message: 'Podaj poprawny adres e-mail.' })
  @MaxLength(200, { message: 'Maksymalnie 200 znaków.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Podaj imię i nazwisko.' })
  @MaxLength(200, { message: 'Maksymalnie 200 znaków.' })
  fullName!: string;

  @IsString()
  @MinLength(12, { message: 'Hasło musi mieć co najmniej 12 znaków.' })
  @MaxLength(200, { message: 'Maksymalnie 200 znaków.' })
  password!: string;

  @IsOptional()
  @Matches(/^(SUPER_ADMIN|ADMIN|VIEWER)$/, { message: 'Nieznana rola.' })
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(64, { message: 'Maksymalnie 64 znaki.' })
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message:
      'Nazwa użytkownika może zawierać tylko litery, cyfry oraz znaki . _ -',
  })
  username?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Podaj poprawny adres e-mail.' })
  @MaxLength(200, { message: 'Maksymalnie 200 znaków.' })
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200, { message: 'Maksymalnie 200 znaków.' })
  fullName?: string;

  @IsOptional()
  @Matches(/^(SUPER_ADMIN|ADMIN|VIEWER)$/, { message: 'Nieznana rola.' })
  role?: 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

  @IsOptional()
  @IsBoolean({ message: 'isActive musi być true lub false.' })
  isActive?: boolean;
}
