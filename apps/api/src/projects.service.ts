import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@tavi/schemas';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { deriveProjectRollup } from './project-rollup';
import { PrismaService } from './prisma.service';

const toOptionalDate = (value?: string | null) =>
  value ? new Date(value) : null;
const toAuditDate = (value: Date | null) => value?.toISOString() ?? null;
const normalizeOptionalNotes = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
const normalizeOptionalTrackerLink = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};
type ProjectRollupClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async createProject(input: CreateProjectInput, actor: SessionUser) {
    this.authService.requireEditAccess(actor);

    const project = await this.prisma.project.create({
      data: {
        title: input.title,
        summary: input.summary ?? null,
        notes: normalizeOptionalNotes(input.notes),
        trackerLink: normalizeOptionalTrackerLink(input.trackerLink),
        ownerUserId: input.ownerUserId,
        dueDate: toOptionalDate(input.dueDate),
        priority: input.priority,
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
      },
    });

    await this.authService.recordAudit(
      actor.id,
      'project',
      project.id,
      'create',
      {
        title: project.title,
        ownerUserId: project.ownerUserId,
        priority: project.priority,
        dueDate: toAuditDate(project.dueDate),
        trackerLink: project.trackerLink,
      },
    );

    return project;
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

    const nextSummary =
      input.summary === undefined ? existing.summary : (input.summary ?? null);
    const nextNotes =
      input.notes === undefined
        ? existing.notes
        : normalizeOptionalNotes(input.notes);
    const nextTrackerLink =
      input.trackerLink === undefined
        ? existing.trackerLink
        : normalizeOptionalTrackerLink(input.trackerLink);
    const nextDueDate =
      input.dueDate === undefined
        ? existing.dueDate
        : toOptionalDate(input.dueDate);
    const nextManualStatus =
      input.manualStatus === undefined
        ? existing.manualStatus
        : input.manualStatus;
    const nextDisplayStatus = nextManualStatus ?? existing.derivedStatus;
    const changedFields: string[] = [];

    if (input.title !== undefined && input.title !== existing.title) {
      changedFields.push('title');
    }

    if (input.summary !== undefined && nextSummary !== existing.summary) {
      changedFields.push('summary');
    }

    if (input.notes !== undefined && nextNotes !== existing.notes) {
      changedFields.push('notes');
    }

    if (
      input.trackerLink !== undefined &&
      nextTrackerLink !== existing.trackerLink
    ) {
      changedFields.push('trackerLink');
    }

    if (
      input.ownerUserId !== undefined &&
      input.ownerUserId !== existing.ownerUserId
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
    const projectUpdateData: Prisma.ProjectUncheckedUpdateInput = {
      title: input.title ?? existing.title,
      summary: nextSummary,
      notes: nextNotes,
      trackerLink: nextTrackerLink,
      ownerUserId: input.ownerUserId ?? existing.ownerUserId,
      dueDate: nextDueDate,
      priority: input.priority ?? existing.priority,
    };

    if (input.manualStatus !== undefined) {
      projectUpdateData.manualStatus =
        nextManualStatus as Prisma.ProjectUncheckedUpdateInput['manualStatus'];
      projectUpdateData.displayStatus =
        nextDisplayStatus as Prisma.ProjectUncheckedUpdateInput['displayStatus'];
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: projectUpdateData,
    });

    if (metadataChanged) {
      await this.authService.recordAudit(
        actor.id,
        'project',
        projectId,
        'update',
        {
          title: updated.title,
          summary: updated.summary,
          ownerUserId: updated.ownerUserId,
          priority: updated.priority,
          dueDate: toAuditDate(updated.dueDate),
          trackerLink: updated.trackerLink,
          changedFields,
        },
      );
    }

    if (overrideChanged) {
      await this.authService.recordAudit(
        actor.id,
        'project',
        projectId,
        nextManualStatus === null
          ? 'status_override_clear'
          : 'status_override_set',
        nextManualStatus === null
          ? {
              previousManualStatus: existing.manualStatus,
              previousNotes: existing.notes,
              derivedStatus: existing.derivedStatus,
              ...(nextNotes ? { notes: nextNotes } : {}),
            }
          : {
              manualStatus: nextManualStatus,
              ...(nextNotes ? { notes: nextNotes } : {}),
              previousManualStatus: existing.manualStatus,
              previousNotes: existing.notes,
              derivedStatus: existing.derivedStatus,
            },
      );
    }

    return updated;
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
