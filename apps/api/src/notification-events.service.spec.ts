import {
  buildImmediateProjectNotifications,
  buildImmediateTaskNotifications,
  type ImmediateNotificationInput,
} from './notification-events';
import { NotificationEventsService } from './notification-events.service';

function requireStringArrayField(
  notification: ImmediateNotificationInput,
  field: string,
) {
  const value = notification.payload[field];

  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error(`Expected ${field} to be a string array`);
  }

  return value;
}

describe('non-admin notification planning helpers', () => {
  it('queues assignment, due date, and on-hold notifications for a newly created task', () => {
    const notifications = buildImmediateTaskNotifications({
      actorName: 'Tavi Editor',
      nextTask: {
        assigneeUserId: 'user-2',
        dueDate: '2026-04-20T00:00:00.000Z',
        id: 'task-1',
        notes: null,
        priority: 'medium',
        projectId: 'project-1',
        projectTitle: 'Roadmap refresh',
        status: 'on_hold',
        title: 'Confirm approvals',
      },
    });

    expect(notifications).toEqual([
      expect.objectContaining({
        kind: 'task_assigned',
        recipientUserId: 'user-2',
      }),
      expect.objectContaining({
        kind: 'task_due_date_added',
        recipientUserId: 'user-2',
      }),
      expect.objectContaining({
        kind: 'task_on_hold',
        recipientUserId: 'user-2',
      }),
    ]);
  });

  it('queues reassignment, due date, resume, and move notifications for task updates', () => {
    const notifications = buildImmediateTaskNotifications({
      actorName: 'Tavi Editor',
      projectOwnerUserId: 'user-3',
      previousTask: {
        assigneeUserId: 'user-1',
        dueDate: '2026-04-18T00:00:00.000Z',
        id: 'task-1',
        notes: 'Waiting on legal',
        priority: 'medium',
        projectId: 'project-1',
        projectTitle: 'Roadmap refresh',
        status: 'on_hold',
        title: 'Confirm approvals',
      },
      nextTask: {
        assigneeUserId: 'user-2',
        dueDate: '2026-04-19T00:00:00.000Z',
        id: 'task-1',
        notes: 'Ready for release',
        priority: 'high',
        projectId: 'project-2',
        projectTitle: 'Release prep',
        status: 'in_progress',
        title: 'Confirm approvals',
      },
      userDisplayNames: {
        'user-1': 'Old Assignee',
        'user-2': 'New Assignee',
        'user-3': 'Project Owner',
      },
    });

    expect(
      notifications.map((notification) => notification.recipientUserId),
    ).toEqual(['user-2', 'user-3']);
    const [firstNotification] = notifications;

    if (!firstNotification) {
      throw new Error('Expected at least one task notification');
    }

    expect(firstNotification.kind).toBe('task_updated');
    expect(requireStringArrayField(firstNotification, 'fromLines')).toEqual(
      expect.arrayContaining([
        'Assignee: Old Assignee',
        'Priority: Medium',
        'Status: On Hold',
        'Due date: 2026-04-18',
        'Project: Roadmap refresh',
      ]),
    );
    expect(requireStringArrayField(firstNotification, 'toLines')).toEqual(
      expect.arrayContaining([
        'Assignee: New Assignee',
        'Priority: High',
        'Status: In Progress',
        'Due date: 2026-04-19',
        'Project: Release prep',
      ]),
    );
  });

  it('queues owner and on-hold notifications for project updates', () => {
    const notifications = buildImmediateProjectNotifications({
      actorName: 'Tavi Editor',
      previousProject: {
        dueDate: null,
        id: 'project-1',
        notes: 'Waiting on approvals',
        ownerUserId: 'user-1',
        priority: 'medium',
        references: null,
        status: 'in_progress',
        title: 'Roadmap refresh',
      },
      nextProject: {
        dueDate: '2026-04-20T00:00:00.000Z',
        id: 'project-1',
        notes: 'Ready for final review',
        ownerUserId: 'user-2',
        priority: 'high',
        references: 'https://tracker.example.com/projects/roadmap-refresh',
        status: 'on_hold',
        title: 'Roadmap refresh',
      },
      taskAssigneeUserIds: ['user-3', 'user-2'],
      userDisplayNames: {
        'user-1': 'Previous Owner',
        'user-2': 'Current Owner',
        'user-3': 'Task Assignee',
      },
    });

    expect(
      notifications.map((notification) => notification.recipientUserId),
    ).toEqual(['user-2', 'user-3']);
    const [firstNotification] = notifications;

    if (!firstNotification) {
      throw new Error('Expected at least one project notification');
    }

    expect(firstNotification.kind).toBe('project_updated');
    expect(requireStringArrayField(firstNotification, 'fromLines')).toEqual(
      expect.arrayContaining([
        'Owner: Previous Owner',
        'Priority: Medium',
        'Status: In Progress',
        'Due date: None',
      ]),
    );
    expect(requireStringArrayField(firstNotification, 'toLines')).toEqual(
      expect.arrayContaining([
        'Owner: Current Owner',
        'Priority: High',
        'Status: On Hold',
        'Due date: 2026-04-20',
      ]),
    );
  });
});

