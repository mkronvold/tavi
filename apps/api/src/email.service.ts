import {
  Injectable,
  ServiceUnavailableException,
  type OnModuleInit,
} from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { SmtpStatus, UpdateEmailSettingsInput } from '@tavi/schemas';
import { AppLogger } from './app-logger';
import { buildEmailHtml, escapeHtml, parseSmtpUrl } from './email-helpers';
import { PrismaService } from './prisma.service';

const DEFAULT_SMTP_URL = 'smtp://10.120.64.99:25';
const DEFAULT_SMTP_FROM = 'noreply@tavi.local';
const EMAIL_SETTINGS_ID = 'global';
const DEFAULT_DAILY_DIGEST_TIME = '09:00';
const PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE =
  'Password reset email is unavailable right now';

type EmailRecipient = {
  email: string;
  name: string;
};

function buildPasswordEmailBody(password: string, homeUrl: string): string {
  return `Your account password has been set. Use the password below to sign in.

<div style="margin:16px 0;padding:14px 18px;background-color:#1e293b;border:1px solid #334155;border-radius:10px;font-family:monospace;font-size:16px;color:#e2e8f0;word-break:break-all;">
  ${escapeHtml(password)}
</div>

<p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">
  To change your password, sign in to <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi</a>,
  open <strong style="color:#e2e8f0;">Settings</strong>, expand <strong style="color:#e2e8f0;">Local Accounts</strong>,
  and use the <strong style="color:#e2e8f0;">My password</strong> section.
  </p>`;
}

function buildAccountUpdateEmailBody(
  changedFields: string[],
  homeUrl: string,
): string {
  const formattedFields = changedFields
    .map((field) => escapeHtml(field.replace(/_/g, ' ')))
    .join(', ');

  return `Your Tavi account was updated by an administrator.

<p style="margin:16px 0 0;">
  Updated fields: <strong style="color:#e2e8f0;">${formattedFields}</strong>
</p>

<p style="margin:12px 0 0;color:#94a3b8;font-size:14px;">
  Review your account in <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi</a>.
</p>`;
}

