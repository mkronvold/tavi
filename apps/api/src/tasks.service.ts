import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BulkArchiveTasksInput,
  BulkUpdateTasksInput,
  CreateTaskInput,
  UpdateTaskInput,
} from '@tavi/schemas';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { ProjectsService } from './projects.service';

const toOptionalDate = (value?: string | null) =>
  value ? new Date(value) : null;
const toAuditDate = (value: Date | null) => value?.toISOString() ?? null;
type TaskMutationRecord = {
  id: string;
  projectId: string;
  title: string;
  notes: string | null;
  assigneeUserId: string;
  dueDate: Date | null;
  priority: CreateTaskInput['priority'];
  status: CreateTaskInput['status'];
  completedAt: Date | null;
};

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
  ) {}

  async createTask(
    projectId: string,
    input: CreateTaskInput,
    actor: SessionUser,
  ) {
    this.authService.requireEditAccess(actor);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, archivedAt: true },
    });

    if (!project || project.archivedAt) {
      throw new NotFoundException('Project not found');
    }

    const highestSortOrder = await this.prisma.task.findFirst({
      where: { projectId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });

    const task = await this.prisma.task.create({
      data: {
        projectId,
        title: input.title,
        notes: normalizeOptionalNotes(input.notes),
        assigneeUserId: input.assigneeUserId,
        dueDate: toOptionalDate(input.dueDate),
        priority: input.priority,
        status: input.status,
        sortOrder: (highestSortOrder?.sortOrder ?? -1) + 1,
        completedAt: input.status === 'done' ? new Date() : null,
      },
    });

    await this.projectsService.recalculateProject(projectId);
    await this.authService.recordAudit(
      actor.id,
      'task',
      task.id,
      'create',
      buildTaskAuditMetadata(task),
    );

    return task;
  }

  async bulkArchiveTasks(input: BulkArchiveTasksInput, actor: SessionUser) {
    this.authService.requireEditAccess(actor);

    const existingTasks = await this.prisma.task.findMany({
      where: {
        id: { in: input.taskIds },
        archivedAt: null,
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        notes: true,
        assigneeUserId: true,
        dueDate: true,
        priority: true,
        status: true,
        completedAt: true,
      },
    });

    if (existingTasks.length !== input.taskIds.length) {
      throw new NotFoundException('One or more tasks were not found');
    }

    const archivedTaskIds: string[] = [];
    const recalculatedProjectIds = new Set<string>();
    const archivedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const existingTask of existingTasks) {
        const task = await tx.task.update({
          where: { id: existingTask.id },
          data: { archivedAt },
        });

        archivedTaskIds.push(task.id);
        recalculatedProjectIds.add(task.projectId);

        await this.authService.recordAudit(
          actor.id,
          'task',
          task.id,
          'bulk_delete',
          buildTaskAuditMetadata(task, ['archivedAt'], {
            archivedAt: toAuditDate(task.archivedAt),
            selectionSize: input.taskIds.length,
          }),
          tx,
        );
      }

      await Promise.all(
        [...recalculatedProjectIds].map((projectId) =>
          this.projectsService.recalculateProject(projectId, tx),
        ),
      );
    });

    return {
      archivedCount: archivedTaskIds.length,
      archivedTaskIds,
    };
  }

  async bulkUpdateTasks(input: BulkUpdateTasksInput, actor: SessionUser) {
    this.authService.requireEditAccess(actor);

    const existingTasks = await this.prisma.task.findMany({
      where: {
        id: { in: input.taskIds },
        archivedAt: null,
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        notes: true,
        assigneeUserId: true,
        dueDate: true,
        priority: true,
        status: true,
        completedAt: true,
      },
    });

    if (existingTasks.length !== input.taskIds.length) {
      throw new NotFoundException('One or more tasks were not found');
    }

    const updates = existingTasks
      .map((task) => buildBulkTaskUpdate(task, input))
      .filter(
        (
          update,
        ): update is {
          existing: TaskMutationRecord;
          data: Prisma.TaskUncheckedUpdateInput;
          changedFields: string[];
        } => update !== null,
      );

    if (updates.length === 0) {
      return {
        updatedCount: 0,
        updatedTaskIds: [],
      };
    }

    const updatedTaskIds: string[] = [];
    const recalculatedProjectIds = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      for (const update of updates) {
        const task = await tx.task.update({
          where: { id: update.existing.id },
          data: update.data,
        });

        updatedTaskIds.push(task.id);
        recalculatedProjectIds.add(task.projectId);

        await this.authService.recordAudit(
          actor.id,
          'task',
          task.id,
          'bulk_update',
          buildTaskAuditMetadata(task, update.changedFields, {
            selectionSize: input.taskIds.length,
          }),
          tx,
        );
      }

      await Promise.all(
        [...recalculatedProjectIds].map((projectId) =>
          this.projectsService.recalculateProject(projectId, tx),
        ),
      );
    });

    return {
      updatedCount: updatedTaskIds.length,
      updatedTaskIds,
    };
  }

  async updateTask(taskId: string, input: UpdateTaskInput, actor: SessionUser) {
    this.authService.requireEditAccess(actor);

    const existing = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!existing || existing.archivedAt) {
      throw new NotFoundException('Task not found');
    }

    const status = input.status ?? existing.status;

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: input.title ?? existing.title,
        notes:
          input.notes === undefined
            ? existing.notes
            : normalizeOptionalNotes(input.notes),
        assigneeUserId: input.assigneeUserId ?? existing.assigneeUserId,
        dueDate:
          input.dueDate === undefined
            ? existing.dueDate
            : toOptionalDate(input.dueDate),
        priority: input.priority ?? existing.priority,
        status,
        completedAt:
          status === 'done' ? (existing.completedAt ?? new Date()) : null,
      },
    });

    await this.projectsService.recalculateProject(existing.projectId);
    await this.authService.recordAudit(
      actor.id,
      'task',
      task.id,
      'update',
      buildTaskAuditMetadata(task, getChangedTaskFields(existing, task)),
    );

    return task;
  }
}

