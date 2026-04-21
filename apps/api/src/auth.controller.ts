import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  localLoginSchema,
  requestPasswordResetSchema,
  resetPasswordWithOtpSchema,
  updateEmailSettingsSchema,
  updateNotificationPreferencesSchema,
  workspaceUserConfigSchema,
} from '@tavi/schemas';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  @Get('local-login-hint')
  getLocalLoginHint() {
    return this.authService.getLocalLoginHintStatus();
  }

  @Post('login')
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseInput(localLoginSchema, body);
    const user = await this.authService.login(input.email, input.password);

    this.authService.setSessionCookie(reply, user);

    return { user };
  }

  @Post('login/guest')
  async loginGuest(@Res({ passthrough: true }) reply: FastifyReply) {
    const user = await this.authService.loginGuest();

    this.authService.setSessionCookie(reply, user);

    return { user };
  }

  @Post('password-reset/request')
  async requestPasswordReset(@Body() body: unknown) {
    const input = parseInput(requestPasswordResetSchema, body);
    await this.authService.requestPasswordReset(input.email);
    return { success: true as const };
  }

  @Post('password-reset/confirm')
  async resetPasswordWithOtp(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = parseInput(resetPasswordWithOtpSchema, body);
    await this.authService.resetPasswordWithOtp(input);
    this.authService.clearSessionCookie(reply);
    return { success: true as const };
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.authService.clearSessionCookie(reply);

    await this.authService.recordAudit(
      request.user!,
      'auth',
      request.user!.id,
      'logout',
      {
        role: request.user!.role,
      },
    );

    return { success: true };
  }

  @Get('me')
  @UseGuards(SessionGuard)
  getMe(@Req() request: AuthenticatedRequest) {
    return { user: request.user };
  }

  @Put('email/settings')
  @UseGuards(SessionGuard)
  async updateEmailSettings(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    this.authService.requireAdminAccess(request.user!);

    const input = parseInput(updateEmailSettingsSchema, body);
    return this.emailService.updateEmailSettings(input);
  }

  @Get('email/status')
  @UseGuards(SessionGuard)
  async getEmailStatus(@Req() request: AuthenticatedRequest) {
    this.authService.requireAdminAccess(request.user!);
    return this.emailService.getSmtpStatus();
  }

  @Post('email/test')
  @UseGuards(SessionGuard)
  async sendTestEmail(@Req() request: AuthenticatedRequest) {
    this.authService.requireAdminAccess(request.user!);

    await this.emailService.sendTestEmail(
      {
        email: request.user!.email,
        name: request.user!.name,
      },
      request.user!,
    );

    return { success: true as const };
  }

  @Get('notification/preferences')
  @UseGuards(SessionGuard)
  async getNotificationPreferences(@Req() request: AuthenticatedRequest) {
    return this.authService.getNotificationPreferences(request.user!.id);
  }

  @Put('notification/preferences')
  @UseGuards(SessionGuard)
  async updateNotificationPreferences(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    this.authService.requireNonGuestAccess(
      request.user!,
      'Guest access cannot update notification preferences',
    );
    const input = parseInput(updateNotificationPreferencesSchema, body);
    return this.authService.updateNotificationPreferences(request.user!, input);
  }

  @Put('user-config')
  @UseGuards(SessionGuard)
  async updateUserConfig(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parseInput(workspaceUserConfigSchema, body);
    return this.authService.updateUserConfig(request.user!, input);
  }

  @Post('settings/reset')
  @UseGuards(SessionGuard)
  async resetUserSettings(@Req() request: AuthenticatedRequest) {
    this.authService.requireNonGuestAccess(
      request.user!,
      'Guest access cannot reset user settings',
    );
    return this.authService.resetUserSettings(request.user!);
  }
}
