import type { ProjectStatus, TaskStatus } from '@tavi/schemas';

type RollupTask = {
  dueDate: Date | null;
  status: TaskStatus;
  archivedAt: Date | null;
};

export type ProjectRollup = {
  derivedStatus: ProjectStatus;
  displayStatus: ProjectStatus;
  taskTotalCount: number;
  taskTodoCount: number;
  taskInProgressCount: number;
  taskBlockedCount: number;
  taskOnHoldCount: number;
  taskDoneCount: number;
  taskCanceledCount: number;
  taskOverdueCount: number;
};

export const deriveProjectRollup = (
  tasks: RollupTask[],
  manualStatus: ProjectStatus | null,
): ProjectRollup => {
  const activeTasks = tasks.filter((task) => task.archivedAt === null);
  const now = new Date();

  const counts = {
    todo: 0,
    in_progress: 0,
    blocked: 0,
    on_hold: 0,
    done: 0,
    canceled: 0,
    overdue: 0,
  };

  for (const task of activeTasks) {
    counts[task.status] += 1;

    if (
      task.dueDate !== null &&
      task.dueDate < now &&
      task.status !== 'done' &&
      task.status !== 'canceled' &&
      task.status !== 'on_hold'
    ) {
      counts.overdue += 1;
    }
  }

  const openTasks = activeTasks.filter((task) => task.status !== 'canceled');
  const actionableTasks = activeTasks.filter(
    (task) => task.status !== 'done' && task.status !== 'canceled',
  );

  let derivedStatus: ProjectStatus = 'not_started';

  if (
    openTasks.length > 0 &&
    openTasks.every((task) => task.status === 'done')
  ) {
    derivedStatus = 'done';
  } else if (
    actionableTasks.length > 0 &&
    actionableTasks.every((task) => task.status === 'blocked')
  ) {
    derivedStatus = 'blocked';
  } else if (
    actionableTasks.length > 0 &&
    actionableTasks.every((task) => task.status === 'on_hold')
  ) {
    derivedStatus = 'on_hold';
  } else if (
    openTasks.length > 0 &&
    openTasks.every((task) => task.status === 'todo')
  ) {
    derivedStatus = 'not_started';
  } else if (actionableTasks.length > 0) {
    derivedStatus = 'in_progress';
  }

  return {
    derivedStatus,
    displayStatus: manualStatus ?? derivedStatus,
    taskTotalCount: activeTasks.length,
    taskTodoCount: counts.todo,
    taskInProgressCount: counts.in_progress,
    taskBlockedCount: counts.blocked,
    taskOnHoldCount: counts.on_hold,
    taskDoneCount: counts.done,
    taskCanceledCount: counts.canceled,
    taskOverdueCount: counts.overdue,
  };
};
