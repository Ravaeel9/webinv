/**
 * Katalog IPAM — warstwa HTTP.
 *
 * Trasy są własnym prefiksem `/api/ipam`, a nie pod `/api/applications`:
 * katalog podsieci i adresów jest osobnym bytem (widok po stronie
 * aplikacji to tylko przypisania aplikacja ↔ adres), więc mieszanie
 * obu drzew w jednym prefiksie zrobiłoby z niego worek tras.
 * Wyjątkiem są dwie trasy przypisań — one zostają tutaj, bo to ten sam
 * katalog, a nie zasób aplikacji (patrz komentarz przy nich).
 *
 * Żadna trasa nie jest `@Public()`: mapa infrastruktury to najbardziej
 * wrażliwa część rejestru (adresy sieci wewnętrznych, VLAN-y, przypisania),
 * więc gość — również anonimowy odwiedzający stronę WWW — nie ma w niej
 * czego szukać.
 */
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
  Put,
} from '@nestjs/common';
import { IpamService } from './ipam.service';
import {
  ClientIp,
  CurrentUser,
  RequirePermission,
  type AuthUser,
} from '../auth/decorators';
import {
  CreateAddressDto,
  CreateSubnetDto,
  SetApplicationIpAddressesDto,
  UpdateAddressDto,
  UpdateSubnetDto,
} from './dto/ipam.dto';

@Controller('api/ipam')
export class IpamController {
  constructor(private readonly ipam: IpamService) {}

  // ── Podsieci ────────────────────────────────────────────────

  @Get('subnets')
  @RequirePermission('ipam:read')
  async listSubnets() {
    const subnets = await this.ipam.listSubnets();
    return { subnets, total: subnets.length };
  }

  @Get('subnets/:id')
  @RequirePermission('ipam:read')
  async getSubnet(@Param('id', ParseUUIDPipe) id: string) {
    return { subnet: await this.ipam.getSubnet(id) };
  }

  @Post('subnets')
  @RequirePermission('ipam:write')
  async createSubnet(
    @Body() dto: CreateSubnetDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { subnet: await this.ipam.createSubnet(dto, actor, ip) };
  }

  @Patch('subnets/:id')
  @RequirePermission('ipam:write')
  async updateSubnet(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubnetDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { subnet: await this.ipam.updateSubnet(id, dto, actor, ip) };
  }

  @Delete('subnets/:id')
  @RequirePermission('ipam:write')
  @HttpCode(200)
  async removeSubnet(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.ipam.removeSubnet(id, actor, ip);
    return { ok: true };
  }

  // ── Adresy podsieci ─────────────────────────────────────────

  /**
   * Sprawdzenie podsieci przed listą adresów jest celowe.
   *
   * `listAddresses()` filtruje zapytanie po `subnetId` i dla nieznanej
   * podsieci zwraca po prostu pustą listę — bez tego dodatkowego odczytu
   * `GET .../subnets/<zły-id>/addresses` odpowiadałby 200 z `[]`, czyli
   * „ta podsieć istnieje i jest pusta”. Kontroler wybiera 404, żeby
   * nieznane ID wyglądało tak samo jak przy `GET subnets/:id`.
   *
   * Koszt to jedno dodatkowe zapytanie na listę adresów; świadomie —
   * lista adresów nie jest trasą częstokrotnie odpytywaną, a odpowiedź
   * 200 dla literówki w linku jest kosztowniejsza.
   */
  @Get('subnets/:id/addresses')
  @RequirePermission('ipam:read')
  async listAddresses(@Param('id', ParseUUIDPipe) id: string) {
    await this.ipam.getSubnet(id);
    return this.ipam.listAddresses(id);
  }

  @Post('subnets/:id/addresses')
  @RequirePermission('ipam:write')
  async createAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAddressDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { address: await this.ipam.createAddress(id, dto, actor, ip) };
  }

  // ── Adresy po identyfikatorze ───────────────────────────────

  @Patch('addresses/:id')
  @RequirePermission('ipam:write')
  async updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAddressDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    return { address: await this.ipam.updateAddress(id, dto, actor, ip) };
  }

  @Delete('addresses/:id')
  @RequirePermission('ipam:write')
  @HttpCode(200)
  async removeAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.ipam.removeAddress(id, actor, ip);
    return { ok: true };
  }

  @Get('addresses/:id/applications')
  @RequirePermission('ipam:read')
  async applicationsForAddress(@Param('id', ParseUUIDPipe) id: string) {
    return { applications: await this.ipam.applicationsForAddress(id) };
  }

  // ── Przypisania aplikacja ↔ adres ───────────────────────────
  //
  // Dwie trasy poniżej mają `applications` własnym prefiksem, więc nie
  // kolidują z `/api/applications/:id` — to osobne kontrolery w
  // osobnych modułach. Dzięki temu Fastify nie musi rozróżniać
  // „`applications` jako segment stały" od „`:id` jako identyfikator”:
  // różne drzewa prefiksów, każde w swoim module.

  /**
   * Adresy przypisane do aplikacji.
   *
   * Uprawnienie `app:read`, nie `ipam:read`: to ta sama lista, którą
   * karta aplikacji pokazuje osobie patrzącej na aplikację, a nie
   * przeglądającej katalog podsieci.
   *
   * Świadomie NIE weryfikujemy istnienia aplikacji (patrz Task 7):
   * `getApplicationIpAddresses()` czyta przypisania i dla nieznanego
   * `appId` zwraca pustą listę, więc odpowiedź to 200 `{ addresses: [] }`.
   * Dodatkowe zapytanie tylko po to, by odrzucić literówkę w adresie,
   * kosztowałoby osobny serwis w tym module i cykl importów
   * (`ApplicationsModule` → `IpamModule`), a zapis (`PUT`) i tak
   * kończy się 404 dla nieznanej aplikacji.
   */
  @Get('applications/:appId/ip-addresses')
  @RequirePermission('app:read')
  async getApplicationIpAddresses(@Param('appId', ParseUUIDPipe) appId: string) {
    return { addresses: await this.ipam.getApplicationIpAddresses(appId) };
  }

  @Put('applications/:appId/ip-addresses')
  @RequirePermission('app:write')
  @HttpCode(200)
  async setApplicationIpAddresses(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Body() dto: SetApplicationIpAddressesDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
    await this.ipam.setApplicationIpAddresses(appId, dto, actor, ip);
    return { ok: true };
  }
}