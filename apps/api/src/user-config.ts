import type {
  GroupBy,
  ProjectSortField,
  ProjectStatus,
  WorkspaceCollapsedGroups,
  WorkspaceFilterState,
  WorkspacePreferences,
  WorkspaceTheme,
  WorkspaceUserConfig,
} from '@tavi/schemas';

const WORKSPACE_THEMES: WorkspaceTheme[] = [
  'light',
  'sepia',
  'spring',
  'ocean',
  'forest',
  'autumn',
  'night',
];

const GROUP_BY_VALUES: GroupBy[] = [
  'none',
  'owner',
  'priority',
  'progress',
  'status',
];

const PROJECT_SORT_FIELD_VALUES: ProjectSortField[] = [
  'title',
  'progress',
  'priority',
  'dueDate',
  'age',
  'lastUpdated',
];

const PROJECT_STATUS_VALUES: ProjectStatus[] = [
  'not_started',
  'in_progress',
  'blocked',
  'on_hold',
  'done',
];

const DEFAULT_WORKSPACE_THEME: WorkspaceTheme = 'light';

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  autoCollapse: true,
  bulkActions: true,
  fullWidth: false,
  theme: DEFAULT_WORKSPACE_THEME,
};

export const DEFAULT_WORKSPACE_USER_CONFIG: WorkspaceUserConfig = {
  addTaskPanels: {},
  collapsedGroups: {},
  filters: {
    assigneeUserIds: [],
    groupBy: 'owner',
    notViewedOnly: false,
    sortBy: [],
    statusFilters: [],
  },
  hideDonePersonalTodos: false,
  hideDoneTasksByProject: {},
  noteEditorHeights: {
    project: null,
    task: null,
  },
  panels: {
    backups: false,
    importExport: false,
    newProject: false,
    personalTodo: false,
    profile: false,
    settings: false,
    view: false,
  },
  preferences: DEFAULT_WORKSPACE_PREFERENCES,
};

export function createDefaultWorkspaceUserConfig(): WorkspaceUserConfig {
  return {
    ...DEFAULT_WORKSPACE_USER_CONFIG,
    addTaskPanels: {},
    collapsedGroups: {},
    filters: {
      ...DEFAULT_WORKSPACE_USER_CONFIG.filters,
      assigneeUserIds: [],
      notViewedOnly: false,
      sortBy: [],
      statusFilters: [],
    },
    hideDoneTasksByProject: {},
    noteEditorHeights: {
      ...DEFAULT_WORKSPACE_USER_CONFIG.noteEditorHeights,
    },
    panels: {
      ...DEFAULT_WORKSPACE_USER_CONFIG.panels,
    },
    preferences: { ...DEFAULT_WORKSPACE_PREFERENCES },
  };
}

export function normalizeWorkspaceUserConfig(
  value: unknown,
): WorkspaceUserConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultWorkspaceUserConfig();
  }

  const raw = value as {
    addTaskPanels?: Record<string, unknown> | null;
    collapsedGroups?: Record<string, unknown> | null;
    filters?: Partial<WorkspaceFilterState> | null;
    hideDonePersonalTodos?: unknown;
    hideDoneTasksByProject?: Record<string, unknown> | null;
    noteEditorHeights?: {
      project?: unknown;
      task?: unknown;
    } | null;
    panels?: Record<string, unknown> | null;
    preferences?: Partial<WorkspacePreferences> | null;
  };

  return {
    addTaskPanels: normalizeBooleanSelection(raw.addTaskPanels),
    collapsedGroups: normalizeCollapsedGroupsByGroup(raw.collapsedGroups),
    filters: normalizeWorkspaceFilterState(raw.filters),
    hideDonePersonalTodos: raw.hideDonePersonalTodos === true,
    hideDoneTasksByProject: normalizeBooleanSelection(
      raw.hideDoneTasksByProject,
    ),
    noteEditorHeights: normalizeNoteEditorHeights(raw.noteEditorHeights),
    panels: normalizeWorkspacePanelState(raw.panels),
    preferences: normalizeWorkspacePreferences(raw.preferences),
  };
}

