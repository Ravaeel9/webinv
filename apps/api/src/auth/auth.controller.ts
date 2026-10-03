import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SessionsService } from './sessions.service';
import { loginRateLimit } from '../config/configuration';
import {
  AllowWhilePasswordChangeRequired,
  ClientIp,
  ClientUserAgent,
  CurrentUser,
  Public,
  type AuthUser,
} from './decorators';
import {
  ChangePasswordDto,
  LoginDto,
  RevokeSessionDto,
} from './dto/auth.dto';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // Osobny, niski limit na logowanie — chroni przed zgadywaniem haseł.
  // Wartości z `loginRateLimit` zamiast zaszytych liczb, żeby
  // `LOGIN_RATE_LIMIT_MAX` w .env coś robił.
  @Throttle({
    default: {
      limit: loginRateLimit.limit,
      ttl: loginRateLimit.ttlMs,
    },
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
    @ClientIp() ip: string,
    @ClientUserAgent() ua: string,
  ) {
    const result = await this.auth.login(dto, ip, ua);

    reply.setCookie(
      this.sessions.cookieName(),
      result.token,
      this.sessions.cookieOptions(result.expiresAt),
    );

    return { user: result.user };
  }

  @Post('logout')
  @HttpCode(200)
  @AllowWhilePasswordChangeRequired()
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser() user: AuthUser,
    @ClientIp() ip: string,
  ) {
    const token = request.cookies?.[this.sessions.cookieName()];
    await this.auth.logout(token, user, ip);
    reply.clearCookie(this.sessions.cookieName(), { path: '/' });
    return { ok: true };
  }

  // /me musi działać zawsze — frontend odczytuje z niego flagę
  // mustChangePassword i na tej podstawie kieruje do zmiany hasła.
  @Get('me')
  @AllowWhilePasswordChangeRequired()
  async me(@CurrentUser() user: AuthUser) {
    return { user };
  }

  @Post('change-password')
  @HttpCode(200)
  @AllowWhilePasswordChangeRequired()
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) reply: FastifyReply,
    @ClientIp() ip: string,
  ) {
    const result = await this.auth.changePassword(user.id, dto, ip);
    reply.setCookie(
      this.sessions.cookieName(),
      result.token,
      this.sessions.cookieOptions(result.expiresAt),
    );
    return { ok: true };
  }

  @Get('sessions')
  @AllowWhilePasswordChangeRequired()
  async listSessions(@CurrentUser() user: AuthUser) {
    return { sessions: await this.auth.listSessions(user.id) };
  }

  @Post('sessions/revoke')
  @HttpCode(200)
  @AllowWhilePasswordChangeRequired()
  async revokeSession(
    @Body() dto: RevokeSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    await this.auth.revokeSession(user.id, dto.sessionId, user);
    return { ok: true };
  }
}
