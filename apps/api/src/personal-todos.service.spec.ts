import type { SessionUser } from './auth.types';
import type { Prisma } from '@prisma/client';
import { PersonalTodosService } from './personal-todos.service';
import { PrismaService } from './prisma.service';

describe('PersonalTodosService', () => {
  const actor: SessionUser = {
    id: 'user-1',
    email: 'viewer@tavi.local',
    name: 'Tavi Viewer',
    role: 'viewer',
  };

  const createService = () => {
    const createMock = jest.fn();
    const createManyMock = jest.fn();
    const deleteManyMock = jest.fn();
    const deleteMock = jest.fn();
    const findFirstMock = jest.fn();
    const findManyMock = jest.fn();
    const findUniqueUserMock = jest.fn();
    const updateMock = jest.fn();
    const tx = {
      personalTodo: {
        createMany: createManyMock,
        deleteMany: deleteManyMock,
        update: updateMock,
      },
    };
    const transactionMock = jest.fn(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const prisma = {
      $transaction: transactionMock,
      personalTodo: {
        create: createMock,
        deleteMany: deleteManyMock,
        delete: deleteMock,
        findFirst: findFirstMock,
        findMany: findManyMock,
        update: updateMock,
      },
      user: {
        findUnique: findUniqueUserMock,
      },
    } as unknown as PrismaService;

    return {
      mocks: {
        createManyMock,
        createMock,
        deleteManyMock,
        deleteMock,
        findFirstMock,
        findManyMock,
        findUniqueUserMock,
        transactionMock,
        updateMock,
      },
      service: new PersonalTodosService(prisma),
    };
  };

  it('creates personal todos for viewers under their own account', async () => {
    const { mocks, service } = createService();

    mocks.findFirstMock.mockResolvedValue(null);
    mocks.createMock.mockResolvedValue({
      id: 'todo-1',
      title: 'Review notes',
      userId: actor.id,
    });

    await service.createPersonalTodo(
      {
        title: 'Review notes',
      },
      actor,
    );

    const firstCreateCall = mocks.createMock.mock.calls.at(0) as
      | [Prisma.PersonalTodoCreateArgs]
      | undefined;

    if (!firstCreateCall) {
      throw new Error('Expected createPersonalTodo to issue a create call');
    }

    const [createCall] = firstCreateCall;

    expect(createCall.data).toMatchObject({
      notes: null,
      title: 'Review notes',
      userId: actor.id,
    });
  });

  it('updates completion timestamps when toggling personal todo status', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue({
      personalTodoRetention: 'never',
    });
    mocks.findFirstMock.mockResolvedValue({
      id: 'todo-1',
      title: 'Review notes',
      userId: actor.id,
      notes: null,
      dueDate: null,
      status: 'todo',
      completedAt: null,
    });
    mocks.updateMock.mockResolvedValue({
      id: 'todo-1',
      status: 'done',
      completedAt: new Date('2026-04-17T10:00:00.000Z'),
    });

    await service.updatePersonalTodo(
      'todo-1',
      {
        status: 'done',
      },
      actor,
    );

    const firstUpdateCall = mocks.updateMock.mock.calls.at(0) as
      | [Prisma.PersonalTodoUpdateArgs]
      | undefined;

    if (!firstUpdateCall) {
      throw new Error('Expected updatePersonalTodo to issue an update call');
    }

    const [updateCall] = firstUpdateCall;

    const updateData = updateCall.data as {
      completedAt?: Date | null;
      status?: string;
    };

    expect(updateCall.where).toEqual({ id: 'todo-1' });
    expect(updateData).toMatchObject({
      status: 'done',
    });
    expect(updateData.completedAt).toBeInstanceOf(Date);
  });

  it('deletes completed personal todos immediately when retention is delete when done', async () => {
    const { mocks, service } = createService();

    mocks.findUniqueUserMock.mockResolvedValue({
      personalTodoRetention: 'delete_when_done',
    });
    mocks.findFirstMock.mockResolvedValue({
      id: 'todo-1',
      title: 'Review notes',
      userId: actor.id,
      notes: null,
      dueDate: null,
      status: 'todo',
      sortOrder: 0,
      completedAt: null,
      createdAt: new Date('2026-04-17T09:00:00.000Z'),
      updatedAt: new Date('2026-04-17T09:00:00.000Z'),
    });

    const result = await service.updatePersonalTodo(
      'todo-1',
      {
        status: 'done',
      },
      actor,
    );

    expect(mocks.deleteMock).toHaveBeenCalledWith({
      where: { id: 'todo-1' },
    });
    expect(mocks.updateMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: 'todo-1',
      status: 'done',
    });
    expect(result.completedAt).toBeInstanceOf(Date);
  });

  it('prunes completed personal todos using the configured retention policy', async () => {
    const { mocks, service } = createService();
    const expectedCutoff = new Date('2026-04-20T12:00:00.000Z');
    expectedCutoff.setMonth(expectedCutoff.getMonth() - 3);

    jest
      .useFakeTimers()
      .setSystemTime(new Date('2026-04-20T12:00:00.000Z').getTime());
    mocks.findUniqueUserMock.mockResolvedValue({
      personalTodoRetention: 'three_months',
    });
    mocks.deleteManyMock.mockResolvedValue({ count: 2 });

    const result = await service.pruneCompletedPersonalTodosForUser(actor.id);

    expect(mocks.deleteManyMock).toHaveBeenCalledWith({
      where: {
        completedAt: {
          lte: expectedCutoff,
        },
        status: 'done',
        userId: actor.id,
      },
    });
    expect(result).toEqual({ deletedCount: 2 });
    jest.useRealTimers();
  });

  it('requires the full personal todo list when reordering', async () => {
    const { mocks, service } = createService();

    mocks.findManyMock.mockResolvedValue([
      { id: 'todo-1', sortOrder: 0 },
      { id: 'todo-2', sortOrder: 1 },
    ]);

    await expect(
      service.reorderPersonalTodos({ todoIds: ['todo-1'] }, actor),
    ).rejects.toThrow(
      'Personal todo order must include every item exactly once',
    );
  });

  it('replaces the current personal todo list on import', async () => {
    const { mocks, service } = createService();

    const result = await service.importPersonalTodos(
      {
        personalTodos: [
          {
            title: 'First',
            notes: '',
            dueDate: '2026-04-20',
            status: 'todo',
          },
          {
            title: 'Second',
            notes: 'Done already',
            dueDate: null,
            status: 'done',
          },
        ],
      },
      actor,
    );

    expect(mocks.deleteManyMock).toHaveBeenCalledWith({
      where: { userId: actor.id },
    });
    const firstCreateManyCall = mocks.createManyMock.mock.calls.at(0) as
      | [Prisma.PersonalTodoCreateManyArgs]
      | undefined;

    if (!firstCreateManyCall) {
      throw new Error(
        'Expected importPersonalTodos to issue a createMany call',
      );
    }

    const [createManyCall] = firstCreateManyCall;

    const createManyData =
      createManyCall.data as Prisma.PersonalTodoCreateManyInput[];

    expect(createManyData).toHaveLength(2);
    expect(createManyData[0]).toMatchObject({
      title: 'First',
      userId: actor.id,
      sortOrder: 0,
      status: 'todo',
    });
    expect(createManyData[1]).toMatchObject({
      title: 'Second',
      userId: actor.id,
      sortOrder: 1,
      status: 'done',
    });
    expect(createManyData[1]?.completedAt).toBeInstanceOf(Date);
    expect(result).toEqual({ importedCount: 2 });
  });
});
