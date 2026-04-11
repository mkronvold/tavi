import { ForbiddenException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import {
  DEFAULT_LOCAL_USERS,
  DEFAULT_LOCAL_USER_PASSWORD,
} from './default-local-users';
import { PrismaService } from './prisma.service';

describe('AuthService', () => {
  const originalAuthMode = process.env.AUTH_MODE;

  const createService = () => {
    const findManyUsersMock = jest.fn();
    const findUniqueUserMock = jest.fn();
    const prisma = {
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
      user: {
        findMany: findManyUsersMock,
        findUnique: findUniqueUserMock,
      },
    } as unknown as PrismaService;

    return {
      findManyUsersMock,
      findUniqueUserMock,
      service: new AuthService(prisma),
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

  it('rejects local login when AUTH_MODE is not local', async () => {
    process.env.AUTH_MODE = 'sso';
    const { findUniqueUserMock, service } = createService();

    await expect(
      service.login('user@tavi.local', 'password-123'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(findUniqueUserMock).not.toHaveBeenCalled();
  });

  it('shows the login hint when all default users still use default credentials', async () => {
    process.env.AUTH_MODE = 'local';
    const { findManyUsersMock, service } = createService();

    findManyUsersMock.mockResolvedValue(
      await Promise.all(
        DEFAULT_LOCAL_USERS.map(async (user) => ({
          email: user.email,
          passwordHash: await bcrypt.hash(DEFAULT_LOCAL_USER_PASSWORD, 10),
          roleAssignment: {
            role: user.role,
          },
        })),
      ),
    );

    await expect(service.getLocalLoginHintStatus()).resolves.toEqual({
      visible: true,
    });
  });

  it('hides the login hint when a default user is missing', async () => {
    process.env.AUTH_MODE = 'local';
    const { findManyUsersMock, service } = createService();

    findManyUsersMock.mockResolvedValue(
      await Promise.all(
        DEFAULT_LOCAL_USERS.slice(0, 2).map(async (user) => ({
          email: user.email,
          passwordHash: await bcrypt.hash(DEFAULT_LOCAL_USER_PASSWORD, 10),
          roleAssignment: {
            role: user.role,
          },
        })),
      ),
    );

    await expect(service.getLocalLoginHintStatus()).resolves.toEqual({
      visible: false,
    });
  });

  it('hides the login hint when a default user password changes', async () => {
    process.env.AUTH_MODE = 'local';
    const { findManyUsersMock, service } = createService();

    findManyUsersMock.mockResolvedValue(
      await Promise.all(
        DEFAULT_LOCAL_USERS.map(async (user, index) => ({
          email: user.email,
          passwordHash: await bcrypt.hash(
            index === 1
              ? 'different-password-123'
              : DEFAULT_LOCAL_USER_PASSWORD,
            10,
          ),
          roleAssignment: {
            role: user.role,
          },
        })),
      ),
    );

    await expect(service.getLocalLoginHintStatus()).resolves.toEqual({
      visible: false,
    });
  });

  it('hides the login hint when a default user can no longer authenticate', async () => {
    process.env.AUTH_MODE = 'local';
    const { findManyUsersMock, service } = createService();

    findManyUsersMock.mockResolvedValue(
      await Promise.all(
        DEFAULT_LOCAL_USERS.map(async (user, index) => ({
          email: user.email,
          passwordHash: await bcrypt.hash(DEFAULT_LOCAL_USER_PASSWORD, 10),
          roleAssignment: index === 2 ? null : { role: user.role },
        })),
      ),
    );

    await expect(service.getLocalLoginHintStatus()).resolves.toEqual({
      visible: false,
    });
  });

  it('hides the login hint when local auth is disabled', async () => {
    process.env.AUTH_MODE = 'sso';
    const { findManyUsersMock, service } = createService();

    await expect(service.getLocalLoginHintStatus()).resolves.toEqual({
      visible: false,
    });
    expect(findManyUsersMock).not.toHaveBeenCalled();
  });
});
