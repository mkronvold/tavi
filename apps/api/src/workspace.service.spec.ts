import type { SessionUser } from './auth.types';
import { PrismaService } from './prisma.service';
import { SavedViewsService } from './saved-views.service';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  const currentUser: SessionUser = {
    id: 'user-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const createService = () => {
    const findUsersMock = jest.fn();
    const findProjectsMock = jest.fn();
    const listSavedViewsMock = jest.fn();
    const prisma = {
      user: {
        findMany: findUsersMock,
      },
      project: {
        findMany: findProjectsMock,
      },
    } as unknown as PrismaService;
    const savedViewsService = {
      listSavedViews: listSavedViewsMock,
    } as unknown as SavedViewsService;

    return {
      mocks: {
        findProjectsMock,
        findUsersMock,
        listSavedViewsMock,
      },
      service: new WorkspaceService(prisma, savedViewsService),
    };
  };

  it('includes project tracker links in workspace responses', async () => {
    const { mocks, service } = createService();

    mocks.findUsersMock.mockResolvedValue([
      {
        id: 'user-1',
        email: 'editor@tavi.local',
        name: 'Tavi Editor',
        roleAssignment: { role: 'editor' },
      },
    ]);
    mocks.findProjectsMock.mockResolvedValue([
      {
        id: 'project-1',
        title: 'Roadmap refresh',
        summary: null,
        notes: null,
        trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
        ownerUserId: 'user-1',
        owner: {
          name: 'Tavi Editor',
          roleAssignment: { role: 'editor' },
        },
        dueDate: null,
        priority: 'medium',
        derivedStatus: 'not_started',
        displayStatus: 'not_started',
        manualStatus: null,
        taskTotalCount: 0,
        taskTodoCount: 0,
        taskInProgressCount: 0,
        taskBlockedCount: 0,
        taskDoneCount: 0,
        taskCanceledCount: 0,
        taskOverdueCount: 0,
        tasks: [],
      },
    ]);
    mocks.listSavedViewsMock.mockResolvedValue([]);

    const result = await service.getWorkspace(currentUser);

    expect(result.projects).toEqual([
      expect.objectContaining({
        id: 'project-1',
        trackerLink: 'https://tracker.example.com/projects/roadmap-refresh',
      }),
    ]);
  });
});
