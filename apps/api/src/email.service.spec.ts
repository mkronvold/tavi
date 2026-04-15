import { EmailService } from './email.service';
import type { AppLogger } from './app-logger';
import type { PrismaService } from './prisma.service';

describe('EmailService', () => {
  const createService = (enabled: boolean | null = true) => {
    let currentEnabled = enabled;
    const upsertMock = jest.fn(
      ({
        create,
        update,
      }: {
        create: { enabled: boolean };
        update: { enabled: boolean };
      }) => {
        currentEnabled = update.enabled ?? create.enabled;
        return Promise.resolve({
          enabled: currentEnabled,
        });
      },
    );
    const prisma = {
      emailSettings: {
        findUnique: jest.fn(() =>
          Promise.resolve(
            currentEnabled === null
              ? null
              : {
                  enabled: currentEnabled,
                },
          ),
        ),
        upsert: upsertMock,
      },
    } as unknown as PrismaService;
    const warnMock = jest.fn();
    const logger = {
      error: jest.fn(),
      log: jest.fn(),
      warn: warnMock,
    } as unknown as AppLogger;
    const service = new EmailService(logger, prisma);
    const sendMail = jest.fn(() => Promise.resolve(undefined));

    Object.assign(service, {
      configured: true,
      fromAddress: 'noreply@tavi.local',
      homeUrl: 'http://localhost:5173',
      smtpHost: '10.120.64.99',
      smtpPort: 25,
      smtpSecure: false,
      transporter: {
        sendMail,
      },
    });

    return {
      logger,
      prisma,
      sendMail,
      service,
      upsertMock,
      warnMock,
    };
  };

  it('defaults email delivery to enabled when no settings record exists', async () => {
    const { service } = createService(null);

    await expect(service.getSmtpStatus()).resolves.toEqual({
      configured: true,
      enabled: true,
      fromAddress: 'noreply@tavi.local',
      host: '10.120.64.99',
      port: 25,
      secure: false,
    });
  });

  it('persists the global email delivery setting', async () => {
    const { service, upsertMock } = createService(true);

    await expect(service.setEmailEnabled(false)).resolves.toEqual({
      configured: true,
      enabled: false,
      fromAddress: 'noreply@tavi.local',
      host: '10.120.64.99',
      port: 25,
      secure: false,
    });
    expect(upsertMock).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: { enabled: false },
      create: {
        id: 'global',
        enabled: false,
      },
    });
  });

  it('skips all outbound email when delivery is disabled', async () => {
    const { sendMail, service, warnMock } = createService(false);

    await service.sendPasswordEmail(
      { email: 'viewer@tavi.local', name: 'Viewer' },
      'temp-password',
    );
    await expect(
      service.sendAccountUpdateEmail(
        { email: 'viewer@tavi.local', name: 'Viewer' },
        ['name'],
      ),
    ).resolves.toBe(false);

    expect(sendMail).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith(
      'Skipping password email — email delivery is disabled',
      'EmailService',
    );
    expect(warnMock).toHaveBeenCalledWith(
      'Skipping account update email — email delivery is disabled',
      'EmailService',
    );
  });
});
