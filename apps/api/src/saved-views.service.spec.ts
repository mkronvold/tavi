import { NotFoundException } from '@nestjs/common';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { SavedViewsService } from './saved-views.service';

describe('SavedViewsService', () => {
  const actor: SessionUser = {
    id: 'user-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const createService = () => {
    const createSavedViewMock = jest.fn();
    const deleteSavedViewMock = jest.fn();
    const findFirstMock = jest.fn();
    const findManyMock = jest.fn();
    const updateSavedViewMock = jest.fn();
    const recordAuditCalls: Array<Parameters<AuthService['recordAudit']>> = [];
    const recordAuditMock = jest.fn(
      (...args: Parameters<AuthService['recordAudit']>) => {
        recordAuditCalls.push(args);
        return Promise.resolve();
      },
    );
    const prisma = {
      savedView: {
        create: createSavedViewMock,
        delete: deleteSavedViewMock,
        findFirst: findFirstMock,
        findMany: findManyMock,
        update: updateSavedViewMock,
      },
    } as unknown as PrismaService;
    const authService = {
      recordAudit: recordAuditMock,
    } as unknown as AuthService;

    return {
      mocks: {
        createSavedViewMock,
        deleteSavedViewMock,
        findFirstMock,
        findManyMock,
        recordAuditCalls,
        recordAuditMock,
        updateSavedViewMock,
      },
      service: new SavedViewsService(prisma, authService),
    };
  };

  it('lists only the current user views and normalizes layout state', async () => {
    const { mocks, service } = createService();

    mocks.findManyMock.mockResolvedValue([
      {
        id: 'view-1',
        userId: actor.id,
        name: 'Blocked review',
        groupBy: 'status',
        search: 'Roadmap',
        statusFilter: 'blocked',
        filtersJson: {
          sortBy: ['progress', 'progress', 'title'],
          assigneeUserIds: ['user-2', 'user-2'],
          collapsedGroupKeys: ['done', 'done', 'blocked'],
          expandedProjectIds: ['project-1', 'project-1'],
        },
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:05:00.000Z'),
      },
    ]);

    const result = await service.listSavedViews(actor);

    expect(mocks.findManyMock).toHaveBeenCalledWith({
      where: { userId: actor.id },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    expect(result).toEqual([
      expect.objectContaining({
        id: 'view-1',
        sortBy: ['progress', 'title'],
        assigneeUserIds: ['user-2'],
        collapsedGroupKeys: ['done', 'blocked'],
        expandedProjectIds: ['project-1'],
        statusFilters: ['blocked'],
      }),
    ]);
  });

  it('maps legacy task-status filters in saved view JSON to project status filters', async () => {
    const { mocks, service } = createService();

    mocks.findManyMock.mockResolvedValue([
      {
        id: 'view-legacy',
        userId: actor.id,
        name: 'Legacy todo view',
        groupBy: 'owner',
        search: '',
        statusFilter: null,
        filtersJson: {
          statusFilters: ['todo', 'todo', 'in_progress', 'canceled'],
        },
        createdAt: new Date('2026-03-01T10:00:00.000Z'),
        updatedAt: new Date('2026-03-01T10:05:00.000Z'),
      },
    ]);

    const result = await service.listSavedViews(actor);

    expect(result).toEqual([
      expect.objectContaining({
        id: 'view-legacy',
        statusFilters: ['not_started', 'in_progress'],
      }),
    ]);
  });

  it('updates saved views with normalized layout state and accurate audit counts', async () => {
    const { mocks, service } = createService();

    mocks.findFirstMock.mockResolvedValue({
      id: 'view-1',
      userId: actor.id,
      name: 'Blocked review',
      groupBy: 'owner',
      search: '',
      statusFilter: null,
      filtersJson: {
        sortBy: [],
        assigneeUserIds: [],
        statusFilters: [],
        collapsedGroupKeys: ['done'],
        expandedProjectIds: [],
      },
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    });
    mocks.updateSavedViewMock.mockResolvedValue({
      id: 'view-1',
      userId: actor.id,
      name: 'Blocked review',
      groupBy: 'status',
      search: 'Roadmap',
      statusFilter: null,
      filtersJson: {
        sortBy: ['progress', 'title'],
        assigneeUserIds: [],
        statusFilters: ['blocked'],
        collapsedGroupKeys: ['done', 'blocked'],
        expandedProjectIds: ['project-1'],
      },
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-01T10:10:00.000Z'),
    });

    const result = await service.updateSavedView(
      'view-1',
      {
        groupBy: 'status',
        search: 'Roadmap',
        sortBy: ['progress', 'title', 'progress'],
        statusFilters: ['blocked'],
        assigneeUserIds: [],
        collapsedGroupKeys: ['done', 'done', 'blocked'],
        expandedProjectIds: ['project-1', 'project-1'],
      },
      actor,
    );

    expect(mocks.updateSavedViewMock).toHaveBeenCalledWith({
      where: { id: 'view-1' },
      data: {
        groupBy: 'status',
        search: 'Roadmap',
        statusFilter: null,
        filtersJson: {
          sortBy: ['progress', 'title'],
          assigneeUserIds: [],
          statusFilters: ['blocked'],
          collapsedGroupKeys: ['done', 'blocked'],
          expandedProjectIds: ['project-1'],
        },
      },
    });
    expect(mocks.recordAuditCalls[0]).toEqual([
      actor,
      'saved_view',
      'view-1',
      'update',
      {
        name: 'Blocked review',
        groupBy: 'status',
        search: 'Roadmap',
        sortBy: ['progress', 'title'],
        statusFilters: ['blocked'],
        assigneeCount: 0,
        collapsedGroupCount: 2,
        expandedProjectCount: 1,
        changedFields: [
          'groupBy',
          'search',
          'sortBy',
          'statusFilters',
          'layout',
        ],
        previousGroupBy: 'owner',
        previousSearch: '',
        previousSortBy: [],
        previousStatusFilters: [],
        previousAssigneeCount: 0,
      },
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        sortBy: ['progress', 'title'],
        assigneeUserIds: [],
        collapsedGroupKeys: ['done', 'blocked'],
        expandedProjectIds: ['project-1'],
        statusFilters: ['blocked'],
      }),
    );
  });

  it('records layout-only saved view changes in audit history', async () => {
    const { mocks, service } = createService();

    mocks.findFirstMock.mockResolvedValue({
      id: 'view-1',
      userId: actor.id,
      name: 'Blocked review',
      groupBy: 'status',
      search: 'Roadmap',
      statusFilter: 'blocked',
      filtersJson: {
        sortBy: ['progress'],
        assigneeUserIds: [],
        statusFilters: ['blocked'],
        collapsedGroupKeys: ['done'],
        expandedProjectIds: [],
      },
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-01T10:00:00.000Z'),
    });
    mocks.updateSavedViewMock.mockResolvedValue({
      id: 'view-1',
      userId: actor.id,
      name: 'Blocked review',
      groupBy: 'status',
      search: 'Roadmap',
      statusFilter: null,
      filtersJson: {
        sortBy: ['progress'],
        assigneeUserIds: [],
        statusFilters: ['blocked'],
        collapsedGroupKeys: ['done'],
        expandedProjectIds: ['project-1'],
      },
      createdAt: new Date('2026-03-01T10:00:00.000Z'),
      updatedAt: new Date('2026-03-01T10:10:00.000Z'),
    });

    await service.updateSavedView(
      'view-1',
      {
        groupBy: 'status',
        search: 'Roadmap',
        sortBy: ['progress'],
        statusFilters: ['blocked'],
        assigneeUserIds: [],
        collapsedGroupKeys: ['done'],
        expandedProjectIds: ['project-1', 'project-1'],
      },
      actor,
    );

    expect(mocks.recordAuditCalls[0]?.[4]).toMatchObject({
      changedFields: ['layout'],
      collapsedGroupCount: 1,
      expandedProjectCount: 1,
    });
  });

  it('rejects updates for views not owned by the actor', async () => {
    const { mocks, service } = createService();

    mocks.findFirstMock.mockResolvedValue(null);

    await expect(
      service.updateSavedView(
        'view-1',
        {
          groupBy: 'status',
          search: '',
          sortBy: [],
          statusFilters: [],
          assigneeUserIds: [],
          collapsedGroupKeys: [],
          expandedProjectIds: [],
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mocks.updateSavedViewMock).not.toHaveBeenCalled();
    expect(mocks.recordAuditMock).not.toHaveBeenCalled();
  });
});
