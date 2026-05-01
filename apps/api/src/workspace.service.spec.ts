import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PersonalTodosService } from './personal-todos.service';
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
    const findCurrentUserMock = jest.fn();
    const createUserMock = jest.fn();
    const findProjectsMock = jest.fn();
    const findActiveProjectMock = jest.fn();
    const countProjectsMock = jest.fn();
    const deleteProjectsMock = jest.fn();
    const createProjectMock = jest.fn();
    const countTasksMock = jest.fn();
    const createTaskMock = jest.fn();
    const findEmailSettingsMock = jest.fn();
    const findPersonalTodosMock = jest.fn();
    const findProjectViewStatesMock = jest.fn().mockResolvedValue([]);
    const upsertProjectViewStateMock = jest.fn();
    const findAuditEventsMock = jest.fn().mockResolvedValue([]);
    type WorkspaceTransactionClient = {
      projectViewState: { upsert: typeof upsertProjectViewStateMock };
      project: {
        count: typeof countProjectsMock;
        create: typeof createProjectMock;
        deleteMany: typeof deleteProjectsMock;
      };
      task: {
        count: typeof countTasksMock;
        create: typeof createTaskMock;
      };
      user: {
        create: typeof createUserMock;
        findMany: typeof findUsersMock;
      };
    };
    const transactionMock = jest.fn(
      (
        input:
          | Array<Promise<unknown>>
          | ((tx: WorkspaceTransactionClient) => Promise<unknown>),
      ) => {
        if (Array.isArray(input)) {
          return Promise.all(input);
        }

        return Promise.resolve(
          input({
            projectViewState: {
              upsert: upsertProjectViewStateMock,
            },
            project: {
              count: countProjectsMock,
              create: createProjectMock,
              deleteMany: deleteProjectsMock,
            },
            task: {
              count: countTasksMock,
              create: createTaskMock,
            },
            user: {
              create: createUserMock,
              findMany: findUsersMock,
            },
          }),
        );
      },
    );
    const listSavedViewsMock = jest.fn();
    const pruneCompletedPersonalTodosForUserMock = jest.fn();
    const requireAdminAccessMock = jest.fn();
    const requireNonGuestAccessMock = jest.fn();
    const isGuestUserMock = jest.fn().mockReturnValue(false);
    const reauthenticateCurrentUserMock = jest.fn();
    const recordAuditMock = jest.fn();
    const hashPasswordMock = jest
      .fn()
      .mockImplementation((password: string) =>
        Promise.resolve(`hashed-${password}`),
      );
    const recalculateProjectMock = jest.fn();
    const prisma = {
      $transaction: transactionMock,
      user: {
        findMany: findUsersMock,
        findUnique: findCurrentUserMock,
      },
      project: {
        findFirst: findActiveProjectMock,
        findMany: findProjectsMock,
      },
      projectViewState: {
        findMany: findProjectViewStatesMock,
        upsert: upsertProjectViewStateMock,
      },
      auditEvent: {
        findMany: findAuditEventsMock,
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
      requireNonGuestAccess: requireNonGuestAccessMock,
      isGuestUser: isGuestUserMock,
      hashPassword: hashPasswordMock,
      reauthenticateCurrentUser: reauthenticateCurrentUserMock,
      recordAudit: recordAuditMock,
    } as unknown as AuthService;
    const projectsService = {
      recalculateProject: recalculateProjectMock,
    } as unknown as ProjectsService;
    const personalTodosService = {
      pruneCompletedPersonalTodosForUser:
        pruneCompletedPersonalTodosForUserMock,
    } as unknown as PersonalTodosService;

    return {
      mocks: {
        countProjectsMock,
        countTasksMock,
        createUserMock,
        createProjectMock,
        createTaskMock,
        deleteProjectsMock,
        findEmailSettingsMock,
        findActiveProjectMock,
        findAuditEventsMock,
        findPersonalTodosMock,
        findProjectViewStatesMock,
        findProjectsMock,
        findCurrentUserMock,
        findUsersMock,
        hashPasswordMock,
        isGuestUserMock,
        listSavedViewsMock,
        pruneCompletedPersonalTodosForUserMock,
        reauthenticateCurrentUserMock,
        recordAuditMock,
        recalculateProjectMock,
        requireAdminAccessMock,
        requireNonGuestAccessMock,
        upsertProjectViewStateMock,
        transactionMock,
      },
      service: new WorkspaceService(
        prisma,
        authService,
        projectsService,
        savedViewsService,
        personalTodosService,
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
    mocks.findCurrentUserMock.mockResolvedValue({
      userConfigJson: JSON.stringify({
        preferences: {
          autoCollapse: false,
          bulkActions: true,
          fullWidth: true,
          theme: 'forest',
        },
      }),
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

    expect(mocks.pruneCompletedPersonalTodosForUserMock).toHaveBeenCalledWith(
      currentUser.id,
    );
    expect(result.workspaceSettings).toEqual({
      dragHandlesEnabled: false,
    });
    expect(result.userConfig).toEqual(
      expect.objectContaining({
        preferences: {
          autoCollapse: false,
          bulkActions: true,
          fullWidth: true,
          theme: 'forest',
        },
      }),
    );
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

  it('flags other-user project and task changes as unviewed', async () => {
    const { mocks, service } = createService();
    const viewedAt = new Date('2026-04-03T10:00:00.000Z');

    mocks.findUsersMock.mockResolvedValue([]);
    mocks.findProjectsMock.mockResolvedValue([
      {
        id: 'project-1',
        title: 'Roadmap refresh',
        notes: null,
        references: null,
        ownerUserId: null,
        owner: null,
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
        manualStatus: null,
        taskTotalCount: 2,
        taskTodoCount: 2,
        taskInProgressCount: 0,
        taskBlockedCount: 0,
        taskDoneCount: 0,
        taskCanceledCount: 0,
        taskOverdueCount: 0,
        createdAt: new Date('2026-04-03T09:00:00.000Z'),
        updatedAt: new Date('2026-04-03T12:00:00.000Z'),
        tasks: [
          {
            id: 'task-1',
            projectId: 'project-1',
            title: 'Kickoff',
            notes: null,
            assigneeUserId: null,
            assignee: null,
            dueDate: null,
            priority: 'medium',
            status: 'not_started',
            sortOrder: 0,
            completedAt: null,
            createdAt: new Date('2026-04-03T09:30:00.000Z'),
            updatedAt: new Date('2026-04-03T11:00:00.000Z'),
          },
          {
            id: 'task-2',
            projectId: 'project-1',
            title: 'Review plan',
            notes: null,
            assigneeUserId: null,
            assignee: null,
            dueDate: null,
            priority: 'medium',
            status: 'not_started',
            sortOrder: 1,
            completedAt: null,
            createdAt: new Date('2026-04-03T09:45:00.000Z'),
            updatedAt: new Date('2026-04-03T11:30:00.000Z'),
          },
        ],
      },
    ]);
    mocks.findEmailSettingsMock.mockResolvedValue(null);
    mocks.findCurrentUserMock.mockResolvedValue({ userConfigJson: null });
    mocks.findPersonalTodosMock.mockResolvedValue([]);
    mocks.listSavedViewsMock.mockResolvedValue([]);
    mocks.findProjectViewStatesMock.mockResolvedValue([
      {
        projectId: 'project-1',
        viewedAt,
      },
    ]);
    mocks.findAuditEventsMock.mockResolvedValue([
      {
        entityType: 'task',
        entityId: 'task-1',
        createdAt: new Date('2026-04-03T11:00:00.000Z'),
      },
      {
        entityType: 'task',
        entityId: 'task-2',
        createdAt: new Date('2026-04-03T11:30:00.000Z'),
      },
      {
        entityType: 'project',
        entityId: 'project-1',
        createdAt: new Date('2026-04-03T09:30:00.000Z'),
      },
    ]);

    const result = await service.getWorkspace(currentUser);

    const actorOrMatcher: unknown = expect.arrayContaining([
      { actorUserId: null },
      { actorUserId: { not: currentUser.id } },
    ]);
    const actorFilterMatcher: unknown = expect.objectContaining({
      OR: actorOrMatcher,
    });
    const auditAndMatcher: unknown = expect.arrayContaining([
      actorFilterMatcher,
    ]);
    const auditWhereMatcher: unknown = expect.objectContaining({
      AND: auditAndMatcher,
    });
    const auditQueryMatcher: unknown = expect.objectContaining({
      where: auditWhereMatcher,
    });
    expect(mocks.findAuditEventsMock).toHaveBeenCalledWith(auditQueryMatcher);
    const project = result.projects[0];

    expect(project).toBeDefined();
    if (!project) {
      throw new Error('Expected project');
    }
    expect(project).toEqual(
      expect.objectContaining({
        hasUnviewedChanges: true,
        lastViewedAt: viewedAt,
      }),
    );
    expect(project.tasks[0]).toEqual(
      expect.objectContaining({
        hasUnviewedChanges: true,
      }),
    );
    expect(project.tasks[1]).toEqual(
      expect.objectContaining({
        hasUnviewedChanges: true,
      }),
    );
  });

  it('marks a single active project viewed for the current user', async () => {
    const { mocks, service } = createService();

    mocks.findActiveProjectMock.mockResolvedValue({ id: 'project-1' });
    mocks.upsertProjectViewStateMock.mockResolvedValue({});

    const result = await service.markProjectViewed('project-1', currentUser);

    expect(mocks.requireNonGuestAccessMock).toHaveBeenCalledWith(currentUser);
    expect(mocks.findActiveProjectMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        id: 'project-1',
      },
      select: { id: true },
    });
    const viewedAtDateMatcher: unknown = expect.any(Date);
    const createViewStateMatcher: unknown = expect.objectContaining({
      projectId: 'project-1',
      userId: currentUser.id,
    });
    const updateViewStateMatcher: unknown = expect.objectContaining({
      viewedAt: viewedAtDateMatcher,
    });
    const upsertViewStateMatcher: unknown = expect.objectContaining({
      create: createViewStateMatcher,
      update: updateViewStateMatcher,
    });

    expect(mocks.upsertProjectViewStateMock).toHaveBeenCalledWith(
      upsertViewStateMatcher,
    );
    expect(result.projectId).toBe('project-1');
    expect(typeof result.viewedAt).toBe('string');
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
        id: 'user-jeyson',
        email: 'jeyson@example.com',
        name: 'Jeyson Remigivse',
      },
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
      {
        id: 'user-king',
        email: 'king@example.com',
        name: 'King Cheung',
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
    expect(mocks.findUsersMock).toHaveBeenCalledWith({
      where: {
        email: {
          in: ['admin@tavi.local', 'editor@tavi.local', 'viewer@tavi.local'],
        },
      },
      select: {
        email: true,
        id: true,
        name: true,
      },
    });
    expect(mocks.deleteProjectsMock).toHaveBeenCalledWith({});
    expect(mocks.createProjectMock).toHaveBeenCalledTimes(4);
    const defaultOwnerDataMatcher: unknown = expect.objectContaining({
      ownerUserId: 'user-admin',
    });
    const defaultOwnerProjectMatcher: unknown = expect.objectContaining({
      data: defaultOwnerDataMatcher,
    });
    expect(mocks.createProjectMock).toHaveBeenNthCalledWith(
      1,
      defaultOwnerProjectMatcher,
    );
    expect(mocks.createTaskMock).toHaveBeenCalledTimes(11);
    const defaultAssigneeDataMatcher: unknown = expect.objectContaining({
      assigneeUserId: 'user-editor',
    });
    const defaultAssigneeTaskMatcher: unknown = expect.objectContaining({
      data: defaultAssigneeDataMatcher,
    });
    expect(mocks.createTaskMock).toHaveBeenNthCalledWith(
      2,
      defaultAssigneeTaskMatcher,
    );
    expect(mocks.recalculateProjectMock).toHaveBeenCalledTimes(4);
    expect(mocks.recordAuditMock).toHaveBeenCalledWith(
      adminUser,
      'auth',
      adminUser.id,
      'workspace_reset_examples',
      {
        seedExamples: true,
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

  it('creates missing default local users before seeding example projects', async () => {
    const adminUser: SessionUser = {
      id: 'user-admin',
      email: 'admin@tavi.local',
      name: 'Tavi Admin',
      role: 'admin',
    };
    const { mocks, service } = createService();

    mocks.findUsersMock.mockResolvedValue([]);
    mocks.createUserMock
      .mockResolvedValueOnce({
        id: 'user-admin',
        email: 'admin@tavi.local',
        name: 'Tavi Admin',
      })
      .mockResolvedValueOnce({
        id: 'user-editor',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
      })
      .mockResolvedValueOnce({
        id: 'user-viewer',
        email: 'viewer@tavi.local',
        name: 'Tavi Viewer',
      });
    mocks.countProjectsMock.mockResolvedValue(0);
    mocks.countTasksMock.mockResolvedValue(0);
    mocks.deleteProjectsMock.mockResolvedValue({ count: 0 });
    mocks.createProjectMock
      .mockResolvedValueOnce({ id: 'project-1' })
      .mockResolvedValueOnce({ id: 'project-2' })
      .mockResolvedValueOnce({ id: 'project-3' })
      .mockResolvedValueOnce({ id: 'project-4' });

    await service.resetWorkspaceExamples(
      { password: 'current-password-123' },
      adminUser,
    );

    expect(mocks.createUserMock).toHaveBeenCalledTimes(3);
    const defaultAdminCreateDataMatcher: unknown = expect.objectContaining({
      email: 'admin@tavi.local',
      passwordHash: 'hashed-password123',
    });
    const defaultAdminCreateMatcher: unknown = expect.objectContaining({
      data: defaultAdminCreateDataMatcher,
    });
    expect(mocks.createUserMock).toHaveBeenNthCalledWith(
      1,
      defaultAdminCreateMatcher,
    );
    expect(mocks.hashPasswordMock).toHaveBeenCalledWith('password123');
    const createdDefaultOwnerDataMatcher: unknown = expect.objectContaining({
      ownerUserId: 'user-admin',
    });
    const createdDefaultOwnerProjectMatcher: unknown = expect.objectContaining({
      data: createdDefaultOwnerDataMatcher,
    });
    expect(mocks.createProjectMock).toHaveBeenNthCalledWith(
      1,
      createdDefaultOwnerProjectMatcher,
    );
    const resetDefaultAuditMatcher: unknown = expect.objectContaining({
      email: 'admin@tavi.local',
      source: 'workspace_reset_examples',
    });
    expect(mocks.recordAuditMock).toHaveBeenCalledWith(
      adminUser,
      'auth',
      'user-admin',
      'account_reset_defaults',
      resetDefaultAuditMatcher,
      expect.any(Object),
    );
  });

  it('clears project and task data without seeding examples when requested', async () => {
    const adminUser: SessionUser = {
      id: 'user-admin',
      email: 'admin@tavi.local',
      name: 'Tavi Admin',
      role: 'admin',
    };
    const { mocks, service } = createService();

    mocks.countProjectsMock.mockResolvedValue(3);
    mocks.countTasksMock.mockResolvedValue(7);
    mocks.deleteProjectsMock.mockResolvedValue({ count: 3 });

    const result = await service.resetWorkspaceExamples(
      { password: 'current-password-123', seedExamples: false },
      adminUser,
    );

    expect(mocks.findUsersMock).not.toHaveBeenCalled();
    expect(mocks.createProjectMock).not.toHaveBeenCalled();
    expect(mocks.createTaskMock).not.toHaveBeenCalled();
    expect(mocks.recalculateProjectMock).not.toHaveBeenCalled();
    expect(mocks.recordAuditMock).toHaveBeenCalledWith(
      adminUser,
      'auth',
      adminUser.id,
      'workspace_clear_projects_tasks',
      {
        seedExamples: false,
        createdProjectCount: 0,
        createdTaskCount: 0,
        deletedProjectCount: 3,
        deletedTaskCount: 7,
      },
      expect.any(Object),
    );
    expect(result).toEqual({
      createdProjectCount: 0,
      createdTaskCount: 0,
      deletedProjectCount: 3,
      deletedTaskCount: 7,
    });
  });
});
