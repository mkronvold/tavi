import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppLogger } from './app-logger';
import type { SessionUser } from './auth.types';
import {
  buildImmediateProjectNotifications,
  buildImmediateTaskNotifications,
  type ImmediateNotificationInput,
  type NotificationProjectSnapshot,
  type NotificationTaskSnapshot,
} from './notification-events';
import type { PrismaService } from './prisma.service';

type NotificationWriteClient =
  | PrismaService
  | Pick<
      Prisma.TransactionClient,
      'notificationEvent' | 'project' | 'task' | 'user'
    >;

const BUFFERED_NON_ADMIN_UPDATE_KINDS = new Set([
  'project_blocked',
  'project_on_hold',
  'project_owner_assigned',
  'project_owner_changed',
  'project_owner_removed',
  'project_resumed',
  'project_updated',
  'task_assigned',
  'task_blocked',
  'task_completed',
  'task_due_date_added',
  'task_due_date_changed',
  'task_moved',
  'task_on_hold',
  'task_reopened',
  'task_resumed',
  'task_unassigned',
  'task_unblocked',
  'task_updated',
]);

@Injectable()
export class NotificationEventsService {
  constructor(private readonly logger: AppLogger) {}

  async queueProjectChange(
    input: {
      actor: SessionUser;
      nextProject: NotificationProjectSnapshot;
      previousProject?: NotificationProjectSnapshot | null;
    },
    prisma: NotificationWriteClient,
  ) {
    const taskAssigneeUserIds =
      input.previousProject === undefined || input.previousProject === null
        ? []
        : await this.readProjectTaskAssigneeUserIds(
            input.nextProject.id,
            prisma,
          );
    const userDisplayNames = await this.readUserDisplayNames(
      [
        input.nextProject.ownerUserId,
        input.previousProject?.ownerUserId ?? null,
        ...taskAssigneeUserIds,
      ],
      prisma,
    );
    const events = buildImmediateProjectNotifications({
      actorName: input.actor.name,
      nextProject: input.nextProject,
      previousProject: input.previousProject ?? null,
      taskAssigneeUserIds,
      userDisplayNames,
    });

    await this.enqueue(events, prisma);
  }

  async queueTaskChange(
    input: {
      actor: SessionUser;
      nextTask: NotificationTaskSnapshot;
      previousTask?: NotificationTaskSnapshot | null;
    },
    prisma: NotificationWriteClient,
  ) {
    const projectOwnerUserId =
      input.previousTask === undefined || input.previousTask === null
        ? null
        : await this.readProjectOwnerUserId(input.nextTask.projectId, prisma);
    const userDisplayNames = await this.readUserDisplayNames(
      [
        projectOwnerUserId,
        input.nextTask.assigneeUserId,
        input.previousTask?.assigneeUserId ?? null,
      ],
      prisma,
    );
    const events = buildImmediateTaskNotifications({
      actorName: input.actor.name,
      nextTask: input.nextTask,
      previousTask: input.previousTask ?? null,
      projectOwnerUserId,
      userDisplayNames,
    });

    await this.enqueue(events, prisma);
  }

  private async enqueue(
    events: ImmediateNotificationInput[],
    prisma: NotificationWriteClient,
  ) {
    if (events.length === 0) {
      return;
    }

    await prisma.notificationEvent.createMany({
      data: events.map((event) => ({
        dedupeKey: event.dedupeKey ?? null,
        kind: event.kind,
        lastError: BUFFERED_NON_ADMIN_UPDATE_KINDS.has(event.kind)
          ? 'buffered_pending'
          : null,
        payload: event.payload as Prisma.InputJsonValue,
        recipientUserId: event.recipientUserId,
      })),
      skipDuplicates: true,
    });

    this.logger.debug('notification.events.queued', {
      count: events.length,
      kinds: [...new Set(events.map((event) => event.kind))],
    });
  }

  private async readProjectOwnerUserId(
    projectId: string,
    prisma: NotificationWriteClient,
  ) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerUserId: true },
    });

    return project?.ownerUserId ?? null;
  }

  private async readProjectTaskAssigneeUserIds(
    projectId: string,
    prisma: NotificationWriteClient,
  ) {
    const tasks = await prisma.task.findMany({
      where: {
        archivedAt: null,
        assigneeUserId: { not: null },
        projectId,
      },
      select: { assigneeUserId: true },
    });

    return [...new Set(tasks.flatMap((task) => task.assigneeUserId ?? []))];
  }

  private async readUserDisplayNames(
    userIds: Array<string | null>,
    prisma: NotificationWriteClient,
  ) {
    const uniqueUserIds = [
      ...new Set(userIds.filter((userId): userId is string => Boolean(userId))),
    ];

    if (uniqueUserIds.length === 0) {
      return {};
    }

    const users = await prisma.user.findMany({
      where: {
        id: { in: uniqueUserIds },
      },
      select: {
        id: true,
        name: true,
      },
    });

    return Object.fromEntries(
      users.map((user) => [user.id, user.name] as const),
    ) as Record<string, string>;
  }
}
