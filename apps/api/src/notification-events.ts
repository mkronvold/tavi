import type { ProjectStatus, TaskStatus } from '@tavi/schemas';

export type ImmediateNotificationInput = {
  dedupeKey?: string;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  recipientUserId: string;
};

export type NotificationKind =
  | 'daily_project_summary'
  | 'daily_task_summary'
  | 'project_blocked'
  | 'project_on_hold'
  | 'project_updated'
  | 'project_owner_assigned'
  | 'project_owner_changed'
  | 'project_owner_removed'
  | 'project_resumed'
  | 'task_assigned'
  | 'task_blocked'
  | 'task_completed'
  | 'task_due_3_days'
  | 'task_due_7_days'
  | 'task_due_date_added'
  | 'task_due_date_changed'
  | 'task_due_today'
  | 'task_due_tomorrow'
  | 'task_moved'
  | 'task_on_hold'
  | 'task_overdue'
  | 'task_reopened'
  | 'task_resumed'
  | 'task_updated'
  | 'task_unassigned'
  | 'task_unblocked';

export type NotificationTaskSnapshot = {
  assigneeUserId: string | null;
  dueDate: string | null;
  id: string;
  notes: string | null;
  priority: 'low' | 'medium' | 'high';
  projectId: string;
  projectTitle: string | null;
  status: TaskStatus;
  title: string;
};

export type NotificationProjectSnapshot = {
  dueDate: string | null;
  id: string;
  notes: string | null;
  ownerUserId: string | null;
  priority: 'low' | 'medium' | 'high';
  references: string | null;
  status: ProjectStatus;
  title: string;
};

export function buildImmediateTaskNotifications(input: {
  actorName: string;
  nextTask: NotificationTaskSnapshot;
  projectOwnerUserId?: string | null;
  previousTask?: NotificationTaskSnapshot | null;
  userDisplayNames?: Record<string, string>;
}): ImmediateNotificationInput[] {
  const {
    actorName,
    nextTask,
    previousTask = null,
    projectOwnerUserId = null,
    userDisplayNames = {},
  } = input;
  const notifications: ImmediateNotificationInput[] = [];

  const queueForAssignee = (
    kind: NotificationKind,
    recipientUserId: string | null,
    payload: Record<string, unknown> = {},
  ) => {
    if (!recipientUserId) {
      return;
    }

    notifications.push({
      kind,
      payload: buildTaskNotificationPayload(actorName, previousTask, nextTask, payload),
      recipientUserId,
    });
  };

  if (previousTask === null) {
    queueForAssignee('task_assigned', nextTask.assigneeUserId);

    if (nextTask.dueDate) {
      queueForAssignee('task_due_date_added', nextTask.assigneeUserId);
    }

    if (nextTask.status === 'blocked') {
      queueForAssignee('task_blocked', nextTask.assigneeUserId);
    }

    if (nextTask.status === 'on_hold') {
      queueForAssignee('task_on_hold', nextTask.assigneeUserId);
    }

    if (nextTask.status === 'done') {
      queueForAssignee('task_completed', nextTask.assigneeUserId);
    }

    return notifications;
  }

  const changeSummary = buildTaskChangeSummary(
    previousTask,
    nextTask,
    userDisplayNames,
  );
  const recipientUserIds = uniqueUserIds([
    nextTask.assigneeUserId,
    projectOwnerUserId,
  ]);

  if (changeSummary === null || recipientUserIds.length === 0) {
    return notifications;
  }

  return recipientUserIds.map((recipientUserId) => ({
    kind: 'task_updated',
    payload: buildTaskNotificationPayload(actorName, previousTask, nextTask, {
      changedFields: changeSummary.changedFields,
      fromLines: changeSummary.fromLines,
      toLines: changeSummary.toLines,
    }),
    recipientUserId,
  }));
}

export function buildImmediateProjectNotifications(input: {
  actorName: string;
  nextProject: NotificationProjectSnapshot;
  previousProject?: NotificationProjectSnapshot | null;
  taskAssigneeUserIds?: string[];
  userDisplayNames?: Record<string, string>;
}): ImmediateNotificationInput[] {
  const {
    actorName,
    nextProject,
    previousProject = null,
    taskAssigneeUserIds = [],
    userDisplayNames = {},
  } = input;
  const notifications: ImmediateNotificationInput[] = [];

  const queueForOwner = (
    kind: NotificationKind,
    recipientUserId: string | null,
    payload: Record<string, unknown> = {},
  ) => {
    if (!recipientUserId) {
      return;
    }

    notifications.push({
      kind,
      payload: {
        actorName,
        nextOwnerUserId: nextProject.ownerUserId,
        previousOwnerUserId: previousProject?.ownerUserId ?? null,
        previousStatus: previousProject?.status ?? null,
        projectId: nextProject.id,
        projectTitle: nextProject.title,
        status: nextProject.status,
        ...payload,
      },
      recipientUserId,
    });
  };

  if (previousProject === null) {
    queueForOwner('project_owner_assigned', nextProject.ownerUserId);

    if (nextProject.status === 'blocked') {
      queueForOwner('project_blocked', nextProject.ownerUserId);
    }

    if (nextProject.status === 'on_hold') {
      queueForOwner('project_on_hold', nextProject.ownerUserId);
    }

    return notifications;
  }

  const changeSummary = buildProjectChangeSummary(
    previousProject,
    nextProject,
    userDisplayNames,
  );
  const recipientUserIds = uniqueUserIds([
    nextProject.ownerUserId,
    ...taskAssigneeUserIds,
  ]);

  if (changeSummary === null || recipientUserIds.length === 0) {
    return notifications;
  }

  return recipientUserIds.map((recipientUserId) => ({
    kind: 'project_updated',
    payload: {
      actorName,
      changedFields: changeSummary.changedFields,
      fromLines: changeSummary.fromLines,
      nextOwnerUserId: nextProject.ownerUserId,
      previousOwnerUserId: previousProject?.ownerUserId ?? null,
      previousStatus: previousProject?.status ?? null,
      projectId: nextProject.id,
      projectTitle: nextProject.title,
      status: nextProject.status,
      toLines: changeSummary.toLines,
    },
    recipientUserId,
  }));
}

