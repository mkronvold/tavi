import type { ProjectSortField, ProjectStatus } from '@tavi/schemas';
import type { Prisma } from '@prisma/client';

type SavedViewLayoutState = {
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
  assigneeUserIds: string[];
  collapsedGroupKeys: string[];
  expandedProjectIds: string[];
};

const EMPTY_LAYOUT_STATE: SavedViewLayoutState = {
  sortBy: [],
  statusFilters: [],
  assigneeUserIds: [],
  collapsedGroupKeys: [],
  expandedProjectIds: [],
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const projectSortFields = new Set([
  'title',
  'progress',
  'priority',
  'dueDate',
  'age',
  'lastUpdated',
]);
const isProjectSortField = (value: string): value is ProjectSortField =>
  projectSortFields.has(value as ProjectSortField);
const isProjectStatus = (value: string): value is ProjectStatus =>
  value === 'not_started' ||
  value === 'in_progress' ||
  value === 'blocked' ||
  value === 'on_hold' ||
  value === 'done';
const toProjectStatus = (value: string): ProjectStatus | null => {
  switch (value) {
    case 'todo':
    case 'not_started':
      return 'not_started';
    case 'in_progress':
      return 'in_progress';
    case 'blocked':
      return 'blocked';
    case 'on_hold':
      return 'on_hold';
    case 'done':
      return 'done';
    default:
      return null;
  }
};

const uniqueStrings = <Value extends string>(values: Value[]) => [
  ...new Set(values),
];

export const parseSavedViewLayoutState = (
  filtersJson: Prisma.JsonValue | Prisma.InputJsonValue | null,
): SavedViewLayoutState => {
  if (
    !filtersJson ||
    typeof filtersJson !== 'object' ||
    Array.isArray(filtersJson)
  ) {
    return EMPTY_LAYOUT_STATE;
  }

  const raw = filtersJson as Record<string, unknown>;

  return {
    sortBy: isStringArray(raw.sortBy)
      ? uniqueStrings(raw.sortBy.filter(isProjectSortField))
      : [],
    statusFilters: isStringArray(raw.statusFilters)
      ? uniqueStrings(
          raw.statusFilters
            .flatMap((status) => {
              const normalizedStatus = toProjectStatus(status);
              return normalizedStatus ? [normalizedStatus] : [];
            })
            .filter(isProjectStatus),
        )
      : [],
    assigneeUserIds: isStringArray(raw.assigneeUserIds)
      ? uniqueStrings(raw.assigneeUserIds)
      : [],
    collapsedGroupKeys: isStringArray(raw.collapsedGroupKeys)
      ? uniqueStrings(raw.collapsedGroupKeys)
      : [],
    expandedProjectIds: isStringArray(raw.expandedProjectIds)
      ? uniqueStrings(raw.expandedProjectIds)
      : [],
  };
};

export const toSavedViewFiltersJson = (
  layoutState: SavedViewLayoutState,
): Prisma.InputJsonValue => ({
  sortBy: uniqueStrings(layoutState.sortBy),
  statusFilters: uniqueStrings(layoutState.statusFilters),
  assigneeUserIds: uniqueStrings(layoutState.assigneeUserIds),
  collapsedGroupKeys: uniqueStrings(layoutState.collapsedGroupKeys),
  expandedProjectIds: uniqueStrings(layoutState.expandedProjectIds),
});
