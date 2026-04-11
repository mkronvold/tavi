import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateSavedViewInput,
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
    const filtersJson = toSavedViewFiltersJson(input);
    const layoutState = parseSavedViewLayoutState(filtersJson);
    const savedView = await this.prisma.savedView.create({
      data: {
        userId: actor.id,
        name: input.name,
        groupBy: input.groupBy,
        search: input.search,
        statusFilter: input.statusFilter ?? null,
        filtersJson,
      },
    });

    await this.authService.recordAudit(
      actor.id,
      'saved_view',
      savedView.id,
      'create',
      {
        name: savedView.name,
        groupBy: savedView.groupBy,
        search: savedView.search,
        statusFilter: savedView.statusFilter,
        collapsedGroupCount: layoutState.collapsedGroupKeys.length,
        expandedProjectCount: layoutState.expandedProjectIds.length,
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
    const filtersJson = toSavedViewFiltersJson(input);
    const existingLayoutState = parseSavedViewLayoutState(existing.filtersJson);
    const layoutState = parseSavedViewLayoutState(filtersJson);

    if (input.groupBy !== existing.groupBy) {
      changedFields.push('groupBy');
    }

    if (input.search !== existing.search) {
      changedFields.push('search');
    }

    if ((input.statusFilter ?? null) !== existing.statusFilter) {
      changedFields.push('statusFilter');
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
        statusFilter: input.statusFilter ?? null,
        filtersJson,
      },
    });

    await this.authService.recordAudit(
      actor.id,
      'saved_view',
      savedView.id,
      'update',
      {
        name: savedView.name,
        groupBy: savedView.groupBy,
        search: savedView.search,
        statusFilter: savedView.statusFilter,
        collapsedGroupCount: layoutState.collapsedGroupKeys.length,
        expandedProjectCount: layoutState.expandedProjectIds.length,
        changedFields,
        previousGroupBy: existing.groupBy,
        previousSearch: existing.search,
        previousStatusFilter: existing.statusFilter,
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
      actor.id,
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

    await this.authService.recordAudit(
      actor.id,
      'saved_view',
      viewId,
      'delete',
      {
        name: existing.name,
      },
    );

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

  private toSavedViewResponse(savedView: SavedViewRecord) {
    const layoutState = parseSavedViewLayoutState(savedView.filtersJson);

    return {
      id: savedView.id,
      name: savedView.name,
      groupBy: savedView.groupBy,
      search: savedView.search,
      statusFilter: savedView.statusFilter,
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
