import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreatePersonalTodoInput,
  ImportPersonalTodosInput,
  ReorderPersonalTodosInput,
  UpdatePersonalTodoInput,
} from '@tavi/schemas';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { PrismaService } from './prisma.service';

type PersonalTodoClient = Pick<PrismaService, 'personalTodo'>;
type PersonalTodoTransactionClient = Pick<
  Prisma.TransactionClient,
  'personalTodo'
>;

@Injectable()
export class PersonalTodosService {
  constructor(private readonly prisma: PrismaService) {}

  async createPersonalTodo(input: CreatePersonalTodoInput, actor: SessionUser) {
    return this.prisma.personalTodo.create({
      data: {
        userId: actor.id,
        title: input.title.trim(),
        notes: normalizeOptionalNotes(input.notes),
        dueDate: toOptionalDate(input.dueDate),
        sortOrder: await getNextPersonalTodoSortOrder(this.prisma, actor.id),
      },
    });
  }

  async updatePersonalTodo(
    todoId: string,
    input: UpdatePersonalTodoInput,
    actor: SessionUser,
  ) {
    const existingTodo = await requireOwnedPersonalTodo(
      this.prisma,
      todoId,
      actor.id,
    );
    const nextStatus = input.status ?? existingTodo.status;

    return this.prisma.personalTodo.update({
      where: { id: todoId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.notes !== undefined
          ? { notes: normalizeOptionalNotes(input.notes) }
          : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: toOptionalDate(input.dueDate) }
          : {}),
        ...(input.status !== undefined
          ? {
              completedAt:
                nextStatus === 'done'
                  ? (existingTodo.completedAt ?? new Date())
                  : null,
              status: nextStatus,
            }
          : {}),
      },
    });
  }

  async deletePersonalTodo(todoId: string, actor: SessionUser) {
    await requireOwnedPersonalTodo(this.prisma, todoId, actor.id);
    await this.prisma.personalTodo.delete({
      where: { id: todoId },
    });

    return { id: todoId };
  }

  async reorderPersonalTodos(
    input: ReorderPersonalTodosInput,
    actor: SessionUser,
  ) {
    const existingTodos = await this.prisma.personalTodo.findMany({
      where: {
        userId: actor.id,
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        sortOrder: true,
      },
    });

    if (existingTodos.length !== input.todoIds.length) {
      throw new BadRequestException(
        'Personal todo order must include every item exactly once',
      );
    }

    const existingTodoById = new Map(
      existingTodos.map((todo) => [todo.id, todo] as const),
    );
    const orderedTodos = input.todoIds.map((todoId) => {
      const todo = existingTodoById.get(todoId);

      if (!todo) {
        throw new BadRequestException(
          'Personal todo order must include every item exactly once',
        );
      }

      return todo;
    });
    const changedTodos = orderedTodos.flatMap((todo, index) =>
      todo.sortOrder === index
        ? []
        : [
            {
              id: todo.id,
              sortOrder: index,
            },
          ],
    );

    if (changedTodos.length === 0) {
      return { success: true as const };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const changedTodo of changedTodos) {
        await tx.personalTodo.update({
          where: { id: changedTodo.id },
          data: { sortOrder: changedTodo.sortOrder },
        });
      }
    });

    return { success: true as const };
  }

  async importPersonalTodos(
    input: ImportPersonalTodosInput,
    actor: SessionUser,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await tx.personalTodo.deleteMany({
        where: { userId: actor.id },
      });

      if (input.personalTodos.length === 0) {
        return;
      }

      await tx.personalTodo.createMany({
        data: input.personalTodos.map((todo, index) => ({
          completedAt: todo.status === 'done' ? new Date() : null,
          dueDate: toOptionalDate(todo.dueDate),
          notes: normalizeOptionalNotes(todo.notes),
          sortOrder: index,
          status: todo.status,
          title: todo.title.trim(),
          userId: actor.id,
        })),
      });
    });

    return {
      importedCount: input.personalTodos.length,
    };
  }
}

async function requireOwnedPersonalTodo(
  prisma: PersonalTodoClient,
  todoId: string,
  userId: string,
) {
  const todo = await prisma.personalTodo.findFirst({
    where: {
      id: todoId,
      userId,
    },
  });

  if (!todo) {
    throw new NotFoundException('Personal todo not found');
  }

  return todo;
}

async function getNextPersonalTodoSortOrder(
  prisma: PersonalTodoClient | PersonalTodoTransactionClient,
  userId: string,
) {
  const lastTodo = await prisma.personalTodo.findFirst({
    where: { userId },
    orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }],
    select: { sortOrder: true },
  });

  return (lastTodo?.sortOrder ?? -1) + 1;
}

function toOptionalDate(value?: string | null) {
  return value ? new Date(value) : null;
}

function normalizeOptionalNotes(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
