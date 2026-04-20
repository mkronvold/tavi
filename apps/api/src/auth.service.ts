import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type {
  AuditEntityType,
  LocalLoginHintResponse,
  NotificationPreferences,
  ResetPasswordWithOtpInput,
  ResetUserSettingsResponse,
  UpdateNotificationPreferencesInput,
  WorkspaceUserConfig,
} from '@tavi/schemas';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedRequest, SessionUser } from './auth.types';
import {
  DEFAULT_LOCAL_USER_EMAILS,
  DEFAULT_LOCAL_USERS,
} from './default-local-users';
import { EmailService } from './email.service';
import { PrismaService } from './prisma.service';
import {
  createDefaultWorkspaceUserConfig,
  normalizeWorkspaceUserConfig,
  parseStoredWorkspaceUserConfig,
  serializeWorkspaceUserConfig,
} from './user-config';

const SESSION_COOKIE = 'tavi_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const LOCAL_AUTH_MODE = 'local';
const DEFAULT_DAILY_DIGEST_TIME = '11:00';
const PASSWORD_RESET_OTP_TTL_MINUTES = 10;
const PASSWORD_RESET_OTP_TTL_MS = PASSWORD_RESET_OTP_TTL_MINUTES * 60 * 1000;
type AuditWriteClient = PrismaService | Prisma.TransactionClient;
type AuditActor = Pick<SessionUser, 'email' | 'id' | 'name' | 'role'>;

