import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { DEFAULT_LOCAL_USERS } from './default-local-users';
import { EmailService } from './email.service';
import { LocalAccountsService } from './local-accounts.service';
import { PrismaService } from './prisma.service';

type LocalAccountFixture = {
  createdAt: Date;
  email: string;
  id: string;
  name: string;
  passwordHash: string;
  roleAssignment: {
    role: Role;
  } | null;
  updatedAt: Date;
};

type PasswordUpdateCall = {
  data: {
    passwordHash: string;
  };
  where: {
    id: string;
  };
};

type UpdateUserCall = {
  data: Record<string, unknown>;
  include?: {
    roleAssignment: true;
  };
  where: {
    id: string;
  };
};

type CreateUserCall = {
  data: {
    email: string;
    name: string;
    passwordHash: string;
    roleAssignment: {
      create: {
        role: string;
      };
    };
  };
  include: {
    roleAssignment: true;
  };
};

const createUserFixture = (
  overrides: Partial<LocalAccountFixture> = {},
): LocalAccountFixture => ({
  createdAt: new Date('2026-02-01T10:00:00.000Z'),
  email: 'user@tavi.local',
  id: 'user-1',
  name: 'Tavi User',
  passwordHash: '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36t0iAfDdc/K1Ji/7luWGIN',
  roleAssignment: {
    role: Role.viewer,
  },
  updatedAt: new Date('2026-02-01T10:00:00.000Z'),
  ...overrides,
});

