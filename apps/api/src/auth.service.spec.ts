import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import {
  DEFAULT_LOCAL_USERS,
  DEFAULT_LOCAL_USER_PASSWORD,
} from './default-local-users';
import { PrismaService } from './prisma.service';

describe('AuthService', () => {
  const originalAuthMode = process.env.AUTH_MODE;
  type AuditEventCreateCall = [
    {
      data: {
        action: string;
        entityId: string;
        metadata?: {
          emailKind?: string;
          recipientEmail?: string;
        };
      };
    },
  ];

  const createService = () => {
    type AuthServicePrismaMock = {
      $transaction: (
        callback: (tx: AuthServicePrismaMock) => unknown,
      ) => Promise<unknown>;
      auditEvent: {
        create: jest.Mock;
      };
      user: {
        findMany: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
      };
    };
    const findManyUsersMock = jest.fn();
    const findUniqueUserMock = jest.fn();
    const updateUserMock = jest.fn();
    const auditEventCreateMock = jest.fn<Promise<void>, AuditEventCreateCall>(
      () => Promise.resolve(),
    );
    const prisma: AuthServicePrismaMock = {
      $transaction: jest.fn(
        (callback: (tx: AuthServicePrismaMock) => unknown) =>
          Promise.resolve(callback(prisma)),
      ),
      auditEvent: {
        create: auditEventCreateMock,
      },
      user: {
        findMany: findManyUsersMock,
        findUnique: findUniqueUserMock,
        update: updateUserMock,
      },
    };
    const assertPasswordResetEmailAvailableMock = jest.fn(() =>
      Promise.resolve(undefined),
    );
    const sendPasswordResetOtpEmailMock = jest.fn(() => Promise.resolve());

    return {
      assertPasswordResetEmailAvailableMock,
      auditEventCreateMock,
      findManyUsersMock,
      findUniqueUserMock,
      sendPasswordResetOtpEmailMock,
      updateUserMock,
      service: new AuthService(
        prisma as unknown as PrismaService,
        {
          assertPasswordResetEmailAvailable:
            assertPasswordResetEmailAvailableMock,
          sendPasswordResetOtpEmail: sendPasswordResetOtpEmailMock,
        } as never,
      ),
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

  it('reauthenticates the current local user with their password', async () => {
    process.env.AUTH_MODE = 'local';
    const { findUniqueUserMock, service } = createService();

    findUniqueUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@tavi.local',
      name: 'Admin User',
      passwordHash: await bcrypt.hash('current-password-123', 10),
      roleAssignment: {
        role: 'admin',
      },
    });

    await expect(
      service.reauthenticateCurrentUser('user-1', 'current-password-123'),
    ).resolves.toBeUndefined();
    expect(findUniqueUserMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      include: { roleAssignment: true },
    });
  });

  it('rejects reauthentication when the password is wrong', async () => {
    process.env.AUTH_MODE = 'local';
    const { findUniqueUserMock, service } = createService();

    findUniqueUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@tavi.local',
      name: 'Admin User',
      passwordHash: await bcrypt.hash('current-password-123', 10),
      roleAssignment: {
        role: 'admin',
      },
    });

    await expect(
      service.reauthenticateCurrentUser('user-1', 'wrong-password-123'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('emails a password reset one-time password for a known user', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      assertPasswordResetEmailAvailableMock,
      auditEventCreateMock,
      findUniqueUserMock,
      sendPasswordResetOtpEmailMock,
      updateUserMock,
      service,
    } = createService();

    findUniqueUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@tavi.local',
      name: 'Admin User',
      passwordHash: await bcrypt.hash('current-password-123', 10),
      roleAssignment: {
        role: 'admin',
      },
    });

    await service.requestPasswordReset('admin@tavi.local');

    expect(assertPasswordResetEmailAvailableMock).toHaveBeenCalledTimes(1);
    const [firstUpdateCall] = updateUserMock.mock.calls as Array<[unknown]>;
    const updateCall = firstUpdateCall?.[0] as
      | {
          where: { id: string };
          data: {
            passwordResetOtpHash: string;
            passwordResetOtpExpiresAt: Date;
          };
        }
      | undefined;

    if (!updateCall) {
      throw new Error('Expected a password reset update call');
    }

    expect(updateCall.where).toEqual({ id: 'user-1' });
    expect(typeof updateCall.data.passwordResetOtpHash).toBe('string');
    expect(updateCall.data.passwordResetOtpExpiresAt).toBeInstanceOf(Date);
    expect(sendPasswordResetOtpEmailMock).toHaveBeenCalledWith(
      { email: 'admin@tavi.local', name: 'Admin User' },
      expect.stringMatching(/^[0-9A-F]{4}-[0-9A-F]{4}$/),
      expect.any(Date),
      {
        actor: {
          email: 'admin@tavi.local',
          id: 'user-1',
          name: 'Admin User',
          role: 'admin',
        },
        entityId: 'user-1',
      },
    );
    const [firstAuditCall] = auditEventCreateMock.mock
      .calls as unknown as AuditEventCreateCall[];

    expect(firstAuditCall?.[0].data.action).toBe('password_reset_requested');
    expect(firstAuditCall?.[0].data.entityId).toBe('user-1');
  });

  it('does not reveal missing accounts during password reset requests', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      assertPasswordResetEmailAvailableMock,
      findUniqueUserMock,
      sendPasswordResetOtpEmailMock,
      updateUserMock,
      service,
    } = createService();

    findUniqueUserMock.mockResolvedValue(null);

    await expect(
      service.requestPasswordReset('missing@tavi.local'),
    ).resolves.toBeUndefined();

    expect(assertPasswordResetEmailAvailableMock).toHaveBeenCalledTimes(1);
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(sendPasswordResetOtpEmailMock).not.toHaveBeenCalled();
  });

  it('records failed password reset email attempts and clears the otp', async () => {
    process.env.AUTH_MODE = 'local';
    const {
      auditEventCreateMock,
      findUniqueUserMock,
      sendPasswordResetOtpEmailMock,
      updateUserMock,
      service,
    } = createService();

    findUniqueUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@tavi.local',
      name: 'Admin User',
      passwordHash: await bcrypt.hash('current-password-123', 10),
      roleAssignment: {
        role: 'admin',
      },
    });
    sendPasswordResetOtpEmailMock.mockRejectedValue(
      new Error('Unable to send password reset email'),
    );

    await expect(
      service.requestPasswordReset('admin@tavi.local'),
    ).rejects.toThrow('Unable to send password reset email');

    expect(updateUserMock).toHaveBeenCalledTimes(2);
    expect(auditEventCreateMock).not.toHaveBeenCalled();
  });

  it('resets a password with a valid one-time password', async () => {
    process.env.AUTH_MODE = 'local';
    const { findUniqueUserMock, updateUserMock, service } = createService();

    findUniqueUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@tavi.local',
      name: 'Admin User',
      passwordHash: await bcrypt.hash('current-password-123', 10),
      passwordResetOtpHash: await bcrypt.hash('ABCD-1234', 10),
      passwordResetOtpExpiresAt: new Date(Date.now() + 60_000),
      roleAssignment: {
        role: 'admin',
      },
    });

    await service.resetPasswordWithOtp({
      email: 'admin@tavi.local',
      oneTimePassword: 'ABCD-1234',
      password: 'new-password-123',
    });

    const [firstUpdateCall] = updateUserMock.mock.calls as Array<[unknown]>;
    const updateCall = firstUpdateCall?.[0] as
      | {
          where: { id: string };
          data: {
            passwordHash: string;
            passwordResetOtpHash: null;
            passwordResetOtpExpiresAt: null;
          };
        }
      | undefined;

    if (!updateCall) {
      throw new Error('Expected a password reset password update call');
    }

    expect(updateCall.where).toEqual({ id: 'user-1' });
    expect(typeof updateCall.data.passwordHash).toBe('string');
    expect(updateCall.data.passwordResetOtpHash).toBeNull();
    expect(updateCall.data.passwordResetOtpExpiresAt).toBeNull();
  });

  it('clears expired password reset codes before rejecting them', async () => {
    process.env.AUTH_MODE = 'local';
    const { findUniqueUserMock, updateUserMock, service } = createService();

    findUniqueUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@tavi.local',
      name: 'Admin User',
      passwordHash: await bcrypt.hash('current-password-123', 10),
      passwordResetOtpHash: await bcrypt.hash('ABCD-1234', 10),
      passwordResetOtpExpiresAt: new Date(Date.now() - 60_000),
      roleAssignment: {
        role: 'admin',
      },
    });

    await expect(
      service.resetPasswordWithOtp({
        email: 'admin@tavi.local',
        oneTimePassword: 'ABCD-1234',
        password: 'new-password-123',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        passwordResetOtpHash: null,
        passwordResetOtpExpiresAt: null,
      },
    });
  });

  it('rejects reusing the current password during password reset', async () => {
    process.env.AUTH_MODE = 'local';
    const { findUniqueUserMock, updateUserMock, service } = createService();
    const passwordHash = await bcrypt.hash('current-password-123', 10);

    findUniqueUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'admin@tavi.local',
      name: 'Admin User',
      passwordHash,
      passwordResetOtpHash: await bcrypt.hash('ABCD-1234', 10),
      passwordResetOtpExpiresAt: new Date(Date.now() + 60_000),
      roleAssignment: {
        role: 'admin',
      },
    });

    await expect(
      service.resetPasswordWithOtp({
        email: 'admin@tavi.local',
        oneTimePassword: 'ABCD-1234',
        password: 'current-password-123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns the current digest preference with the configured digest time', async () => {
    const { findUniqueUserMock, service } = createService();

    findUniqueUserMock.mockResolvedValue({
      dailyDigestEnabled: true,
      dailyDigestTime: '14:30',
      personalTodoRetention: 'three_months',
      personalTodoRemindersEnabled: false,
    });

    await expect(service.getNotificationPreferences('user-1')).resolves.toEqual(
      {
        dailyDigestEnabled: true,
        dailyDigestTime: '14:30',
        personalTodoRetention: 'three_months',
        personalTodoRemindersEnabled: false,
      },
    );
  });

  it('updates the current user digest preference and records an audit event', async () => {
    const { findUniqueUserMock, updateUserMock, service } = createService();
    const actor = {
      id: 'user-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      role: 'editor' as const,
    };

    updateUserMock.mockResolvedValue({
      id: actor.id,
    });
    findUniqueUserMock.mockResolvedValue({
      dailyDigestEnabled: true,
      dailyDigestTime: '11:00',
      personalTodoRetention: 'never',
      personalTodoRemindersEnabled: false,
    });

    await expect(
      service.updateNotificationPreferences(actor, {
        dailyDigestEnabled: true,
      }),
    ).resolves.toEqual({
      dailyDigestEnabled: true,
      dailyDigestTime: '11:00',
      personalTodoRetention: 'never',
      personalTodoRemindersEnabled: false,
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: {
        dailyDigestEnabled: true,
      },
    });
  });

  it('updates personal to do reminders without changing digest settings', async () => {
    const { findUniqueUserMock, updateUserMock, service } = createService();
    const actor = {
      id: 'user-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      role: 'editor' as const,
    };

    updateUserMock.mockResolvedValue({
      id: actor.id,
    });
    findUniqueUserMock.mockResolvedValue({
      dailyDigestEnabled: false,
      dailyDigestTime: '11:00',
      personalTodoRetention: 'never',
      personalTodoRemindersEnabled: false,
    });

    await expect(
      service.updateNotificationPreferences(actor, {
        personalTodoRemindersEnabled: false,
      }),
    ).resolves.toEqual({
      dailyDigestEnabled: false,
      dailyDigestTime: '11:00',
      personalTodoRetention: 'never',
      personalTodoRemindersEnabled: false,
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: {
        personalTodoRemindersEnabled: false,
      },
    });
  });

  it('updates the current user digest time without changing other preferences', async () => {
    const { findUniqueUserMock, updateUserMock, service } = createService();
    const actor = {
      id: 'user-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      role: 'editor' as const,
    };

    updateUserMock.mockResolvedValue({
      id: actor.id,
    });
    findUniqueUserMock.mockResolvedValue({
      dailyDigestEnabled: false,
      dailyDigestTime: '14:30',
      personalTodoRetention: 'never',
      personalTodoRemindersEnabled: true,
    });

    await expect(
      service.updateNotificationPreferences(actor, {
        dailyDigestTime: '14:30',
      }),
    ).resolves.toEqual({
      dailyDigestEnabled: false,
      dailyDigestTime: '14:30',
      personalTodoRetention: 'never',
      personalTodoRemindersEnabled: true,
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: {
        dailyDigestTime: '14:30',
      },
    });
  });

  it('updates personal todo retention without changing other preferences', async () => {
    const { findUniqueUserMock, updateUserMock, service } = createService();
    const actor = {
      id: 'user-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      role: 'editor' as const,
    };

    updateUserMock.mockResolvedValue({
      id: actor.id,
    });
    findUniqueUserMock.mockResolvedValue({
      dailyDigestEnabled: false,
      dailyDigestTime: '11:00',
      personalTodoRetention: 'delete_when_done',
      personalTodoRemindersEnabled: true,
    });

    await expect(
      service.updateNotificationPreferences(actor, {
        personalTodoRetention: 'delete_when_done',
      }),
    ).resolves.toEqual({
      dailyDigestEnabled: false,
      dailyDigestTime: '11:00',
      personalTodoRetention: 'delete_when_done',
      personalTodoRemindersEnabled: true,
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: {
        personalTodoRetention: 'delete_when_done',
      },
    });
  });

  it('returns the current server-backed user config', async () => {
    const { findUniqueUserMock, service } = createService();

    findUniqueUserMock.mockResolvedValue({
      userConfigJson: JSON.stringify({
        addTaskPanels: {
          'project-1': true,
        },
        collapsedGroups: {},
        filters: {
          assigneeUserIds: ['user-2'],
          groupBy: 'status',
          sortBy: ['priority'],
          statusFilters: ['blocked'],
        },
        hideDonePersonalTodos: true,
        hideDoneTasksByProject: {
          'project-1': true,
        },
        noteEditorHeights: {
          project: 240,
          task: 180,
        },
        panels: {
          backups: false,
          importExport: false,
          newProject: false,
          personalTodo: false,
          profile: true,
          settings: false,
          view: true,
        },
        preferences: {
          autoCollapse: false,
          bulkActions: true,
          fullWidth: true,
          theme: 'forest',
        },
      }),
    });

    await expect(service.getUserConfig('user-1')).resolves.toEqual({
      addTaskPanels: {
        'project-1': true,
      },
      collapsedGroups: {},
      filters: {
        assigneeUserIds: ['user-2'],
        groupBy: 'status',
        sortBy: ['priority'],
        statusFilters: ['blocked'],
      },
      hideDonePersonalTodos: true,
      hideDoneTasksByProject: {
        'project-1': true,
      },
      noteEditorHeights: {
        project: 240,
        task: 180,
      },
      panels: {
        backups: false,
        importExport: false,
        newProject: false,
        personalTodo: false,
        profile: true,
        settings: false,
        view: true,
      },
      preferences: {
        autoCollapse: false,
        bulkActions: true,
        fullWidth: true,
        theme: 'forest',
      },
    });
  });

  it('updates the current user server-backed config', async () => {
    const { updateUserMock, service } = createService();
    const actor = {
      id: 'user-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      role: 'editor' as const,
    };

    updateUserMock.mockResolvedValue({
      id: actor.id,
    });

    await expect(
      service.updateUserConfig(actor, {
        addTaskPanels: {
          'project-1': true,
        },
        collapsedGroups: {},
        filters: {
          assigneeUserIds: [],
          groupBy: 'owner',
          sortBy: [],
          statusFilters: [],
        },
        hideDonePersonalTodos: false,
        hideDoneTasksByProject: {},
        noteEditorHeights: {
          project: null,
          task: null,
        },
        panels: {
          backups: false,
          importExport: false,
          newProject: false,
          personalTodo: false,
          profile: true,
          settings: false,
          view: true,
        },
        preferences: {
          autoCollapse: true,
          bulkActions: false,
          fullWidth: false,
          theme: 'light',
        },
      }),
    ).resolves.toEqual({
      addTaskPanels: {
        'project-1': true,
      },
      collapsedGroups: {},
      filters: {
        assigneeUserIds: [],
        groupBy: 'owner',
        sortBy: [],
        statusFilters: [],
      },
      hideDonePersonalTodos: false,
      hideDoneTasksByProject: {},
      noteEditorHeights: {
        project: null,
        task: null,
      },
      panels: {
        backups: false,
        importExport: false,
        newProject: false,
        personalTodo: false,
        profile: true,
        settings: false,
        view: true,
      },
      preferences: {
        autoCollapse: true,
        bulkActions: false,
        fullWidth: false,
        theme: 'light',
      },
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: {
        userConfigJson: JSON.stringify({
          addTaskPanels: {
            'project-1': true,
          },
          collapsedGroups: {},
          filters: {
            assigneeUserIds: [],
            groupBy: 'owner',
            sortBy: [],
            statusFilters: [],
          },
          hideDonePersonalTodos: false,
          hideDoneTasksByProject: {},
          noteEditorHeights: {
            project: null,
            task: null,
          },
          panels: {
            backups: false,
            importExport: false,
            newProject: false,
            personalTodo: false,
            profile: true,
            settings: false,
            view: true,
          },
          preferences: {
            autoCollapse: true,
            bulkActions: false,
            fullWidth: false,
            theme: 'light',
          },
        }),
      },
    });
  });

  it('resets user settings back to defaults and records an audit event', async () => {
    const { auditEventCreateMock, updateUserMock, service } = createService();
    const actor = {
      id: 'user-1',
      email: 'editor@tavi.local',
      name: 'Tavi Editor',
      role: 'editor' as const,
    };

    updateUserMock.mockResolvedValue({
      id: actor.id,
    });

    await expect(service.resetUserSettings(actor)).resolves.toEqual({
      notificationPreferences: {
        dailyDigestEnabled: false,
        dailyDigestTime: '11:00',
        personalTodoRetention: 'never',
        personalTodoRemindersEnabled: true,
      },
      userConfig: {
        addTaskPanels: {},
        collapsedGroups: {},
        filters: {
          assigneeUserIds: [],
          groupBy: 'owner',
          sortBy: [],
          statusFilters: [],
        },
        hideDonePersonalTodos: false,
        hideDoneTasksByProject: {},
        noteEditorHeights: {
          project: null,
          task: null,
        },
        panels: {
          backups: false,
          importExport: false,
          newProject: false,
          personalTodo: false,
          profile: false,
          settings: false,
          view: false,
        },
        preferences: {
          autoCollapse: true,
          bulkActions: true,
          fullWidth: false,
          theme: 'light',
        },
      },
    });

    expect(updateUserMock).toHaveBeenCalledWith({
      where: { id: actor.id },
      data: {
        dailyDigestEnabled: false,
        dailyDigestTime: '11:00',
        personalTodoRetention: 'never',
        personalTodoRemindersEnabled: true,
        userConfigJson: null,
      },
    });
    expect(auditEventCreateMock).toHaveBeenCalledTimes(1);

    const auditCall = auditEventCreateMock.mock.calls[0]?.[0] as
      | AuditEventCreateCall[0]
      | undefined;

    expect(auditCall?.data.action).toBe('user_settings_reset');
    expect(auditCall?.data.entityId).toBe(actor.id);
  });
});
