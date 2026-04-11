import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { localLoginSchema } from '@tavi/schemas';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest } from './auth.types';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';
import { parseInput } from './validation';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  @Post('logout')
  @UseGuards(SessionGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.authService.clearSessionCookie(reply);

    await this.authService.recordAudit(
      request.user!.id,
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
}
