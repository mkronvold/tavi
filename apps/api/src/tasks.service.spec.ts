import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
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
  status: 'todo' | 'in_progress' | 'blocked' | 'done' | 'canceled';
  title: string;
};

describe('TasksService', () => {
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
    const findManyMock = jest.fn();
    const findUniqueTaskMock = jest.fn();
    const updateSingleTaskMock: jest.MockedFunction<
      (args: UpdateTaskCall) => Promise<unknown>
    > = jest.fn();
    const updateTaskMock: jest.MockedFunction<
      (args: UpdateTaskCall) => Promise<unknown>
    > = jest.fn();
    const tx = {
      task: {
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
      task: {
        findMany: findManyMock,
        findUnique: findUniqueTaskMock,
        update: updateSingleTaskMock,
      },
      $transaction: transactionMock,
    } as unknown as PrismaService;
    const authService = {
      requireEditAccess: requireEditAccessMock,
      recordAudit: recordAuditMock,
    } as unknown as AuthService;
    const projectsService = {
      recalculateProject: recalculateProjectMock,
    } as unknown as ProjectsService;

    return {
      mocks: {
        findManyMock,
        findUniqueTaskMock,
        recalculateProjectMock,
        recordAuditCalls,
        recordAuditMock,
        requireEditAccessMock,
        transactionMock,
        tx,
        updateSingleTaskMock,
        updateTaskMock,
      },
      service: new TasksService(prisma, authService, projectsService),
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

    expect(firstAuditCall[0]).toBe(actor.id);
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

    expect(firstAuditCall[0]).toBe(actor.id);
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
    expect(mocks.recalculateProjectMock).toHaveBeenCalledWith('project-1');

    const auditMetadata = mocks.recordAuditCalls[0]?.[4] ?? {};
    const changedFields = Array.isArray(auditMetadata['changedFields'])
      ? auditMetadata['changedFields'].filter(
          (value): value is string => typeof value === 'string',
        )
      : [];

    expect(changedFields).toEqual(['status', 'completedAt']);
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