export function generatePasswordResetOtp() {
  const value = randomBytes(4).toString('hex').toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async login(email: string, password: string): Promise<SessionUser> {
    this.requireLocalAuthMode();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roleAssignment: true },
    });

    if (!user?.roleAssignment) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await this.verifyPassword(
      password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.recordAudit(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.roleAssignment.role,
      },
      'auth',
      user.id,
      'login',
      {
        role: user.roleAssignment.role,
      },
    );

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.roleAssignment.role,
    };
  }

  setSessionCookie(reply: FastifyReply, user: SessionUser) {
    const payload = Buffer.from(JSON.stringify(user), 'utf8').toString(
      'base64url',
    );

    reply.setCookie(SESSION_COOKIE, payload, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      signed: true,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      signed: true,
    });
  }

  async getSessionUser(
    request: AuthenticatedRequest,
  ): Promise<SessionUser | null> {
    const cookie = request.cookies[SESSION_COOKIE];

    if (!cookie) {
      return null;
    }

    const unsigned = request.unsignCookie(cookie);

    if (!unsigned.valid || !unsigned.value) {
      return null;
    }

    try {
      const payload = JSON.parse(
        Buffer.from(unsigned.value, 'base64url').toString('utf8'),
      ) as SessionUser;

      const user = await this.prisma.user.findUnique({
        where: { id: payload.id },
        include: { roleAssignment: true },
      });

      if (!user?.roleAssignment) {
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.roleAssignment.role,
      };
    } catch {
      return null;
    }
  }

  async reauthenticateCurrentUser(userId: string, password: string) {
    this.requireLocalAuthMode();

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roleAssignment: true },
    });

    if (!user?.roleAssignment) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await this.verifyPassword(
      password,
      user.passwordHash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }
  }

  async requestPasswordReset(email: string) {
    this.requireLocalAuthMode();
    await this.emailService.assertPasswordResetEmailAvailable();

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { roleAssignment: true },
    });

    if (!user?.roleAssignment) {
      return;
    }

    const oneTimePassword = generatePasswordResetOtp();
    const passwordResetOtpHash = await this.hashPassword(oneTimePassword);
    const passwordResetOtpExpiresAt = new Date(
      Date.now() + PASSWORD_RESET_OTP_TTL_MS,
    );

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetOtpHash,
        passwordResetOtpExpiresAt,
      },
    });

    const auditActor = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.roleAssignment.role,
    } as const;

    try {
      await this.emailService.sendPasswordResetOtpEmail(
        { email: user.email, name: user.name },
        oneTimePassword,
        passwordResetOtpExpiresAt,
        {
          actor: auditActor,
          entityId: user.id,
        },
      );
    } catch (error) {
      await this.clearPasswordResetOtp(user.id);
      throw error;
    }

    await this.recordAudit(
      auditActor,
      'auth',
      user.id,
      'password_reset_requested',
      {
        delivery: 'email_otp',
        expiresAt: passwordResetOtpExpiresAt.toISOString(),
      },
    );
  }

  async resetPasswordWithOtp(input: ResetPasswordWithOtpInput) {
    this.requireLocalAuthMode();

    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { roleAssignment: true },
    });

    if (
      !user?.roleAssignment ||
      !user.passwordResetOtpHash ||
      !user.passwordResetOtpExpiresAt
    ) {
      throw new UnauthorizedException('Invalid one-time password');
    }

    if (user.passwordResetOtpExpiresAt.getTime() < Date.now()) {
      await this.clearPasswordResetOtp(user.id);
      throw new UnauthorizedException('Invalid one-time password');
    }

    const oneTimePasswordMatches = await this.verifyPassword(
      input.oneTimePassword,
      user.passwordResetOtpHash,
    );

    if (!oneTimePasswordMatches) {
      throw new UnauthorizedException('Invalid one-time password');
    }

    const passwordMatches = await this.verifyPassword(
      input.password,
      user.passwordHash,
    );

    if (passwordMatches) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await this.hashPassword(input.password);
    const userRole = user.roleAssignment.role;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordResetOtpHash: null,
          passwordResetOtpExpiresAt: null,
        },
      });

      await this.recordAudit(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          role: userRole,
        },
        'auth',
        user.id,
        'password_reset',
        {
          delivery: 'email_otp',
          scope: 'forgot_password',
        },
        tx,
      );
    });
  }

  requireEditAccess(user: SessionUser) {
    if (user.role === Role.viewer) {
      throw new ForbiddenException('Viewers cannot modify workspace data');
    }
  }

  requireAdminAccess(
    user: SessionUser,
    message = 'Only admins can perform this action',
  ) {
    if (user.role !== Role.admin) {
      throw new ForbiddenException(message);
    }
  }

  requireLocalAuthMode() {
    if (!this.isLocalAuthModeEnabled()) {
      throw new ForbiddenException('Local authentication is disabled');
    }
  }

  async getLocalLoginHintStatus(): Promise<LocalLoginHintResponse> {
    if (!this.isLocalAuthModeEnabled()) {
      return { visible: false };
    }

    const users = await this.prisma.user.findMany({
      where: {
        email: {
          in: DEFAULT_LOCAL_USER_EMAILS,
        },
      },
      select: {
        email: true,
        passwordHash: true,
        roleAssignment: {
          select: {
            role: true,
          },
        },
      },
    });

    if (users.length !== DEFAULT_LOCAL_USERS.length) {
      return { visible: false };
    }

    const usersByEmail = new Map(users.map((user) => [user.email, user]));

    for (const defaultUser of DEFAULT_LOCAL_USERS) {
      const user = usersByEmail.get(defaultUser.email);

      if (!user?.roleAssignment) {
        return { visible: false };
      }

      const passwordMatches = await this.verifyPassword(
        defaultUser.password,
        user.passwordHash,
      );

      if (!passwordMatches) {
        return { visible: false };
      }
    }

    return { visible: true };
  }

  async getNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferences> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        dailyDigestEnabled: true,
        dailyDigestTime: true,
        personalTodoRetention: true,
        personalTodoRemindersEnabled: true,
      },
    });

    return {
      dailyDigestEnabled: user?.dailyDigestEnabled ?? false,
      dailyDigestTime: user?.dailyDigestTime ?? DEFAULT_DAILY_DIGEST_TIME,
      personalTodoRetention: user?.personalTodoRetention ?? 'never',
      personalTodoRemindersEnabled: user?.personalTodoRemindersEnabled ?? true,
    };
  }

  async getUserConfig(userId: string): Promise<WorkspaceUserConfig> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        userConfigJson: true,
      },
    });

    return parseStoredWorkspaceUserConfig(user?.userConfigJson);
  }

  async updateUserConfig(
    actor: SessionUser,
    input: WorkspaceUserConfig,
  ): Promise<WorkspaceUserConfig> {
    const normalizedConfig = normalizeWorkspaceUserConfig(input);

    await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        userConfigJson: serializeWorkspaceUserConfig(normalizedConfig),
      },
    });

    return normalizedConfig;
  }

  async updateNotificationPreferences(
    actor: SessionUser,
    input: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferences> {
    await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        ...(input.dailyDigestEnabled !== undefined
          ? { dailyDigestEnabled: input.dailyDigestEnabled }
          : {}),
        ...(input.dailyDigestTime !== undefined
          ? { dailyDigestTime: input.dailyDigestTime }
          : {}),
        ...(input.personalTodoRetention !== undefined
          ? { personalTodoRetention: input.personalTodoRetention }
          : {}),
        ...(input.personalTodoRemindersEnabled !== undefined
          ? {
              personalTodoRemindersEnabled: input.personalTodoRemindersEnabled,
            }
          : {}),
      },
    });

    await this.recordAudit(
      actor,
      'auth',
      actor.id,
      'notification_preferences_updated',
      {
        ...(input.dailyDigestEnabled !== undefined
          ? { dailyDigestEnabled: input.dailyDigestEnabled }
          : {}),
        ...(input.dailyDigestTime !== undefined
          ? { dailyDigestTime: input.dailyDigestTime }
          : {}),
        ...(input.personalTodoRetention !== undefined
          ? { personalTodoRetention: input.personalTodoRetention }
          : {}),
        ...(input.personalTodoRemindersEnabled !== undefined
          ? {
              personalTodoRemindersEnabled: input.personalTodoRemindersEnabled,
            }
          : {}),
      },
    );

    return this.getNotificationPreferences(actor.id);
  }

  async resetUserSettings(
    actor: SessionUser,
  ): Promise<ResetUserSettingsResponse> {
    await this.prisma.user.update({
      where: { id: actor.id },
      data: {
        dailyDigestEnabled: false,
        dailyDigestTime: DEFAULT_DAILY_DIGEST_TIME,
        personalTodoRetention: 'never',
        personalTodoRemindersEnabled: true,
        userConfigJson: null,
      },
    });

    await this.recordAudit(actor, 'auth', actor.id, 'user_settings_reset', {
      dailyDigestEnabled: false,
      dailyDigestTime: DEFAULT_DAILY_DIGEST_TIME,
      personalTodoRetention: 'never',
      personalTodoRemindersEnabled: true,
    });

    return {
      notificationPreferences: {
        dailyDigestEnabled: false,
        dailyDigestTime: DEFAULT_DAILY_DIGEST_TIME,
        personalTodoRetention: 'never',
        personalTodoRemindersEnabled: true,
      },
      userConfig: createDefaultWorkspaceUserConfig(),
    };
  }

  async hashPassword(password: string) {
    this.requireLocalAuthMode();
    return bcrypt.hash(password, 10);
  }

  async verifyPassword(password: string, passwordHash: string) {
    return bcrypt.compare(password, passwordHash);
  }

  async recordAudit(
    actor: AuditActor,
    entityType: AuditEntityType,
    entityId: string,
    action: string,
    metadata?: Record<string, unknown>,
    prismaClient: AuditWriteClient = this.prisma,
  ) {
    await prismaClient.auditEvent.create({
      data: {
        actorEmail: actor.email,
        actorName: actor.name,
        actorRole: actor.role,
        actorUserId: actor.id,
        entityType,
        entityId,
        action,
        ...(metadata
          ? {
              metadata: metadata as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  }

  private isLocalAuthModeEnabled() {
    return (process.env.AUTH_MODE ?? LOCAL_AUTH_MODE) === LOCAL_AUTH_MODE;
  }

  private async clearPasswordResetOtp(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
      },
    });
  }
}
