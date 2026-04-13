import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  BulkArchiveTasksInput,
  BulkUpdateTasksInput,
  ConvertTaskToProjectInput,
  CreateTaskInput,
  ProjectStatus,
  UpdateTaskInput,
} from '@tavi/schemas';
import type { Prisma } from '@prisma/client';
import { buildAuditChanges } from './audit-change';
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
  assigneeUserId: string | null;
  dueDate: Date | null;
  priority: CreateTaskInput['priority'];
  status: CreateTaskInput['status'];
  completedAt: Date | null;
};
type TaskMutationClient = Pick<PrismaService, 'project' | 'task'>;

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

    await requireActiveProject(this.prisma, projectId);

    const task = await this.prisma.task.create({
      data: {
        projectId,
        title: input.title,
        notes: normalizeOptionalNotes(input.notes),
        assigneeUserId: input.assigneeUserId,
        dueDate: toOptionalDate(input.dueDate),
        priority: input.priority,
        status: input.status,
        sortOrder: await getNextTaskSortOrder(this.prisma, projectId),
        completedAt: input.status === 'done' ? new Date() : null,
      },
    });

    await this.projectsService.recalculateProject(projectId);
    await this.authService.recordAudit(
      actor,
      'task',
      task.id,
      'create',
      buildTaskAuditMetadata(task, getCreatedTaskFields(task), {
        changes: buildTaskAuditChanges(
          null,
          toTaskMutationRecord(task),
          getCreatedTaskFields(task),
        ),
      }),
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
          actor,
          'task',
          task.id,
          'bulk_delete',
          buildTaskAuditMetadata(task, ['archivedAt'], {
            archivedAt: toAuditDate(task.archivedAt),
            changes: buildTaskAuditChanges(
              toTaskMutationRecord(existingTask),
              toTaskMutationRecord(task),
              ['archivedAt'],
              {
                nextArchivedAt: task.archivedAt,
              },
            ),
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
          actor,
          'task',
          task.id,
          'bulk_update',
          buildTaskAuditMetadata(task, update.changedFields, {
            changes: buildTaskAuditChanges(
              update.existing,
              toTaskMutationRecord(task),
              update.changedFields,
            ),
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
    const nextProjectId = input.projectId ?? existing.projectId;
    const nextAssigneeUserId =
      input.assigneeUserId === undefined
        ? existing.assigneeUserId
        : input.assigneeUserId;

    if (nextProjectId !== existing.projectId) {
      await requireActiveProject(this.prisma, nextProjectId);
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        projectId: nextProjectId,
        title: input.title ?? existing.title,
        notes:
          input.notes === undefined
            ? existing.notes
            : normalizeOptionalNotes(input.notes),
        assigneeUserId: nextAssigneeUserId,
        dueDate:
          input.dueDate === undefined
            ? existing.dueDate
            : toOptionalDate(input.dueDate),
        priority: input.priority ?? existing.priority,
        sortOrder:
          nextProjectId === existing.projectId
            ? existing.sortOrder
            : await getNextTaskSortOrder(this.prisma, nextProjectId),
        status,
        completedAt:
          status === 'done' ? (existing.completedAt ?? new Date()) : null,
      },
    });

    await this.projectsService.recalculateProject(existing.projectId);
    if (nextProjectId !== existing.projectId) {
      await this.projectsService.recalculateProject(nextProjectId);
    }
    await this.authService.recordAudit(
      actor,
      'task',
      task.id,
      'update',
      buildTaskAuditMetadata(task, getChangedTaskFields(existing, task), {
        changes: buildTaskAuditChanges(
          toTaskMutationRecord(existing),
          toTaskMutationRecord(task),
          getChangedTaskFields(existing, task),
        ),
      }),
    );

    return task;
  }

  async convertTaskToProject(
    taskId: string,
    input: ConvertTaskToProjectInput,
    actor: SessionUser,
  ) {
    this.authService.requireEditAccess(actor);

    const existing = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!existing || existing.archivedAt) {
      throw new NotFoundException('Task not found');
    }

    const nextAssigneeUserId =
      input.assigneeUserId === undefined
        ? existing.assigneeUserId
        : input.assigneeUserId;
    const nextTask = toTaskMutationRecord({
      id: existing.id,
      projectId: existing.projectId,
      title: input.title ?? existing.title,
      notes:
        input.notes === undefined
          ? existing.notes
          : normalizeOptionalNotes(input.notes),
      assigneeUserId: nextAssigneeUserId,
      dueDate:
        input.dueDate === undefined
          ? existing.dueDate
          : toOptionalDate(input.dueDate),
      priority: input.priority ?? existing.priority,
      status: input.status ?? existing.status,
      completedAt:
        (input.status ?? existing.status) === 'done'
          ? (existing.completedAt ?? new Date())
          : null,
    });
    const changedFields = [
      ...getChangedTaskFields(toTaskMutationRecord(existing), nextTask),
      'archivedAt',
    ];
    const manualStatus = toProjectManualStatus(nextTask.status);
    const archivedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          title: nextTask.title,
          notes: nextTask.notes,
          trackerLink: null,
          ownerUserId: nextTask.assigneeUserId,
          dueDate: nextTask.dueDate,
          priority: nextTask.priority,
          derivedStatus: 'not_started',
          displayStatus: manualStatus ?? 'not_started',
          manualStatus,
        },
      });
      const archivedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          title: nextTask.title,
          notes: nextTask.notes,
          assigneeUserId: nextTask.assigneeUserId,
          dueDate: nextTask.dueDate,
          priority: nextTask.priority,
          status: nextTask.status,
          completedAt: nextTask.completedAt,
          archivedAt,
        },
      });

      await this.projectsService.recalculateProject(existing.projectId, tx);
      await this.authService.recordAudit(
        actor,
        'project',
        project.id,
        'create',
        {
          title: project.title,
          ownerUserId: project.ownerUserId,
          priority: project.priority,
          dueDate: toAuditDate(project.dueDate),
          trackerLink: project.trackerLink,
          ...(manualStatus ? { manualStatus } : {}),
          sourceTaskId: taskId,
        },
        tx,
      );
      await this.authService.recordAudit(
        actor,
        'task',
        archivedTask.id,
        'convert_to_project',
        buildTaskAuditMetadata(nextTask, changedFields, {
          archivedAt: toAuditDate(archivedTask.archivedAt),
          changes: buildTaskAuditChanges(
            toTaskMutationRecord(existing),
            nextTask,
            changedFields,
            {
              nextArchivedAt: archivedTask.archivedAt,
            },
          ),
          convertedProjectId: project.id,
        }),
        tx,
      );

      return {
        projectId: project.id,
        taskId: archivedTask.id,
      };
    });
  }

  async deleteTask(taskId: string, actor: SessionUser) {
    this.authService.requireEditAccess(actor);

    const existing = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!existing || existing.archivedAt) {
      throw new NotFoundException('Task not found');
    }

    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: new Date() },
    });

    await this.projectsService.recalculateProject(task.projectId);
    await this.authService.recordAudit(
      actor,
      'task',
      task.id,
      'delete',
      buildTaskAuditMetadata(task, ['archivedAt'], {
        archivedAt: toAuditDate(task.archivedAt),
        changes: buildTaskAuditChanges(
          toTaskMutationRecord(existing),
          toTaskMutationRecord(task),
          ['archivedAt'],
          {
            nextArchivedAt: task.archivedAt,
          },
        ),
      }),
    );

    return {
      id: task.id,
      projectId: task.projectId,
    };
  }
}

