import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateSavedViewInput,
  ProjectStatus,
  RenameSavedViewInput,
  UpdateSavedViewInput,
} from '@tavi/schemas';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import {
  parseSavedViewLayoutState,
  toSavedViewFiltersJson,
} from './saved-view-state';

type SavedViewRecord = {
  id: string;
  userId: string;
  name: string;
  groupBy: string;
  search: string;
  statusFilter: string | null;
  filtersJson: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class SavedViewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  async listSavedViews(actor: SessionUser) {
    const savedViews = await this.prisma.savedView.findMany({
      where: { userId: actor.id },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });

    return savedViews.map((savedView) => this.toSavedViewResponse(savedView));
  }

  async createSavedView(input: CreateSavedViewInput, actor: SessionUser) {
    const viewState = toSavedViewLayoutState(input);
    const filtersJson = toSavedViewFiltersJson(viewState);
    const savedView = await this.prisma.savedView.create({
      data: {
        userId: actor.id,
        name: input.name,
        groupBy: input.groupBy,
        search: input.search,
        statusFilter: null,
        filtersJson,
      },
    });

    await this.authService.recordAudit(
      actor,
      'saved_view',
      savedView.id,
      'create',
      {
        name: savedView.name,
        groupBy: savedView.groupBy,
        search: savedView.search,
        sortBy: viewState.sortBy,
        statusFilters: viewState.statusFilters,
        assigneeCount: viewState.assigneeUserIds.length,
        collapsedGroupCount: viewState.collapsedGroupKeys.length,
        expandedProjectCount: viewState.expandedProjectIds.length,
      },
    );

    return this.toSavedViewResponse(savedView);
  }

  async updateSavedView(
    viewId: string,
    input: UpdateSavedViewInput,
    actor: SessionUser,
  ) {
    const existing = await this.getOwnedSavedView(viewId, actor.id);
    const changedFields: string[] = [];
    const layoutState = toSavedViewLayoutState(input);
    const filtersJson = toSavedViewFiltersJson(layoutState);
    const existingLayoutState = this.readSavedViewState(existing);

    if (input.groupBy !== existing.groupBy) {
      changedFields.push('groupBy');
    }

    if (input.search !== existing.search) {
      changedFields.push('search');
    }

    if (!sameStringArray(layoutState.sortBy, existingLayoutState.sortBy)) {
      changedFields.push('sortBy');
    }

    if (
      !sameStringArray(
        layoutState.statusFilters,
        existingLayoutState.statusFilters,
      )
    ) {
      changedFields.push('statusFilters');
    }

    if (
      !sameStringArray(
        layoutState.assigneeUserIds,
        existingLayoutState.assigneeUserIds,
      )
    ) {
      changedFields.push('assigneeUserIds');
    }

    if (
      !sameStringArray(
        existingLayoutState.collapsedGroupKeys,
        layoutState.collapsedGroupKeys,
      ) ||
      !sameStringArray(
        existingLayoutState.expandedProjectIds,
        layoutState.expandedProjectIds,
      )
    ) {
      changedFields.push('layout');
    }

    const savedView = await this.prisma.savedView.update({
      where: { id: viewId },
      data: {
        groupBy: input.groupBy,
        search: input.search,
        statusFilter: null,
        filtersJson,
      },
    });

    await this.authService.recordAudit(
      actor,
      'saved_view',
      savedView.id,
      'update',
      {
        name: savedView.name,
        groupBy: savedView.groupBy,
        search: savedView.search,
        sortBy: layoutState.sortBy,
        statusFilters: layoutState.statusFilters,
        assigneeCount: layoutState.assigneeUserIds.length,
        collapsedGroupCount: layoutState.collapsedGroupKeys.length,
        expandedProjectCount: layoutState.expandedProjectIds.length,
        changedFields,
        previousGroupBy: existing.groupBy,
        previousSearch: existing.search,
        previousSortBy: existingLayoutState.sortBy,
        previousStatusFilters: existingLayoutState.statusFilters,
        previousAssigneeCount: existingLayoutState.assigneeUserIds.length,
      },
    );

    return this.toSavedViewResponse(savedView);
  }

  async renameSavedView(
    viewId: string,
    input: RenameSavedViewInput,
    actor: SessionUser,
  ) {
    const existing = await this.getOwnedSavedView(viewId, actor.id);

    const savedView = await this.prisma.savedView.update({
      where: { id: viewId },
      data: { name: input.name },
    });

    await this.authService.recordAudit(
      actor,
      'saved_view',
      savedView.id,
      'rename',
      {
        previousName: existing.name,
        name: savedView.name,
      },
    );

    return this.toSavedViewResponse(savedView);
  }

  async deleteSavedView(viewId: string, actor: SessionUser) {
    const existing = await this.getOwnedSavedView(viewId, actor.id);

    await this.prisma.savedView.delete({
      where: { id: viewId },
    });

    await this.authService.recordAudit(actor, 'saved_view', viewId, 'delete', {
      name: existing.name,
    });

    return { id: viewId };
  }

  private async getOwnedSavedView(viewId: string, userId: string) {
    const savedView = await this.prisma.savedView.findFirst({
      where: {
        id: viewId,
        userId,
      },
    });

    if (!savedView) {
      throw new NotFoundException('Saved view not found');
    }

    return savedView;
  }

  private readSavedViewState(savedView: SavedViewRecord) {
    const viewState = parseSavedViewLayoutState(savedView.filtersJson);

    return {
      ...viewState,
      statusFilters:
        viewState.statusFilters.length > 0
          ? viewState.statusFilters
          : normalizeLegacyStatusFilter(savedView.statusFilter),
    };
  }

  private toSavedViewResponse(savedView: SavedViewRecord) {
    const layoutState = this.readSavedViewState(savedView);

    return {
      id: savedView.id,
      name: savedView.name,
      groupBy: savedView.groupBy,
      search: savedView.search,
      ...layoutState,
      createdAt: savedView.createdAt,
      updatedAt: savedView.updatedAt,
    };
  }
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function normalizeLegacyStatusFilter(statusFilter: string | null): ProjectStatus[] {
  switch (statusFilter) {
    case 'not_started':
      return ['not_started'];
    case 'in_progress':
      return ['in_progress'];
    case 'blocked':
      return ['blocked'];
    case 'on_hold':
      return ['on_hold'];
    case 'done':
      return ['done'];
    default:
      return [];
  }
}

function toSavedViewLayoutState(
  input: Pick<
    CreateSavedViewInput | UpdateSavedViewInput,
    'collapsedGroupKeys' | 'expandedProjectIds'
  > & {
    sortBy?: CreateSavedViewInput['sortBy'];
    assigneeUserIds?: string[];
    statusFilter?: string | null;
    statusFilters?: ProjectStatus[];
  },
) {
  return parseSavedViewLayoutState(
    toSavedViewFiltersJson({
      sortBy: input.sortBy ?? [],
      statusFilters:
        input.statusFilters && input.statusFilters.length > 0
          ? input.statusFilters
          : normalizeLegacyStatusFilter(input.statusFilter ?? null),
      assigneeUserIds: input.assigneeUserIds ?? [],
      collapsedGroupKeys: input.collapsedGroupKeys,
      expandedProjectIds: input.expandedProjectIds,
    }),
  );
}
