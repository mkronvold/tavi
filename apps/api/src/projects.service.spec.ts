import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { NotificationEventsService } from './notification-events.service';
import { PrismaService } from './prisma.service';
import { ProjectsService } from './projects.service';

describe('ProjectsService', () => {
  type CreateProjectCall = {
    data: Record<string, unknown>;
  };
  type CreateTaskCall = {
    data: Record<string, unknown>;
  };

  type UpdateProjectCall = {
    data: Record<string, unknown>;
    where: { id: string };
  };
  type UpdateManyTasksCall = {
    data: Record<string, unknown>;
    where: Record<string, unknown>;
  };

  const actor: SessionUser = {
    id: 'user-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const existingProject = {
    id: 'project-1',
    title: 'Roadmap refresh',
    notes: null,
    references: null,
    ownerUserId: 'user-1',
    dueDate: null,
    priority: 'medium',
    derivedStatus: 'in_progress',
    displayStatus: 'in_progress',
    manualStatus: null,
    taskTotalCount: 0,
    archivedAt: null,
  };

  const createService = () => {
    const createProjectMock: jest.MockedFunction<
      (args: CreateProjectCall) => Promise<unknown>
    > = jest.fn();
    const createTaskMock: jest.MockedFunction<
      (args: CreateTaskCall) => Promise<unknown>
    > = jest.fn();
    const findFirstProjectMock = jest.fn();
    const findFirstTaskMock = jest.fn();
    const findUniqueMock = jest.fn();
    const updateProjectMock: jest.MockedFunction<
      (args: UpdateProjectCall) => Promise<unknown>
    > = jest.fn();
    const updateManyTasksMock: jest.MockedFunction<
      (args: UpdateManyTasksCall) => Promise<{ count: number }>
    > = jest.fn();
    const tx = {
      project: {
        create: createProjectMock,
        findFirst: findFirstProjectMock,
        findUnique: findUniqueMock,
        update: updateProjectMock,
      },
      task: {
        create: createTaskMock,
        findFirst: findFirstTaskMock,
        updateMany: updateManyTasksMock,
      },
    };
    const transactionMock = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const requireEditAccessMock = jest.fn();
    const recordAuditCalls: Array<Parameters<AuthService['recordAudit']>> = [];
    const recordAuditMock = jest.fn(
      (...args: Parameters<AuthService['recordAudit']>) => {
        recordAuditCalls.push(args);
        return Promise.resolve();
      },
    );
    const prisma = {
      $transaction: transactionMock,
      project: {
        create: createProjectMock,
        findFirst: findFirstProjectMock,
        findUnique: findUniqueMock,
        update: updateProjectMock,
      },
      task: {
        create: createTaskMock,
        findFirst: findFirstTaskMock,
        updateMany: updateManyTasksMock,
      },
    } as unknown as PrismaService;
    const authService = {
      requireEditAccess: requireEditAccessMock,
      recordAudit: recordAuditMock,
    } as unknown as AuthService;
    const notificationEventsService = {
      queueProjectChange: jest.fn(() => Promise.resolve()),
    } as unknown as NotificationEventsService;

    return {
      mocks: {
        createProjectMock,
        createTaskMock,
        findFirstProjectMock,
        findFirstTaskMock,
        findUniqueMock,
        recordAuditCalls,
        recordAuditMock,
        requireEditAccessMock,
        transactionMock,
        tx,
        updateProjectMock,
        updateManyTasksMock,
      },
      service: new ProjectsService(
        prisma,
        authService,
        notificationEventsService,
      ),
    };
  };

  const expectRecordAuditCall = (
    actual: Parameters<AuthService['recordAudit']>,
    {
      action,
      entityId,
      entityType,
      metadata,
      tx,
    }: {
      action: string;
      entityId: string;
      entityType: 'project' | 'task';
      metadata: unknown;
      tx?: unknown;
    },
  ) => {
    expect(actual.slice(0, 5)).toEqual([
      actor,
      entityType,
      entityId,
      action,
      metadata,
    ]);

    if (tx !== undefined) {
      expect(actual[5]).toBe(tx);
    }
  };

  it('creates projects with normalized tracker links and audit metadata', async () => {
    const { mocks, service } = createService();

    mocks.createProjectMock.mockResolvedValue({
      ...existingProject,
      references: 'https://tracker.example.com/projects/roadmap-refresh',
    });

    const result = await service.createProject(
      {
        title: 'Roadmap refresh',
        references: '  https://tracker.example.com/projects/roadmap-refresh  ',
        ownerUserId: 'user-1',
        priority: 'medium',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.createProjectMock).toHaveBeenCalledWith({
      data: {
        title: 'Roadmap refresh',
        notes: null,
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        ownerUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
      },
    });
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'create',
      metadata: expect.objectContaining({
        title: 'Roadmap refresh',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        changedFields: ['title', 'ownerUserId', 'priority', 'references'],
        changes: [
          { field: 'title', from: null, to: 'Roadmap refresh' },
          { field: 'ownerUserId', from: null, to: 'user-1' },
          { field: 'priority', from: null, to: 'medium' },
          {
            field: 'references',
            from: null,
            to: 'https://tracker.example.com/projects/roadmap-refresh',
          },
        ],
      }),
    });
    expect(result).toMatchObject({
      id: 'project-1',
      references: 'https://tracker.example.com/projects/roadmap-refresh',
    });
  });

  it('converts taskless projects into tasks inside an auto-created Unassigned project', async () => {
    const { mocks, service } = createService();
    const archivedAt = new Date('2026-02-03T10:00:00.000Z');

    mocks.findUniqueMock.mockResolvedValue({
      ...existingProject,
      notes: 'Awaiting dependency',
      references: 'https://tracker.example.com/projects/roadmap-refresh',
      displayStatus: 'blocked',
      manualStatus: 'blocked',
      taskTotalCount: 0,
    });
    mocks.findFirstProjectMock.mockResolvedValue(null);
    mocks.createProjectMock.mockResolvedValue({
      id: 'project-unassigned',
      title: 'Unassigned',
      notes: null,
      references: null,
      ownerUserId: 'user-1',
      dueDate: null,
      priority: 'medium',
      archivedAt: null,
    });
    mocks.findFirstTaskMock.mockResolvedValue({
      sortOrder: 2,
    });
    mocks.createTaskMock.mockResolvedValue({
      id: 'task-3',
      projectId: 'project-unassigned',
      title: 'Roadmap refresh',
      notes: 'Awaiting dependency',
      assigneeUserId: 'user-1',
      dueDate: null,
      priority: 'medium',
      status: 'blocked',
    });
    mocks.findUniqueMock
      .mockResolvedValueOnce({
        ...existingProject,
        notes: 'Awaiting dependency',
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        displayStatus: 'blocked',
        manualStatus: 'blocked',
        taskTotalCount: 0,
      })
      .mockResolvedValueOnce({
        id: 'project-unassigned',
        title: 'Unassigned',
        notes: null,
        references: null,
        ownerUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
        manualStatus: null,
        tasks: [
          {
            dueDate: null,
            status: 'blocked',
            archivedAt: null,
          },
        ],
      });
    mocks.updateProjectMock
      .mockResolvedValueOnce({
        ...existingProject,
        notes: 'Awaiting dependency',
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        displayStatus: 'blocked',
        manualStatus: 'blocked',
        taskTotalCount: 0,
        archivedAt,
      })
      .mockResolvedValueOnce({
        id: 'project-unassigned',
        title: 'Unassigned',
        notes: null,
        references: null,
        ownerUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'blocked',
        displayStatus: 'blocked',
        manualStatus: null,
      });

    const result = await service.convertProjectToTask('project-1', {}, actor);

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.findFirstProjectMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        id: { not: 'project-1' },
        title: {
          equals: 'Unassigned',
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(mocks.createProjectMock).toHaveBeenCalledWith({
      data: {
        title: 'Unassigned',
        notes: null,
        references: null,
        ownerUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
      },
    });
    expect(mocks.findFirstTaskMock).toHaveBeenCalledWith({
      where: { projectId: 'project-unassigned' },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    expect(mocks.createTaskMock).toHaveBeenCalledWith({
      data: {
        projectId: 'project-unassigned',
        title: 'Roadmap refresh',
        notes: 'Awaiting dependency',
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        status: 'blocked',
        sortOrder: 3,
        completedAt: null,
      },
    });

    const projectUpdateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(projectUpdateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        title: 'Roadmap refresh',
        notes: 'Awaiting dependency',
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        ownerUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        manualStatus: 'blocked',
        displayStatus: 'blocked',
      },
    });
    expect(projectUpdateCall?.data['archivedAt']).toBeInstanceOf(Date);
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(3);
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-unassigned',
      action: 'create',
      metadata: expect.objectContaining({
        title: 'Unassigned',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        references: null,
        changedFields: ['title', 'ownerUserId', 'priority'],
        changes: [
          { field: 'title', from: null, to: 'Unassigned' },
          { field: 'ownerUserId', from: null, to: 'user-1' },
          { field: 'priority', from: null, to: 'medium' },
        ],
      }),
      tx: mocks.tx,
    });
    expectRecordAuditCall(mocks.recordAuditCalls[1], {
      entityType: 'task',
      entityId: 'task-3',
      action: 'convert_from_project',
      metadata: {
        title: 'Roadmap refresh',
        projectId: 'project-unassigned',
        assigneeUserId: 'user-1',
        priority: 'medium',
        status: 'blocked',
        dueDate: null,
        sourceProjectId: 'project-1',
      },
      tx: mocks.tx,
    });
    expectRecordAuditCall(mocks.recordAuditCalls[2], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'convert_to_task',
      metadata: expect.objectContaining({
        title: 'Roadmap refresh',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        status: 'blocked',
        changedFields: ['archivedAt'],
        archivedAt: archivedAt.toISOString(),
        destinationProjectId: 'project-unassigned',
        taskId: 'task-3',
        changes: [
          {
            field: 'archivedAt',
            from: null,
            to: archivedAt.toISOString(),
          },
        ],
      }),
      tx: mocks.tx,
    });
    expect(result).toEqual({
      projectId: 'project-unassigned',
      taskId: 'task-3',
    });
  });

  it('refuses to convert projects that still have active tasks', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue({
      ...existingProject,
      taskTotalCount: 2,
    });

    await expect(
      service.convertProjectToTask('project-1', {}, actor),
    ).rejects.toThrow(
      'Only projects without active tasks can be converted to a task',
    );
    expect(mocks.transactionMock).not.toHaveBeenCalled();
  });

  it('updates project notes without requiring a manual status change', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue(existingProject);
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      notes: 'Keep team aligned',
    });

    const result = await service.updateProject(
      'project-1',
      {
        notes: '  Keep team aligned  ',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        notes: 'Keep team aligned',
      },
    });
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(1);
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'update',
      metadata: expect.objectContaining({
        title: 'Roadmap refresh',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        references: null,
        changedFields: ['notes'],
        changes: [
          {
            field: 'notes',
            from: null,
            to: 'Keep team aligned',
          },
        ],
      }),
    });
    expect(result).toMatchObject({
      id: 'project-1',
      notes: 'Keep team aligned',
    });
  });

  it('updates tracker links as project metadata and allows clearing them', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue({
      ...existingProject,
      references: 'https://tracker.example.com/projects/roadmap-refresh',
    });
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      references: null,
    });

    const result = await service.updateProject(
      'project-1',
      {
        references: null,
      },
      actor,
    );

    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        references: null,
      },
    });
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'update',
      metadata: expect.objectContaining({
        title: 'Roadmap refresh',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        references: null,
        changedFields: ['references'],
        changes: [
          {
            field: 'references',
            from: 'https://tracker.example.com/projects/roadmap-refresh',
            to: null,
          },
        ],
      }),
    });
    expect(result).toMatchObject({
      id: 'project-1',
      references: null,
    });
  });

  it('sets manual status overrides without requiring notes', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue(existingProject);
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      displayStatus: 'blocked',
      manualStatus: 'blocked',
    });

    const result = await service.updateProject(
      'project-1',
      {
        manualStatus: 'blocked',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        displayStatus: 'blocked',
        manualStatus: 'blocked',
        notes: null,
      },
    });
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(1);
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'status_override_set',
      metadata: expect.objectContaining({
        manualStatus: 'blocked',
        previousManualStatus: null,
        previousNotes: null,
        derivedStatus: 'in_progress',
        changes: [
          {
            field: 'manualStatus',
            from: null,
            to: 'blocked',
          },
        ],
      }),
    });
    expect(result).toMatchObject({
      id: 'project-1',
      displayStatus: 'blocked',
      manualStatus: 'blocked',
      notes: null,
    });
  });

  it('records both metadata and override audit events when notes and status change together', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueMock.mockResolvedValue(existingProject);
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      displayStatus: 'blocked',
      manualStatus: 'blocked',
      notes: 'Awaiting dependency',
      priority: 'high',
      title: 'Roadmap refresh v2',
    });

    await service.updateProject(
      'project-1',
      {
        title: 'Roadmap refresh v2',
        priority: 'high',
        manualStatus: 'blocked',
        notes: '  Awaiting dependency  ',
      },
      actor,
    );

    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(2);
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'update',
      metadata: expect.objectContaining({
        title: 'Roadmap refresh v2',
        ownerUserId: 'user-1',
        priority: 'high',
        dueDate: null,
        references: null,
        changedFields: ['title', 'notes', 'priority'],
        changes: [
          {
            field: 'title',
            from: 'Roadmap refresh',
            to: 'Roadmap refresh v2',
          },
          {
            field: 'notes',
            from: null,
            to: 'Awaiting dependency',
          },
          {
            field: 'priority',
            from: 'medium',
            to: 'high',
          },
        ],
      }),
    });
    expectRecordAuditCall(mocks.recordAuditCalls[1], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'status_override_set',
      metadata: expect.objectContaining({
        manualStatus: 'blocked',
        notes: 'Awaiting dependency',
        previousManualStatus: null,
        previousNotes: null,
        derivedStatus: 'in_progress',
        changes: [
          {
            field: 'manualStatus',
            from: null,
            to: 'blocked',
          },
        ],
      }),
    });
  });

  it('clears manual status overrides back to the derived status while preserving notes', async () => {
    const { mocks, service } = createService();
    const recalculateProjectMock = jest
      .spyOn(service, 'recalculateProject')
      .mockResolvedValue(undefined);

    mocks.findUniqueMock
      .mockResolvedValueOnce({
        ...existingProject,
        derivedStatus: 'not_started',
        displayStatus: 'blocked',
        manualStatus: 'blocked',
        notes: 'Awaiting dependency',
      })
      .mockResolvedValueOnce({
        ...existingProject,
        derivedStatus: 'in_progress',
        displayStatus: 'in_progress',
        manualStatus: null,
        notes: 'Awaiting dependency',
      });
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      derivedStatus: 'not_started',
      displayStatus: 'not_started',
      manualStatus: null,
      notes: 'Awaiting dependency',
    });

    const result = await service.updateProject(
      'project-1',
      {
        manualStatus: null,
      },
      actor,
    );

    const updateCall = mocks.updateProjectMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'project-1' },
      data: {
        manualStatus: null,
        notes: 'Awaiting dependency',
      },
    });
    expect(updateCall?.data).not.toHaveProperty('displayStatus');
    expect(recalculateProjectMock).toHaveBeenCalledWith('project-1', mocks.tx);
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'status_override_clear',
      metadata: expect.objectContaining({
        previousManualStatus: 'blocked',
        previousNotes: 'Awaiting dependency',
        derivedStatus: 'in_progress',
        notes: 'Awaiting dependency',
        changes: [
          {
            field: 'manualStatus',
            from: 'blocked',
            to: null,
          },
        ],
      }),
    });
    expect(result).toMatchObject({
      id: 'project-1',
      displayStatus: 'in_progress',
      manualStatus: null,
      notes: 'Awaiting dependency',
    });
  });

  it('archives a project and its active tasks while recording project audit history', async () => {
    const { mocks, service } = createService();
    const archivedAt = new Date('2026-02-03T09:00:00.000Z');

    mocks.findUniqueMock.mockResolvedValue(existingProject);
    mocks.updateProjectMock.mockResolvedValue({
      ...existingProject,
      archivedAt,
    });
    mocks.updateManyTasksMock.mockResolvedValue({ count: 2 });

    const result = await service.deleteProject('project-1', actor);

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.transactionMock).toHaveBeenCalledTimes(1);

    const projectUpdateCall = mocks.updateProjectMock.mock.calls[0]?.[0];
    const taskUpdateManyCall = mocks.updateManyTasksMock.mock.calls[0]?.[0];

    expect(projectUpdateCall).toMatchObject({
      where: { id: 'project-1' },
    });
    expect(projectUpdateCall?.data['archivedAt']).toBeInstanceOf(Date);
    expect(taskUpdateManyCall).toMatchObject({
      where: {
        projectId: 'project-1',
        archivedAt: null,
      },
    });
    expect(taskUpdateManyCall?.data['archivedAt']).toBe(
      projectUpdateCall?.data['archivedAt'],
    );
    expectRecordAuditCall(mocks.recordAuditCalls[0], {
      entityType: 'project',
      entityId: 'project-1',
      action: 'delete',
      metadata: expect.objectContaining({
        title: 'Roadmap refresh',
        ownerUserId: 'user-1',
        priority: 'medium',
        dueDate: null,
        references: null,
        changedFields: ['archivedAt'],
        archivedAt: archivedAt.toISOString(),
        archivedTaskCount: 2,
        changes: [
          {
            field: 'archivedAt',
            from: null,
            to: archivedAt.toISOString(),
          },
        ],
      }),
      tx: mocks.tx,
    });
    expect(result).toEqual({
      id: 'project-1',
      archivedTaskCount: 2,
    });
  });
});
