import bcrypt from 'bcryptjs';
import { LocalAuthBootstrapService } from './local-auth-bootstrap.service';
import type { AppLogger } from './app-logger';
import type { PrismaService } from './prisma.service';

describe('LocalAuthBootstrapService', () => {
  const originalAuthMode = process.env.AUTH_MODE;

  const createService = () => {
    const queryRawMock = jest.fn();
    const countUsersMock = jest.fn();
    const upsertUserMock = jest.fn();
    const upsertRoleAssignmentMock = jest.fn();
    const transactionMock = jest.fn(async (callback) =>
      callback({
        $queryRaw: queryRawMock,
        roleAssignment: {
          upsert: upsertRoleAssignmentMock,
        },
        user: {
          count: countUsersMock,
          upsert: upsertUserMock,
        },
      }),
    );
    const logger = {
      log: jest.fn(),
    } as unknown as AppLogger;
    const prisma = {
      $transaction: transactionMock,
    } as unknown as PrismaService;

    return {
      countUsersMock,
      logger,
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
      logger,
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
    expect(logger.log).toHaveBeenCalledWith(
      'auth.bootstrap.initial_admin_created',
      expect.objectContaining({
        email: 'admin@tavi.local',
        initialPassword: expect.stringMatching(/^[A-Za-z0-9]{10}$/),
        passwordSource: 'generated',
      }),
    );
  });

  it('does not reseed when users already exist', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      countUsersMock,
      logger,
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
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('does nothing when another instance already holds the bootstrap lock', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      countUsersMock,
      logger,
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
    expect(logger.log).not.toHaveBeenCalled();
  });
});