function buildPasswordResetOtpEmailBody(
  oneTimePassword: string,
  homeUrl: string,
  expiresAt: Date,
): string {
  return `A one-time password was requested to reset your Tavi password.

<div style="margin:16px 0;padding:14px 18px;background-color:#1e293b;border:1px solid #334155;border-radius:10px;font-family:monospace;font-size:18px;letter-spacing:0.08em;color:#e2e8f0;">
  ${escapeHtml(oneTimePassword)}
</div>

<p style="margin:12px 0 0;color:#94a3b8;font-size:14px;">
  This code expires at <strong style="color:#e2e8f0;">${escapeHtml(expiresAt.toISOString())}</strong>.
</p>

<p style="margin:12px 0 0;color:#94a3b8;font-size:14px;">
  Enter the code on the <a href="${homeUrl}" style="color:#a5b4fc;text-decoration:none;">Tavi login screen</a>, set a new password, and sign in again with that new password.
</p>`;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private transporter: Transporter<SMTPTransport.SentMessageInfo> | null = null;
  private smtpHost: string | null = null;
  private smtpPort: number | null = null;
  private smtpSecure = false;
  private fromAddress: string = DEFAULT_SMTP_FROM;
  private homeUrl: string = 'http://localhost:5173';
  private configured = false;

  constructor(
    private readonly logger: AppLogger,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const smtpUrl = process.env.SMTP_URL ?? DEFAULT_SMTP_URL;
    const smtpUser = process.env.SMTP_USER || undefined;
    const smtpPass = process.env.SMTP_PASS || undefined;
    this.fromAddress = process.env.SMTP_FROM ?? DEFAULT_SMTP_FROM;
    this.homeUrl = process.env.TAVI_HOME_URL ?? 'http://localhost:5173';

    try {
      const { host, port, secure } = parseSmtpUrl(smtpUrl);
      this.smtpHost = host;
      this.smtpPort = port;
      this.smtpSecure = secure;

      const auth =
        smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined;

      this.transporter = createTransport({
        host,
        port,
        secure,
        auth,
        tls: secure ? undefined : { rejectUnauthorized: false },
      });

      this.configured = true;
      this.logger.log(
        `Email transport configured: ${host}:${port} (${secure ? 'TLS' : 'plain'})`,
        'EmailService',
      );
    } catch (error) {
      this.configured = false;
      this.logger.warn(
        `Email transport not configured: ${error instanceof Error ? error.message : String(error)}`,
        'EmailService',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async getSmtpStatus(): Promise<SmtpStatus> {
    const settings = await this.readEmailSettings();

    return {
      dailyDigestTime: settings?.dailyDigestTime ?? DEFAULT_DAILY_DIGEST_TIME,
      dragHandlesEnabled: settings?.dragHandlesEnabled ?? true,
      enabled: settings?.enabled ?? true,
      configured: this.configured,
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpSecure,
      fromAddress: this.fromAddress,
    };
  }

  async updateEmailSettings(
    input: UpdateEmailSettingsInput,
  ): Promise<SmtpStatus> {
    await this.prisma.emailSettings.upsert({
      where: { id: EMAIL_SETTINGS_ID },
      update: {
        dailyDigestTime: input.dailyDigestTime,
        dragHandlesEnabled: input.dragHandlesEnabled,
        enabled: input.enabled,
      },
      create: {
        dailyDigestTime: input.dailyDigestTime,
        dragHandlesEnabled: input.dragHandlesEnabled,
        id: EMAIL_SETTINGS_ID,
        enabled: input.enabled,
      },
    });

    return this.getSmtpStatus();
  }

  async setEmailEnabled(enabled: boolean): Promise<SmtpStatus> {
    const settings = await this.readEmailSettings();

    return this.updateEmailSettings({
      dailyDigestTime: settings?.dailyDigestTime ?? DEFAULT_DAILY_DIGEST_TIME,
      dragHandlesEnabled: settings?.dragHandlesEnabled ?? true,
      enabled,
    });
  }

  async sendPasswordEmail(
    recipient: EmailRecipient,
    plainPassword: string,
  ): Promise<void> {
    const transporter = await this.getReadyTransport('password email');

    if (!transporter) {
      return;
    }

    const body = buildPasswordEmailBody(plainPassword, this.homeUrl);
    const html = buildEmailHtml(this.homeUrl, recipient.name, body);

    try {
      await transporter.sendMail({
        from: this.fromAddress,
        to: recipient.email,
        subject: 'Your Tavi account password',
        html,
      });

      this.logger.log(
        `Password email sent to ${recipient.email}`,
        'EmailService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to send password email to ${recipient.email}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'EmailService',
      );
      throw new Error('Unable to send password email');
    }
  }

  async sendAccountUpdateEmail(
    recipient: EmailRecipient,
    changedFields: string[],
  ): Promise<boolean> {
    const transporter = await this.getReadyTransport('account update email');

    if (!transporter) {
      return false;
    }

    const body = buildAccountUpdateEmailBody(changedFields, this.homeUrl);
    const html = buildEmailHtml(this.homeUrl, recipient.name, body);

    try {
      await transporter.sendMail({
        from: this.fromAddress,
        to: recipient.email,
        subject: 'Your Tavi account was updated',
        html,
      });

      this.logger.log(
        `Account update email sent to ${recipient.email}`,
        'EmailService',
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to send account update email to ${recipient.email}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'EmailService',
      );
      return false;
    }
  }

  async assertPasswordResetEmailAvailable(): Promise<void> {
    await this.getReadyTransport('password reset email', {
      ignoreEmailEnabled: true,
      throwWhenUnavailable: true,
    });
  }

  async sendPasswordResetOtpEmail(
    recipient: EmailRecipient,
    oneTimePassword: string,
    expiresAt: Date,
  ): Promise<void> {
    const transporter = await this.getReadyTransport('password reset email', {
      ignoreEmailEnabled: true,
      throwWhenUnavailable: true,
    });

    if (!transporter) {
      throw new ServiceUnavailableException(
        PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
      );
    }

    const body = buildPasswordResetOtpEmailBody(
      oneTimePassword,
      this.homeUrl,
      expiresAt,
    );
    const html = buildEmailHtml(this.homeUrl, recipient.name, body);

    try {
      await transporter.sendMail({
        from: this.fromAddress,
        to: recipient.email,
        subject: 'Your Tavi one-time password',
        html,
      });

      this.logger.log(
        `Password reset email sent to ${recipient.email}`,
        'EmailService',
      );
    } catch (error) {
      this.logger.error(
        `Failed to send password reset email to ${recipient.email}: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        'EmailService',
      );
      throw new Error('Unable to send password reset email');
    }
  }

  private async getReadyTransport(
    emailType:
      | 'account update email'
      | 'password email'
      | 'password reset email',
    options?: {
      ignoreEmailEnabled?: boolean;
      throwWhenUnavailable?: boolean;
    },
  ): Promise<Transporter<SMTPTransport.SentMessageInfo> | null> {
    if (!this.transporter) {
      if (options?.throwWhenUnavailable) {
        throw new ServiceUnavailableException(
          PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
        );
      }

      this.logger.warn(
        `Skipping ${emailType} — SMTP not configured`,
        'EmailService',
      );
      return null;
    }

    if (!options?.ignoreEmailEnabled) {
      const settings = await this.readEmailSettings();

      if (settings?.enabled === false) {
        if (options?.throwWhenUnavailable) {
          throw new ServiceUnavailableException(
            PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
          );
        }

        this.logger.warn(
          `Skipping ${emailType} — email delivery is disabled`,
          'EmailService',
        );
        return null;
      }
    }

    return this.transporter;
  }

  private readEmailSettings() {
    return this.prisma.emailSettings.findUnique({
      where: { id: EMAIL_SETTINGS_ID },
      select: {
        dailyDigestTime: true,
        dragHandlesEnabled: true,
        enabled: true,
      },
    });
  }
}

export {
  buildAccountUpdateEmailBody,
  buildEmailHtml,
  buildPasswordEmailBody,
  parseSmtpUrl,
  escapeHtml,
};