describe('NotificationEventsService', () => {
  const createService = () => {
    const logger = {
      debug: jest.fn(),
    };
    const createMany = jest.fn(() => Promise.resolve());
    const findProject = jest.fn();
    const findTasks = jest.fn();
    const findUsers = jest.fn();
    const service = new NotificationEventsService(logger as never);
    const prisma = {
      notificationEvent: {
        createMany,
      },
      project: {
        findUnique: findProject,
      },
      task: {
        findMany: findTasks,
      },
      user: {
        findMany: findUsers,
      },
    };

    return {
      mocks: {
        createMany,
        findProject,
        findTasks,
        findUsers,
      },
      prisma,
      service,
    };
  };

  it('queues task update emails for the task assignee and project owner', async () => {
    const { mocks, prisma, service } = createService();

    mocks.findProject.mockResolvedValue({ ownerUserId: 'user-9' });
    mocks.findUsers.mockResolvedValue([
      { id: 'user-2', name: 'Task Assignee' },
      { id: 'user-9', name: 'Project Owner' },
    ]);

    await service.queueTaskChange(
      {
        actor: {
          id: 'user-1',
          email: 'editor@tavi.local',
          name: 'Tavi Editor',
          role: 'editor',
        },
        previousTask: {
          assigneeUserId: 'user-2',
          dueDate: null,
          id: 'task-1',
          notes: 'Draft copy',
          priority: 'medium',
          projectId: 'project-1',
          projectTitle: 'Roadmap refresh',
          status: 'not_started',
          title: 'Kickoff',
        },
        nextTask: {
          assigneeUserId: 'user-2',
          dueDate: '2026-04-22T00:00:00.000Z',
          id: 'task-1',
          notes: 'Final copy',
          priority: 'high',
          projectId: 'project-1',
          projectTitle: 'Roadmap refresh',
          status: 'in_progress',
          title: 'Kickoff',
        },
      },
      prisma as never,
    );

    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          kind: 'task_updated',
          recipientUserId: 'user-2',
        }),
        expect.objectContaining({
          kind: 'task_updated',
          recipientUserId: 'user-9',
        }),
      ],
      skipDuplicates: true,
    });
  });

  it('queues project update emails for the owner and active task assignees', async () => {
    const { mocks, prisma, service } = createService();

    mocks.findTasks.mockResolvedValue([
      { assigneeUserId: 'user-2' },
      { assigneeUserId: 'user-3' },
      { assigneeUserId: 'user-2' },
    ]);
    mocks.findUsers.mockResolvedValue([
      { id: 'user-1', name: 'Project Owner' },
      { id: 'user-2', name: 'Assignee One' },
      { id: 'user-3', name: 'Assignee Two' },
    ]);

    await service.queueProjectChange(
      {
        actor: {
          id: 'user-8',
          email: 'editor@tavi.local',
          name: 'Tavi Editor',
          role: 'editor',
        },
        previousProject: {
          dueDate: null,
          id: 'project-1',
          notes: 'Old project note',
          ownerUserId: 'user-1',
          priority: 'medium',
          references: null,
          status: 'in_progress',
          title: 'Roadmap refresh',
        },
        nextProject: {
          dueDate: '2026-04-25T00:00:00.000Z',
          id: 'project-1',
          notes: 'New project note',
          ownerUserId: 'user-1',
          priority: 'high',
          references: 'https://tracker.example.com/projects/roadmap-refresh',
          status: 'on_hold',
          title: 'Roadmap refresh',
        },
      },
      prisma as never,
    );

    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          kind: 'project_updated',
          recipientUserId: 'user-1',
        }),
        expect.objectContaining({
          kind: 'project_updated',
          recipientUserId: 'user-2',
        }),
        expect.objectContaining({
          kind: 'project_updated',
          recipientUserId: 'user-3',
        }),
      ],
      skipDuplicates: true,
    });
  });
});