export function parseStoredWorkspaceUserConfig(
  value: string | null | undefined,
): WorkspaceUserConfig {
  if (!value) {
    return createDefaultWorkspaceUserConfig();
  }

  try {
    return normalizeWorkspaceUserConfig(JSON.parse(value) as unknown);
  } catch {
    return createDefaultWorkspaceUserConfig();
  }
}

export function serializeWorkspaceUserConfig(value: unknown): string {
  return JSON.stringify(normalizeWorkspaceUserConfig(value));
}

function normalizeWorkspacePanelState(
  value: Record<string, unknown> | null | undefined,
) {
  return {
    backups: value?.backups === true,
    importExport: value?.importExport === true,
    newProject: value?.newProject === true,
    personalTodo: value?.personalTodo === true,
    profile: value?.profile === true,
    settings: value?.settings === true,
    view: value?.view === true,
  };
}

function normalizeBooleanSelection(
  value: Record<string, unknown> | null | undefined,
) {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, isSelected]) => isSelected === true),
  ) as Record<string, boolean>;
}

function uniqueStringArray(values: string[]) {
  return [...new Set(values)];
}

function normalizeWorkspacePreferences(
  value: Partial<WorkspacePreferences> | null | undefined,
): WorkspacePreferences {
  return {
    autoCollapse: value?.autoCollapse !== false,
    bulkActions: value?.bulkActions !== false,
    fullWidth: value?.fullWidth === true,
    theme: normalizeWorkspaceTheme(value?.theme),
  };
}

function normalizeWorkspaceTheme(value: unknown): WorkspaceTheme {
  if (value === 'dark') {
    return 'ocean';
  }

  return typeof value === 'string' &&
    WORKSPACE_THEMES.includes(value as WorkspaceTheme)
    ? (value as WorkspaceTheme)
    : DEFAULT_WORKSPACE_THEME;
}

function normalizeWorkspaceFilterState(
  value: Partial<WorkspaceFilterState> | null | undefined,
): WorkspaceFilterState {
  return {
    assigneeUserIds: uniqueStringArray(
      (value?.assigneeUserIds ?? []).filter(
        (entry): entry is string =>
          typeof entry === 'string' && entry.length > 0,
      ),
    ),
    groupBy: isGroupBy(value?.groupBy) ? value.groupBy : 'owner',
    notViewedOnly: value?.notViewedOnly === true,
    sortBy: uniqueStringArray(
      (value?.sortBy ?? []).filter(isProjectSortField),
    ) as ProjectSortField[],
    statusFilters: uniqueStringArray(
      (value?.statusFilters ?? []).filter(isProjectStatus),
    ) as ProjectStatus[],
  };
}

function normalizeCollapsedGroupsByGroup(
  value: Record<string, unknown> | null | undefined,
): WorkspaceCollapsedGroups {
  return Object.fromEntries(
    Object.entries(value ?? {}).flatMap(([groupBy, selection]) => {
      if (
        !isGroupBy(groupBy) ||
        !selection ||
        typeof selection !== 'object' ||
        Array.isArray(selection)
      ) {
        return [];
      }

      const normalizedSelection = normalizeBooleanSelection(
        selection as Record<string, unknown>,
      );

      return Object.keys(normalizedSelection).length === 0
        ? []
        : [[groupBy, normalizedSelection]];
    }),
  ) as WorkspaceCollapsedGroups;
}

function normalizeNoteEditorHeights(
  value:
    | {
        project?: unknown;
        task?: unknown;
      }
    | null
    | undefined,
) {
  return {
    project: normalizeNoteEditorHeight(value?.project),
    task: normalizeNoteEditorHeight(value?.task),
  };
}

function normalizeNoteEditorHeight(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function isGroupBy(value: unknown): value is GroupBy {
  return (
    typeof value === 'string' && GROUP_BY_VALUES.includes(value as GroupBy)
  );
}

function isProjectSortField(value: unknown): value is ProjectSortField {
  return (
    typeof value === 'string' &&
    PROJECT_SORT_FIELD_VALUES.includes(value as ProjectSortField)
  );
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  return (
    typeof value === 'string' &&
    PROJECT_STATUS_VALUES.includes(value as ProjectStatus)
  );
}
