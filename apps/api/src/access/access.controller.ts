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
import { AccessService } from './access.service';
import {
  ClientIp,
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from '../auth/decorators';
import {
  CreatePersonDto,
  GrantAccessDto,
  MatrixQueryDto,
  PersonQueryDto,
  UpdateGrantDto,
  UpdatePersonDto,
} from './dto/access.dto';
import {
  ApplyPersonsImportDto,
  PreviewPersonsImportDto,
} from './dto/import.dto';

/**
 * Macierz uprawnień i katalog osób.
 *
 * Każda trasa ma własne `@RequirePermission`, bo guard sprawdza tylko to,
 * co jest zapisane — brak dekoratora oznaczałby dostęp dla każdego
 * zalogowanego, w tym dla roli VIEWER, która macierzy nie widzi.
 *
 * `@Public()` nie pojawia się nigdzie: macierz zawiera dane osobowe
 * osób spoza panelu, więc nie ma wersji dostępnej bez sesji.
 */
@Controller('api/access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  // ─── Macierz jednej aplikacji ───────────────────────────────

  @Get('applications/:id')
  @RequirePermission('access:read')
  async applicationAccess(@Param('id', ParseUUIDPipe) id: string) {
    return { grants: await this.access.listApplicationAccess(id) };
  }

  @Post('applications/:id')
  @RequirePermission('access:write')
  async grant(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantAccessDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { grant: await this.access.grantAccess(id, dto, actor, ip) };
  }

  @Patch('applications/:id/:personId')
  @RequirePermission('access:write')
  async updateGrant(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: UpdateGrantDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { grant: await this.access.updateGrant(id, personId, dto, actor, ip) };
  }

  @Delete('applications/:id/:personId')
  @RequirePermission('access:write')
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personId', ParseUUIDPipe) personId: string,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.access.revokeGrant(id, personId, actor, ip);
    return { ok: true };
  }

  // ─── Macierz zbiorcza ───────────────────────────────────────

  @Get('matrix')
  @RequirePermission('access:read')
  async matrix(@Query() query: MatrixQueryDto) {
    return { rows: await this.access.matrix(query) };
  }

  /**
   * Eksport raportu całej macierzy — dowód półrocznego przeglądu.
   * Odpowiedź CSV z nazwą pliku w nagłówku. Eksport nigdy nie jest
   * publiczny: raport zawiera dane osobowe osób spoza panelu.
   */
  @Get('matrix/export')
  @RequirePermission('access:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportMatrix(@Res() reply: FastifyReply) {
    const { csv, nazwaPliku } = await this.access.exportMatrixCsv();
    reply.header('Content-Disposition', `attachment; filename="${nazwaPliku}"`);
    return reply.send(csv);
  }

  /** Raport macierzy jednej aplikacji — do wręczenia jej właścicielowi. */
  @Get('applications/:id/export')
  @RequirePermission('access:read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportApplicationMatrix(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() reply: FastifyReply,
  ) {
    const { csv, nazwaPliku } = await this.access.exportMatrixCsv(id);
    reply.header('Content-Disposition', `attachment; filename="${nazwaPliku}"`);
    return reply.send(csv);
  }

  // ─── Import osób z CSV ──────────────────────────────────────

  /** Podgląd importu: klasyfikuje wiersze, nic nie zapisuje. */
  @Post('import/preview')
  @RequirePermission('access:write')
  async previewImport(@Body() dto: PreviewPersonsImportDto) {
    return this.access.previewPersonsImport(dto.csv, dto.mapping);
  }

  /** Zapis wybranych wierszy — serwis waliduje je ponownie. */
  @Post('import/apply')
  @RequirePermission('access:write')
  async applyImport(
    @Body() dto: ApplyPersonsImportDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { result: await this.access.applyPersonsImport(dto.rows, actor, ip) };
  }

  // ─── Katalog osób ───────────────────────────────────────────

  @Get('persons')
  @RequirePermission('access:read')
  async persons(@Query() query: PersonQueryDto) {
    return {
      persons: await this.access.listPersons({
        search: query.search,
        department: query.department,
        includeInactive: query.includeInactive !== 'false',
        sort: query.sort,
      }),
    };
  }

  /** Licznik katalogu osób — liczby z bazy, niezależne od filtrów listy. */
  @Get('persons/count')
  @RequirePermission('access:read')
  async personsCount() {
    return { count: await this.access.licznikOsob() };
  }

  @Get('persons/:id')
  @RequirePermission('access:read')
  async person(@Param('id', ParseUUIDPipe) id: string) {
    return {
      person: await this.access.getPerson(id),
      grants: await this.access.matrix({ personId: id }),
    };
  }

  @Post('persons')
  @HttpCode(201)
  @RequirePermission('access:write')
  async createPerson(
    @Body() dto: CreatePersonDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { person: await this.access.createPerson(dto, actor, ip) };
  }

  @Patch('persons/:id')
  @RequirePermission('access:write')
  async updatePerson(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { person: await this.access.updatePerson(id, dto, actor, ip) };
  }

  /** Usunięcie osoby — twarde kasowanie błędnego wpisu (`deletePerson` w serwisie). */
  @Delete('persons/:id')
  @RequirePermission('access:write')
  async deletePerson(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.access.deletePerson(id, actor, ip);
    return { ok: true };
  }
}