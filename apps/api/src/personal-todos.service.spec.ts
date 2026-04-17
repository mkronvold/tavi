import type { SessionUser } from "./auth.types";
import { PersonalTodosService } from "./personal-todos.service";
import { PrismaService } from "./prisma.service";

describe("PersonalTodosService", () => {
  const actor: SessionUser = {
    id: "user-1",
    email: "viewer@tavi.local",
    name: "Tavi Viewer",
    role: "viewer",
  };

  const createService = () => {
    const createMock = jest.fn();
    const createManyMock = jest.fn();
    const deleteManyMock = jest.fn();
    const deleteMock = jest.fn();
    const findFirstMock = jest.fn();
    const findManyMock = jest.fn();
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
        delete: deleteMock,
        findFirst: findFirstMock,
        findMany: findManyMock,
        update: updateMock,
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
        transactionMock,
        updateMock,
      },
      service: new PersonalTodosService(prisma),
    };
  };

  it("creates personal todos for viewers under their own account", async () => {
    const { mocks, service } = createService();

    mocks.findFirstMock.mockResolvedValue(null);
    mocks.createMock.mockResolvedValue({
      id: "todo-1",
      title: "Review notes",
      userId: actor.id,
    });

    await service.createPersonalTodo(
      {
        title: "Review notes",
      },
      actor,
    );

    expect(mocks.createMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notes: null,
        title: "Review notes",
        userId: actor.id,
      }),
    });
  });

  it("updates completion timestamps when toggling personal todo status", async () => {
    const { mocks, service } = createService();

    mocks.findFirstMock.mockResolvedValue({
      id: "todo-1",
      title: "Review notes",
      userId: actor.id,
      notes: null,
      dueDate: null,
      status: "todo",
      completedAt: null,
    });
    mocks.updateMock.mockResolvedValue({
      id: "todo-1",
      status: "done",
      completedAt: new Date("2026-04-17T10:00:00.000Z"),
    });

    await service.updatePersonalTodo(
      "todo-1",
      {
        status: "done",
      },
      actor,
    );

    expect(mocks.updateMock).toHaveBeenCalledWith({
      where: { id: "todo-1" },
      data: expect.objectContaining({
        status: "done",
        completedAt: expect.any(Date),
      }),
    });
  });

  it("requires the full personal todo list when reordering", async () => {
    const { mocks, service } = createService();

    mocks.findManyMock.mockResolvedValue([
      { id: "todo-1", sortOrder: 0 },
      { id: "todo-2", sortOrder: 1 },
    ]);

    await expect(
      service.reorderPersonalTodos({ todoIds: ["todo-1"] }, actor),
    ).rejects.toThrow("Personal todo order must include every item exactly once");
  });

  it("replaces the current personal todo list on import", async () => {
    const { mocks, service } = createService();

    const result = await service.importPersonalTodos(
      {
        personalTodos: [
          {
            title: "First",
            notes: "",
            dueDate: "2026-04-20",
            status: "todo",
          },
          {
            title: "Second",
            notes: "Done already",
            dueDate: null,
            status: "done",
          },
        ],
      },
      actor,
    );

    expect(mocks.deleteManyMock).toHaveBeenCalledWith({
      where: { userId: actor.id },
    });
    expect(mocks.createManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          title: "First",
          userId: actor.id,
          sortOrder: 0,
          status: "todo",
        }),
        expect.objectContaining({
          title: "Second",
          userId: actor.id,
          sortOrder: 1,
          status: "done",
          completedAt: expect.any(Date),
        }),
      ],
    });
    expect(result).toEqual({ importedCount: 2 });
  });
});
