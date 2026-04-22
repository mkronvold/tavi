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
  clearAllLocalAccountsSchema,
  createLocalAccountSchema,
  deleteLocalAccountSchema,
  importLocalAccountsSchema,
  setLocalAccountPasswordSchema,
  setOwnPasswordSchema,
  updateLocalAccountSchema,
  updateOwnProfileSchema,
} from '@tavi/schemas';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { LocalAccountsService } from './local-accounts.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('auth')
@UseGuards(SessionGuard)
export class LocalAccountsController {
  constructor(
    private readonly localAccountsService: LocalAccountsService,
    private readonly authService: AuthService,
  ) {}

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

  @Post('accounts/clear-all')
  clearAllAccounts(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(clearAllLocalAccountsSchema, body);

    return this.localAccountsService.clearAllAccounts(input, request.user!);
  }

  @Patch('accounts/:userId')
  async updateAccount(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(updateLocalAccountSchema, body);
    return this.localAccountsService.updateAccount(
      userId,
      input,
      request.user!,
    );
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
    this.authService.requireNonGuestAccess(
      request.user!,
      'Guest access cannot update the guest password',
    );
    const input = parseInput(setOwnPasswordSchema, body);

    await this.localAccountsService.setOwnPassword(input, request.user!);

    return { success: true as const };
  }

  @Patch('me')
  async updateOwnProfile(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    this.authService.requireNonGuestAccess(
      request.user!,
      'Guest access cannot update the guest profile',
    );
    const input = parseInput(updateOwnProfileSchema, body);

    return this.localAccountsService.updateOwnProfile(input, request.user!);
  }
}
