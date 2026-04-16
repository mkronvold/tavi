import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { NotificationEventsService } from './notification-events.service';
import { PrismaService } from './prisma.service';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';

type TaskFixture = {
  assigneeUserId: string;
  completedAt: Date | null;
  dueDate: Date | null;
  id: string;
  notes: string | null;
  priority: 'low' | 'medium' | 'high';
  projectId: string;
  sortOrder?: number;
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'canceled';
  title: string;
};

describe('TasksService', () => {
  type CreateProjectCall = {
    data: Record<string, unknown>;
  };
  type CreateTaskCall = {
    data: Record<string, unknown>;
  };
  type UpdateTaskCall = {
    data: Record<string, unknown>;
    where: { id: string };
  };

  const actor: SessionUser = {
    id: 'user-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const createService = () => {
    const createProjectMock: jest.MockedFunction<
      (args: CreateProjectCall) => Promise<unknown>
    > = jest.fn();
    const createTaskMock: jest.MockedFunction<
      (args: CreateTaskCall) => Promise<unknown>
    > = jest.fn();
    const findManyMock = jest.fn();
    const findFirstTaskMock = jest.fn();
    const findUniqueProjectMock = jest.fn();
    const findUniqueTaskMock = jest.fn();
    const updateTaskMock: jest.MockedFunction<
      (args: UpdateTaskCall) => Promise<unknown>
    > = jest.fn();
    const updateSingleTaskMock = updateTaskMock;
    const tx = {
      project: {
        create: createProjectMock,
      },
      task: {
        create: createTaskMock,
        findFirst: findFirstTaskMock,
        update: updateTaskMock,
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
    const recalculateProjectMock = jest.fn(() => Promise.resolve());
    const prisma = {
      project: {
        findUnique: findUniqueProjectMock,
      },
      task: {
        findFirst: findFirstTaskMock,
        findMany: findManyMock,
        findUnique: findUniqueTaskMock,
        update: updateTaskMock,
      },
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const authService = {
      requireEditAccess: requireEditAccessMock,
      recordAudit: recordAuditMock,
    } as unknown as AuthService;
    const notificationEventsService = {
      queueTaskChange: jest.fn(() => Promise.resolve()),
    } as unknown as NotificationEventsService;
    const projectsService = {
      recalculateProject: recalculateProjectMock,
    } as unknown as ProjectsService;

    return {
      mocks: {
        findManyMock,
        findFirstTaskMock,
        findUniqueProjectMock,
        findUniqueTaskMock,
        createProjectMock,
        createTaskMock,
        recalculateProjectMock,
        recordAuditCalls,
        recordAuditMock,
        requireEditAccessMock,
        transactionMock,
        tx,
        updateSingleTaskMock,
        updateTaskMock,
      },
      service: new TasksService(
        prisma,
        authService,
        notificationEventsService,
        projectsService,
      ),
    };
  };

  it('bulk updates tasks, records audit events, and recalculates each affected project', async () => {
    const { mocks, service } = createService();
    const existingTasks: TaskFixture[] = [
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'First task',
        notes: null,
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        completedAt: null,
      },
      {
        id: 'task-2',
        projectId: 'project-1',
        title: 'Second task',
        notes: null,
        assigneeUserId: 'user-2',
        dueDate: null,
        priority: 'low',
        status: 'in_progress',
        completedAt: null,
      },
      {
        id: 'task-3',
        projectId: 'project-2',
        title: 'Third task',
        notes: null,
        assigneeUserId: 'user-3',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        completedAt: null,
      },
    ];

    mocks.findManyMock.mockResolvedValue(existingTasks);
    mocks.updateTaskMock
      .mockResolvedValueOnce({
        ...existingTasks[0],
        priority: 'high',
        status: 'done',
        completedAt: new Date('2026-02-01T12:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        ...existingTasks[1],
        priority: 'high',
        status: 'done',
        completedAt: new Date('2026-02-01T12:00:01.000Z'),
      })
      .mockResolvedValueOnce({
        ...existingTasks[2],
        priority: 'high',
        status: 'done',
        completedAt: new Date('2026-02-01T12:00:02.000Z'),
      });

    const result = await service.bulkUpdateTasks(
      {
        taskIds: existingTasks.map((task) => task.id),
        priority: 'high',
        status: 'done',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.updateTaskMock).toHaveBeenCalledTimes(3);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledTimes(2);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-1',
      mocks.tx,
    );
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-2',
      mocks.tx,
    );
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(3);

    const firstAuditCall = mocks.recordAuditCalls[0];
    const firstAuditMetadata = firstAuditCall[4] ?? {};
    const firstAuditChangedFields = Array.isArray(
      firstAuditMetadata['changedFields'],
    )
      ? firstAuditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const selectionSize =
      typeof firstAuditMetadata['selectionSize'] === 'number'
        ? firstAuditMetadata['selectionSize']
        : null;
    const status =
      typeof firstAuditMetadata['status'] === 'string'
        ? firstAuditMetadata['status']
        : null;

    expect(firstAuditCall[0]).toEqual(actor);
    expect(firstAuditCall[1]).toBe('task');
    expect(firstAuditCall[2]).toBe('task-1');
    expect(firstAuditCall[3]).toBe('bulk_update');
    expect(firstAuditCall[5]).toBe(mocks.tx);
    expect(firstAuditChangedFields).toEqual(
      expect.arrayContaining(['priority', 'status', 'completedAt']),
    );
    expect(selectionSize).toBe(3);
    expect(status).toBe('done');
    expect(result).toEqual({
      updatedCount: 3,
      updatedTaskIds: ['task-1', 'task-2', 'task-3'],
    });
  });

  it('bulk archives tasks, records audit events, and recalculates each affected project', async () => {
    const { mocks, service } = createService();
    const existingTasks: TaskFixture[] = [
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'First task',
        notes: null,
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        completedAt: null,
      },
      {
        id: 'task-2',
        projectId: 'project-2',
        title: 'Second task',
        notes: null,
        assigneeUserId: 'user-2',
        dueDate: null,
        priority: 'low',
        status: 'in_progress',
        completedAt: null,
      },
    ];
    const archivedAt = new Date('2026-02-02T09:00:00.000Z');

    mocks.findManyMock.mockResolvedValue(existingTasks);
    mocks.updateTaskMock
      .mockResolvedValueOnce({
        ...existingTasks[0],
        archivedAt,
      })
      .mockResolvedValueOnce({
        ...existingTasks[1],
        archivedAt,
      });

    const result = await service.bulkArchiveTasks(
      {
        taskIds: existingTasks.map((task) => task.id),
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.updateTaskMock).toHaveBeenCalledTimes(2);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledTimes(2);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-1',
      mocks.tx,
    );
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-2',
      mocks.tx,
    );
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(2);

    const firstUpdateCall = mocks.updateTaskMock.mock.calls[0]?.[0];
    const secondUpdateCall = mocks.updateTaskMock.mock.calls[1]?.[0];

    if (!firstUpdateCall || !secondUpdateCall) {
      throw new Error('Expected archive update calls');
    }

    expect(firstUpdateCall.data['archivedAt']).toBeInstanceOf(Date);
    expect(secondUpdateCall.data['archivedAt']).toBe(
      firstUpdateCall.data['archivedAt'],
    );

    const firstAuditCall = mocks.recordAuditCalls[0];
    const firstAuditMetadata = firstAuditCall[4] ?? {};
    const firstAuditChangedFields = Array.isArray(
      firstAuditMetadata['changedFields'],
    )
      ? firstAuditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const selectionSize =
      typeof firstAuditMetadata['selectionSize'] === 'number'
        ? firstAuditMetadata['selectionSize']
        : null;
    const archivedAtValue =
      typeof firstAuditMetadata['archivedAt'] === 'string'
        ? firstAuditMetadata['archivedAt']
        : null;

    expect(firstAuditCall[0]).toEqual(actor);
    expect(firstAuditCall[1]).toBe('task');
    expect(firstAuditCall[2]).toBe('task-1');
    expect(firstAuditCall[3]).toBe('bulk_delete');
    expect(firstAuditCall[5]).toBe(mocks.tx);
    expect(firstAuditChangedFields).toEqual(['archivedAt']);
    expect(selectionSize).toBe(2);
    expect(archivedAtValue).toBe(archivedAt.toISOString());
    expect(result).toEqual({
      archivedCount: 2,
      archivedTaskIds: ['task-1', 'task-2'],
    });
  });

  it('bulk copies tasks into another project in the selected order and recalculates the target project', async () => {
    const { mocks, service } = createService();
    const completedAt = new Date('2026-02-03T09:30:00.000Z');

    mocks.findUniqueProjectMock.mockResolvedValue({
      id: 'project-2',
      archivedAt: null,
      title: 'Operations uplift',
    });
    mocks.findManyMock.mockResolvedValue([
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Done task',
        notes: 'Keep evidence',
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'high',
        status: 'done',
        completedAt,
        project: {
          title: 'Roadmap refresh',
        },
      },
      {
        id: 'task-2',
        projectId: 'project-1',
        title: 'Todo task',
        notes: null,
        assigneeUserId: 'user-2',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        completedAt: null,
        project: {
          title: 'Roadmap refresh',
        },
      },
    ]);
    mocks.findFirstTaskMock.mockResolvedValue({
      sortOrder: 4,
    });
    mocks.createTaskMock
      .mockResolvedValueOnce({
        id: 'copy-2',
        projectId: 'project-2',
        title: 'Todo task',
        notes: null,
        assigneeUserId: 'user-2',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        completedAt: null,
      })
      .mockResolvedValueOnce({
        id: 'copy-1',
        projectId: 'project-2',
        title: 'Done task',
        notes: 'Keep evidence',
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'high',
        status: 'done',
        completedAt,
      });

    const result = await service.bulkCopyTasks(
      {
        taskIds: ['task-2', 'task-1'],
        targetProjectId: 'project-2',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.findFirstTaskMock).toHaveBeenCalledWith({
      where: { projectId: 'project-2' },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    expect(mocks.createTaskMock).toHaveBeenNthCalledWith(1, {
      data: {
        projectId: 'project-2',
        title: 'Todo task',
        notes: null,
        assigneeUserId: 'user-2',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        sortOrder: 5,
        completedAt: null,
      },
    });
    expect(mocks.createTaskMock).toHaveBeenNthCalledWith(2, {
      data: {
        projectId: 'project-2',
        title: 'Done task',
        notes: 'Keep evidence',
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'high',
        status: 'done',
        sortOrder: 6,
        completedAt,
      },
    });
    expect(mocks.recalculateProjectMock).toHaveBeenCalledTimes(1);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-2',
      mocks.tx,
    );

    const firstAuditCall = mocks.recordAuditCalls[0];
    const firstAuditMetadata = firstAuditCall[4] ?? {};
    const firstAuditChangedFields = Array.isArray(
      firstAuditMetadata['changedFields'],
    )
      ? firstAuditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(firstAuditCall[3]).toBe('bulk_copy');
    expect(firstAuditChangedFields).toEqual(
      expect.arrayContaining([
        'projectId',
        'title',
        'assigneeUserId',
        'priority',
        'status',
      ]),
    );
    expect(firstAuditMetadata['copiedFromProjectTitle']).toBe(
      'Roadmap refresh',
    );
    expect(firstAuditMetadata['selectionSize']).toBe(2);
    expect(result).toEqual({
      copiedCount: 2,
      copiedTaskIds: ['copy-2', 'copy-1'],
      targetProjectId: 'project-2',
    });
  });

  it('reorders project tasks and audits changed sort order entries', async () => {
    const { mocks, service } = createService();
    const existingTasks: Array<TaskFixture & { sortOrder: number }> = [
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Kickoff',
        notes: null,
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        sortOrder: 0,
        completedAt: null,
      },
      {
        id: 'task-2',
        projectId: 'project-1',
        title: 'Review plan',
        notes: null,
        assigneeUserId: 'user-2',
        dueDate: null,
        priority: 'medium',
        status: 'in_progress',
        sortOrder: 1,
        completedAt: null,
      },
      {
        id: 'task-3',
        projectId: 'project-1',
        title: 'Share update',
        notes: null,
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'low',
        status: 'todo',
        sortOrder: 2,
        completedAt: null,
      },
    ];

    mocks.findUniqueProjectMock.mockResolvedValue({
      id: 'project-1',
      archivedAt: null,
      title: 'Roadmap refresh',
    });
    mocks.findManyMock.mockResolvedValue(existingTasks);
    mocks.updateTaskMock
      .mockResolvedValueOnce({
        ...existingTasks[1],
        sortOrder: 0,
      })
      .mockResolvedValueOnce({
        ...existingTasks[0],
        sortOrder: 1,
      });

    const result = await service.reorderProjectTasks(
      'project-1',
      {
        taskIds: ['task-2', 'task-1', 'task-3'],
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.findUniqueProjectMock).toHaveBeenCalledWith({
      where: { id: 'project-1' },
      select: { archivedAt: true, id: true, title: true },
    });
    expect(mocks.findManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        projectId: 'project-1',
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        assigneeUserId: true,
        completedAt: true,
        dueDate: true,
        id: true,
        notes: true,
        priority: true,
        projectId: true,
        sortOrder: true,
        status: true,
        title: true,
      },
    });
    expect(mocks.updateTaskMock).toHaveBeenNthCalledWith(1, {
      where: { id: 'task-2' },
      data: { sortOrder: 0 },
    });
    expect(mocks.updateTaskMock).toHaveBeenNthCalledWith(2, {
      where: { id: 'task-1' },
      data: { sortOrder: 1 },
    });
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(2);

    const firstAuditCall = mocks.recordAuditCalls[0];
    const firstAuditMetadata = firstAuditCall[4] ?? {};
    const firstAuditChangedFields = Array.isArray(
      firstAuditMetadata['changedFields'],
    )
      ? firstAuditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(firstAuditCall[3]).toBe('bulk_update');
    expect(firstAuditChangedFields).toEqual(['sortOrder']);
    expect(firstAuditMetadata['selectionSize']).toBe(3);
    expect(firstAuditMetadata['projectTitle']).toBe('Roadmap refresh');
    expect(firstAuditMetadata['changes']).toEqual([
      {
        field: 'sortOrder',
        from: 1,
        to: 0,
      },
    ]);
    expect(result).toEqual({ success: true });
  });

  it('updates only the selected tasks that actually change', async () => {
    const { mocks, service } = createService();
    const existingTasks: TaskFixture[] = [
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Already complete',
        notes: null,
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'high',
        status: 'done',
        completedAt: new Date('2026-02-01T11:59:00.000Z'),
      },
      {
        id: 'task-2',
        projectId: 'project-1',
        title: 'Needs update',
        notes: null,
        assigneeUserId: 'user-2',
        dueDate: null,
        priority: 'high',
        status: 'todo',
        completedAt: null,
      },
    ];

    mocks.findManyMock.mockResolvedValue(existingTasks);
    mocks.updateTaskMock.mockResolvedValueOnce({
      ...existingTasks[1],
      status: 'done',
      completedAt: new Date('2026-02-01T12:00:00.000Z'),
    });

    const result = await service.bulkUpdateTasks(
      {
        taskIds: existingTasks.map((task) => task.id),
        priority: 'high',
        status: 'done',
      },
      actor,
    );

    expect(mocks.updateTaskMock).toHaveBeenCalledTimes(1);
    const updateCall = mocks.updateTaskMock.mock.calls[0]?.[0];

    expect(updateCall.where).toEqual({ id: 'task-2' });
    expect(updateCall.data).toMatchObject({
      status: 'done',
    });
    expect(updateCall.data['completedAt']).toBeInstanceOf(Date);
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(1);

    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(changedFields).toEqual(['status', 'completedAt']);
    expect(auditMetadata['selectionSize']).toBe(2);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      updatedCount: 1,
      updatedTaskIds: ['task-2'],
    });
  });

  it('preserves task notes when bulk updates move blocked tasks forward', async () => {
    const { mocks, service } = createService();
    const existingTasks: TaskFixture[] = [
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Blocked task',
        notes: 'Blocked: Waiting on design sign-off',
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        status: 'blocked',
        completedAt: null,
      },
    ];

    mocks.findManyMock.mockResolvedValue(existingTasks);
    mocks.updateTaskMock.mockResolvedValueOnce({
      ...existingTasks[0],
      completedAt: new Date('2026-02-01T12:30:00.000Z'),
      status: 'done',
    });

    await service.bulkUpdateTasks(
      {
        taskIds: ['task-1'],
        status: 'done',
      },
      actor,
    );

    const updateCall = mocks.updateTaskMock.mock.calls[0]?.[0];

    expect(updateCall.data).toMatchObject({
      status: 'done',
    });
    expect(updateCall.data['completedAt']).toBeInstanceOf(Date);
    expect(updateCall.data).not.toHaveProperty('notes');

    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(changedFields).toEqual(['status', 'completedAt']);
  });

  it('clears task notes through bulk updates when requested', async () => {
    const { mocks, service } = createService();
    const existingTasks: TaskFixture[] = [
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Document rollout',
        notes: 'Confirm with the platform team',
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        completedAt: null,
      },
    ];

    mocks.findManyMock.mockResolvedValue(existingTasks);
    mocks.updateTaskMock.mockResolvedValueOnce({
      ...existingTasks[0],
      notes: null,
    });

    const result = await service.bulkUpdateTasks(
      {
        taskIds: ['task-1'],
        notes: null,
      },
      actor,
    );

    const updateCall = mocks.updateTaskMock.mock.calls[0]?.[0];
    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(updateCall?.data).toMatchObject({ notes: null });
    expect(changedFields).toEqual(['notes']);
    expect(result).toEqual({
      updatedCount: 1,
      updatedTaskIds: ['task-1'],
    });
  });

  it('preserves task notes on direct updates and audits completion changes', async () => {
    const { mocks, service } = createService();
    const existingTask = {
      archivedAt: null,
      assigneeUserId: 'user-1',
      completedAt: null,
      dueDate: null,
      id: 'task-1',
      notes: 'Blocked: Waiting on design sign-off',
      priority: 'medium',
      projectId: 'project-1',
      status: 'blocked',
      title: 'Blocked task',
    };

    mocks.findUniqueTaskMock.mockResolvedValue(existingTask);
    mocks.updateSingleTaskMock.mockResolvedValue({
      ...existingTask,
      completedAt: new Date('2026-02-01T12:45:00.000Z'),
      status: 'done',
    });

    await service.updateTask(
      'task-1',
      {
        status: 'done',
      },
      actor,
    );

    const updateCall = mocks.updateSingleTaskMock.mock.calls[0]?.[0] as
      | UpdateTaskCall
      | undefined;

    if (!updateCall) {
      throw new Error('Expected a task update call');
    }

    expect(updateCall.where).toEqual({ id: 'task-1' });
    expect(updateCall.data).toMatchObject({
      notes: 'Blocked: Waiting on design sign-off',
      status: 'done',
    });
    expect(updateCall.data['completedAt']).toBeInstanceOf(Date);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-1',
      mocks.tx,
    );

    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(changedFields).toEqual(['status', 'completedAt']);
  });

  it('moves tasks between projects and recalculates both project rollups', async () => {
    const { mocks, service } = createService();
    const existingTask = {
      archivedAt: null,
      assigneeUserId: 'user-1',
      completedAt: null,
      dueDate: null,
      id: 'task-1',
      notes: 'Confirm milestone scope',
      priority: 'medium',
      projectId: 'project-1',
      sortOrder: 1,
      status: 'todo',
      title: 'Kickoff',
    };

    mocks.findUniqueTaskMock.mockResolvedValue(existingTask);
    mocks.findUniqueProjectMock.mockResolvedValue({
      archivedAt: null,
      id: 'project-2',
    });
    mocks.findFirstTaskMock.mockResolvedValue({
      sortOrder: 2,
    });
    mocks.updateSingleTaskMock.mockResolvedValue({
      ...existingTask,
      projectId: 'project-2',
      sortOrder: 3,
    });

    const result = await service.updateTask(
      'task-1',
      {
        projectId: 'project-2',
      },
      actor,
    );

    const updateCall = mocks.updateSingleTaskMock.mock.calls[0]?.[0] as
      | UpdateTaskCall
      | undefined;

    if (!updateCall) {
      throw new Error('Expected a task update call');
    }

    expect(mocks.findUniqueProjectMock).toHaveBeenCalledWith({
      where: { id: 'project-2' },
      select: { archivedAt: true, id: true, title: true },
    });
    expect(mocks.findFirstTaskMock).toHaveBeenCalledWith({
      where: { projectId: 'project-2' },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    expect(updateCall.data).toMatchObject({
      projectId: 'project-2',
      sortOrder: 3,
    });
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-1',
      mocks.tx,
    );
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-2',
      mocks.tx,
    );

    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(changedFields).toEqual(['projectId']);
    expect(result).toMatchObject({
      id: 'task-1',
      projectId: 'project-2',
    });
  });

  it('converts a task into a standalone project in one transaction', async () => {
    const { mocks, service } = createService();
    const archivedAt = new Date('2026-02-03T11:00:00.000Z');
    const dueDate = new Date('2026-02-07T09:00:00.000Z');
    const existingTask = {
      archivedAt: null,
      assigneeUserId: 'user-2',
      completedAt: null,
      dueDate,
      id: 'task-1',
      notes: 'Waiting on a cross-team dependency',
      priority: 'high',
      projectId: 'project-1',
      status: 'blocked',
      title: 'Resolve blocker',
    };

    mocks.findUniqueTaskMock.mockResolvedValue(existingTask);
    mocks.createProjectMock.mockResolvedValue({
      id: 'project-2',
      ownerUserId: 'user-2',
      dueDate,
      priority: 'high',
      title: 'Resolve blocker project',
      references: null,
    });
    mocks.updateTaskMock.mockResolvedValue({
      ...existingTask,
      archivedAt,
      title: 'Resolve blocker project',
    });

    const result = await service.convertTaskToProject(
      'task-1',
      {
        title: 'Resolve blocker project',
      },
      actor,
    );

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(mocks.createProjectMock).toHaveBeenCalledWith({
      data: {
        title: 'Resolve blocker project',
        notes: 'Waiting on a cross-team dependency',
        references: null,
        ownerUserId: 'user-2',
        dueDate,
        priority: 'high',
        derivedStatus: 'not_started',
        displayStatus: 'blocked',
        manualStatus: 'blocked',
      },
    });

    const updateCall = mocks.updateTaskMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'task-1' },
      data: {
        title: 'Resolve blocker project',
        notes: 'Waiting on a cross-team dependency',
        assigneeUserId: 'user-2',
        dueDate,
        priority: 'high',
        status: 'blocked',
      },
    });
    expect(updateCall?.data['archivedAt']).toBeInstanceOf(Date);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith(
      'project-1',
      mocks.tx,
    );
    expect(mocks.recordAuditMock).toHaveBeenCalledTimes(2);
    expect(mocks.recordAuditCalls[0]?.[1]).toBe('project');
    expect(mocks.recordAuditCalls[0]?.[2]).toBe('project-2');
    expect(mocks.recordAuditCalls[0]?.[3]).toBe('create');
    expect(mocks.recordAuditCalls[1]?.[1]).toBe('task');
    expect(mocks.recordAuditCalls[1]?.[2]).toBe('task-1');
    expect(mocks.recordAuditCalls[1]?.[3]).toBe('convert_to_project');

    const taskAuditMetadata = mocks.recordAuditCalls[1]?.[4] ?? {};
    const changedFields = Array.isArray(taskAuditMetadata['changedFields'])
      ? taskAuditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(changedFields).toEqual(['title', 'archivedAt']);
    expect(taskAuditMetadata['convertedProjectId']).toBe('project-2');
    expect(taskAuditMetadata['archivedAt']).toBe(archivedAt.toISOString());
    expect(result).toEqual({
      projectId: 'project-2',
      taskId: 'task-1',
    });
  });

  it('archives a task and records audit metadata for the delete action', async () => {
    const { mocks, service } = createService();
    const archivedAt = new Date('2026-02-03T10:30:00.000Z');
    const existingTask = {
      archivedAt: null,
      assigneeUserId: 'user-1',
      completedAt: null,
      dueDate: null,
      id: 'task-1',
      notes: 'Confirm milestone scope',
      priority: 'medium',
      projectId: 'project-1',
      status: 'todo',
      title: 'Kickoff',
    };

    mocks.findUniqueTaskMock.mockResolvedValue(existingTask);
    mocks.updateSingleTaskMock.mockResolvedValue({
      ...existingTask,
      archivedAt,
    });

    const result = await service.deleteTask('task-1', actor);

    expect(mocks.requireEditAccessMock).toHaveBeenCalledWith(actor);
    const updateCall = mocks.updateSingleTaskMock.mock.calls[0]?.[0];

    expect(updateCall).toMatchObject({
      where: { id: 'task-1' },
    });
    expect(updateCall?.data['archivedAt']).toBeInstanceOf(Date);
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith('project-1');

    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];
    const archivedAtValue =
      typeof auditMetadata['archivedAt'] === 'string'
        ? auditMetadata['archivedAt']
        : null;

    expect(mocks.recordAuditCalls[0]?.[3]).toBe('delete');
    expect(changedFields).toEqual(['archivedAt']);
    expect(archivedAtValue).toBe(archivedAt.toISOString());
    expect(result).toEqual({
      id: 'task-1',
      projectId: 'project-1',
    });
  });

  it('allows blocked bulk updates without requiring dedicated blocker text', async () => {
    const { mocks, service } = createService();

    mocks.findManyMock.mockResolvedValue([
      {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Blocked task',
        notes: null,
        assigneeUserId: 'user-1',
        dueDate: null,
        priority: 'medium',
        status: 'todo',
        completedAt: null,
      } satisfies TaskFixture,
    ]);
    mocks.updateTaskMock.mockResolvedValueOnce({
      id: 'task-1',
      projectId: 'project-1',
      title: 'Blocked task',
      notes: null,
      assigneeUserId: 'user-1',
      dueDate: null,
      priority: 'medium',
      status: 'blocked',
      completedAt: null,
    });

    const result = await service.bulkUpdateTasks(
      {
        taskIds: ['task-1'],
        status: 'blocked',
      },
      actor,
    );

    const updateCall = mocks.updateTaskMock.mock.calls[0]?.[0];
    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(updateCall.data).toMatchObject({ status: 'blocked' });
    expect(changedFields).toEqual(['status']);
    expect(result).toEqual({
      updatedCount: 1,
      updatedTaskIds: ['task-1'],
    });
  });

  it('normalizes task notes on direct updates', async () => {
    const { mocks, service } = createService();
    const existingTask = {
      archivedAt: null,
      assigneeUserId: 'user-1',
      completedAt: null,
      dueDate: null,
      id: 'task-1',
      notes: null,
      priority: 'medium',
      projectId: 'project-1',
      status: 'todo',
      title: 'Follow-up task',
    };

    mocks.findUniqueTaskMock.mockResolvedValue(existingTask);
    mocks.updateSingleTaskMock.mockResolvedValue({
      ...existingTask,
      notes: 'Needs cross-team review',
    });

    await service.updateTask(
      'task-1',
      {
        notes: '  Needs cross-team review  ',
      },
      actor,
    );

    const updateCall = mocks.updateSingleTaskMock.mock.calls[0]?.[0] as
      | UpdateTaskCall
      | undefined;

    if (!updateCall) {
      throw new Error('Expected a task update call');
    }

    expect(updateCall.data).toMatchObject({
      notes: 'Needs cross-team review',
    });

    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(changedFields).toEqual(['notes']);
  });
});
