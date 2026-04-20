import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

jest.mock('@tavi/schemas', () => ({
  localLoginSchema: {},
  requestPasswordResetSchema: {},
  resetPasswordWithOtpSchema: {},
  updateEmailSettingsSchema: {},
  updateNotificationPreferencesSchema: {},
  workspaceUserConfigSchema: {},
}));

import { AuthController } from './auth.controller';
import type { AuthenticatedRequest, SessionUser } from './auth.types';

describe('AuthController', () => {
  const adminUser: SessionUser = {
    id: 'user-1',
    email: 'admin@tavi.local',
    name: 'Tavi Admin',
    role: 'admin',
  };

  const createController = () => {
    const requireAdminAccessMock = jest.fn();
    const resetUserSettingsMock = jest.fn(() =>
      Promise.resolve({
        notificationPreferences: {
          dailyDigestEnabled: false,
          dailyDigestTime: '11:00',
          personalTodoRemindersEnabled: true,
          personalTodoRetention: 'never',
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
      }),
    );
    const sendTestEmailMock = jest.fn(() => Promise.resolve());
    const authService = {
      requireAdminAccess: requireAdminAccessMock,
      resetUserSettings: resetUserSettingsMock,
    } as never;
    const emailService = {
      sendTestEmail: sendTestEmailMock,
    } as never;

    return {
      controller: new AuthController(authService, emailService),
      requireAdminAccessMock,
      resetUserSettingsMock,
      sendTestEmailMock,
    };
  };

  it('exposes the test email endpoint as POST auth/email/test', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const sendTestEmailHandler: object = AuthController.prototype.sendTestEmail;

    expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
    expect(Reflect.getMetadata(PATH_METADATA, sendTestEmailHandler)).toBe(
      'email/test',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, sendTestEmailHandler)).toBe(
      RequestMethod.POST,
    );
  });

  it('sends a test email to the signed-in admin user', async () => {
    const { controller, requireAdminAccessMock, sendTestEmailMock } =
      createController();
    const request = {
      user: adminUser,
    } as AuthenticatedRequest;

    await expect(controller.sendTestEmail(request)).resolves.toEqual({
      success: true,
    });

    expect(requireAdminAccessMock).toHaveBeenCalledWith(adminUser);
    expect(sendTestEmailMock).toHaveBeenCalledWith(
      {
        email: adminUser.email,
        name: adminUser.name,
      },
      adminUser,
    );
  });

  it('resets the signed-in user settings through POST auth/settings/reset', async () => {
    const { controller, resetUserSettingsMock } = createController();
    const request = {
      user: adminUser,
    } as AuthenticatedRequest;
    const resetUserSettingsHandler = Object.getOwnPropertyDescriptor(
      AuthController.prototype,
      'resetUserSettings',
    )?.value as object;

    expect(Reflect.getMetadata(PATH_METADATA, resetUserSettingsHandler)).toBe(
      'settings/reset',
    );
    expect(Reflect.getMetadata(METHOD_METADATA, resetUserSettingsHandler)).toBe(
      RequestMethod.POST,
    );

    await controller.resetUserSettings(request);

    expect(resetUserSettingsMock).toHaveBeenCalledWith(adminUser);
  });
});
