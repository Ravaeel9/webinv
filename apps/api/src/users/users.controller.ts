import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { AuthService } from '../auth/auth.service';
import {
  ClientIp,
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from '../auth/decorators';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/auth.dto';
import { IsString, MinLength, MaxLength } from 'class-validator';

class ResetPasswordDto {
  @IsString()
  @MinLength(12, { message: 'Hasło musi mieć co najmniej 12 znaków.' })
  @MaxLength(200)
  newPassword!: string;
}

@Controller('api/users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  /** Lista użytkowników — do odczytu każdy zalogowany. */
  @Get()
  @RequirePermission('user:read')
  async list(@Query('includeInactive') includeInactive?: string) {
    const include = includeInactive !== 'false';
    return { users: await this.users.list(include) };
  }

  /** Słownik do wyboru administratorów w formularzu aplikacji. */
  @Get('options')
  @RequirePermission('app:read')
  async options() {
    return { users: await this.users.options() };
  }

  @Get(':id')
  @RequirePermission('user:read')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return { user: await this.users.get(id) };
  }

  @Post()
  @RequirePermission('user:write')
  async create(
    @Body() dto: CreateUserDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { user: await this.users.create(dto, actor, ip) };
  }

  @Patch(':id')
  @RequirePermission('user:write')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { user: await this.users.update(id, dto, actor, ip) };
  }

  @Delete(':id')
  @RequirePermission('user:write')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.users.remove(id, actor, ip);
    return { ok: true };
  }

  /** Reset hasła — tylko super admin. */
  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermission('user:write')
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.auth.adminResetPassword(id, dto.newPassword, actor, ip);
    return { ok: true };
  }

  /** Wymuszenie zmiany hasła przy następnym logowaniu. */
  @Post(':id/require-password-change')
  @HttpCode(200)
  @RequirePermission('user:write')
  async requirePasswordChange(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.auth.requirePasswordChange(id, actor);
    return { ok: true };
  }
}