function normalizeOptionalNotes(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toTaskMutationRecord(task: TaskMutationRecord): TaskMutationRecord {
  return {
    assigneeUserId: task.assigneeUserId,
    completedAt: task.completedAt,
    dueDate: task.dueDate,
    id: task.id,
    notes: task.notes,
    priority: task.priority,
    projectId: task.projectId,
    status: task.status,
    title: task.title,
  };
}

function toProjectManualStatus(
  status: CreateTaskInput['status'],
): ProjectStatus | null {
  switch (status) {
    case 'blocked':
      return 'blocked';
    case 'done':
      return 'done';
    case 'in_progress':
      return 'in_progress';
    case 'canceled':
    case 'todo':
      return null;
  }
}

async function requireActiveProject(
  prisma: TaskMutationClient,
  projectId: string,
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, archivedAt: true },
  });

  if (!project || project.archivedAt) {
    throw new NotFoundException('Project not found');
  }
}

async function getNextTaskSortOrder(
  prisma: TaskMutationClient,
  projectId: string,
) {
  const highestSortOrder = await prisma.task.findFirst({
    where: { projectId },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });

  return (highestSortOrder?.sortOrder ?? -1) + 1;
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

  if (existing.projectId !== next.projectId) {
    changedFields.push('projectId');
  }

  if (toAuditDate(existing.dueDate) !== toAuditDate(next.dueDate)) {
    changedFields.push('dueDate');
  }

  if (toAuditDate(existing.completedAt) !== toAuditDate(next.completedAt)) {
    changedFields.push('completedAt');
  }

  return changedFields;
}

function getCreatedTaskFields(task: TaskMutationRecord) {
  return [
    'projectId',
    'title',
    'notes',
    'assigneeUserId',
    'priority',
    'status',
    'dueDate',
    ...(task.completedAt ? ['completedAt'] : []),
  ];
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
    notes: task.notes,
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

function buildTaskAuditChanges(
  previousTask: TaskMutationRecord | null,
  nextTask: TaskMutationRecord,
  changedFields: string[],
  options: {
    previousArchivedAt?: Date | null;
    nextArchivedAt?: Date | null;
  } = {},
) {
  if (changedFields.length === 0) {
    return [];
  }

  return buildAuditChanges(
    changedFields,
    buildTaskAuditSnapshot(previousTask, {
      archivedAt: options.previousArchivedAt ?? null,
    }),
    buildTaskAuditSnapshot(nextTask, {
      archivedAt: options.nextArchivedAt ?? null,
    }),
  );
}

function buildTaskAuditSnapshot(
  task: TaskMutationRecord | null,
  options: {
    archivedAt?: Date | null;
  } = {},
) {
  return {
    archivedAt: toAuditDate(options.archivedAt ?? null),
    assigneeUserId: task?.assigneeUserId ?? null,
    completedAt: toAuditDate(task?.completedAt ?? null),
    dueDate: toAuditDate(task?.dueDate ?? null),
    notes: task?.notes ?? null,
    priority: task?.priority ?? null,
    projectId: task?.projectId ?? null,
    status: task?.status ?? null,
    title: task?.title ?? null,
  };
}
