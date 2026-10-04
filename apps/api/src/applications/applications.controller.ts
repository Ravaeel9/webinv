import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApplicationsService } from './applications.service';
import {
  ClientIp,
  CurrentUser,
  Public,
  RequirePermission,
  type AuthUser,
} from '../auth/decorators';
import {
  CreateApplicationDto,
  ListApplicationsQuery,
  UpdateApplicationDto,
} from './dto/application.dto';

@Controller('api/applications')
export class ApplicationsController {
  constructor(private readonly apps: ApplicationsService) {}

  /**
   * Odczyt rejestru jest dostępny bez logowania.
   *
   * Zapis (POST/PATCH/DELETE) zostaje za `app:write`, więc widok
   * publiczne jest faktycznie tylko do odczytu — nie da się nim
   * zmienić ani usunąć wpisu.
   *
   * Gość dostaje okrojony rekord (bez klasyfikacji bezpieczeństwa,
   * krytyczności i właściciela); zalogowany użytkownik pełny.
   * Decyzję podejmuje `viewer`, nie flaga z URL-a.
   */
  @Get()
  @Public()
  @RequirePermission('app:read')
  async list(@Query() query: ListApplicationsQuery, @CurrentUser() viewer?: AuthUser) {
    return viewer ? this.apps.list(query) : this.apps.listPublic(query);
  }

  @Get('stats')
  @RequirePermission('app:read')
  async stats() {
    return this.apps.stats();
  }

  /**
   * Adresy właścicieli do filtra na liście.
   *
   * Tylko dla zalogowanych — `ownerEmail` nie leci do widoku
   * publicznego, więc gość nie ma z czego budować selecta.
   */
  @Get('owner-options')
  @RequirePermission('app:read')
  async ownerOptions() {
    return { owners: await this.apps.ownerOptions() };
  }

  /** Potrzebne publicznie do filtrów na liście (lista środowisk). */
  @Get('environments')
  @Public()
  @RequirePermission('app:read')
  async environments() {
    return { environments: await this.apps.environments() };
  }

  @Get('export')
  @RequirePermission('app:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async export(
    @Query() query: ListApplicationsQuery,
    @Res() reply: FastifyReply,
  ) {
    const csv = await this.apps.exportCsv(query);
    const stamp = new Date().toISOString().slice(0, 10);
    reply.header(
      'Content-Disposition',
      `attachment; filename="rejestr-${stamp}.csv"`,
    );
    return reply.send(csv);
  }

  @Get(':id')
  @Public()
  @RequirePermission('app:read')
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() viewer?: AuthUser) {
    const application = viewer
      ? await this.apps.get(id)
      : await this.apps.getPublic(id);
    return { application };
  }

  @Post()
  @RequirePermission('app:write')
  async create(
    @Body() dto: CreateApplicationDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { application: await this.apps.create(dto, actor, ip) };
  }

  @Patch(':id')
  @RequirePermission('app:write')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { application: await this.apps.update(id, dto, actor, ip) };
  }

  @Delete(':id')
  @RequirePermission('app:write')
  @HttpCode(200)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.apps.remove(id, actor, ip);
    return { ok: true };
  }

  @Post(':id/restore')
  @RequirePermission('app:write')
  @HttpCode(200)
  async restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { application: await this.apps.restore(id, actor, ip) };
  }
}
