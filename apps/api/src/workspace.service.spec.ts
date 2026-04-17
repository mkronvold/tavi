import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { ProjectsService } from './projects.service';
import { SavedViewsService } from './saved-views.service';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  const currentUser: SessionUser = {
    id: 'user-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const createService = () => {
    const findUsersMock = jest.fn();
    const findProjectsMock = jest.fn();
    const countProjectsMock = jest.fn();
    const deleteProjectsMock = jest.fn();
    const createProjectMock = jest.fn();
    const countTasksMock = jest.fn();
    const createTaskMock = jest.fn();
    const findEmailSettingsMock = jest.fn();
    const findPersonalTodosMock = jest.fn();
    const transactionMock = jest.fn((callback: (tx: unknown) => unknown) =>
      Promise.resolve(
        callback({
          project: {
            count: countProjectsMock,
            create: createProjectMock,
            deleteMany: deleteProjectsMock,
          },
          task: {
            count: countTasksMock,
            create: createTaskMock,
          },
        }),
      ),
    );
    const listSavedViewsMock = jest.fn();
    const requireAdminAccessMock = jest.fn();
    const reauthenticateCurrentUserMock = jest.fn();
    const recordAuditMock = jest.fn();
    const recalculateProjectMock = jest.fn();
    const prisma = {
      $transaction: transactionMock,
      user: {
        findMany: findUsersMock,
      },
      project: {
        findMany: findProjectsMock,
      },
      emailSettings: {
        findUnique: findEmailSettingsMock,
      },
      personalTodo: {
        findMany: findPersonalTodosMock,
      },
    } as unknown as PrismaService;
    const savedViewsService = {
      listSavedViews: listSavedViewsMock,
    } as unknown as SavedViewsService;
    const authService = {
      requireAdminAccess: requireAdminAccessMock,
      reauthenticateCurrentUser: reauthenticateCurrentUserMock,
      recordAudit: recordAuditMock,
    } as unknown as AuthService;
    const projectsService = {
      recalculateProject: recalculateProjectMock,
    } as unknown as ProjectsService;

    return {
      mocks: {
        countProjectsMock,
        countTasksMock,
        createProjectMock,
        createTaskMock,
        deleteProjectsMock,
        findEmailSettingsMock,
        findPersonalTodosMock,
        findProjectsMock,
        findUsersMock,
        listSavedViewsMock,
        reauthenticateCurrentUserMock,
        recordAuditMock,
        recalculateProjectMock,
        requireAdminAccessMock,
        transactionMock,
      },
      service: new WorkspaceService(
        prisma,
        authService,
        projectsService,
        savedViewsService,
      ),
    };
  };

  it('includes project tracker links in workspace responses', async () => {
    const { mocks, service } = createService();

    mocks.findUsersMock.mockResolvedValue([
      {
        id: 'user-1',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
        roleAssignment: { role: 'editor' },
      },
    ]);
    mocks.findProjectsMock.mockResolvedValue([
      {
        id: 'project-1',
        title: 'Roadmap refresh',
        notes: null,
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        ownerUserId: 'user-1',
        owner: {
          name: 'Tavi Editor',
          roleAssignment: { role: 'editor' },
        },
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
        manualStatus: null,
        taskTotalCount: 0,
        taskTodoCount: 0,
        taskInProgressCount: 0,
        taskBlockedCount: 0,
        taskDoneCount: 0,
        taskCanceledCount: 0,
        taskOverdueCount: 0,
        tasks: [],
      },
    ]);
    mocks.findEmailSettingsMock.mockResolvedValue({
      dragHandlesEnabled: false,
    });
    mocks.findPersonalTodosMock.mockResolvedValue([
      {
        id: 'todo-1',
        title: 'Private follow-up',
        notes: 'Only visible to me',
        dueDate: null,
        status: 'todo',
        sortOrder: 0,
        completedAt: null,
        createdAt: new Date('2026-04-03T09:00:00.000Z'),
        updatedAt: new Date('2026-04-03T09:00:00.000Z'),
      },
    ]);
    mocks.listSavedViewsMock.mockResolvedValue([]);

    const result = await service.getWorkspace(currentUser);

    expect(result.workspaceSettings).toEqual({
      dragHandlesEnabled: false,
    });
    expect(result.projects).toEqual([
      expect.objectContaining({
        id: 'project-1',
        references: 'https://tracker.example.com/projects/roadmap-refresh',
      }),
    ]);
    expect(result.personalTodos).toEqual([
      expect.objectContaining({
        id: 'todo-1',
        title: 'Private follow-up',
      }),
    ]);
  });

  it('resets project and task data after admin password confirmation', async () => {
    const adminUser: SessionUser = {
      id: 'user-admin',
      email: 'admin@tavi.local',
      name: 'Tavi Admin',
      role: 'admin',
    };
    const { mocks, service } = createService();

    mocks.findUsersMock.mockResolvedValue([
      {
        id: 'user-admin',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
      },
      {
        id: 'user-editor',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
      },
      {
        id: 'user-viewer',
        email: 'viewer@tavi.local',
        name: 'Tavi Viewer',
      },
    ]);
    mocks.countProjectsMock.mockResolvedValue(2);
    mocks.countTasksMock.mockResolvedValue(5);
    mocks.deleteProjectsMock.mockResolvedValue({ count: 2 });
    mocks.createProjectMock
      .mockResolvedValueOnce({ id: 'project-1' })
      .mockResolvedValueOnce({ id: 'project-2' })
      .mockResolvedValueOnce({ id: 'project-3' })
      .mockResolvedValueOnce({ id: 'project-4' });

    const result = await service.resetWorkspaceExamples(
      { password: 'current-password-123' },
      adminUser,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(adminUser);
    expect(mocks.reauthenticateCurrentUserMock).toHaveBeenCalledWith(
      adminUser.id,
      'current-password-123',
    );
    expect(mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProjectsMock).toHaveBeenCalledWith({});
    expect(mocks.createProjectMock).toHaveBeenCalledTimes(4);
    expect(mocks.createTaskMock).toHaveBeenCalledTimes(11);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledTimes(4);
    expect(mocks.recordAuditMock).toHaveBeenCalledWith(
      adminUser,
      'auth',
      adminUser.id,
      'workspace_reset_examples',
      {
        createdProjectCount: 4,
        createdTaskCount: 11,
        deletedProjectCount: 2,
        deletedTaskCount: 5,
      },
      expect.any(Object),
    );
    expect(result).toEqual({
      createdProjectCount: 4,
      createdTaskCount: 11,
      deletedProjectCount: 2,
      deletedTaskCount: 5,
    });
  });
});
