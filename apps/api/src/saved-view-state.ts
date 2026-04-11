import type { Prisma } from '@prisma/client';

type SavedViewLayoutState = {
  collapsedGroupKeys: string[];
  expandedProjectIds: string[];
};

const EMPTY_LAYOUT_STATE: SavedViewLayoutState = {
  collapsedGroupKeys: [],
  expandedProjectIds: [],
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const uniqueStrings = (values: string[]) => [...new Set(values)];

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
  collapsedGroupKeys: uniqueStrings(layoutState.collapsedGroupKeys),
  expandedProjectIds: uniqueStrings(layoutState.expandedProjectIds),
});