describe('LocalAccountsService', () => {
  const originalAuthMode = process.env.AUTH_MODE;
  const adminActor: SessionUser = {
    id: 'admin-1',
    email: 'admin@tavi.local',
    name: 'Tavi Admin',
    role: 'admin',
  };
  const editorActor: SessionUser = {
    id: 'editor-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const createService = () => {
    const findManyUsersMock = jest.fn();
    const findUniqueUserMock = jest.fn();
    const countRoleAssignmentsMock = jest.fn();
    const createUserMock: jest.MockedFunction<
      (args: CreateUserCall) => Promise<unknown>
    > = jest.fn();
    const updateUserMock: jest.MockedFunction<
      (args: UpdateUserCall) => Promise<unknown>
    > = jest.fn();
    const updateManyProjectMock = jest.fn();
    const updateManyTaskMock = jest.fn();
    const deleteUserMock = jest.fn();
    const createAuditEventTxMock = jest.fn(() => Promise.resolve());
    const tx = {
      auditEvent: {
        create: createAuditEventTxMock,
      },
      project: {
        updateMany: updateManyProjectMock,
      },
      roleAssignment: {
        count: countRoleAssignmentsMock,
      },
      task: {
        updateMany: updateManyTaskMock,
      },
      user: {
        create: createUserMock,
        delete: deleteUserMock,
        findMany: findManyUsersMock,
        update: updateUserMock,
      },
    };
    const transactionMock = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const prisma = {
      $transaction: transactionMock,
      auditEvent: {
        create: jest.fn(() => Promise.resolve()),
      },
      roleAssignment: {
        count: countRoleAssignmentsMock,
      },
      user: {
        findMany: findManyUsersMock,
        findUnique: findUniqueUserMock,
      },
    } as unknown as PrismaService;
    const authService = new AuthService(prisma);
    const sendAccountUpdateEmailMock = jest.fn(() => Promise.resolve(false));
    const sendPasswordEmailMock = jest.fn(() => Promise.resolve());
    const emailService = {
      sendAccountUpdateEmail: sendAccountUpdateEmailMock,
      sendPasswordEmail: sendPasswordEmailMock,
    } as unknown as EmailService;

    return {
      mocks: {
        countRoleAssignmentsMock,
        createAuditEventTxMock,
        createUserMock,
        deleteUserMock,
        findManyUsersMock,
        findUniqueUserMock,
        sendAccountUpdateEmailMock,
        sendPasswordEmailMock,
        transactionMock,
        tx,
        updateManyProjectMock,
        updateManyTaskMock,
        updateUserMock,
      },
      service: new LocalAccountsService(prisma, authService, emailService),
    };
  };

  beforeEach(() => {
    process.env.AUTH_MODE = 'local';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
      return;
    }

    process.env.AUTH_MODE = originalAuthMode;
  });

  it('lists local accounts for admins', async () => {
    const { mocks, service } = createService();

    mocks.findManyUsersMock.mockResolvedValue([
      createUserFixture({
        id: 'admin-1',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        roleAssignment: {
          role: Role.admin,
        },
      }),
      createUserFixture({
        id: 'editor-1',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
        roleAssignment: {
          role: Role.editor,
        },
      }),
    ]);

    const result = await service.listAccounts(adminActor);

    expect(result).toEqual([
      {
        id: 'admin-1',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        role: 'admin',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
      {
        id: 'editor-1',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
        role: 'editor',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
    ]);
    expect(mocks.findManyUsersMock).toHaveBeenCalledWith({
      include: {
        roleAssignment: true,
        _count: {
          select: {
            assignedTasks: true,
            ownedProjects: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });
  });

  it('exports local accounts for admins', async () => {
    const { mocks, service } = createService();

    mocks.findManyUsersMock.mockResolvedValue([
      createUserFixture({
        id: 'admin-1',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        roleAssignment: {
          role: Role.admin,
        },
      }),
      createUserFixture({
        id: 'editor-1',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
        roleAssignment: {
          role: Role.editor,
        },
      }),
    ]);

    await expect(service.exportAccounts(adminActor)).resolves.toEqual({
      accounts: [
        {
          email: 'admin@tavi.local',
          name: 'Tavi Admin',
          passwordHash: expect.any(String),
          role: 'admin',
        },
        {
          email: 'editor@tavi.local',
          name: 'Tavi Editor',
          passwordHash: expect.any(String),
          role: 'editor',
        },
      ],
    });
  });

  it('blocks non-admins from listing local accounts', async () => {
    const { service } = createService();

    await expect(service.listAccounts(editorActor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it.each([
    [
      'exporting accounts',
      (service: LocalAccountsService) => service.exportAccounts(editorActor),
    ],
    [
      'creating accounts',
      (service: LocalAccountsService) =>
        service.createAccount(
          {
            email: 'new.user@tavi.local',
            name: 'New User',
            password: 'new-password-123',
            role: 'viewer',
          },
          editorActor,
        ),
    ],
    [
      'importing accounts',
      (service: LocalAccountsService) =>
        service.importAccounts(
          {
            accounts: [
              {
                email: 'new.user@tavi.local',
                name: 'New User',
                password: 'new-password-123',
                role: 'viewer',
              },
            ],
          },
          editorActor,
        ),
    ],
    [
      'resetting default accounts',
      (service: LocalAccountsService) =>
        service.resetDefaultAccounts(editorActor),
    ],
    [
      'updating accounts',
      (service: LocalAccountsService) =>
        service.updateAccount(
          'user-2',
          {
            name: 'Updated User',
          },
          editorActor,
        ),
    ],
    [
      'deleting accounts',
      (service: LocalAccountsService) =>
        service.deleteAccount('user-2', {}, editorActor),
    ],
  ])('blocks non-admins from %s', async (_label, action) => {
    const { mocks, service } = createService();

    await expect(action(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.findUniqueUserMock).not.toHaveBeenCalled();
  });

  it('creates a local account and records an audit event', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValueOnce(null);
    mocks.createUserMock.mockResolvedValue(
      createUserFixture({
        id: 'user-2',
        email: 'new.user@tavi.local',
        name: 'New User',
        roleAssignment: {
          role: Role.editor,
        },
      }),
    );

    const result = await service.createAccount(
      {
        email: 'new.user@tavi.local',
        name: 'New User',
        password: 'new-password-123',
        role: 'editor',
      },
      adminActor,
    );

    const createCall = mocks.createUserMock.mock.calls[0]?.[0] as
      | {
          data: {
            email: string;
            name: string;
            passwordHash: string;
            roleAssignment: {
              create: {
                role: string;
              };
            };
          };
          include: {
            roleAssignment: true;
          };
        }
      | undefined;

    if (!createCall) {
      throw new Error('Expected a create user call');
    }

    expect(createCall.data.email).toBe('new.user@tavi.local');
    expect(createCall.data.name).toBe('New User');
    expect(createCall.data.roleAssignment).toEqual({
      create: {
        role: 'editor',
      },
    });
    expect(createCall.include).toEqual({ roleAssignment: true });
    expect(typeof createCall.data.passwordHash).toBe('string');
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      id: 'user-2',
      email: 'new.user@tavi.local',
      name: 'New User',
      role: 'editor',
      createdAt: '2026-02-01T10:00:00.000Z',
      updatedAt: '2026-02-01T10:00:00.000Z',
    });
  });

  it('rejects duplicate account emails', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValueOnce({ id: 'user-existing' });

    await expect(
      service.createAccount(
        {
          email: 'admin@tavi.local',
          name: 'Duplicate',
          password: 'password-123',
          role: 'viewer',
        },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(mocks.createUserMock).not.toHaveBeenCalled();
  });

  it('imports local accounts with create, update, and unchanged outcomes', async () => {
    const { mocks, service } = createService();
    const existingAdmin = createUserFixture({
      id: 'admin-1',
      email: 'admin@tavi.local',
      name: 'Tavi Admin',
      roleAssignment: {
        role: Role.admin,
      },
    });
    const existingEditor = createUserFixture({
      id: 'editor-1',
      email: 'editor@tavi.local',
      name: 'Old Editor',
      roleAssignment: {
        role: Role.viewer,
      },
    });
    const existingViewer = createUserFixture({
      id: 'viewer-1',
      email: 'viewer@tavi.local',
      name: 'Tavi Viewer',
      roleAssignment: {
        role: Role.viewer,
      },
    });

    mocks.findManyUsersMock.mockResolvedValueOnce([
      existingAdmin,
      existingEditor,
      existingViewer,
    ]);
    mocks.countRoleAssignmentsMock.mockResolvedValue(1);
    mocks.createUserMock.mockResolvedValue(
      createUserFixture({
        id: 'user-2',
        email: 'new.user@tavi.local',
        name: 'New User',
        roleAssignment: {
          role: Role.editor,
        },
      }),
    );
    mocks.updateUserMock.mockResolvedValue(
      createUserFixture({
        ...existingEditor,
        name: 'Tavi Editor',
        roleAssignment: {
          role: Role.editor,
        },
      }),
    );

    const result = await service.importAccounts(
      {
        accounts: [
          {
            email: 'admin@tavi.local',
            name: 'Tavi Admin',
            password: '',
            role: 'admin',
          },
          {
            email: 'editor@tavi.local',
            name: 'Tavi Editor',
            password: '',
            role: 'editor',
          },
          {
            email: 'new.user@tavi.local',
            name: 'New User',
            password: 'new-password-123',
            role: 'editor',
          },
        ],
      },
      adminActor,
    );

    expect(mocks.findManyUsersMock).toHaveBeenCalledWith({
      where: {
        email: {
          in: ['admin@tavi.local', 'editor@tavi.local', 'new.user@tavi.local'],
        },
      },
      include: { roleAssignment: true },
    });
    expect(mocks.countRoleAssignmentsMock).toHaveBeenCalledWith({
      where: { role: Role.admin },
    });
    expect(mocks.createUserMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateUserMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateUserMock).toHaveBeenCalledWith({
      where: { id: 'editor-1' },
      data: {
        name: 'Tavi Editor',
        roleAssignment: {
          upsert: {
            create: {
              role: 'editor',
            },
            update: {
              role: 'editor',
            },
          },
        },
      },
      include: { roleAssignment: true },
    });
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      accounts: [
        {
          id: 'admin-1',
          email: 'admin@tavi.local',
          name: 'Tavi Admin',
          role: 'admin',
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-02-01T10:00:00.000Z',
        },
        {
          id: 'editor-1',
          email: 'editor@tavi.local',
          name: 'Tavi Editor',
          role: 'editor',
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-02-01T10:00:00.000Z',
        },
        {
          id: 'user-2',
          email: 'new.user@tavi.local',
          name: 'New User',
          role: 'editor',
          createdAt: '2026-02-01T10:00:00.000Z',
          updatedAt: '2026-02-01T10:00:00.000Z',
        },
      ],
      summary: {
        processed: 3,
        created: 1,
        updated: 1,
        unchanged: 1,
      },
    });
  });

  it('requires passwords when importing new local accounts', async () => {
    const { mocks, service } = createService();

    mocks.findManyUsersMock.mockResolvedValueOnce([]);
    mocks.countRoleAssignmentsMock.mockResolvedValue(1);

    await expect(
      service.importAccounts(
        {
          accounts: [
            {
              email: 'new.user@tavi.local',
              name: 'New User',
              password: '',
              role: 'viewer',
            },
          ],
        },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.createUserMock).not.toHaveBeenCalled();
  });

  it('accepts a password hash when importing a new local account', async () => {
    const { mocks, service } = createService();

    mocks.findManyUsersMock.mockResolvedValueOnce([]);
    mocks.countRoleAssignmentsMock.mockResolvedValue(1);
    mocks.createUserMock.mockResolvedValue(
      createUserFixture({
        id: 'user-2',
        email: 'new.user@tavi.local',
        name: 'New User',
        roleAssignment: {
          role: Role.viewer,
        },
      }),
    );

    await service.importAccounts(
      {
        accounts: [
          {
            email: 'new.user@tavi.local',
            name: 'New User',
            passwordHash: '$2b$10$abcdefghijklmnopqrstuuC6f4Wj1F0m1YJmQxvQhW2i5Y6nZ9e6',
            role: 'viewer',
          },
        ],
      },
      adminActor,
    );

    const createCall = mocks.createUserMock.mock.calls[0]?.[0];

    if (!createCall) {
      throw new Error('Expected a create user call');
    }

    expect(createCall.data.passwordHash).toBe(
      '$2b$10$abcdefghijklmnopqrstuuC6f4Wj1F0m1YJmQxvQhW2i5Y6nZ9e6',
    );
  });

  it('uses an imported password hash for existing accounts when provided', async () => {
    const { mocks, service } = createService();
    const existingEditor = createUserFixture({
      id: 'editor-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      roleAssignment: {
        role: Role.editor,
      },
    });

    mocks.findManyUsersMock.mockResolvedValueOnce([existingEditor]);
    mocks.countRoleAssignmentsMock.mockResolvedValue(1);
    mocks.updateUserMock.mockResolvedValue(existingEditor);

    await service.importAccounts(
      {
        accounts: [
          {
            email: 'editor@tavi.local',
            name: 'Tavi Editor',
            passwordHash:
              '$2b$10$abcdefghijklmnopqrstuuC6f4Wj1F0m1YJmQxvQhW2i5Y6nZ9e6',
            role: 'editor',
          },
        ],
      },
      adminActor,
    );

    const updatePasswordCall = mocks.updateUserMock.mock.calls[0]?.[0];

    if (!updatePasswordCall) {
      throw new Error('Expected an import password update call');
    }

    expect(updatePasswordCall.data.passwordHash).toBe(
      '$2b$10$abcdefghijklmnopqrstuuC6f4Wj1F0m1YJmQxvQhW2i5Y6nZ9e6',
    );
  });

  it('updates imported account passwords when a non-empty password is provided', async () => {
    const { mocks, service } = createService();
    const existingEditor = createUserFixture({
      id: 'editor-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      roleAssignment: {
        role: Role.editor,
      },
    });

    mocks.findManyUsersMock.mockResolvedValueOnce([existingEditor]);
    mocks.countRoleAssignmentsMock.mockResolvedValue(1);
    mocks.updateUserMock.mockResolvedValue(existingEditor);

    await service.importAccounts(
      {
        accounts: [
          {
            email: 'editor@tavi.local',
            name: 'Tavi Editor',
            password: 'replacement-password-123',
            role: 'editor',
          },
        ],
      },
      adminActor,
    );

    const updatePasswordCall = mocks.updateUserMock.mock.calls[0]?.[0];

    if (!updatePasswordCall) {
      throw new Error('Expected an import password update call');
    }

    expect(updatePasswordCall.where).toEqual({ id: 'editor-1' });
    expect(typeof updatePasswordCall.data.passwordHash).toBe('string');
    expect(updatePasswordCall.include).toEqual({ roleAssignment: true });
  });

  it('updates account identity fields and role', async () => {
    const { mocks, service } = createService();
    const existing = createUserFixture({
      id: 'user-2',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      roleAssignment: {
        role: Role.editor,
      },
    });

    mocks.findUniqueUserMock
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null);
    mocks.sendAccountUpdateEmailMock.mockResolvedValue(true);
    mocks.updateUserMock.mockResolvedValue(
      createUserFixture({
        ...existing,
        email: 'editor.renamed@tavi.local',
        name: 'Updated Editor',
        roleAssignment: {
          role: Role.viewer,
        },
      }),
    );

    const result = await service.updateAccount(
      'user-2',
      {
        email: 'editor.renamed@tavi.local',
        name: 'Updated Editor',
        role: 'viewer',
      },
      adminActor,
    );

    expect(mocks.updateUserMock).toHaveBeenCalledWith({
      where: { id: 'user-2' },
      data: {
        email: 'editor.renamed@tavi.local',
        name: 'Updated Editor',
        roleAssignment: {
          upsert: {
            create: {
              role: 'viewer',
            },
            update: {
              role: 'viewer',
            },
          },
        },
      },
      include: { roleAssignment: true },
    });
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendAccountUpdateEmailMock).toHaveBeenCalledWith(
      {
        email: 'editor.renamed@tavi.local',
        name: 'Updated Editor',
      },
      ['email', 'name', 'role'],
    );
    expect(result.account.role).toBe('viewer');
    expect(result.notificationEmailSent).toBe(true);
  });

  it('prevents demoting the last admin account', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue(
      createUserFixture({
        id: 'admin-1',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        roleAssignment: {
          role: Role.admin,
        },
      }),
    );
    mocks.countRoleAssignmentsMock.mockResolvedValue(1);

    await expect(
      service.updateAccount(
        'admin-1',
        {
          role: 'viewer',
        },
        adminActor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.updateUserMock).not.toHaveBeenCalled();
  });

  it('resets another user password for admins', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue(
      createUserFixture({
        id: 'user-2',
        email: 'viewer@tavi.local',
        name: 'Tavi Viewer',
      }),
    );
    mocks.updateUserMock.mockResolvedValue({ id: 'user-2' });

    await service.setAccountPassword(
      'user-2',
      {
        password: 'replacement-password-123',
      },
      adminActor,
    );

    const updatePasswordCall = mocks.updateUserMock.mock.calls[0]?.[0] as
      | PasswordUpdateCall
      | undefined;

    if (!updatePasswordCall) {
      throw new Error('Expected a password update call');
    }

    expect(updatePasswordCall.where).toEqual({ id: 'user-2' });
    expect(typeof updatePasswordCall.data.passwordHash).toBe('string');
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(1);
  });

  it('changes the current user password after reauthenticating with the current password', async () => {
    const { mocks, service } = createService();
    const passwordHash = await bcrypt.hash('current-password-123', 10);
    const existing = createUserFixture({
      id: editorActor.id,
      email: editorActor.email,
      name: editorActor.name,
      passwordHash,
    });

    mocks.findUniqueUserMock.mockResolvedValue(existing);
    mocks.updateUserMock.mockResolvedValue({ id: editorActor.id });

    await service.setOwnPassword(
      {
        currentPassword: 'current-password-123',
        password: 'password-456',
      },
      editorActor,
    );

    const updatePasswordCall = mocks.updateUserMock.mock.calls[0]?.[0] as
      | PasswordUpdateCall
      | undefined;

    if (!updatePasswordCall) {
      throw new Error('Expected a self password update call');
    }

    expect(updatePasswordCall.where).toEqual({ id: editorActor.id });
    expect(typeof updatePasswordCall.data.passwordHash).toBe('string');
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(1);
  });

  it('updates the current user profile and password in one self-service request', async () => {
    const { mocks, service } = createService();
    const passwordHash = await bcrypt.hash('current-password-123', 10);
    const existing = createUserFixture({
      id: editorActor.id,
      email: editorActor.email,
      name: editorActor.name,
      passwordHash,
      roleAssignment: {
        role: Role.editor,
      },
    });
    const updated = createUserFixture({
      id: editorActor.id,
      email: 'renamed@tavi.local',
      name: 'Renamed Editor',
      roleAssignment: {
        role: Role.editor,
      },
    });

    mocks.findUniqueUserMock
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    mocks.updateUserMock
      .mockResolvedValueOnce(updated)
      .mockResolvedValueOnce(updated);

    const result = await service.updateOwnProfile(
      {
        currentPassword: 'current-password-123',
        email: 'renamed@tavi.local',
        name: 'Renamed Editor',
        password: 'password-456',
      },
      editorActor,
    );

    expect(result.notificationEmailSent).toBe(false);
    expect(result.account.email).toBe('renamed@tavi.local');
    expect(result.account.name).toBe('Renamed Editor');
    expect(mocks.updateUserMock).toHaveBeenCalledTimes(2);
    expect(mocks.updateUserMock).toHaveBeenNthCalledWith(1, {
      where: { id: editorActor.id },
      data: {
        email: 'renamed@tavi.local',
        name: 'Renamed Editor',
      },
      include: { roleAssignment: true },
    });
    expect(mocks.updateUserMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: editorActor.id },
        include: { roleAssignment: true },
      }),
    );
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(1);
    expect(mocks.sendAccountUpdateEmailMock).not.toHaveBeenCalled();
  });

  it('blocks non-admins from setting another user password', async () => {
    const { mocks, service } = createService();

    await expect(
      service.setAccountPassword(
        'user-2',
        {
          password: 'password-456',
        },
        editorActor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.findUniqueUserMock).not.toHaveBeenCalled();
  });

  it('rejects reusing the current password for self-service password changes', async () => {
    const { mocks, service } = createService();
    const passwordHash = await bcrypt.hash('password-123', 10);

    mocks.findUniqueUserMock.mockResolvedValue(
      createUserFixture({
        id: editorActor.id,
        email: editorActor.email,
        name: editorActor.name,
        passwordHash,
      }),
    );

    await expect(
      service.setOwnPassword(
        {
          currentPassword: 'password-123',
          password: 'password-123',
        },
        editorActor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.updateUserMock).not.toHaveBeenCalled();
  });

  it('resets the default local accounts without deleting unrelated accounts', async () => {
    const { mocks, service } = createService();
    const existingAdmin = createUserFixture({
      id: 'admin-1',
      email: 'admin@tavi.local',
      name: 'Changed Admin',
      roleAssignment: {
        role: Role.viewer,
      },
    });

    mocks.findManyUsersMock.mockResolvedValueOnce([existingAdmin]);
    mocks.createUserMock
      .mockResolvedValueOnce(
        createUserFixture({
          id: 'editor-1',
          email: 'editor@tavi.local',
          name: 'Tavi Editor',
          roleAssignment: {
            role: Role.editor,
          },
        }),
      )
      .mockResolvedValueOnce(
        createUserFixture({
          id: 'viewer-1',
          email: 'viewer@tavi.local',
          name: 'Tavi Viewer',
          roleAssignment: {
            role: Role.viewer,
          },
        }),
      );
    mocks.updateUserMock.mockResolvedValue(
      createUserFixture({
        id: 'admin-1',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        roleAssignment: {
          role: Role.admin,
        },
      }),
    );

    const result = await service.resetDefaultAccounts(adminActor);

    expect(mocks.findManyUsersMock).toHaveBeenCalledWith({
      where: {
        email: {
          in: DEFAULT_LOCAL_USERS.map((user) => user.email),
        },
      },
      include: { roleAssignment: true },
    });
    const resetUpdateCall = mocks.updateUserMock.mock.calls[0]?.[0];

    if (!resetUpdateCall) {
      throw new Error('Expected a default reset update call');
    }

    expect(resetUpdateCall.where).toEqual({ id: 'admin-1' });
    expect(resetUpdateCall.data).toMatchObject({
      name: 'Tavi Admin',
      roleAssignment: {
        upsert: {
          create: {
            role: 'admin',
          },
          update: {
            role: 'admin',
          },
        },
      },
    });
    expect(typeof resetUpdateCall.data.passwordHash).toBe('string');
    expect(resetUpdateCall.include).toEqual({ roleAssignment: true });
    expect(mocks.createUserMock).toHaveBeenCalledTimes(2);
    expect(mocks.deleteUserMock).not.toHaveBeenCalled();
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(3);
    expect(result.accounts).toEqual([
      {
        id: 'admin-1',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
        role: 'admin',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
      {
        id: 'editor-1',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
        role: 'editor',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
      {
        id: 'viewer-1',
        email: 'viewer@tavi.local',
        name: 'Tavi Viewer',
        role: 'viewer',
        createdAt: '2026-02-01T10:00:00.000Z',
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
    ]);
  });

  it('deletes unused non-admin accounts', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue(
      Object.assign(
        createUserFixture({
          id: 'user-3',
          email: 'remove.me@tavi.local',
          name: 'Remove Me',
          roleAssignment: {
            role: Role.viewer,
          },
        }),
        {
          _count: {
            assignedTasks: 0,
            ownedProjects: 0,
          },
        },
      ),
    );

    const result = await service.deleteAccount('user-3', {}, adminActor);

    expect(result).toEqual({ id: 'user-3' });
    expect(mocks.deleteUserMock).toHaveBeenCalledWith({
      where: { id: 'user-3' },
    });
    expect(mocks.updateManyTaskMock).not.toHaveBeenCalled();
    expect(mocks.createAuditEventTxMock).toHaveBeenCalledTimes(1);
  });

  it('reassigns assigned tasks before deleting an account', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock
      .mockResolvedValueOnce(
        Object.assign(
          createUserFixture({
            id: 'user-4',
            email: 'busy.user@tavi.local',
            name: 'Busy User',
            roleAssignment: {
              role: Role.viewer,
            },
          }),
          {
            _count: {
              assignedTasks: 2,
              ownedProjects: 0,
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        createUserFixture({
          id: 'user-9',
          email: 'new.assignee@tavi.local',
          name: 'New Assignee',
          roleAssignment: {
            role: Role.editor,
          },
        }),
      );

    const result = await service.deleteAccount(
      'user-4',
      { nextTaskAssigneeUserId: 'user-9' },
      adminActor,
    );

    expect(result).toEqual({ id: 'user-4' });
    expect(mocks.updateManyProjectMock).not.toHaveBeenCalled();
    expect(mocks.updateManyTaskMock).toHaveBeenCalledWith({
      where: { assigneeUserId: 'user-4' },
      data: { assigneeUserId: 'user-9' },
    });
    expect(mocks.deleteUserMock).toHaveBeenCalledWith({
      where: { id: 'user-4' },
    });
  });

  it('reassigns owned projects before deleting an account', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock
      .mockResolvedValueOnce(
        Object.assign(
          createUserFixture({
            id: 'user-4',
            email: 'owner.user@tavi.local',
            name: 'Owner User',
            roleAssignment: {
              role: Role.viewer,
            },
          }),
          {
            _count: {
              assignedTasks: 0,
              ownedProjects: 2,
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        createUserFixture({
          id: 'user-9',
          email: 'new.owner@tavi.local',
          name: 'New Owner',
          roleAssignment: {
            role: Role.editor,
          },
        }),
      );

    const result = await service.deleteAccount(
      'user-4',
      { nextProjectOwnerUserId: 'user-9' },
      adminActor,
    );

    expect(result).toEqual({ id: 'user-4' });
    expect(mocks.updateManyProjectMock).toHaveBeenCalledWith({
      where: { ownerUserId: 'user-4' },
      data: { ownerUserId: 'user-9' },
    });
    expect(mocks.updateManyTaskMock).not.toHaveBeenCalled();
    expect(mocks.deleteUserMock).toHaveBeenCalledWith({
      where: { id: 'user-4' },
    });
  });

  it('clears owned projects before deleting an account', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue(
      Object.assign(
        createUserFixture({
          id: 'user-4',
          email: 'owner.user@tavi.local',
          name: 'Owner User',
          roleAssignment: {
            role: Role.viewer,
          },
        }),
        {
          _count: {
            assignedTasks: 0,
            ownedProjects: 2,
          },
        },
      ),
    );

    const result = await service.deleteAccount(
      'user-4',
      { nextProjectOwnerUserId: null },
      adminActor,
    );

    expect(result).toEqual({ id: 'user-4' });
    expect(mocks.updateManyProjectMock).toHaveBeenCalledWith({
      where: { ownerUserId: 'user-4' },
      data: { ownerUserId: null },
    });
    expect(mocks.updateManyTaskMock).not.toHaveBeenCalled();
    expect(mocks.deleteUserMock).toHaveBeenCalledWith({
      where: { id: 'user-4' },
    });
  });

  it('clears assigned tasks before deleting an account', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue(
      Object.assign(
        createUserFixture({
          id: 'user-4',
          email: 'busy.user@tavi.local',
          name: 'Busy User',
          roleAssignment: {
            role: Role.viewer,
          },
        }),
        {
          _count: {
            assignedTasks: 2,
            ownedProjects: 0,
          },
        },
      ),
    );

    const result = await service.deleteAccount(
      'user-4',
      { nextTaskAssigneeUserId: null },
      adminActor,
    );

    expect(result).toEqual({ id: 'user-4' });
    expect(mocks.updateManyProjectMock).not.toHaveBeenCalled();
    expect(mocks.updateManyTaskMock).toHaveBeenCalledWith({
      where: { assigneeUserId: 'user-4' },
      data: { assigneeUserId: null },
    });
    expect(mocks.deleteUserMock).toHaveBeenCalledWith({
      where: { id: 'user-4' },
    });
  });

  it('blocks deleting accounts with related data', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue(
      Object.assign(
        createUserFixture({
          id: 'user-4',
          email: 'busy.user@tavi.local',
          name: 'Busy User',
          roleAssignment: {
            role: Role.viewer,
          },
        }),
        {
          _count: {
            assignedTasks: 2,
            ownedProjects: 1,
          },
        },
      ),
    );

    await expect(
      service.deleteAccount('user-4', {}, adminActor),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.deleteUserMock).not.toHaveBeenCalled();
  });

  it('blocks local account management when local auth is disabled', async () => {
    process.env.AUTH_MODE = 'sso';
    const { service } = createService();

    await expect(service.listAccounts(adminActor)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
