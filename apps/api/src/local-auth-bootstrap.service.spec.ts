import bcrypt from 'bcryptjs';
import { LocalAuthBootstrapService } from './local-auth-bootstrap.service';
import type { AppLogger } from './app-logger';
import type { PrismaService } from './prisma.service';

type BootstrapTransactionClient = {
  $queryRaw: jest.Mock;
  roleAssignment: {
    upsert: jest.Mock;
  };
  user: {
    count: jest.Mock;
    upsert: jest.Mock;
  };
};

describe('LocalAuthBootstrapService', () => {
  const originalAuthMode = process.env.AUTH_MODE;

  const createService = () => {
    const queryRawMock = jest.fn();
    const countUsersMock = jest.fn();
    const logMock = jest.fn();
    const upsertUserMock = jest.fn();
    const upsertRoleAssignmentMock = jest.fn();
    const transactionClient: BootstrapTransactionClient = {
      $queryRaw: queryRawMock,
      roleAssignment: {
        upsert: upsertRoleAssignmentMock,
      },
      user: {
        count: countUsersMock,
        upsert: upsertUserMock,
      },
    };
    const transactionMock = jest.fn(
      (callback: (client: BootstrapTransactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
    const logger = {
      log: logMock,
    } as unknown as AppLogger;
    const prisma = {
      $transaction: transactionMock,
    } as unknown as PrismaService;

    return {
      countUsersMock,
      logger,
      logMock,
      prisma,
      queryRawMock,
      service: new LocalAuthBootstrapService(logger, prisma),
      transactionMock,
      upsertRoleAssignmentMock,
      upsertUserMock,
    };
  };

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
      return;
    }

    process.env.AUTH_MODE = originalAuthMode;
  });

  it('skips bootstrap when local auth is disabled', async () => {
    process.env.AUTH_MODE = 'sso';
    const { service, transactionMock } = createService();

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it('creates the initial admin and logs the generated password when there are no users', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      countUsersMock,
      logMock,
      queryRawMock,
      service,
      upsertRoleAssignmentMock,
      upsertUserMock,
    } = createService();

    queryRawMock.mockResolvedValue([{ locked: true }]);
    countUsersMock.mockResolvedValue(0);
    upsertUserMock.mockResolvedValue({ id: 'admin-user' });
    upsertRoleAssignmentMock.mockResolvedValue({});
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed-password' as never);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(upsertUserMock).toHaveBeenCalledWith({
      where: { email: 'admin@tavi.local' },
      update: {
        name: 'Tavi Admin',
        passwordHash: 'hashed-password',
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
      },
      create: {
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        passwordHash: 'hashed-password',
      },
    });
    expect(upsertRoleAssignmentMock).toHaveBeenCalledWith({
      where: { userId: 'admin-user' },
      update: { role: 'admin' },
      create: {
        userId: 'admin-user',
        role: 'admin',
      },
    });
    const [, bootstrapLogPayload] = logMock.mock.calls[0] as [
      string,
      {
        email: string;
        initialPassword: string;
        passwordSource: string;
      },
    ];

    expect(logMock).toHaveBeenCalledWith(
      'auth.bootstrap.initial_admin_created',
      expect.anything(),
    );
    expect(bootstrapLogPayload.email).toBe('admin@tavi.local');
    expect(bootstrapLogPayload.initialPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(bootstrapLogPayload.passwordSource).toBe('generated');
  });

  it('does not reseed when users already exist', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      countUsersMock,
      logMock,
      queryRawMock,
      service,
      upsertRoleAssignmentMock,
      upsertUserMock,
    } = createService();

    queryRawMock.mockResolvedValue([{ locked: true }]);
    countUsersMock.mockResolvedValue(2);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(upsertUserMock).not.toHaveBeenCalled();
    expect(upsertRoleAssignmentMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  it('does nothing when another instance already holds the bootstrap lock', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      countUsersMock,
      logMock,
      queryRawMock,
      service,
      upsertRoleAssignmentMock,
      upsertUserMock,
    } = createService();

    queryRawMock.mockResolvedValue([{ locked: false }]);

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();

    expect(countUsersMock).not.toHaveBeenCalled();
    expect(upsertUserMock).not.toHaveBeenCalled();
    expect(upsertRoleAssignmentMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });
});
