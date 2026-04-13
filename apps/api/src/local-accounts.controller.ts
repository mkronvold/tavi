import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  createLocalAccountSchema,
  deleteLocalAccountSchema,
  importLocalAccountsSchema,
  setLocalAccountPasswordSchema,
  setOwnPasswordSchema,
  updateLocalAccountSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { LocalAccountsService } from './local-accounts.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('auth')
@UseGuards(SessionGuard)
export class LocalAccountsController {
  constructor(private readonly localAccountsService: LocalAccountsService) {}

  @Get('accounts')
  async listAccounts(@Req() request: AuthenticatedRequest) {
    const accounts = await this.localAccountsService.listAccounts(
      request.user!,
    );

    return { accounts };
  }

  @Get('accounts/export')
  exportAccounts(@Req() request: AuthenticatedRequest) {
    return this.localAccountsService.exportAccounts(request.user!);
  }

  @Post('accounts')
  async createAccount(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(createLocalAccountSchema, body);
    const account = await this.localAccountsService.createAccount(
      input,
      request.user!,
    );

    return { account };
  }

  @Post('accounts/import')
  importAccounts(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parseInput(importLocalAccountsSchema, body);
    return this.localAccountsService.importAccounts(input, request.user!);
  }

  @Post('accounts/reset-defaults')
  resetDefaultAccounts(@Req() request: AuthenticatedRequest) {
    return this.localAccountsService.resetDefaultAccounts(request.user!);
  }

  @Patch('accounts/:userId')
  async updateAccount(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updateLocalAccountSchema, body);
    const account = await this.localAccountsService.updateAccount(
      userId,
      input,
      request.user!,
    );

    return { account };
  }

  @Delete('accounts/:userId')
  deleteAccount(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(deleteLocalAccountSchema, body ?? {});

    return this.localAccountsService.deleteAccount(
      userId,
      input,
      request.user!,
    );
  }

  @Post('accounts/:userId/password')
  async setAccountPassword(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(setLocalAccountPasswordSchema, body);

    await this.localAccountsService.setAccountPassword(
      userId,
      input,
      request.user!,
    );

    return { success: true as const };
  }

  @Post('me/password')
  async setOwnPassword(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(setOwnPasswordSchema, body);

    await this.localAccountsService.setOwnPassword(input, request.user!);

    return { success: true as const };
  }
}