function buildTaskNotificationPayload(
  actorName: string,
  previousTask: NotificationTaskSnapshot | null,
  nextTask: NotificationTaskSnapshot,
  payload: Record<string, unknown>,
) {
  return {
    actorName,
    dueDate: nextTask.dueDate,
    previousAssigneeUserId: previousTask?.assigneeUserId ?? null,
    previousDueDate: previousTask?.dueDate ?? null,
    previousProjectId: previousTask?.projectId ?? null,
    previousProjectTitle: previousTask?.projectTitle ?? null,
    previousStatus: previousTask?.status ?? null,
    projectId: nextTask.projectId,
    projectTitle: nextTask.projectTitle,
    status: nextTask.status,
    taskId: nextTask.id,
    taskTitle: nextTask.title,
    ...payload,
  };
}

function buildTaskChangeSummary(
  previousTask: NotificationTaskSnapshot,
  nextTask: NotificationTaskSnapshot,
  userDisplayNames: Record<string, string>,
) {
  const changes = [
    buildChangeEntry('Title', previousTask.title, nextTask.title),
    buildChangeEntry('Notes', previousTask.notes, nextTask.notes),
    buildChangeEntry(
      'Assignee',
      formatUserDisplay(previousTask.assigneeUserId, userDisplayNames),
      formatUserDisplay(nextTask.assigneeUserId, userDisplayNames),
    ),
    buildChangeEntry(
      'Priority',
      formatLabel(previousTask.priority),
      formatLabel(nextTask.priority),
    ),
    buildChangeEntry(
      'Status',
      formatLabel(previousTask.status),
      formatLabel(nextTask.status),
    ),
    buildChangeEntry(
      'Due date',
      formatDateDisplay(previousTask.dueDate),
      formatDateDisplay(nextTask.dueDate),
    ),
    buildChangeEntry(
      'Project',
      previousTask.projectTitle ?? 'Unassigned',
      nextTask.projectTitle ?? 'Unassigned',
    ),
  ].filter((change): change is { field: string; from: string; to: string } =>
    change !== null,
  );

  if (changes.length === 0) {
    return null;
  }

  return {
    changedFields: changes.map((change) => change.field),
    fromLines: changes.map((change) => `${change.field}: ${change.from}`),
    toLines: changes.map((change) => `${change.field}: ${change.to}`),
  };
}

function buildProjectChangeSummary(
  previousProject: NotificationProjectSnapshot,
  nextProject: NotificationProjectSnapshot,
  userDisplayNames: Record<string, string>,
) {
  const changes = [
    buildChangeEntry('Title', previousProject.title, nextProject.title),
    buildChangeEntry('Notes', previousProject.notes, nextProject.notes),
    buildChangeEntry(
      'References',
      previousProject.references,
      nextProject.references,
    ),
    buildChangeEntry(
      'Owner',
      formatUserDisplay(previousProject.ownerUserId, userDisplayNames),
      formatUserDisplay(nextProject.ownerUserId, userDisplayNames),
    ),
    buildChangeEntry(
      'Priority',
      formatLabel(previousProject.priority),
      formatLabel(nextProject.priority),
    ),
    buildChangeEntry(
      'Status',
      formatLabel(previousProject.status),
      formatLabel(nextProject.status),
    ),
    buildChangeEntry(
      'Due date',
      formatDateDisplay(previousProject.dueDate),
      formatDateDisplay(nextProject.dueDate),
    ),
  ].filter((change): change is { field: string; from: string; to: string } =>
    change !== null,
  );

  if (changes.length === 0) {
    return null;
  }

  return {
    changedFields: changes.map((change) => change.field),
    fromLines: changes.map((change) => `${change.field}: ${change.from}`),
    toLines: changes.map((change) => `${change.field}: ${change.to}`),
  };
}

function buildChangeEntry(
  field: string,
  previousValue: string | null,
  nextValue: string | null,
) {
  const from = normalizeChangeValue(previousValue);
  const to = normalizeChangeValue(nextValue);

  if (from === to) {
    return null;
  }

  return {
    field,
    from,
    to,
  };
}

function normalizeChangeValue(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : 'None';
}

function formatUserDisplay(
  userId: string | null,
  userDisplayNames: Record<string, string>,
) {
  if (!userId) {
    return 'None';
  }

  return userDisplayNames[userId] ?? userId;
}

function formatLabel(value: string) {
  return value
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatDateDisplay(value: string | null) {
  if (!value) {
    return null;
  }

  return value.slice(0, 10);
}

function uniqueUserIds(userIds: Array<string | null>) {
  return [...new Set(userIds.filter((userId): userId is string => Boolean(userId)))];
}
