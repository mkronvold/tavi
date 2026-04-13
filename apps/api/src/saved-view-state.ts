import type { ProjectSortField } from '@tavi/schemas';
import type { Prisma } from '@prisma/client';

type SavedViewLayoutState = {
  sortBy: ProjectSortField[];
  statusFilters: string[];
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
const projectSortFields = new Set<ProjectSortField>([
  'title',
  'progress',
  'priority',
  'dueDate',
]);
const isProjectSortField = (value: string): value is ProjectSortField =>
  projectSortFields.has(value as ProjectSortField);

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
      ? uniqueStrings(raw.statusFilters)
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
