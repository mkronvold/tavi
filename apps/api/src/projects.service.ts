import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type ConvertProjectToTaskInput,
  type CreateTaskInput,
  type ProjectStatus,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@tavi/schemas';
import type { Prisma } from '@prisma/client';
import { buildAuditChanges } from './audit-change';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { NotificationEventsService } from './notification-events.service';
import { deriveProjectRollup } from './project-rollup';
import { PrismaService } from './prisma.service';

const toOptionalDate = (value?: string | null) =>
  value ? new Date(value) : null;
const toAuditDate = (value: Date | null) => value?.toISOString() ?? null;
const normalizeOptionalNotes = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
const normalizeOptionalReferences = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
const UNASSIGNED_PROJECT_TITLE = 'Unassigned';
type ProjectRollupClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly notificationEventsService: NotificationEventsService,
  ) {}

  async createProject(input: CreateProjectInput, actor: SessionUser) {
    this.authService.requireEditAccess(actor);

    return this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          title: input.title,
          notes: normalizeOptionalNotes(input.notes),
          references: normalizeOptionalReferences(input.references),
          ownerUserId: input.ownerUserId ?? null,
          dueDate: toOptionalDate(input.dueDate),
          priority: input.priority,
          derivedStatus: 'not_started',
          displayStatus: 'not_started',
        },
      });

      await this.authService.recordAudit(
        actor,
        'project',
        project.id,
        'create',
        buildProjectAuditMetadata(project, getCreatedProjectFields(project), {
          changes: buildProjectAuditChanges(
            null,
            project,
            getCreatedProjectFields(project),
          ),
        }),
        tx,
      );
      await this.notificationEventsService.queueProjectChange(
        {
          actor,
          nextProject: toProjectNotificationSnapshot(project),
        },
        tx,
      );

      return project;
    });
  }

  async updateProject(
    projectId: string,
    input: UpdateProjectInput,
    actor: SessionUser,
  ) {
    this.authService.requireEditAccess(actor);

    const existing = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!existing || existing.archivedAt) {
      throw new NotFoundException('Project not found');
    }

    const nextNotes =
      input.notes === undefined
        ? existing.notes
        : normalizeOptionalNotes(input.notes);
    const nextReferences =
      input.references === undefined
        ? existing.references
        : normalizeOptionalReferences(input.references);
    const nextDueDate =
      input.dueDate === undefined
        ? existing.dueDate
        : toOptionalDate(input.dueDate);
    const nextOwnerUserId =
      input.ownerUserId === undefined
        ? existing.ownerUserId
        : input.ownerUserId;
    const nextManualStatus =
      input.manualStatus === undefined
        ? existing.manualStatus
        : input.manualStatus;
    const nextDisplayStatus = nextManualStatus ?? existing.derivedStatus;
    const changedFields: string[] = [];

    if (input.title !== undefined && input.title !== existing.title) {
      changedFields.push('title');
    }

    if (input.notes !== undefined && nextNotes !== existing.notes) {
      changedFields.push('notes');
    }

    if (
      input.references !== undefined &&
      nextReferences !== existing.references
    ) {
      changedFields.push('references');
    }

    if (
      input.ownerUserId !== undefined &&
      nextOwnerUserId !== existing.ownerUserId
    ) {
      changedFields.push('ownerUserId');
    }

    if (
      input.dueDate !== undefined &&
      nextDueDate?.toISOString() !== existing.dueDate?.toISOString()
    ) {
      changedFields.push('dueDate');
    }

    if (input.priority !== undefined && input.priority !== existing.priority) {
      changedFields.push('priority');
    }

    const metadataChanged = changedFields.length > 0;
    const overrideChanged = nextManualStatus !== existing.manualStatus;
    const clearingManualStatus = overrideChanged && nextManualStatus === null;
    const projectUpdateData: Prisma.ProjectUncheckedUpdateInput = {
      title: input.title ?? existing.title,
      notes: nextNotes,
      references: nextReferences,
      ownerUserId: nextOwnerUserId,
      dueDate: nextDueDate,
      priority: input.priority ?? existing.priority,
    };

    if (input.manualStatus !== undefined) {
      projectUpdateData.manualStatus =
        nextManualStatus as Prisma.ProjectUncheckedUpdateInput['manualStatus'];
      if (!clearingManualStatus) {
        projectUpdateData.displayStatus =
          nextDisplayStatus as Prisma.ProjectUncheckedUpdateInput['displayStatus'];
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let updated = await tx.project.update({
        where: { id: projectId },
        data: projectUpdateData,
      });

      if (clearingManualStatus) {
        await this.recalculateProject(projectId, tx);
        updated =
          (await tx.project.findUnique({
            where: { id: projectId },
          })) ?? updated;
      }

      if (metadataChanged) {
        await this.authService.recordAudit(
          actor,
          'project',
          projectId,
          'update',
          buildProjectAuditMetadata(updated, changedFields, {
            changes: buildProjectAuditChanges(existing, updated, changedFields),
          }),
          tx,
        );
      }

      if (overrideChanged) {
        await this.authService.recordAudit(
          actor,
          'project',
          projectId,
          nextManualStatus === null
            ? 'status_override_clear'
            : 'status_override_set',
          nextManualStatus === null
            ? {
                previousManualStatus: existing.manualStatus,
                previousNotes: existing.notes,
                derivedStatus: updated.derivedStatus,
                changes: buildAuditChanges(
                  ['manualStatus'],
                  {
                    manualStatus: existing.manualStatus,
                  },
                  {
                    manualStatus: nextManualStatus,
                  },
                ),
                ...(nextNotes ? { notes: nextNotes } : {}),
              }
            : {
                manualStatus: nextManualStatus,
                ...(nextNotes ? { notes: nextNotes } : {}),
                previousManualStatus: existing.manualStatus,
                previousNotes: existing.notes,
                derivedStatus: existing.derivedStatus,
                changes: buildAuditChanges(
                  ['manualStatus'],
                  {
                    manualStatus: existing.manualStatus,
                  },
                  {
                    manualStatus: nextManualStatus,
                  },
                ),
              },
          tx,
        );
      }

      await this.notificationEventsService.queueProjectChange(
        {
          actor,
          nextProject: toProjectNotificationSnapshot(updated),
          previousProject: toProjectNotificationSnapshot(existing),
        },
        tx,
      );

      return updated;
    });
  }

  async convertProjectToTask(
    projectId: string,
    input: ConvertProjectToTaskInput,
    actor: SessionUser,
  ) {
    this.authService.requireEditAccess(actor);

    const existing = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!existing || existing.archivedAt) {
      throw new NotFoundException('Project not found');
    }

    if (existing.taskTotalCount > 0) {
      throw new ConflictException(
        'Only projects without active tasks can be converted to a task',
      );
    }

    const nextTitle = input.title ?? existing.title;

    if (isUnassignedProjectTitle(nextTitle)) {
      throw new ConflictException(
        `"${UNASSIGNED_PROJECT_TITLE}" cannot be converted to a task`,
      );
    }

    const nextNotes =
      input.notes === undefined
        ? existing.notes
        : normalizeOptionalNotes(input.notes);
    const nextReferences =
      input.references === undefined
        ? existing.references
        : normalizeOptionalReferences(input.references);
    const nextDueDate =
      input.dueDate === undefined
        ? existing.dueDate
        : toOptionalDate(input.dueDate);
    const nextOwnerUserId = input.ownerUserId ?? existing.ownerUserId;
    const nextPriority = input.priority ?? existing.priority;
    const nextManualStatus =
      input.manualStatus === undefined
        ? existing.manualStatus
        : input.manualStatus;
    const nextDisplayStatus = nextManualStatus ?? existing.derivedStatus;
    const nextTaskStatus = toTaskStatus(nextDisplayStatus);
    const changedFields: string[] = [];
    const archivedAt = new Date();

    if (nextTitle !== existing.title) {
      changedFields.push('title');
    }

    if (nextNotes !== existing.notes) {
      changedFields.push('notes');
    }

    if (nextReferences !== existing.references) {
      changedFields.push('references');
    }

    if (nextOwnerUserId !== existing.ownerUserId) {
      changedFields.push('ownerUserId');
    }

    if (toAuditDate(nextDueDate) !== toAuditDate(existing.dueDate)) {
      changedFields.push('dueDate');
    }

    if (nextPriority !== existing.priority) {
      changedFields.push('priority');
    }

    if (nextManualStatus !== existing.manualStatus) {
      changedFields.push('manualStatus');
    }

    changedFields.push('archivedAt');

    return this.prisma.$transaction(async (tx) => {
      const existingUnassignedProject = await tx.project.findFirst({
        where: {
          archivedAt: null,
          id: { not: projectId },
          title: {
            equals: UNASSIGNED_PROJECT_TITLE,
            mode: 'insensitive',
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      const destinationProject =
        existingUnassignedProject ??
        (await tx.project.create({
          data: {
            title: UNASSIGNED_PROJECT_TITLE,
            notes: null,
            references: null,
            ownerUserId: nextOwnerUserId,
            dueDate: null,
            priority: 'medium',
            derivedStatus: 'not_started',
            displayStatus: 'not_started',
          },
        }));
      const highestSortOrder = await tx.task.findFirst({
        where: { projectId: destinationProject.id },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const taskCompletedAt = nextTaskStatus === 'done' ? new Date() : null;
      const task = await tx.task.create({
        data: {
          projectId: destinationProject.id,
          title: nextTitle,
          notes: nextNotes,
          assigneeUserId: nextOwnerUserId,
          dueDate: nextDueDate,
          priority: nextPriority,
          status: nextTaskStatus,
          sortOrder: (highestSortOrder?.sortOrder ?? -1) + 1,
          completedAt: taskCompletedAt,
        },
      });
      const project = await tx.project.update({
        where: { id: projectId },
        data: {
          title: nextTitle,
          notes: nextNotes,
          references: nextReferences,
          ownerUserId: nextOwnerUserId,
          dueDate: nextDueDate,
          priority: nextPriority,
          manualStatus:
            nextManualStatus as Prisma.ProjectUncheckedUpdateInput['manualStatus'],
          displayStatus:
            nextDisplayStatus as Prisma.ProjectUncheckedUpdateInput['displayStatus'],
          archivedAt,
        },
      });

      await this.recalculateProject(destinationProject.id, tx);

      if (!existingUnassignedProject) {
        await this.authService.recordAudit(
          actor,
          'project',
          destinationProject.id,
          'create',
          buildProjectAuditMetadata(
            destinationProject,
            getCreatedProjectFields(destinationProject),
            {
              changes: buildProjectAuditChanges(
                null,
                destinationProject,
                getCreatedProjectFields(destinationProject),
              ),
            },
          ),
          tx,
        );
      }

      await this.authService.recordAudit(
        actor,
        'task',
        task.id,
        'convert_from_project',
        {
          title: task.title,
          projectId: task.projectId,
          assigneeUserId: task.assigneeUserId,
          priority: task.priority,
          status: task.status,
          dueDate: toAuditDate(task.dueDate),
          sourceProjectId: projectId,
        },
        tx,
      );
      await this.authService.recordAudit(
        actor,
        'project',
        project.id,
        'convert_to_task',
        buildProjectAuditMetadata(project, changedFields, {
          archivedAt: toAuditDate(project.archivedAt),
          changes: buildProjectAuditChanges(existing, project, changedFields, {
            nextArchivedAt: project.archivedAt,
          }),
          destinationProjectId: destinationProject.id,
          status: task.status,
          taskId: task.id,
        }),
        tx,
      );

      return {
        projectId: destinationProject.id,
        taskId: task.id,
      };
    });
  }

  async deleteProject(projectId: string, actor: SessionUser) {
    this.authService.requireEditAccess(actor);

    const existing = await this.prisma.project.findUnique({
      where: { id: projectId },
    });

    if (!existing || existing.archivedAt) {
      throw new NotFoundException('Project not found');
    }

    const archivedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      const [project, archivedTasks] = await Promise.all([
        tx.project.update({
          where: { id: projectId },
          data: { archivedAt },
        }),
        tx.task.updateMany({
          where: {
            projectId,
            archivedAt: null,
          },
          data: { archivedAt },
        }),
      ]);

      await this.authService.recordAudit(
        actor,
        'project',
        project.id,
        'delete',
        buildProjectAuditMetadata(project, ['archivedAt'], {
          archivedAt: toAuditDate(project.archivedAt),
          archivedTaskCount: archivedTasks.count,
          changes: buildProjectAuditChanges(existing, project, ['archivedAt'], {
            nextArchivedAt: project.archivedAt,
          }),
        }),
        tx,
      );

      return {
        id: project.id,
        archivedTaskCount: archivedTasks.count,
      };
    });
  }

  async recalculateProject(
    projectId: string,
    prisma: ProjectRollupClient = this.prisma,
  ) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        tasks: {
          where: { archivedAt: null },
          select: {
            dueDate: true,
            status: true,
            archivedAt: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const rollup = deriveProjectRollup(
      project.tasks.map((task) => ({
        dueDate: task.dueDate,
        status: task.status,
        archivedAt: task.archivedAt,
      })),
      project.manualStatus,
    );

    await prisma.project.update({
      where: { id: projectId },
      data: rollup,
    });
  }
}

function isUnassignedProjectTitle(value: string) {
  return value.trim().toLowerCase() === UNASSIGNED_PROJECT_TITLE.toLowerCase();
}

function toTaskStatus(status: ProjectStatus): CreateTaskInput['status'] {
  return status;
}

function getCreatedProjectFields(project: {
  dueDate: Date | null;
  manualStatus?: string | null;
  notes: string | null;
  ownerUserId: string | null;
  priority: string;
  title: string;
  references: string | null;
}) {
  return [
    'title',
    'notes',
    'ownerUserId',
    'priority',
    'dueDate',
    'references',
  ].filter((field) => {
    switch (field) {
      case 'notes':
        return project.notes !== null;
      case 'ownerUserId':
        return project.ownerUserId !== null;
      case 'dueDate':
        return project.dueDate !== null;
      case 'references':
        return project.references !== null;
      default:
        return true;
    }
  });
}

function buildProjectAuditMetadata(
  project: {
    dueDate: Date | null;
    manualStatus?: string | null;
    notes: string | null;
    ownerUserId: string | null;
    priority: string;
    title: string;
    references: string | null;
  },
  changedFields: string[] = [],
  extra: Record<string, unknown> = {},
) {
  return {
    title: project.title,
    notes: project.notes,
    ownerUserId: project.ownerUserId,
    priority: project.priority,
    dueDate: toAuditDate(project.dueDate),
    ...(project.manualStatus !== undefined
      ? { manualStatus: project.manualStatus }
      : {}),
    references: project.references,
    ...(changedFields.length > 0 ? { changedFields } : {}),
    ...extra,
  };
}

function buildProjectAuditChanges(
  previousProject: {
    dueDate: Date | null;
    manualStatus?: string | null;
    notes: string | null;
    ownerUserId: string | null;
    priority: string;
    title: string;
    references: string | null;
  } | null,
  nextProject: {
    dueDate: Date | null;
    manualStatus?: string | null;
    notes: string | null;
    ownerUserId: string | null;
    priority: string;
    title: string;
    references: string | null;
  },
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
    buildProjectAuditSnapshot(previousProject, {
      archivedAt: options.previousArchivedAt ?? null,
    }),
    buildProjectAuditSnapshot(nextProject, {
      archivedAt: options.nextArchivedAt ?? null,
    }),
  );
}

function buildProjectAuditSnapshot(
  project: {
    dueDate: Date | null;
    manualStatus?: string | null;
    notes: string | null;
    ownerUserId: string | null;
    priority: string;
    title: string;
    references: string | null;
  } | null,
  options: {
    archivedAt?: Date | null;
  } = {},
) {
  return {
    archivedAt: toAuditDate(options.archivedAt ?? null),
    dueDate: toAuditDate(project?.dueDate ?? null),
    manualStatus: project?.manualStatus ?? null,
    notes: project?.notes ?? null,
    ownerUserId: project?.ownerUserId ?? null,
    priority: project?.priority ?? null,
    title: project?.title ?? null,
    references: project?.references ?? null,
  };
}

function toProjectNotificationSnapshot(project: {
  dueDate: Date | null;
  displayStatus: ProjectStatus;
  id: string;
  notes: string | null;
  ownerUserId: string | null;
  priority: CreateProjectInput['priority'];
  references: string | null;
  title: string;
}) {
  return {
    dueDate: toAuditDate(project.dueDate),
    id: project.id,
    notes: project.notes,
    ownerUserId: project.ownerUserId,
    priority: project.priority,
    references: project.references,
    status: project.displayStatus,
    title: project.title,
  };
}