function normalizeOptionalNotes(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function getChangedTaskFields(
  existing: TaskMutationRecord,
  next: TaskMutationRecord,
) {
  const changedFields: string[] = [];

  if (existing.title !== next.title) {
    changedFields.push('title');
  }

  if (existing.notes !== next.notes) {
    changedFields.push('notes');
  }

  if (existing.assigneeUserId !== next.assigneeUserId) {
    changedFields.push('assigneeUserId');
  }

  if (existing.priority !== next.priority) {
    changedFields.push('priority');
  }

  if (existing.status !== next.status) {
    changedFields.push('status');
  }

  if (toAuditDate(existing.dueDate) !== toAuditDate(next.dueDate)) {
    changedFields.push('dueDate');
  }

  if (toAuditDate(existing.completedAt) !== toAuditDate(next.completedAt)) {
    changedFields.push('completedAt');
  }

  return changedFields;
}

function buildBulkTaskUpdate(
  existing: TaskMutationRecord,
  input: BulkUpdateTasksInput,
) {
  const changedFields: string[] = [];
  const data: Prisma.TaskUncheckedUpdateInput = {};

  if (
    input.assigneeUserId !== undefined &&
    input.assigneeUserId !== existing.assigneeUserId
  ) {
    data.assigneeUserId = input.assigneeUserId;
    changedFields.push('assigneeUserId');
  }

  if (input.priority !== undefined && input.priority !== existing.priority) {
    data.priority = input.priority;
    changedFields.push('priority');
  }

  if (input.dueDate !== undefined) {
    const dueDate = toOptionalDate(input.dueDate);

    if (toAuditDate(dueDate) !== toAuditDate(existing.dueDate)) {
      data.dueDate = dueDate;
      changedFields.push('dueDate');
    }
  }

  if (input.status !== undefined) {
    if (input.status !== existing.status) {
      data.status = input.status;
      changedFields.push('status');
    }

    const completedAt =
      input.status === 'done' ? (existing.completedAt ?? new Date()) : null;

    if (toAuditDate(completedAt) !== toAuditDate(existing.completedAt)) {
      data.completedAt = completedAt;
      changedFields.push('completedAt');
    }
  }

  if (changedFields.length === 0 && data.completedAt === undefined) {
    return null;
  }

  return {
    existing,
    data,
    changedFields,
  };
}

function buildTaskAuditMetadata(
  task: TaskMutationRecord,
  changedFields: string[] = [],
  extra: Record<string, unknown> = {},
) {
  return {
    title: task.title,
    projectId: task.projectId,
    assigneeUserId: task.assigneeUserId,
    priority: task.priority,
    status: task.status,
    dueDate: toAuditDate(task.dueDate),
    ...(changedFields.length > 0 ? { changedFields } : {}),
    ...extra,
  };
}
