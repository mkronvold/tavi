import {
  type DragEvent as ReactDragEvent,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appName, appRepositoryUrl, appVersion } from "@tavi/config";
import type {
  AuditEntityType,
  Priority,
  ProjectStatus,
  TaskStatus,
} from "@tavi/schemas";
import "./App.css";
import {
  ApiError,
  bulkCopyTasks,
  bulkDeleteTasks,
  bulkUpdateTasks,
  convertProjectToTask,
  convertTaskToProject,
  createProject,
  createSavedView,
  createTask,
  deleteProject,
  deleteSavedView,
  deleteTask,
  getAuditHistory,
  getAuditLogRetention,
  getLocalLoginHint,
  getNotificationPreferences,
  getSmtpStatus,
  getWorkspace,
  isApiUnavailableError,
  listAuditChanges,
  listAuditLogins,
  login,
  logout,
  purgeAuditLogs,
  renameSavedView,
  reorderProjectTasks,
  setAuditLogRetention,
  updateEmailSettings,
  updateMyProfile,
  updateNotificationPreferences,
  updateProject,
  updateSavedView,
  updateTask,
} from "./api";
import { BackupSettingsCard } from "./BackupSettingsCard";
import { ExportPanel } from "./ExportPanel";
import { downloadCsvFile } from "./export-utils";
import { ImportPanel } from "./ImportPanel";
import { LocalAccountsPanel } from "./LocalAccountsPanel";
import {
  extractUrlFilename,
  NotesMarkdown,
  truncateDisplayLinkLabel,
} from "./NotesMarkdown";
import { PersonalTodoPanel } from "./PersonalTodoPanel";
import { getAppHomeUrl } from "./runtime-config";
import {
  clearTaviStorage,
  readTaviStorage,
  removeTaviStorage,
  writeTaviStorage,
} from "./storage";
import type {
  AuditHistoryEvent,
  AuditLogRetentionWindow,
  CreateProjectPayload,
  CreateTaskPayload,
  GroupBy,
  LoginPayload,
  NotificationPreferences,
  ProjectSortField,
  SavedView,
  SmtpStatus,
  UpdateOwnProfilePayload,
  WorkspaceUser,
  UpdateProjectPayload,
  UpdateTaskPayload,
  WorkspaceProject,
  WorkspaceResponse,
  WorkspaceTask,
} from "./types";

const GROUP_LABELS: Record<GroupBy, string> = {
  none: "Projects",
  owner: "Owner",
  priority: "Priority",
  status: "Status",
  progress: "Progress",
};

const PROJECT_SORT_OPTIONS: Array<{
  label: string;
  value: ProjectSortField;
}> = [
  { label: "Title", value: "title" },
  { label: "Progress", value: "progress" },
  { label: "Priority", value: "priority" },
  { label: "Due Date", value: "dueDate" },
  { label: "Age", value: "age" },
  { label: "Last Updated", value: "lastUpdated" },
];

const PROJECT_STATUS_FILTER_OPTIONS: Array<{
  label: string;
  value: ProjectStatus;
}> = [
  { label: "Not started", value: "not_started" },
  { label: "In progress", value: "in_progress" },
  { label: "Blocked", value: "blocked" },
  { label: "On hold", value: "on_hold" },
  { label: "Done", value: "done" },
];

const EMPTY_PROJECT_FORM: CreateProjectPayload = {
  title: "",
  notes: "",
  references: "",
  ownerUserId: null,
  dueDate: "",
  priority: "medium",
};

const EMPTY_LOGIN_FORM: LoginPayload = {
  email: "",
  password: "",
};

const BRAND_MARK = "ᴛᴀᴠi";
const EDITOR_SCROLL_TOP_MARGIN = 132;
const EDITOR_SCROLL_BOTTOM_MARGIN = 24;
const SCROLL_TO_TOP_VISIBILITY_OFFSET = 240;
const EDITOR_INPUT_SELECTOR =
  'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])';
const ROW_EDIT_INTERACTIVE_SELECTOR =
  "button, a, input, select, textarea, label";

type WorkspacePanelState = {
  backups: boolean;
  importExport: boolean;
  newProject: boolean;
  personalTodo: boolean;
  profile: boolean;
  settings: boolean;
  view: boolean;
};

const WORKSPACE_THEMES = [
  "light",
  "sepia",
  "spring",
  "ocean",
  "forest",
  "autumn",
  "night",
] as const;

type WorkspaceTheme = (typeof WORKSPACE_THEMES)[number];

type WorkspaceFilterState = {
  assigneeUserIds: string[];
  groupBy: GroupBy;
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
};

type WorkspaceCollapsedGroups = Partial<
  Record<GroupBy, Record<string, boolean>>
>;

type NoteEditorType = "project" | "task";
type TaskDropPosition = "before" | "after";

type NoteEditorHeights = {
  project: number | null;
  task: number | null;
};

type TaskDragState = {
  projectId: string;
  taskId: string;
  overTaskId: string;
  position: TaskDropPosition;
};

type WorkspacePreferences = {
  autoCollapse: boolean;
  bulkActions: boolean;
  fullWidth: boolean;
  theme: WorkspaceTheme;
};

type BulkTaskDraft = {
  assigneeMode: "keep" | "set" | "clear";
  assigneeUserId: string;
  copyTargetProjectId: string;
  dueDate: string;
  dueDateMode: "keep" | "set" | "clear";
  notesMode: "keep" | "clear";
  priority: Priority | "";
  status: TaskStatus | "";
};

type AuditTarget = {
  emptyMessage: string;
  entityId: string;
  entityType: AuditEntityType;
  subtitle: string;
  title: string;
};

type AdminAuditReportType = "changes" | "logins";

const AUDIT_CHANGE_ACTION_OPTIONS = [
  { label: "All actions", value: "" },
  { label: "Create", value: "create" },
  { label: "Update", value: "update" },
  { label: "Delete", value: "delete" },
  { label: "Bulk copy", value: "bulk_copy" },
  { label: "Bulk update", value: "bulk_update" },
  { label: "Bulk delete", value: "bulk_delete" },
  { label: "Converted to project", value: "convert_to_project" },
  { label: "Converted from project", value: "convert_from_project" },
  { label: "Converted to task", value: "convert_to_task" },
  { label: "Status override set", value: "status_override_set" },
  { label: "Status override clear", value: "status_override_clear" },
  { label: "Import create", value: "import_create" },
  { label: "Import update", value: "import_update" },
] as const;

const AUDIT_LOG_RETENTION_OPTIONS: Array<{
  label: string;
  value: AuditLogRetentionWindow;
}> = [
  { label: "1 day", value: "one_day" },
  { label: "1 week", value: "one_week" },
  { label: "1 month", value: "one_month" },
  { label: "3 months", value: "three_months" },
  { label: "6 months", value: "six_months" },
  { label: "1 year", value: "one_year" },
];

const DEFAULT_AUDIT_LOG_RETENTION_WINDOW: AuditLogRetentionWindow = "one_month";
const BULK_CLEAR_ASSIGNEE_VALUE = "__none__";

const createEmptyBulkTaskDraft = (): BulkTaskDraft => ({
  assigneeMode: "keep",
  assigneeUserId: "",
  copyTargetProjectId: "",
  dueDate: "",
  dueDateMode: "keep",
  notesMode: "keep",
  priority: "",
  status: "",
});

const DEFAULT_WORKSPACE_PANEL_STATE: WorkspacePanelState = {
  backups: false,
  importExport: false,
  newProject: false,
  personalTodo: false,
  profile: false,
  settings: false,
  view: false,
};

const DEFAULT_WORKSPACE_THEME: WorkspaceTheme = "light";

const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  autoCollapse: true,
  bulkActions: true,
  fullWidth: false,
  theme: DEFAULT_WORKSPACE_THEME,
};

const WORKSPACE_THEME_META: Record<
  WorkspaceTheme,
  { colorScheme: "dark" | "light"; label: string }
> = {
  autumn: { colorScheme: "dark", label: "Autumn" },
  forest: { colorScheme: "dark", label: "Forest" },
  light: { colorScheme: "light", label: "Light" },
  night: { colorScheme: "dark", label: "Night" },
  ocean: { colorScheme: "dark", label: "Ocean" },
  sepia: { colorScheme: "light", label: "Sepia" },
  spring: { colorScheme: "light", label: "Spring" },
};

const PANEL_STORAGE_KEY = "workspace.panels";
const ADD_TASK_PANEL_STORAGE_KEY = "workspace.projectAddTask";
const PREFERENCES_STORAGE_KEY = "workspace.preferences";
const FILTER_STORAGE_KEY = "workspace.filters";
const COLLAPSED_GROUPS_STORAGE_KEY = "workspace.collapsedGroups";
const NOTE_EDITOR_HEIGHTS_STORAGE_KEY = "workspace.noteEditorHeights";
const HIDE_DONE_TASKS_STORAGE_KEY = "workspace.hideDoneTasks";
const HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY = "workspace.personalTodos.hideDone";
const UNASSIGNED_PROJECT_TITLE = "Unassigned";
const UNASSIGNED_FILTER_VALUE = "__unassigned__";
const CONVERT_TASK_TO_PROJECT_VALUE = "__convert-task-to-project__";
const NO_TASK_ASSIGNEE_LABEL = "None";
const NO_PROJECT_OWNER_LABEL = "None";
const NO_PROJECT_OWNER_GROUP = "No owner";
const FIBONACCI_BACKOFF_MS = [
  1_000, 1_000, 2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 34_000, 55_000,
] as const;

function getFibonacciBackoffMs(attempt: number) {
  if (attempt <= 1) {
    return FIBONACCI_BACKOFF_MS[0];
  }

  return FIBONACCI_BACKOFF_MS[
    Math.min(attempt - 1, FIBONACCI_BACKOFF_MS.length - 1)
  ];
}

function App() {
  const queryClient = useQueryClient();
  const [loginForm, setLoginForm] = useState<LoginPayload>(EMPTY_LOGIN_FORM);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [workspacePreferences, setWorkspacePreferences] =
    useState<WorkspacePreferences>(() =>
      normalizeWorkspacePreferences(
        readTaviStorage<Partial<WorkspacePreferences>>(
          PREFERENCES_STORAGE_KEY,
          {},
        ),
      ),
    );

  useEffect(() => {
    if (
      workspacePreferences.theme === DEFAULT_WORKSPACE_PREFERENCES.theme &&
      workspacePreferences.autoCollapse ===
        DEFAULT_WORKSPACE_PREFERENCES.autoCollapse &&
      workspacePreferences.bulkActions ===
        DEFAULT_WORKSPACE_PREFERENCES.bulkActions &&
      workspacePreferences.fullWidth === DEFAULT_WORKSPACE_PREFERENCES.fullWidth
    ) {
      removeTaviStorage(PREFERENCES_STORAGE_KEY);
      return;
    }

    writeTaviStorage(PREFERENCES_STORAGE_KEY, workspacePreferences);
  }, [workspacePreferences]);

  useEffect(() => {
    document.documentElement.dataset.theme = workspacePreferences.theme;
    document.documentElement.style.colorScheme =
      WORKSPACE_THEME_META[workspacePreferences.theme].colorScheme;

    return () => {
      delete document.documentElement.dataset.theme;
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [workspacePreferences.theme]);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
    refetchInterval: (query) =>
      isApiUnavailableError(query.state.error)
        ? getFibonacciBackoffMs(query.state.fetchFailureCount)
        : false,
    refetchIntervalInBackground: true,
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: async () => {
      setLoginError(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) => {
      setLoginError(
        error instanceof ApiError ? error.message : "Unable to sign in",
      );
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
  });

  const authRequired =
    workspaceQuery.error instanceof ApiError &&
    workspaceQuery.error.status === 401;
  const localLoginHintQuery = useQuery({
    queryKey: ["localLoginHint"],
    queryFn: getLocalLoginHint,
    enabled: authRequired,
    retry: false,
  });
  const showLocalLoginHint =
    authRequired &&
    localLoginHintQuery.isSuccess &&
    !localLoginHintQuery.isFetching &&
    localLoginHintQuery.data.visible;

  if (workspaceQuery.isLoading) {
    return <div className="screen-state">Loading tavi...</div>;
  }

  if (authRequired) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <header>
            <span className="brand-mark">{BRAND_MARK}</span>
            <h1>{appName}</h1>
            <p>
              tavi - short for Track And Visualize. We mostly just call it tavi.
            </p>
          </header>

          <form
            className="login-form"
            onSubmit={(event) => {
              event.preventDefault();
              loginMutation.mutate(loginForm);
            }}
          >
            <label>
              Email
              <input
                type="email"
                value={loginForm.email}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={loginForm.password}
                onChange={(event) =>
                  setLoginForm((current) => ({
                    ...current,
                    password: event.target.value,
                  }))
                }
              />
            </label>

            <button type="submit" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Signing in..." : "Sign in"}
            </button>
          </form>

          {showLocalLoginHint ? (
            <div className="login-hint">
              <strong>Local dev users</strong>
              <span>
                admin@tavi.local, editor@tavi.local, viewer@tavi.local
              </span>
              <span>Password: password123</span>
            </div>
          ) : null}

          {loginError ? <p className="error-banner">{loginError}</p> : null}
        </section>
      </main>
    );
  }

  if (workspaceQuery.isError || !workspaceQuery.data) {
    return (
      <div className="screen-state error-state">
        {workspaceQuery.error instanceof Error
          ? workspaceQuery.error.message
          : "Unable to load the workspace"}
      </div>
    );
  }

  return (
    <WorkspaceScreen
      data={workspaceQuery.data}
      onBulkActionsChange={(bulkActions) =>
        setWorkspacePreferences((current) => ({
          ...current,
          bulkActions,
        }))
      }
      onLogout={() => logoutMutation.mutate()}
      onAutoCollapseChange={(autoCollapse) =>
        setWorkspacePreferences((current) => ({
          ...current,
          autoCollapse,
        }))
      }
      onFullWidthChange={(fullWidth) =>
        setWorkspacePreferences((current) => ({
          ...current,
          fullWidth,
        }))
      }
      onResetPreferences={() =>
        setWorkspacePreferences(DEFAULT_WORKSPACE_PREFERENCES)
      }
      onThemeChange={(theme) =>
        setWorkspacePreferences((current) => ({
          ...current,
          theme,
        }))
      }
      preferences={workspacePreferences}
      queryClient={queryClient}
    />
  );
}

type WorkspaceScreenProps = {
  data: WorkspaceResponse;
  onBulkActionsChange: (bulkActions: boolean) => void;
  onLogout: () => void;
  onAutoCollapseChange: (autoCollapse: boolean) => void;
  onFullWidthChange: (fullWidth: boolean) => void;
  onResetPreferences: () => void;
  onThemeChange: (theme: WorkspaceTheme) => void;
  preferences: WorkspacePreferences;
  queryClient: ReturnType<typeof useQueryClient>;
};

function WorkspaceScreen({
  data,
  onBulkActionsChange,
  onLogout,
  onAutoCollapseChange,
  onFullWidthChange,
  onResetPreferences,
  onThemeChange,
  preferences,
  queryClient,
}: WorkspaceScreenProps) {
  const [panelState, setPanelState] = useState<WorkspacePanelState>(() =>
    normalizeWorkspacePanelState(
      readTaviStorage<Partial<WorkspacePanelState>>(PANEL_STORAGE_KEY, {}),
    ),
  );
  const [workspaceFilters, setWorkspaceFilters] =
    useState<WorkspaceFilterState>(() =>
      normalizeWorkspaceFilterState(
        readTaviStorage<Partial<WorkspaceFilterState>>(FILTER_STORAGE_KEY, {}),
      ),
    );
  const [collapsedGroupsByGroup, setCollapsedGroupsByGroup] =
    useState<WorkspaceCollapsedGroups>(() =>
      normalizeCollapsedGroupsByGroup(
        readTaviStorage<WorkspaceCollapsedGroups>(
          COLLAPSED_GROUPS_STORAGE_KEY,
          {},
        ),
      ),
    );
  const [noteEditorHeights, setNoteEditorHeights] = useState<NoteEditorHeights>(
    () =>
      normalizeNoteEditorHeights(
        readTaviStorage<Partial<NoteEditorHeights>>(
          NOTE_EDITOR_HEIGHTS_STORAGE_KEY,
          {},
        ),
      ),
  );
  const {
    assigneeUserIds: assigneeFilterUserIds,
    groupBy,
    sortBy,
    statusFilters,
  } = workspaceFilters;
  const collapsedGroups = collapsedGroupsByGroup[groupBy] ?? {};
  const noteEditorResizeStartHeights = useRef<NoteEditorHeights>({
    project: null,
    task: null,
  });
  const projectEditFormRef = useRef<HTMLFormElement | null>(null);
  const taskEditRowRef = useRef<HTMLTableRowElement | null>(null);
  const validAssigneeUserIds = useMemo(
    () => new Set(data.users.map((user) => user.id)),
    [data.users],
  );
  const effectiveAssigneeFilterUserIds = useMemo(
    () =>
      assigneeFilterUserIds.filter(
        (userId) =>
          userId === UNASSIGNED_FILTER_VALUE ||
          validAssigneeUserIds.has(userId),
      ),
    [assigneeFilterUserIds, validAssigneeUserIds],
  );
  const [search, setSearch] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const [hideDoneTasksByProject, setHideDoneTasksByProject] = useState<
    Record<string, boolean>
  >(() =>
    normalizeBooleanSelection(
      readTaviStorage<Record<string, boolean>>(HIDE_DONE_TASKS_STORAGE_KEY, {}),
    ),
  );
  const [hideDonePersonalTodos, setHideDonePersonalTodos] = useState(() =>
    readTaviStorage<boolean>(HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY, false) ===
    true,
  );
  const [projectForm, setProjectForm] = useState<CreateProjectPayload>({
    ...EMPTY_PROJECT_FORM,
    ownerUserId: data.currentUser.id,
  });
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState<UpdateProjectPayload>({
    title: "",
    notes: "",
    references: "",
    ownerUserId: null,
    dueDate: "",
    priority: "medium",
    manualStatus: null,
  });
  const [projectEditError, setProjectEditError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskEditError, setTaskEditError] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<UpdateTaskPayload>({
    title: "",
    notes: "",
    assigneeUserId: data.currentUser.id,
    dueDate: "",
    priority: "medium",
    status: "todo",
  });
  const [newTaskByProject, setNewTaskByProject] = useState<
    Record<string, CreateTaskPayload>
  >({});
  const [addTaskPanels, setAddTaskPanels] = useState<Record<string, boolean>>(
    () =>
      normalizeBooleanSelection(
        readTaviStorage<Record<string, boolean>>(
          ADD_TASK_PANEL_STORAGE_KEY,
          {},
        ),
      ),
  );
  const [selectedSavedViewId, setSelectedSavedViewId] = useState<string | null>(
    null,
  );
  const [savedViewName, setSavedViewName] = useState("");
  const [savedViewError, setSavedViewError] = useState<string | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<Record<string, boolean>>(
    {},
  );
  const [bulkTaskDraft, setBulkTaskDraft] = useState<BulkTaskDraft>(
    createEmptyBulkTaskDraft,
  );
  const [bulkTaskError, setBulkTaskError] = useState<string | null>(null);
  const [auditTarget, setAuditTarget] = useState<AuditTarget | null>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState<string | null>(null);
  const [taskDragState, setTaskDragState] = useState<TaskDragState | null>(
    null,
  );
  const [showScrollToTop, setShowScrollToTop] = useState(
    () => readViewportScrollOffset() > SCROLL_TO_TOP_VISIBILITY_OFFSET,
  );
  const canEditWorkspace = data.currentUser.role !== "viewer";
  const appHomeUrl = getAppHomeUrl();
  const { autoCollapse, bulkActions, fullWidth, theme } = preferences;
  const canSelectTasks = canEditWorkspace && bulkActions;
  const invalidateWorkspaceAndAudit = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  const setGroupBy = (nextGroupBy: GroupBy) => {
    setWorkspaceFilters((current) =>
      current.groupBy === nextGroupBy
        ? current
        : {
            ...current,
            groupBy: nextGroupBy,
          },
    );
  };
  const setSortBy = (nextSortBy: ProjectSortField[]) => {
    setWorkspaceFilters((current) =>
      sameStringArray(current.sortBy, nextSortBy)
        ? current
        : {
            ...current,
            sortBy: nextSortBy,
          },
    );
  };
  const setStatusFilters = (nextStatusFilters: ProjectStatus[]) => {
    setWorkspaceFilters((current) =>
      sameStringArray(current.statusFilters, nextStatusFilters)
        ? current
        : {
            ...current,
            statusFilters: nextStatusFilters,
          },
    );
  };
  const setAssigneeFilterUserIds = (nextAssigneeUserIds: string[]) => {
    setWorkspaceFilters((current) =>
      sameStringArray(current.assigneeUserIds, nextAssigneeUserIds)
        ? current
        : {
            ...current,
            assigneeUserIds: nextAssigneeUserIds,
          },
    );
  };
  const setCollapsedGroupsForGroupBy = (
    targetGroupBy: GroupBy,
    nextValue:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>),
  ) => {
    setCollapsedGroupsByGroup((current) => {
      const currentSelection = current[targetGroupBy] ?? {};
      const nextSelection = normalizeBooleanSelection(
        typeof nextValue === "function"
          ? nextValue(currentSelection)
          : nextValue,
      );

      if (sameBooleanSelection(currentSelection, nextSelection)) {
        return current;
      }

      if (Object.keys(nextSelection).length === 0) {
        if (!(targetGroupBy in current)) {
          return current;
        }

        const remainingSelections = { ...current };

        delete remainingSelections[targetGroupBy];
        return remainingSelections;
      }

      return {
        ...current,
        [targetGroupBy]: nextSelection,
      };
    });
  };
  const setCollapsedGroups = (
    nextValue:
      | Record<string, boolean>
      | ((current: Record<string, boolean>) => Record<string, boolean>),
  ) => {
    setCollapsedGroupsForGroupBy(groupBy, nextValue);
  };
  const rememberNoteEditorHeight = (
    editorType: NoteEditorType,
    textarea: HTMLTextAreaElement,
  ) => {
    noteEditorResizeStartHeights.current[editorType] =
      readTextareaHeight(textarea);
  };
  const persistNoteEditorHeight = (
    editorType: NoteEditorType,
    textarea: HTMLTextAreaElement,
  ) => {
    const startHeight = noteEditorResizeStartHeights.current[editorType];
    const nextHeight = readTextareaHeight(textarea);

    noteEditorResizeStartHeights.current[editorType] = null;

    if (
      startHeight === null ||
      nextHeight === null ||
      startHeight === nextHeight
    ) {
      return;
    }

    setNoteEditorHeights((current) =>
      current[editorType] === nextHeight
        ? current
        : {
            ...current,
            [editorType]: nextHeight,
          },
    );
  };

  useEffect(() => {
    if (
      groupBy === "owner" &&
      sortBy.length === 0 &&
      statusFilters.length === 0 &&
      effectiveAssigneeFilterUserIds.length === 0
    ) {
      removeTaviStorage(FILTER_STORAGE_KEY);
      return;
    }

    writeTaviStorage(FILTER_STORAGE_KEY, {
      ...workspaceFilters,
      assigneeUserIds: effectiveAssigneeFilterUserIds,
    });
  }, [
    effectiveAssigneeFilterUserIds,
    groupBy,
    sortBy,
    statusFilters,
    workspaceFilters,
  ]);

  useEffect(() => {
    const activeCollapsedGroups = activeCollapsedGroupsByGroup(
      collapsedGroupsByGroup,
    );

    if (Object.keys(activeCollapsedGroups).length === 0) {
      removeTaviStorage(COLLAPSED_GROUPS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(COLLAPSED_GROUPS_STORAGE_KEY, activeCollapsedGroups);
  }, [collapsedGroupsByGroup]);

  useEffect(() => {
    if (noteEditorHeights.project === null && noteEditorHeights.task === null) {
      removeTaviStorage(NOTE_EDITOR_HEIGHTS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(NOTE_EDITOR_HEIGHTS_STORAGE_KEY, noteEditorHeights);
  }, [noteEditorHeights]);

  useLayoutEffect(() => {
    if (!editingProjectId) {
      return;
    }

    revealEditor(projectEditFormRef.current);
  }, [editingProjectId]);

  useLayoutEffect(() => {
    if (!editingTaskId) {
      return;
    }

    revealEditor(taskEditRowRef.current);
  }, [editingTaskId]);

  useEffect(() => {
    const activePanels = activeBooleanSelection(panelState);

    if (Object.keys(activePanels).length === 0) {
      removeTaviStorage(PANEL_STORAGE_KEY);
      return;
    }

    writeTaviStorage(PANEL_STORAGE_KEY, activePanels);
  }, [panelState]);

  useEffect(() => {
    if (data.currentUser.role === "admin" || !panelState.settings) {
      return;
    }

    setPanelState((current) =>
      current.settings
        ? {
            ...current,
            settings: false,
          }
        : current,
    );
  }, [data.currentUser.role, panelState.settings]);

  useEffect(() => {
    const activeAddTaskPanels = activeBooleanSelection(addTaskPanels);

    if (Object.keys(activeAddTaskPanels).length === 0) {
      removeTaviStorage(ADD_TASK_PANEL_STORAGE_KEY);
      return;
    }

    writeTaviStorage(ADD_TASK_PANEL_STORAGE_KEY, activeAddTaskPanels);
  }, [addTaskPanels]);

  useEffect(() => {
    const activeHiddenDoneTasks = activeBooleanSelection(hideDoneTasksByProject);

    if (Object.keys(activeHiddenDoneTasks).length === 0) {
      removeTaviStorage(HIDE_DONE_TASKS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(HIDE_DONE_TASKS_STORAGE_KEY, activeHiddenDoneTasks);
  }, [hideDoneTasksByProject]);

  useEffect(() => {
    if (!hideDonePersonalTodos) {
      removeTaviStorage(HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY);
      return;
    }

    writeTaviStorage(HIDE_DONE_PERSONAL_TODOS_STORAGE_KEY, true);
  }, [hideDonePersonalTodos]);

  useEffect(() => {
    const syncScrollToTopVisibility = () => {
      setShowScrollToTop(
        readViewportScrollOffset() > SCROLL_TO_TOP_VISIBILITY_OFFSET,
      );
    };

    syncScrollToTopVisibility();
    globalThis.addEventListener("scroll", syncScrollToTopVisibility, {
      passive: true,
    });

    return () => {
      globalThis.removeEventListener("scroll", syncScrollToTopVisibility);
    };
  }, []);

  const clearSelectedTasksForProjects = (projectIds: string[]) => {
    if (projectIds.length === 0) {
      return;
    }

    const taskIdsToClear = new Set(
      data.projects
        .filter((project) => projectIds.includes(project.id))
        .flatMap((project) => project.tasks.map((task) => task.id)),
    );

    if (taskIdsToClear.size === 0) {
      return;
    }

    const hadSelectedTasks = Array.from(taskIdsToClear).some(
      (taskId) => selectedTasks[taskId],
    );

    setSelectedTasks((current) => {
      const nextSelectedTasks = { ...current };
      let changed = false;

      taskIdsToClear.forEach((taskId) => {
        if (taskId in nextSelectedTasks) {
          delete nextSelectedTasks[taskId];
          changed = true;
        }
      });

      return changed ? nextSelectedTasks : current;
    });

    if (hadSelectedTasks) {
      setBulkTaskError(null);
    }
  };
  const clearSelectedTask = (taskId: string) => {
    const hadSelectedTask = Boolean(selectedTasks[taskId]);

    setSelectedTasks((current) => {
      if (!(taskId in current)) {
        return current;
      }

      const nextSelectedTasks = { ...current };

      delete nextSelectedTasks[taskId];
      return nextSelectedTasks;
    });

    if (hadSelectedTask) {
      setBulkTaskError(null);
    }
  };
  const clearAddTaskPanelsForProjects = (projectIds: string[]) => {
    if (projectIds.length === 0) {
      return;
    }

    setAddTaskPanels((current) => {
      const nextAddTaskPanels = { ...current };
      let changed = false;

      for (const projectId of projectIds) {
        if (!(projectId in nextAddTaskPanels)) {
          continue;
        }

        delete nextAddTaskPanels[projectId];
        changed = true;
      }

      return changed ? nextAddTaskPanels : current;
    });
  };
  const clearProjectPanels = (projectId: string) => {
    setExpandedProjects((current) => {
      if (!(projectId in current)) {
        return current;
      }

      const nextExpandedProjects = { ...current };

      delete nextExpandedProjects[projectId];
      return nextExpandedProjects;
    });
    clearAddTaskPanelsForProjects([projectId]);
  };
  const revealExpandedProjectCard = (projectId: string) => {
    const reveal = () => {
      revealElementInViewport(
        document.querySelector<HTMLElement>(
          `[data-project-card-id="${projectId}"]`,
        ),
      );
    };

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(reveal);
      return;
    }

    globalThis.setTimeout(reveal, 0);
  };

  const setProjectExpanded = (projectId: string, nextValue: boolean) => {
    const collapsedProjectIds = !nextValue
      ? [projectId]
      : autoCollapse
        ? Object.keys(expandedProjects).filter(
            (expandedProjectId) => expandedProjectId !== projectId,
          )
        : [];
    const shouldRevealExpandedProject =
      nextValue && autoCollapse && collapsedProjectIds.length > 0;

    clearAddTaskPanelsForProjects(collapsedProjectIds);

    if (!nextValue) {
      clearSelectedTasksForProjects(collapsedProjectIds);
    } else if (autoCollapse) {
      clearSelectedTasksForProjects(collapsedProjectIds);
    }

    setExpandedProjects((current) => {
      if (!nextValue) {
        if (!current[projectId]) {
          return current;
        }

        const remaining = { ...current };

        delete remaining[projectId];
        return remaining;
      }

      if (!autoCollapse) {
        return {
          ...current,
          [projectId]: true,
        };
      }

      return {
        [projectId]: true,
      };
    });

    if (shouldRevealExpandedProject) {
      revealExpandedProjectCard(projectId);
    }
  };

  const openProjectEditor = (project: WorkspaceProject) => {
    setTaskEditError(null);
    setEditingTaskId(null);
    setProjectExpanded(project.id, true);
    setProjectEditError(null);
    setEditingProjectId(project.id);
    setProjectDraft({
      title: project.title,
      notes: project.notes ?? "",
      references: project.references ?? "",
      ownerUserId: project.ownerUserId,
      dueDate: toDateInput(project.dueDate),
      priority: project.priority,
      manualStatus: project.manualStatus,
    });
  };

  const openTaskEditor = (projectId: string, selectedTask: WorkspaceTask) => {
    const enterEditMode = () => {
      setEditingTaskId(selectedTask.id);
      setTaskDraft({
        projectId: selectedTask.projectId,
        title: selectedTask.title,
        notes: selectedTask.notes ?? "",
        assigneeUserId: selectedTask.assigneeUserId,
        dueDate: toDateInput(selectedTask.dueDate),
        priority: selectedTask.priority,
        status: selectedTask.status,
      });
    };

    setProjectExpanded(projectId, true);
    setProjectEditError(null);
    setEditingProjectId(null);
    setTaskEditError(null);

    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(enterEditMode);
      return;
    }

    globalThis.setTimeout(enterEditMode, 0);
  };

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: async () => {
      setProjectForm({
        ...EMPTY_PROJECT_FORM,
        ownerUserId: data.currentUser.id,
      });
      await invalidateWorkspaceAndAudit();
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: UpdateProjectPayload;
    }) => updateProject(projectId, payload),
    onSuccess: async () => {
      setProjectEditError(null);
      setEditingProjectId(null);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setProjectEditError(
        error instanceof ApiError ? error.message : "Unable to save project",
      );
    },
  });
  const convertProjectToTaskMutation = useMutation({
    mutationFn: async ({
      payload,
      project,
    }: {
      payload: UpdateProjectPayload;
      project: WorkspaceProject;
    }) => {
      const result = await convertProjectToTask(project.id, payload);

      return {
        ...result,
        title: payload.title ?? project.title,
      };
    },
    onSuccess: async (result, variables) => {
      setProjectEditError(null);
      setEditingProjectId(null);
      clearProjectPanels(variables.project.id);

      if (
        auditTarget?.entityType === "project" &&
        auditTarget.entityId === variables.project.id
      ) {
        setAuditTarget(null);
      }

      setProjectExpanded(result.projectId, true);
      setWorkspaceNotice(
        `Converted project "${result.title}" into a task in ${UNASSIGNED_PROJECT_TITLE}.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setProjectEditError(
        error instanceof ApiError
          ? error.message
          : "Unable to convert project into a task",
      );
    },
  });
  const deleteProjectMutation = useMutation({
    mutationFn: ({ projectId }: { projectId: string; title: string }) =>
      deleteProject(projectId),
    onSuccess: async (result, variables) => {
      const deletedProject = data.projects.find(
        (project) => project.id === variables.projectId,
      );
      const deletedTaskIds = new Set(
        deletedProject?.tasks.map((task) => task.id) ?? [],
      );

      clearSelectedTasksForProjects([variables.projectId]);
      clearProjectPanels(variables.projectId);
      setProjectEditError(null);
      setEditingProjectId(null);

      if (editingTaskId && deletedTaskIds.has(editingTaskId)) {
        setEditingTaskId(null);
      }

      if (
        auditTarget &&
        ((auditTarget.entityType === "project" &&
          auditTarget.entityId === variables.projectId) ||
          (auditTarget.entityType === "task" &&
            deletedTaskIds.has(auditTarget.entityId)))
      ) {
        setAuditTarget(null);
      }

      setWorkspaceNotice(
        result.archivedTaskCount === 0
          ? `Deleted project "${variables.title}" from the workspace.`
          : `Deleted project "${variables.title}" and ${result.archivedTaskCount.toString()} task${result.archivedTaskCount === 1 ? "" : "s"} from the workspace.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(null);
      setProjectEditError(
        error instanceof ApiError ? error.message : "Unable to delete project",
      );
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: CreateTaskPayload;
    }) => createTask(projectId, payload),
    onSuccess: async (_, variables) => {
      setProjectExpanded(variables.projectId, true);
      setAddTaskPanels((current) => ({
        ...current,
        [variables.projectId]: true,
      }));
      setNewTaskByProject((current) => ({
        ...current,
        [variables.projectId]: nextTaskPayload(
          data.currentUser.id,
          variables.payload,
        ),
      }));
      await invalidateWorkspaceAndAudit();
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: UpdateTaskPayload;
    }) => updateTask(taskId, payload),
    onSuccess: async (_, variables) => {
      setTaskEditError(null);
      setEditingTaskId(null);
      if (variables.payload.projectId) {
        setProjectExpanded(variables.payload.projectId, true);
      }
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setTaskEditError(
        error instanceof ApiError ? error.message : "Unable to save task",
      );
    },
  });
  const convertTaskToProjectMutation = useMutation({
    mutationFn: async ({
      payload,
      task,
    }: {
      payload: Omit<UpdateTaskPayload, "projectId">;
      task: WorkspaceTask;
    }) => {
      const result = await convertTaskToProject(task.id, payload);

      return {
        ...result,
        title: payload.title ?? task.title,
      };
    },
    onSuccess: async (result, variables) => {
      setTaskEditError(null);
      setEditingTaskId(null);
      clearSelectedTask(variables.task.id);

      if (
        auditTarget?.entityType === "task" &&
        auditTarget.entityId === variables.task.id
      ) {
        setAuditTarget(null);
      }

      setProjectExpanded(result.projectId, true);
      setWorkspaceNotice(`Converted task "${result.title}" into a project.`);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(
        error instanceof ApiError
          ? error.message
          : "Unable to convert task into a project",
      );
    },
  });
  const deleteTaskMutation = useMutation({
    mutationFn: ({ taskId }: { taskId: string; title: string }) =>
      deleteTask(taskId),
    onSuccess: async (_, variables) => {
      setTaskEditError(null);
      setEditingTaskId(null);
      clearSelectedTask(variables.taskId);

      if (
        auditTarget?.entityType === "task" &&
        auditTarget.entityId === variables.taskId
      ) {
        setAuditTarget(null);
      }

      setWorkspaceNotice(
        `Deleted task "${variables.title}" from the workspace.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(
        error instanceof ApiError ? error.message : "Unable to delete task",
      );
    },
  });
  const reorderProjectTasksMutation = useMutation({
    mutationFn: ({
      projectId,
      taskIds,
    }: {
      projectId: string;
      taskIds: string[];
    }) => reorderProjectTasks(projectId, { taskIds }),
    onMutate: async (variables) => {
      setWorkspaceNotice(null);
      await queryClient.cancelQueries({ queryKey: ["workspace"] });
      const previous = queryClient.getQueryData<WorkspaceResponse>([
        "workspace",
      ]);

      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        reorderWorkspaceProjectTasks(
          current,
          variables.projectId,
          variables.taskIds,
        ),
      );

      return { previous };
    },
    onSuccess: async (_result, variables) => {
      setProjectExpanded(variables.projectId, true);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["workspace"], context.previous);
      }

      setWorkspaceNotice(
        error instanceof ApiError ? error.message : "Unable to reorder tasks",
      );
    },
    onSettled: () => {
      setTaskDragState(null);
    },
  });

  const bulkUpdateTaskMutation = useMutation({
    mutationFn: bulkUpdateTasks,
    onSuccess: async () => {
      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setBulkTaskError(
        error instanceof ApiError ? error.message : "Unable to update tasks",
      );
    },
  });
  const bulkCopyTaskMutation = useMutation({
    mutationFn: bulkCopyTasks,
    onSuccess: async (result, variables) => {
      const targetProject = data.projects.find(
        (project) => project.id === variables.targetProjectId,
      );

      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
      setWorkspaceNotice(
        targetProject
          ? `Copied ${result.copiedCount.toString()} task${result.copiedCount === 1 ? "" : "s"} to "${targetProject.title}".`
          : `Copied ${result.copiedCount.toString()} task${result.copiedCount === 1 ? "" : "s"} to the selected project.`,
      );
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setWorkspaceNotice(null);
      setBulkTaskError(
        error instanceof ApiError ? error.message : "Unable to copy tasks",
      );
    },
  });
  const bulkDeleteTaskMutation = useMutation({
    mutationFn: bulkDeleteTasks,
    onSuccess: async (result) => {
      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
      setWorkspaceNotice(
        `Deleted ${result.archivedCount.toString()} task${result.archivedCount === 1 ? "" : "s"} from the workspace.`,
      );

      if (
        auditTarget?.entityType === "task" &&
        result.archivedTaskIds.includes(auditTarget.entityId)
      ) {
        setAuditTarget(null);
      }

      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    },
    onError: (error) => {
      setWorkspaceNotice(null);
      setBulkTaskError(
        error instanceof ApiError ? error.message : "Unable to delete tasks",
      );
    },
  });

  const createSavedViewMutation = useMutation({
    mutationFn: createSavedView,
    onSuccess: async (savedView: SavedView) => {
      setSavedViewError(null);
      setSelectedSavedViewId(savedView.id);
      setSavedViewName(savedView.name);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to save view",
      );
    },
  });

  const updateSavedViewMutation = useMutation({
    mutationFn: ({
      viewId,
      payload,
    }: {
      viewId: string;
      payload: ReturnType<typeof buildSavedViewPayload>;
    }) => updateSavedView(viewId, payload),
    onSuccess: async () => {
      setSavedViewError(null);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to update view",
      );
    },
  });

  const renameSavedViewMutation = useMutation({
    mutationFn: ({ viewId, name }: { viewId: string; name: string }) =>
      renameSavedView(viewId, { name }),
    onSuccess: async (_, variables) => {
      setSavedViewError(null);
      setSavedViewName(variables.name);
      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to rename view",
      );
    },
  });

  const deleteSavedViewMutation = useMutation({
    mutationFn: deleteSavedView,
    onSuccess: async (_, deletedViewId) => {
      setSavedViewError(null);

      if (selectedSavedViewId === deletedViewId) {
        setSelectedSavedViewId(null);
        setSavedViewName("");
      }

      await invalidateWorkspaceAndAudit();
    },
    onError: (error) => {
      setSavedViewError(
        error instanceof ApiError ? error.message : "Unable to delete view",
      );
    },
  });

  const filteredProjects = useMemo(
    () =>
      filterProjects({
        assigneeUserIds: effectiveAssigneeFilterUserIds,
        projects: data.projects,
        search,
        statusFilters,
      }),
    [data.projects, effectiveAssigneeFilterUserIds, search, statusFilters],
  );
  const groupedProjects = useMemo(
    () => groupProjects(filteredProjects, groupBy, sortBy),
    [filteredProjects, groupBy, sortBy],
  );
  const orderedProjects = useMemo(
    () => groupedProjects.flatMap((group) => group.projects),
    [groupedProjects],
  );
  const selectedSavedView = useMemo(
    () =>
      data.savedViews.find(
        (savedView) => savedView.id === selectedSavedViewId,
      ) ?? null,
    [data.savedViews, selectedSavedViewId],
  );
  const fullProjectById = useMemo(
    () =>
      Object.fromEntries(
        data.projects.map((project) => [project.id, project]),
      ) as Record<string, WorkspaceProject>,
    [data.projects],
  );
  const hiddenDoneTaskIds = useMemo(
    () =>
      new Set(
        filteredProjects.flatMap((project) =>
          hideDoneTasksByProject[project.id]
            ? project.tasks
                .filter((task) => task.status === "done")
                .map((task) => task.id)
            : [],
        ),
      ),
    [filteredProjects, hideDoneTasksByProject],
  );
  const visibleTasks = useMemo(
    () =>
      filteredProjects.flatMap((project) =>
        hideDoneTasksByProject[project.id]
          ? project.tasks.filter((task) => task.status !== "done")
          : project.tasks,
      ),
    [filteredProjects, hideDoneTasksByProject],
  );
  const selectedTaskItems = useMemo(
    () => visibleTasks.filter((task) => selectedTasks[task.id]),
    [selectedTasks, visibleTasks],
  );
  const selectedTaskIds = useMemo(
    () => selectedTaskItems.map((task) => task.id),
    [selectedTaskItems],
  );
  const selectedProjectCount = useMemo(
    () => new Set(selectedTaskItems.map((task) => task.projectId)).size,
    [selectedTaskItems],
  );

  useEffect(() => {
    if (hiddenDoneTaskIds.size === 0) {
      return;
    }

    const hasHiddenSelectedTasks = Array.from(hiddenDoneTaskIds).some(
      (taskId) => selectedTasks[taskId],
    );

    if (hasHiddenSelectedTasks) {
      setSelectedTasks((current) => {
        const nextSelection = { ...current };

        hiddenDoneTaskIds.forEach((taskId) => {
          delete nextSelection[taskId];
        });

        return nextSelection;
      });
      setBulkTaskError(null);
    }

    if (editingTaskId && hiddenDoneTaskIds.has(editingTaskId)) {
      setTaskEditError(null);
      setEditingTaskId(null);
    }
  }, [editingTaskId, hiddenDoneTaskIds, selectedTasks]);

  const userLookup = useMemo(
    () =>
      Object.fromEntries(data.users.map((user) => [user.id, user])) as Record<
        string,
        WorkspaceUser
      >,
    [data.users],
  );
  const assigneeFilterOptions = useMemo(
    () => [
      { label: "Unassigned", value: UNASSIGNED_FILTER_VALUE },
      ...data.users.map((user) => ({ label: user.name, value: user.id })),
    ],
    [data.users],
  );
  const hasBulkChanges =
    bulkTaskDraft.assigneeMode !== "keep" ||
    bulkTaskDraft.dueDateMode !== "keep" ||
    bulkTaskDraft.notesMode !== "keep" ||
    bulkTaskDraft.priority !== "" ||
    bulkTaskDraft.status !== "";
  const hasBulkCopyTarget = bulkTaskDraft.copyTargetProjectId !== "";
  const bulkTaskActionPending =
    bulkUpdateTaskMutation.isPending ||
    bulkCopyTaskMutation.isPending ||
    bulkDeleteTaskMutation.isPending;
  const stickyBulkActionsVisible =
    canSelectTasks && selectedTaskItems.length > 0;
  const auditHistoryQuery = useQuery({
    queryKey: [
      "audit",
      auditTarget?.entityType ?? "",
      auditTarget?.entityId ?? "",
    ],
    queryFn: () => {
      if (!auditTarget) {
        return Promise.resolve([]);
      }

      return getAuditHistory(auditTarget.entityType, auditTarget.entityId, 25);
    },
    enabled: auditTarget !== null,
  });

  const applySavedView = (savedView: SavedView) => {
    setGroupBy(savedView.groupBy);
    setSearch(savedView.search);
    setSortBy(savedView.sortBy);
    setStatusFilters(savedView.statusFilters);
    setAssigneeFilterUserIds(savedView.assigneeUserIds);
    setCollapsedGroupsForGroupBy(
      savedView.groupBy,
      toSelectionMap(savedView.collapsedGroupKeys),
    );
    setExpandedProjects(toSelectionMap(savedView.expandedProjectIds));
    setSelectedSavedViewId(savedView.id);
    setSavedViewName(savedView.name);
    setSavedViewError(null);
  };

  const openAuditHistory = (nextTarget: AuditTarget) => {
    setAuditTarget(nextTarget);
  };

  const clearBulkTaskSelection = () => {
    setBulkTaskError(null);
    setSelectedTasks({});
    setBulkTaskDraft(createEmptyBulkTaskDraft());
  };

  const handleBulkActionsChange = (nextBulkActions: boolean) => {
    if (!nextBulkActions) {
      setBulkTaskError(null);
      setSelectedTasks({});
      setBulkTaskDraft(createEmptyBulkTaskDraft());
    }

    onBulkActionsChange(nextBulkActions);
  };

  const toggleWorkspacePanel = (panel: keyof WorkspacePanelState) => {
    setWorkspaceNotice(null);
    setPanelState((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  };
  const setWorkspacePanelOpen = (
    panel: keyof WorkspacePanelState,
    isOpen: boolean,
  ) => {
    setWorkspaceNotice(null);
    setPanelState((current) =>
      current[panel] === isOpen
        ? current
        : {
            ...current,
            [panel]: isOpen,
          },
    );
  };

  const setAddTaskPanelOpen = (projectId: string, nextValue: boolean) => {
    setWorkspaceNotice(null);
    setAddTaskPanels((current) => {
      if (!nextValue) {
        const remaining = { ...current };

        delete remaining[projectId];
        return remaining;
      }

      return {
        ...current,
        [projectId]: true,
      };
    });
  };

  const handleClearLocalStorage = () => {
    if (
      !window.confirm(
        "Clear all Tavi browser-local preferences stored in this browser?",
      )
    ) {
      return;
    }

    const clearedKeyCount = clearTaviStorage();

    setWorkspaceFilters({
      assigneeUserIds: [],
      groupBy: "owner",
      sortBy: [],
      statusFilters: [],
    });
    setCollapsedGroupsByGroup({});
    setPanelState({ ...DEFAULT_WORKSPACE_PANEL_STATE });
    setAddTaskPanels({});
    setHideDoneTasksByProject({});
    setHideDonePersonalTodos(false);
    onResetPreferences();
    setWorkspaceNotice(
      clearedKeyCount === 0
        ? "Tavi browser-local preferences were already clear."
        : `Cleared ${clearedKeyCount.toString()} Tavi browser-local preference${clearedKeyCount === 1 ? "" : "s"}.`,
    );
  };

  const applyBulkTaskChanges = () => {
    if (selectedTaskIds.length === 0 || !hasBulkChanges) {
      return;
    }

    if (bulkTaskDraft.dueDateMode === "set" && !bulkTaskDraft.dueDate) {
      setBulkTaskError("Choose a due date or clear it");
      return;
    }

    setBulkTaskError(null);
    bulkUpdateTaskMutation.mutate({
      ...buildBulkTaskPayload(bulkTaskDraft),
      taskIds: selectedTaskIds,
    });
  };

  const deleteSelectedTasks = () => {
    if (selectedTaskIds.length === 0) {
      return;
    }

    setWorkspaceNotice(null);
    setBulkTaskError(null);
    bulkDeleteTaskMutation.mutate({
      taskIds: selectedTaskIds,
    });
  };

  const copySelectedTasks = () => {
    if (selectedTaskIds.length === 0) {
      return;
    }

    if (!bulkTaskDraft.copyTargetProjectId) {
      setBulkTaskError("Choose a project to copy into");
      return;
    }

    setWorkspaceNotice(null);
    setBulkTaskError(null);
    bulkCopyTaskMutation.mutate({
      targetProjectId: bulkTaskDraft.copyTargetProjectId,
      taskIds: selectedTaskIds,
    });
  };

  return (
    <main
      className={`workspace-shell${fullWidth ? " workspace-shell--full-width" : ""}`}
    >
      <header className="workspace-header">
        <div className="workspace-branding">
          <a className="workspace-brand-link" href={appHomeUrl}>
            <img
              alt=""
              aria-hidden="true"
              className="brand-logo"
              height="36"
              src="/logo.svg"
              width="36"
            />
            <span className="brand-mark">{BRAND_MARK}</span>
          </a>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={`header-user header-user-button${panelState.profile ? " is-active" : ""}`}
            aria-pressed={panelState.profile}
            onClick={() =>
              setWorkspacePanelOpen("profile", !panelState.profile)
            }
          >
            {data.currentUser.name}
          </button>
          <button type="button" className="ghost-button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="workspace-controls">
        <div className="workspace-controls-row">
          <div className="workspace-filter-row">
            <div className="workspace-filter search-filter">
              <input
                aria-label="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search projects and tasks"
              />
            </div>

            <div className="workspace-filter">
              <select
                aria-label="Group by"
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as GroupBy)}
              >
                {Object.entries(GROUP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <MultiSelectFilter
              label="Status"
              options={PROJECT_STATUS_FILTER_OPTIONS}
              selectedValues={statusFilters}
              onChange={(nextValues) =>
                setStatusFilters(nextValues.filter(isProjectStatus))
              }
            />

            <MultiSelectFilter
              label="Assignee"
              options={assigneeFilterOptions}
              selectedValues={effectiveAssigneeFilterUserIds}
              onChange={setAssigneeFilterUserIds}
            />

            <MultiSortFilter
              label="Sort by"
              options={PROJECT_SORT_OPTIONS}
              selectedValues={sortBy}
              onChange={setSortBy}
            />
          </div>

          <div className="workspace-panel-toggles">
            <button
              type="button"
              className={`ghost-button compact-button panel-toggle-button${panelState.view ? " is-active" : ""}`}
              aria-pressed={panelState.view}
              onClick={() => toggleWorkspacePanel("view")}
            >
              View
            </button>
            <button
              type="button"
              className={`ghost-button compact-button panel-toggle-button${panelState.personalTodo ? " is-active" : ""}`}
              aria-pressed={panelState.personalTodo}
              onClick={() => toggleWorkspacePanel("personalTodo")}
            >
              Personal ToDo
            </button>
            <button
              type="button"
              className={`ghost-button compact-button panel-toggle-button${panelState.newProject ? " is-active" : ""}`}
              aria-pressed={panelState.newProject}
              disabled={!canEditWorkspace}
              onClick={() => toggleWorkspacePanel("newProject")}
            >
              New Project
            </button>
            {data.currentUser.role === "admin" ? (
              <button
                type="button"
                className={`ghost-button compact-button panel-toggle-button${panelState.settings ? " is-active" : ""}`}
                aria-pressed={panelState.settings}
                onClick={() => toggleWorkspacePanel("settings")}
              >
                Settings
              </button>
            ) : null}
          </div>
        </div>

        {workspaceNotice ? (
          <p className="workspace-notice">{workspaceNotice}</p>
        ) : null}

        {!canEditWorkspace ? (
          <p className="toolbar-hint">
            Viewer access is read-only for shared projects and tasks. Personal
            ToDo, filters, saved views, and audit history remain available.
          </p>
        ) : null}

        <div className="workspace-panel-stack">
          {panelState.profile ? (
            <ProfilePanel
              autoCollapse={autoCollapse}
              bulkActions={bulkActions}
              currentUser={data.currentUser}
              fullWidth={fullWidth}
              isAdmin={data.currentUser.role === "admin"}
              isImportExportOpen={panelState.importExport}
              isUserHistoryOpen={
                auditTarget?.entityType === "auth" &&
                auditTarget.entityId === data.currentUser.id
              }
              onAutoCollapseChange={onAutoCollapseChange}
              onBulkActionsChange={handleBulkActionsChange}
              onClearLocalStorage={handleClearLocalStorage}
              onClose={() => setWorkspacePanelOpen("profile", false)}
              onFullWidthChange={onFullWidthChange}
              onNotice={setWorkspaceNotice}
              onThemeChange={onThemeChange}
              onToggleImportExportPanel={() =>
                toggleWorkspacePanel("importExport")
              }
              onToggleUserHistory={() => {
                if (
                  auditTarget?.entityType === "auth" &&
                  auditTarget.entityId === data.currentUser.id
                ) {
                  setAuditTarget(null);
                  return;
                }

                openAuditHistory({
                  emptyMessage: "No sign-in events yet for this account.",
                  entityId: data.currentUser.id,
                  entityType: "auth",
                  subtitle: data.currentUser.email,
                  title: "User History",
                });
              }}
              theme={theme}
            />
          ) : null}

          {panelState.view ? (
            <section className="workspace-panel-card">
              <header className="panel-header">
                <div>
                  <strong>Views</strong>
                  <span>
                    Save search, grouping, task filters, and expansion defaults.
                  </span>
                </div>
              </header>

              <div className="saved-view-grid">
                <label>
                  My view
                  <select
                    value={selectedSavedViewId ?? ""}
                    onChange={(event) => {
                      const nextSavedView = data.savedViews.find(
                        (savedView) => savedView.id === event.target.value,
                      );

                      if (!nextSavedView) {
                        setSelectedSavedViewId(null);
                        setSavedViewName("");
                        setSavedViewError(null);
                        return;
                      }

                      applySavedView(nextSavedView);
                    }}
                  >
                    <option value="">Current workspace</option>
                    {data.savedViews.map((savedView) => (
                      <option key={savedView.id} value={savedView.id}>
                        {savedView.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  View name
                  <input
                    value={savedViewName}
                    onChange={(event) => {
                      setSavedViewName(event.target.value);
                      setSavedViewError(null);
                    }}
                    placeholder="Sprint review"
                  />
                </label>
              </div>

              <div className="saved-view-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={!selectedSavedView}
                  onClick={() => {
                    if (!selectedSavedView) {
                      return;
                    }

                    openAuditHistory({
                      emptyMessage: "No saved-view changes recorded yet.",
                      entityId: selectedSavedView.id,
                      entityType: "saved_view",
                      subtitle: "Personal workspace layout",
                      title: `View history · ${selectedSavedView.name}`,
                    });
                  }}
                >
                  History
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    !savedViewName.trim() || createSavedViewMutation.isPending
                  }
                  onClick={() => {
                    createSavedViewMutation.mutate({
                      name: savedViewName.trim(),
                      ...buildSavedViewPayload({
                        assigneeUserIds: effectiveAssigneeFilterUserIds,
                        groupBy,
                        search,
                        sortBy,
                        statusFilters,
                        collapsedGroups,
                        expandedProjects,
                      }),
                    });
                  }}
                >
                  {createSavedViewMutation.isPending ? "Saving..." : "Save new"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    !selectedSavedView || updateSavedViewMutation.isPending
                  }
                  onClick={() => {
                    if (!selectedSavedView) {
                      return;
                    }

                    updateSavedViewMutation.mutate({
                      viewId: selectedSavedView.id,
                      payload: buildSavedViewPayload({
                        assigneeUserIds: effectiveAssigneeFilterUserIds,
                        groupBy,
                        search,
                        sortBy,
                        statusFilters,
                        collapsedGroups,
                        expandedProjects,
                      }),
                    });
                  }}
                >
                  {updateSavedViewMutation.isPending ? "Updating..." : "Update"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    !selectedSavedView ||
                    !savedViewName.trim() ||
                    renameSavedViewMutation.isPending ||
                    savedViewName.trim() === selectedSavedView.name
                  }
                  onClick={() => {
                    if (!selectedSavedView) {
                      return;
                    }

                    renameSavedViewMutation.mutate({
                      viewId: selectedSavedView.id,
                      name: savedViewName.trim(),
                    });
                  }}
                >
                  {renameSavedViewMutation.isPending ? "Renaming..." : "Rename"}
                </button>
                <button
                  type="button"
                  className="ghost-button danger-button"
                  disabled={
                    !selectedSavedView || deleteSavedViewMutation.isPending
                  }
                  onClick={() => {
                    if (selectedSavedView) {
                      deleteSavedViewMutation.mutate(selectedSavedView.id);
                    }
                  }}
                >
                  {deleteSavedViewMutation.isPending ? "Deleting..." : "Delete"}
                </button>
              </div>

              {savedViewError ? (
                <p className="error-banner">{savedViewError}</p>
              ) : null}
            </section>
          ) : null}

          {panelState.personalTodo ? (
            <PersonalTodoPanel
              hideDoneTodos={hideDonePersonalTodos}
              onClose={() => setWorkspacePanelOpen("personalTodo", false)}
              onHideDoneChange={setHideDonePersonalTodos}
              onNotice={setWorkspaceNotice}
              personalTodos={data.personalTodos}
            />
          ) : null}

          {panelState.newProject && canEditWorkspace ? (
            <section className="workspace-panel-card">
              <header className="panel-header">
                <div>
                  <strong>New project</strong>
                  <span>Create a project without leaving the workspace.</span>
                </div>
              </header>

              <form
                className="inline-form project-create-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  createProjectMutation.mutate(
                    normalizeCreateProjectPayload(projectForm),
                  );
                }}
              >
                <input
                  value={projectForm.title}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      title: event.target.value,
                    }))
                  }
                  placeholder="New project title"
                />
                <textarea
                  value={projectForm.notes ?? ""}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className="resizable-notes"
                  placeholder="Notes"
                  rows={2}
                />
                <textarea
                  value={projectForm.references ?? ""}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      references: event.target.value,
                    }))
                  }
                  className="resizable-notes"
                  placeholder="References (one per line)"
                  rows={2}
                />
                <select
                  value={projectForm.ownerUserId ?? ""}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      ownerUserId: event.target.value || null,
                    }))
                  }
                >
                  <option value="">{NO_PROJECT_OWNER_LABEL}</option>
                  {data.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
                <select
                  value={projectForm.priority}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      priority: event.target.value as Priority,
                    }))
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
                <input
                  type="date"
                  value={projectForm.dueDate}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      dueDate: event.target.value,
                    }))
                  }
                />
                <button
                  type="submit"
                  disabled={createProjectMutation.isPending}
                >
                  Add project
                </button>
              </form>
            </section>
          ) : null}

          {panelState.settings ? (
            <SettingsPanel
              currentUser={data.currentUser}
              isBackupsOpen={panelState.backups}
              isAdmin={data.currentUser.role === "admin"}
              isImportExportOpen={panelState.importExport}
              onToggleBackupsPanel={() => toggleWorkspacePanel("backups")}
              onToggleImportExportPanel={() =>
                toggleWorkspacePanel("importExport")
              }
              onNotice={setWorkspaceNotice}
              users={data.users}
            />
          ) : null}

          {panelState.importExport ? (
            <>
              <ExportPanel
                assigneeUserIds={effectiveAssigneeFilterUserIds}
                groupBy={groupBy}
                onClose={() => toggleWorkspacePanel("importExport")}
                onNotice={setWorkspaceNotice}
                projects={orderedProjects}
                search={search}
                sortBy={sortBy}
                statusFilters={statusFilters}
              />

              {data.currentUser.role === "admin" ? (
                <ImportPanel
                  isAdmin={data.currentUser.role === "admin"}
                  onClose={() => toggleWorkspacePanel("importExport")}
                  onNotice={setWorkspaceNotice}
                  queryClient={queryClient}
                />
              ) : (
                <section className="workspace-panel-card">
                  <header className="panel-header">
                    <div>
                      <strong>Import</strong>
                      <span>
                        Loop CSV staging remains admin-only in this build.
                      </span>
                    </div>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        onClick={() => toggleWorkspacePanel("importExport")}
                      >
                        Close
                      </button>
                    </div>
                  </header>

                  <p className="toolbar-hint">
                    Ask an admin to stage imports while export wiring lands.
                  </p>
                </section>
              )}
            </>
          ) : null}

          {panelState.backups ? (
            <section className="workspace-panel-card">
              <header className="panel-header">
                <div>
                  <strong>Backups</strong>
                  <span>
                    Configure scheduled snapshots and preview restore changes.
                  </span>
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={() => toggleWorkspacePanel("backups")}
                  >
                    Close
                  </button>
                </div>
              </header>

              <BackupSettingsCard
                onNotice={setWorkspaceNotice}
                variant="panel"
              />
            </section>
          ) : null}
        </div>
      </section>

      {stickyBulkActionsVisible ? (
        <section className="bulk-action-card bulk-action-card--sticky">
          <div className="bulk-action-header">
            <div>
              <strong>
                {selectedTaskItems.length} selected task
                {selectedTaskItems.length === 1 ? "" : "s"}
              </strong>
              <span>
                {selectedProjectCount} project
                {selectedProjectCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="bulk-action-buttons">
              <button
                type="button"
                className="ghost-button"
                onClick={clearBulkTaskSelection}
                disabled={bulkTaskActionPending}
              >
                Clear
              </button>
              <button
                type="button"
                className="danger-button"
                onClick={deleteSelectedTasks}
                disabled={bulkTaskActionPending}
              >
                {bulkDeleteTaskMutation.isPending ? "Deleting..." : "Delete"}
              </button>
              <button
                type="button"
                onClick={copySelectedTasks}
                disabled={!hasBulkCopyTarget || bulkTaskActionPending}
              >
                {bulkCopyTaskMutation.isPending ? "Copying..." : "Copy"}
              </button>
              <button
                type="button"
                disabled={!hasBulkChanges || bulkTaskActionPending}
                onClick={applyBulkTaskChanges}
              >
                {bulkUpdateTaskMutation.isPending ? "Applying..." : "Apply"}
              </button>
            </div>
          </div>

          <div className="bulk-action-grid">
            <label>
              Status
              <select
                value={bulkTaskDraft.status}
                onChange={(event) => {
                  const nextStatus = event.target.value as TaskStatus | "";

                  setBulkTaskDraft((current) => ({
                    ...current,
                    status: nextStatus,
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">No change</option>
                <option value="todo">Todo</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="on_hold">On hold</option>
                <option value="done">Done</option>
                <option value="canceled">Canceled</option>
              </select>
            </label>

            <label>
              Assignee
              <select
                value={
                  bulkTaskDraft.assigneeMode === "keep"
                    ? ""
                    : bulkTaskDraft.assigneeMode === "clear"
                      ? BULK_CLEAR_ASSIGNEE_VALUE
                      : bulkTaskDraft.assigneeUserId
                }
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setBulkTaskDraft((current) => ({
                    ...current,
                    assigneeMode:
                      nextValue === ""
                        ? "keep"
                        : nextValue === BULK_CLEAR_ASSIGNEE_VALUE
                          ? "clear"
                          : "set",
                    assigneeUserId:
                      nextValue === "" ||
                      nextValue === BULK_CLEAR_ASSIGNEE_VALUE
                        ? ""
                        : nextValue,
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">No change</option>
                <option value={BULK_CLEAR_ASSIGNEE_VALUE}>
                  {NO_TASK_ASSIGNEE_LABEL}
                </option>
                {data.users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Priority
              <select
                value={bulkTaskDraft.priority}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    priority: event.target.value as Priority | "",
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">No change</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <label>
              Due date
              <input
                type="date"
                value={bulkTaskDraft.dueDate}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    dueDate: event.target.value,
                    dueDateMode: event.target.value ? "set" : "keep",
                  }));
                  setBulkTaskError(null);
                }}
              />
            </label>

            <label>
              Notes
              <select
                value={bulkTaskDraft.notesMode}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    notesMode: event.target.value as "keep" | "clear",
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="keep">No change</option>
                <option value="clear">Clear notes</option>
              </select>
            </label>

            <label>
              Copy to project
              <select
                value={bulkTaskDraft.copyTargetProjectId}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    copyTargetProjectId: event.target.value,
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">Select project</option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="bulk-date-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    dueDate: "",
                    dueDateMode: "clear",
                  }));
                  setBulkTaskError(null);
                }}
              >
                Clear due date
              </button>
              {bulkTaskDraft.dueDateMode === "clear" ? (
                <span className="status-note">Due date will be removed</span>
              ) : null}
            </div>
          </div>

          {bulkTaskError ? (
            <p className="error-banner">{bulkTaskError}</p>
          ) : null}
        </section>
      ) : null}

      {auditTarget ? (
        <AuditHistoryPanel
          currentUser={data.currentUser}
          emptyMessage={auditTarget.emptyMessage}
          errorMessage={
            auditHistoryQuery.error instanceof Error
              ? auditHistoryQuery.error.message
              : null
          }
          events={auditHistoryQuery.data ?? []}
          isError={auditHistoryQuery.isError}
          isLoading={auditHistoryQuery.isLoading}
          onClose={() => setAuditTarget(null)}
          subtitle={auditTarget.subtitle}
          title={auditTarget.title}
          users={userLookup}
        />
      ) : null}

      {groupedProjects.map((group) => (
        <section className="group-card" key={group.key}>
          <header className="group-header">
            <button
              type="button"
              className="group-toggle"
              onClick={() =>
                setCollapsedGroups((current) => ({
                  ...current,
                  [group.key]: !current[group.key],
                }))
              }
            >
              {collapsedGroups[group.key] ? "+" : "-"}
            </button>
            <div>
              <h2>{group.key}</h2>
              <p>
                {group.projects.length} projects /{" "}
                {group.projects.reduce(
                  (total, project) => total + project.tasks.length,
                  0,
                )}{" "}
                tasks
              </p>
            </div>
          </header>

          {!collapsedGroups[group.key] ? (
            <div className="project-list">
              {group.projects.map((project) => {
                const expanded = expandedProjects[project.id] ?? false;
                const fullProject = fullProjectById[project.id] ?? project;
                const hideDoneTasks =
                  hideDoneTasksByProject[project.id] ?? false;
                const showDoneTasks = !hideDoneTasks;
                const addTaskOpen = addTaskPanels[project.id] ?? false;
                const taskDraftValue =
                  newTaskByProject[project.id] ??
                  defaultTaskPayload(data.currentUser.id);
                const doneProjectTaskIds = project.tasks
                  .filter((task) => task.status === "done")
                  .map((task) => task.id);
                const tasksAreFiltered =
                  fullProject.tasks.length !== project.tasks.length;
                const visibleProjectTasks = hideDoneTasks
                  ? project.tasks.filter((task) => task.status !== "done")
                  : project.tasks;
                const projectTaskIds = visibleProjectTasks.map(
                  (task) => task.id,
                );
                const showTaskReorderColumn =
                  canEditWorkspace &&
                  (data.workspaceSettings?.dragHandlesEnabled ?? true);
                const taskTableColumnCount =
                  (canSelectTasks ? 1 : 0) +
                  (showTaskReorderColumn ? 1 : 0) +
                  6;
                const taskReorderDisabledReason = !showTaskReorderColumn
                  ? null
                  : reorderProjectTasksMutation.isPending
                    ? "Saving task order..."
                    : tasksAreFiltered
                      ? "Clear task filters to reorder tasks."
                      : hideDoneTasks
                        ? "Show done tasks to reorder tasks."
                        : fullProject.tasks.length < 2
                          ? "At least two tasks are required to reorder."
                          : null;
                const canReorderProjectTasks =
                  taskReorderDisabledReason === null;
                const activeTaskDragState =
                  taskDragState?.projectId === project.id
                    ? taskDragState
                    : null;
                const selectedProjectTaskCount = projectTaskIds.filter(
                  (taskId) => selectedTasks[taskId],
                ).length;
                const allProjectTasksSelected =
                  projectTaskIds.length > 0 &&
                  selectedProjectTaskCount === projectTaskIds.length;

                const projectCardClassName = `project-card${
                  expanded ? " project-card--expanded" : ""
                }${
                  expanded || editingProjectId === project.id || addTaskOpen
                    ? ""
                    : " project-card--collapsed"
                }`;

                return (
                  <article
                    className={projectCardClassName}
                    data-project-card-id={project.id}
                    key={project.id}
                  >
                    <div
                      className="project-row"
                      onClick={(event) => {
                        if (
                          canEditWorkspace &&
                          shouldOpenEditorFromModifierClick(event)
                        ) {
                          openProjectEditor(project);
                          return;
                        }

                        if (shouldToggleProjectFromRowClick(event)) {
                          setProjectExpanded(project.id, !expanded);
                        }
                      }}
                    >
                      <button
                        type="button"
                        className="group-toggle"
                        onClick={() =>
                          setProjectExpanded(project.id, !expanded)
                        }
                      >
                        {expanded ? "-" : "+"}
                      </button>

                      <div className="project-main">
                        <strong>{project.title}</strong>
                        <NotesMarkdown
                          className="formatted-notes formatted-notes--project"
                          emptyLabel="No notes"
                          value={project.notes}
                        />
                      </div>

                      <div className="project-status">
                        <span
                          className={`status-pill status-${project.displayStatus}`}
                          title={formatProjectStatusPillLabel(
                            project.displayStatus,
                            project.manualStatus,
                          )}
                        >
                          {formatProjectStatusPillLabel(
                            project.displayStatus,
                            project.manualStatus,
                          )}
                        </span>
                        {project.manualStatus ? (
                          <>
                            <span className="status-note">
                              Derived:{" "}
                              {formatStatusLabel(project.derivedStatus)}
                            </span>
                          </>
                        ) : null}
                      </div>

                      <div className="project-meta">
                        <span
                          className="project-owner-pill"
                          title={formatProjectOwnerLabel(project.ownerName)}
                        >
                          {formatProjectOwnerLabel(project.ownerName)}
                        </span>
                        <span
                          className={`priority-pill priority-${project.priority}`}
                        >
                          {formatPriorityLabel(project.priority)}
                        </span>
                        <span className="project-progress">
                          {formatTaskCompletionPercent(
                            project.taskDoneCount,
                            project.taskTotalCount,
                          )}
                        </span>
                        <span className="project-due-date">
                          {formatDate(project.dueDate)}
                        </span>
                        {parseProjectReferences(project.references).map(
                          (reference, index) => {
                            const referenceHref =
                              toProjectReferenceHref(reference);
                            const referenceLabel =
                              formatProjectReferenceLabel(reference);

                            return referenceHref ? (
                              <a
                                key={`${project.id}-reference-${index.toString()}`}
                                className="project-reference project-reference-link"
                                href={referenceHref}
                                rel="noopener noreferrer"
                                target="_blank"
                                title={reference}
                              >
                                {referenceLabel} ↗
                              </a>
                            ) : (
                              <span
                                key={`${project.id}-reference-${index.toString()}`}
                                className="project-reference project-reference-text"
                                title={reference}
                              >
                                {reference}
                              </span>
                            );
                          },
                        )}
                      </div>

                      <div className="project-row-actions">
                        {canEditWorkspace && project.manualStatus ? (
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => {
                              setProjectEditError(null);
                              updateProjectMutation.mutate({
                                projectId: project.id,
                                payload: {
                                  manualStatus: null,
                                },
                              });
                            }}
                          >
                            Clear override
                          </button>
                        ) : null}

                        {canEditWorkspace ? (
                          <button
                            type="button"
                            className={`ghost-button compact-button panel-toggle-button${addTaskOpen ? " is-active" : ""}`}
                            aria-pressed={addTaskOpen}
                            onClick={() => {
                              if (!expanded && !addTaskOpen) {
                                setProjectExpanded(project.id, true);
                              }

                              setAddTaskPanelOpen(project.id, !addTaskOpen);
                            }}
                          >
                            Add Task
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="ghost-button compact-button"
                          onClick={() =>
                            openAuditHistory({
                              emptyMessage: "No project changes recorded yet.",
                              entityId: project.id,
                              entityType: "project",
                              subtitle: formatProjectOwnerLabel(
                                project.ownerName,
                              ),
                              title: `Project history · ${project.title}`,
                            })
                          }
                        >
                          History
                        </button>

                        {canEditWorkspace ? (
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => openProjectEditor(project)}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {canEditWorkspace && editingProjectId === project.id ? (
                      <form
                        ref={projectEditFormRef}
                        className="inline-form project-row project-row--edit"
                        onSubmit={(event) => {
                          event.preventDefault();

                          updateProjectMutation.mutate({
                            projectId: project.id,
                            payload: normalizeProjectDraftPayload(projectDraft),
                          });
                        }}
                      >
                        <span className="project-row-edit-spacer" />
                        <div className="project-main">
                          <input
                            value={projectDraft.title ?? ""}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                title: event.target.value,
                              }))
                            }
                            placeholder="Project title"
                          />
                          <textarea
                            value={projectDraft.notes ?? ""}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                notes: event.target.value,
                              }))
                            }
                            className="resizable-notes"
                            onPointerDown={(event) =>
                              rememberNoteEditorHeight(
                                "project",
                                event.currentTarget,
                              )
                            }
                            onPointerUp={(event) =>
                              persistNoteEditorHeight(
                                "project",
                                event.currentTarget,
                              )
                            }
                            placeholder="Project notes"
                            rows={2}
                            style={toTextareaStyle(noteEditorHeights.project)}
                          />
                        </div>
                        <div className="project-status project-status--edit">
                          <select
                            value={projectDraft.manualStatus ?? ""}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                manualStatus: event.target.value
                                  ? (event.target.value as ProjectStatus)
                                  : null,
                              }))
                            }
                          >
                            <option value="">Derived from tasks</option>
                            <option value="not_started">Not started</option>
                            <option value="in_progress">In progress</option>
                            <option value="blocked">Blocked</option>
                            <option value="on_hold">On hold</option>
                            <option value="done">Done</option>
                          </select>
                        </div>
                        <div className="project-meta project-meta--edit">
                          <select
                            value={projectDraft.ownerUserId ?? ""}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                ownerUserId: event.target.value || null,
                              }))
                            }
                          >
                            <option value="">{NO_PROJECT_OWNER_LABEL}</option>
                            {data.users.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.name}
                              </option>
                            ))}
                          </select>
                          <select
                            value={projectDraft.priority ?? "medium"}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                priority: event.target.value as Priority,
                              }))
                            }
                          >
                            <option value="low">Low</option>
                            <option value="medium">Medium</option>
                            <option value="high">High</option>
                          </select>
                          <input
                            type="date"
                            value={projectDraft.dueDate ?? ""}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                dueDate: event.target.value,
                              }))
                            }
                          />
                          <textarea
                            value={projectDraft.references ?? ""}
                            onChange={(event) =>
                              setProjectDraft((current) => ({
                                ...current,
                                references: event.target.value,
                              }))
                            }
                            className="resizable-notes project-references-input"
                            placeholder="References (one per line)"
                            rows={2}
                          />
                        </div>
                        <div className="project-row-actions">
                          <button type="submit">Save</button>
                          <button
                            type="button"
                            className="ghost-button"
                            disabled={
                              !canConvertProjectToTask(project, projectDraft) ||
                              convertProjectToTaskMutation.isPending
                            }
                            title={
                              projectConvertToTaskNote(project, projectDraft) ??
                              undefined
                            }
                            onClick={() =>
                              convertProjectToTaskMutation.mutate({
                                project,
                                payload:
                                  normalizeProjectDraftPayload(projectDraft),
                              })
                            }
                          >
                            {convertProjectToTaskMutation.isPending
                              ? "Converting..."
                              : "Convert to Task"}
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Delete project "${project.title}" and remove its ${project.taskTotalCount.toString()} task${project.taskTotalCount === 1 ? "" : "s"} from the workspace?`,
                                )
                              ) {
                                return;
                              }

                              deleteProjectMutation.mutate({
                                projectId: project.id,
                                title: project.title,
                              });
                            }}
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            className="ghost-button"
                            onClick={() => {
                              setProjectEditError(null);
                              setEditingProjectId(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : null}
                    {canEditWorkspace &&
                    editingProjectId === project.id &&
                    projectEditError ? (
                      <p className="error-banner nested-error">
                        {projectEditError}
                      </p>
                    ) : null}

                    {expanded ? (
                      <div className="task-panel">
                        <table className="task-table">
                          <thead>
                            <tr>
                              {canSelectTasks ? (
                                <th className="task-select-column">
                                  <input
                                    aria-label={`Select all tasks in ${project.title}`}
                                    checked={allProjectTasksSelected}
                                    onChange={(event) => {
                                      setSelectedTasks((current) => ({
                                        ...current,
                                        ...Object.fromEntries(
                                          projectTaskIds.map((taskId) => [
                                            taskId,
                                            event.target.checked,
                                          ]),
                                        ),
                                      }));
                                      setBulkTaskError(null);
                                    }}
                                    type="checkbox"
                                  />
                                </th>
                              ) : null}
                              {showTaskReorderColumn ? (
                                <th
                                  className="task-reorder-column"
                                  aria-hidden="true"
                                />
                              ) : null}
                              <th>Task</th>
                              <th>Assignee</th>
                              <th>
                                <span className="task-status-heading">
                                  <span>Status</span>
                                  <button
                                    type="button"
                                    className="ghost-button compact-button task-done-toggle"
                                    aria-label={
                                      showDoneTasks
                                        ? `Hide done tasks in ${project.title}`
                                        : `Show done tasks in ${project.title}`
                                    }
                                    aria-pressed={showDoneTasks}
                                    disabled={doneProjectTaskIds.length === 0}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setHideDoneTasksByProject((current) => {
                                        const nextSelection = { ...current };

                                        if (nextSelection[project.id]) {
                                          delete nextSelection[project.id];
                                        } else {
                                          nextSelection[project.id] = true;
                                        }

                                        return nextSelection;
                                      });
                                    }}
                                    title={
                                      doneProjectTaskIds.length === 0
                                        ? "No done tasks"
                                        : showDoneTasks
                                          ? "Hide done tasks"
                                          : "Show done tasks"
                                    }
                                  >
                                    D
                                  </button>
                                </span>
                              </th>
                              <th>Priority</th>
                              <th>Due</th>
                              <th className="task-action-header">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {canEditWorkspace && addTaskOpen ? (
                              <tr className="task-create-row">
                                {canSelectTasks ? (
                                  <td className="task-select-cell" />
                                ) : null}
                                {showTaskReorderColumn ? (
                                  <td className="task-reorder-cell task-reorder-cell--spacer" />
                                ) : null}
                                <td>
                                  <div className="task-create-field">
                                    <input
                                      value={taskDraftValue.title}
                                      onChange={(event) =>
                                        setNewTaskByProject((current) => ({
                                          ...current,
                                          [project.id]: {
                                            ...taskDraftValue,
                                            title: event.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="New task title"
                                    />
                                    <input
                                      value={taskDraftValue.notes ?? ""}
                                      onChange={(event) =>
                                        setNewTaskByProject((current) => ({
                                          ...current,
                                          [project.id]: {
                                            ...taskDraftValue,
                                            notes: event.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="Task notes"
                                    />
                                  </div>
                                </td>
                                <td>
                                  <select
                                    value={taskDraftValue.assigneeUserId ?? ""}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          assigneeUserId:
                                            event.target.value || null,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="">
                                      {NO_TASK_ASSIGNEE_LABEL}
                                    </option>
                                    {data.users.map((user) => (
                                      <option key={user.id} value={user.id}>
                                        {user.name}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  <select
                                    value={taskDraftValue.status}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          status: event.target
                                            .value as TaskStatus,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="todo">Todo</option>
                                    <option value="in_progress">
                                      In progress
                                    </option>
                                    <option value="blocked">Blocked</option>
                                    <option value="on_hold">On hold</option>
                                    <option value="done">Done</option>
                                    <option value="canceled">Canceled</option>
                                  </select>
                                </td>
                                <td>
                                  <select
                                    value={taskDraftValue.priority}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          priority: event.target
                                            .value as Priority,
                                        },
                                      }))
                                    }
                                  >
                                    <option value="low">Low</option>
                                    <option value="medium">Medium</option>
                                    <option value="high">High</option>
                                  </select>
                                </td>
                                <td>
                                  <input
                                    type="date"
                                    value={taskDraftValue.dueDate}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          dueDate: event.target.value,
                                        },
                                      }))
                                    }
                                  />
                                </td>
                                <td className="task-action-cell">
                                  <button
                                    type="button"
                                    className="compact-button"
                                    disabled={
                                      !taskDraftValue.title.trim() ||
                                      createTaskMutation.isPending
                                    }
                                    onClick={() =>
                                      createTaskMutation.mutate({
                                        projectId: project.id,
                                        payload: {
                                          ...taskDraftValue,
                                          title: taskDraftValue.title.trim(),
                                        },
                                      })
                                    }
                                  >
                                    {createTaskMutation.isPending
                                      ? "Adding..."
                                      : "Add"}
                                  </button>
                                  <button
                                    type="button"
                                    className="ghost-button compact-button"
                                    onClick={() => {
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: defaultTaskPayload(
                                          data.currentUser.id,
                                        ),
                                      }));
                                      setAddTaskPanelOpen(project.id, false);
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </td>
                              </tr>
                            ) : null}
                            {visibleProjectTasks.map((task) => (
                              <TaskRow
                                canEditTask={canEditWorkspace}
                                canReorderTask={canReorderProjectTasks}
                                canSelectTasks={canSelectTasks}
                                data={data}
                                dragHandleTitle={
                                  taskReorderDisabledReason ?? "Drag to reorder"
                                }
                                editRowRef={taskEditRowRef}
                                editingTaskId={editingTaskId}
                                isSelected={selectedTasks[task.id] ?? false}
                                isTaskDragging={
                                  activeTaskDragState?.taskId === task.id
                                }
                                key={task.id}
                                onEdit={(selectedTask) =>
                                  openTaskEditor(project.id, selectedTask)
                                }
                                onFinishTaskDrag={() => {
                                  setTaskDragState((current) =>
                                    current?.projectId === project.id
                                      ? null
                                      : current,
                                  );
                                }}
                                onSave={(payload) => {
                                  const normalizedPayload =
                                    normalizeTaskDraftPayload(payload);

                                  setTaskEditError(null);

                                  if (
                                    normalizedPayload.projectId ===
                                    CONVERT_TASK_TO_PROJECT_VALUE
                                  ) {
                                    convertTaskToProjectMutation.mutate({
                                      payload: {
                                        assigneeUserId:
                                          normalizedPayload.assigneeUserId,
                                        dueDate: normalizedPayload.dueDate,
                                        notes: normalizedPayload.notes,
                                        priority: normalizedPayload.priority,
                                        status: normalizedPayload.status,
                                        title: normalizedPayload.title,
                                      },
                                      task,
                                    });
                                    return;
                                  }

                                  updateTaskMutation.mutate({
                                    taskId: task.id,
                                    payload: normalizedPayload,
                                  });
                                }}
                                onDelete={() =>
                                  deleteTaskMutation.mutate({
                                    taskId: task.id,
                                    title: task.title,
                                  })
                                }
                                onCancel={() => {
                                  setTaskEditError(null);
                                  setEditingTaskId(null);
                                }}
                                onPreviewTaskDrop={(position) => {
                                  setTaskDragState((current) => {
                                    if (
                                      !current ||
                                      current.projectId !== project.id ||
                                      current.taskId === task.id
                                    ) {
                                      return current;
                                    }

                                    if (
                                      current.overTaskId === task.id &&
                                      current.position === position
                                    ) {
                                      return current;
                                    }

                                    return {
                                      ...current,
                                      overTaskId: task.id,
                                      position,
                                    };
                                  });
                                }}
                                onStartTaskDrag={() => {
                                  if (!canReorderProjectTasks) {
                                    return;
                                  }

                                  setTaskDragState({
                                    overTaskId: task.id,
                                    position: "before",
                                    projectId: project.id,
                                    taskId: task.id,
                                  });
                                }}
                                onSubmitTaskDrop={(position) => {
                                  if (
                                    !canReorderProjectTasks ||
                                    !activeTaskDragState ||
                                    activeTaskDragState.taskId === task.id
                                  ) {
                                    setTaskDragState((current) =>
                                      current?.projectId === project.id
                                        ? null
                                        : current,
                                    );
                                    return;
                                  }

                                  const currentTaskIds = fullProject.tasks.map(
                                    (currentTask) => currentTask.id,
                                  );
                                  const nextTaskIds = moveTaskIdRelative(
                                    currentTaskIds,
                                    activeTaskDragState.taskId,
                                    task.id,
                                    position,
                                  );

                                  if (
                                    sameStringArray(currentTaskIds, nextTaskIds)
                                  ) {
                                    setTaskDragState((current) =>
                                      current?.projectId === project.id
                                        ? null
                                        : current,
                                    );
                                    return;
                                  }

                                  reorderProjectTasksMutation.mutate({
                                    projectId: project.id,
                                    taskIds: nextTaskIds,
                                  });
                                }}
                                onToggleSelected={(checked) => {
                                  setSelectedTasks((current) => ({
                                    ...current,
                                    [task.id]: checked,
                                  }));
                                  setBulkTaskError(null);
                                }}
                                onViewHistory={() =>
                                  openAuditHistory({
                                    emptyMessage:
                                      "No task changes recorded for this task yet.",
                                    entityId: task.id,
                                    entityType: "task",
                                    subtitle: project.title,
                                    title: `Task history · ${task.title}`,
                                  })
                                }
                                reorderIndicator={
                                  activeTaskDragState?.taskId !== task.id &&
                                  activeTaskDragState?.overTaskId === task.id
                                    ? activeTaskDragState.position
                                    : null
                                }
                                showReorderHandle={showTaskReorderColumn}
                                task={task}
                                taskDraft={taskDraft}
                                taskEditError={taskEditError}
                                taskNoteEditorHeight={noteEditorHeights.task}
                                onTaskNotesPointerDown={(textarea) =>
                                  rememberNoteEditorHeight("task", textarea)
                                }
                                onTaskNotesPointerUp={(textarea) =>
                                  persistNoteEditorHeight("task", textarea)
                                }
                                setTaskDraft={setTaskDraft}
                              />
                            ))}
                            {hideDoneTasks &&
                            project.tasks.length > 0 &&
                            visibleProjectTasks.length === 0 ? (
                              <tr className="task-empty-row">
                                <td colSpan={taskTableColumnCount}>
                                  Done tasks are hidden. Use D to show them.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ))}
      {showScrollToTop ? (
        <button
          type="button"
          className="ghost-button compact-button scroll-to-top-button"
          onClick={() => {
            globalThis.scrollTo({
              top: 0,
              behavior: "smooth",
            });
          }}
        >
          To top
        </button>
      ) : null}
    </main>
  );
}

type TaskRowProps = {
  canEditTask: boolean;
  canReorderTask: boolean;
  canSelectTasks: boolean;
  data: WorkspaceResponse;
  dragHandleTitle: string;
  editRowRef?: React.Ref<HTMLTableRowElement>;
  editingTaskId: string | null;
  isSelected: boolean;
  isTaskDragging: boolean;
  onEdit: (task: WorkspaceTask) => void;
  onFinishTaskDrag: () => void;
  onSave: (payload: UpdateTaskPayload) => void;
  onDelete: () => void;
  onCancel: () => void;
  onPreviewTaskDrop: (position: TaskDropPosition) => void;
  onStartTaskDrag: () => void;
  onSubmitTaskDrop: (position: TaskDropPosition) => void;
  onTaskNotesPointerDown: (textarea: HTMLTextAreaElement) => void;
  onTaskNotesPointerUp: (textarea: HTMLTextAreaElement) => void;
  onToggleSelected: (checked: boolean) => void;
  onViewHistory: () => void;
  reorderIndicator: TaskDropPosition | null;
  showReorderHandle: boolean;
  task: WorkspaceTask;
  taskDraft: UpdateTaskPayload;
  taskEditError: string | null;
  taskNoteEditorHeight: number | null;
  setTaskDraft: React.Dispatch<React.SetStateAction<UpdateTaskPayload>>;
};

function TaskRow({
  canEditTask,
  canReorderTask,
  canSelectTasks,
  data,
  dragHandleTitle,
  editRowRef,
  editingTaskId,
  isSelected,
  isTaskDragging,
  onEdit,
  onFinishTaskDrag,
  onSave,
  onDelete,
  onCancel,
  onPreviewTaskDrop,
  onStartTaskDrag,
  onSubmitTaskDrop,
  onTaskNotesPointerDown,
  onTaskNotesPointerUp,
  onToggleSelected,
  onViewHistory,
  reorderIndicator,
  showReorderHandle,
  task,
  taskDraft,
  taskEditError,
  taskNoteEditorHeight,
  setTaskDraft,
}: TaskRowProps) {
  if (editingTaskId === task.id) {
    const taskEditFormId = `task-edit-${task.id}`;
    const selectedProjectId = taskDraft.projectId ?? task.projectId;
    const isConvertingToProject =
      selectedProjectId === CONVERT_TASK_TO_PROJECT_VALUE;

    return (
      <tr className="editing-row" ref={editRowRef}>
        {canSelectTasks ? <td className="task-select-cell" /> : null}
        {showReorderHandle ? (
          <td className="task-reorder-cell task-reorder-cell--spacer" />
        ) : null}
        <td>
          <div className="task-create-field">
            {taskEditError ? (
              <p className="error-banner task-edit-error">{taskEditError}</p>
            ) : null}
            <input
              form={taskEditFormId}
              value={taskDraft.title ?? ""}
              onChange={(event) =>
                setTaskDraft((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
            />
            <textarea
              form={taskEditFormId}
              value={taskDraft.notes ?? ""}
              onChange={(event) =>
                setTaskDraft((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              className="resizable-notes"
              onPointerDown={(event) =>
                onTaskNotesPointerDown(event.currentTarget)
              }
              onPointerUp={(event) => onTaskNotesPointerUp(event.currentTarget)}
              placeholder="Task notes"
              rows={2}
              style={toTextareaStyle(taskNoteEditorHeight)}
            />
            <select
              aria-label="Project"
              form={taskEditFormId}
              value={selectedProjectId}
              onChange={(event) =>
                setTaskDraft((current) => ({
                  ...current,
                  projectId: event.target.value,
                }))
              }
            >
              {data.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
              <option value={CONVERT_TASK_TO_PROJECT_VALUE}>
                Convert to Project
              </option>
            </select>
          </div>
        </td>
        <td>
          <select
            aria-label="Assignee"
            form={taskEditFormId}
            value={taskDraft.assigneeUserId ?? ""}
            onChange={(event) =>
              setTaskDraft((current) => ({
                ...current,
                assigneeUserId: event.target.value || null,
              }))
            }
          >
            <option value="">{NO_TASK_ASSIGNEE_LABEL}</option>
            {data.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          <select
            form={taskEditFormId}
            value={taskDraft.status ?? "todo"}
            onChange={(event) =>
              setTaskDraft((current) => ({
                ...current,
                status: event.target.value as TaskStatus,
              }))
            }
          >
            <option value="todo">Todo</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
            <option value="on_hold">On hold</option>
            <option value="done">Done</option>
            <option value="canceled">Canceled</option>
          </select>
        </td>
        <td>
          <select
            form={taskEditFormId}
            value={taskDraft.priority ?? "medium"}
            onChange={(event) =>
              setTaskDraft((current) => ({
                ...current,
                priority: event.target.value as Priority,
              }))
            }
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </td>
        <td>
          <input
            form={taskEditFormId}
            type="date"
            value={taskDraft.dueDate ?? ""}
            onChange={(event) =>
              setTaskDraft((current) => ({
                ...current,
                dueDate: event.target.value,
              }))
            }
          />
        </td>
        <td className="task-action-cell task-edit-action-cell">
          <form
            id={taskEditFormId}
            className="task-edit-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSave(taskDraft);
            }}
          />
          <button
            type="submit"
            form={taskEditFormId}
            className="compact-button mini-button"
          >
            {isConvertingToProject ? "Convert" : "Save"}
          </button>
          <button
            type="button"
            className="ghost-button compact-button mini-button"
            onClick={() => {
              if (
                !window.confirm(
                  `Delete task "${task.title}" from the workspace?`,
                )
              ) {
                return;
              }

              onDelete();
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="ghost-button compact-button mini-button icon-compact-button"
            aria-label="Cancel editing task"
            onClick={onCancel}
          >
            X
          </button>
        </td>
      </tr>
    );
  }

  const rowClassName = [
    isTaskDragging ? "task-row--dragging" : null,
    reorderIndicator === "before" ? "task-row--drop-before" : null,
    reorderIndicator === "after" ? "task-row--drop-after" : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  return (
    <tr
      className={rowClassName || undefined}
      onClick={(event) => {
        if (canEditTask && shouldOpenEditorFromModifierClick(event)) {
          onEdit(task);
        }
      }}
      onDragOver={(event) => {
        if (!canReorderTask) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onPreviewTaskDrop(readTaskDropPosition(event));
      }}
      onDrop={(event) => {
        if (!canReorderTask) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onSubmitTaskDrop(readTaskDropPosition(event));
      }}
    >
      {canSelectTasks ? (
        <td className="task-select-cell">
          <input
            aria-label={`Select task ${task.title}`}
            checked={isSelected}
            onChange={(event) => onToggleSelected(event.target.checked)}
            type="checkbox"
          />
        </td>
      ) : null}
      {showReorderHandle ? (
        <td className="task-reorder-cell">
          <button
            type="button"
            className={`ghost-button compact-button task-reorder-handle${
              isTaskDragging ? " is-active" : ""
            }`}
            aria-label={`Drag to reorder ${task.title}`}
            title={dragHandleTitle}
            disabled={!canReorderTask}
            draggable={canReorderTask}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDragStart={(event) => {
              if (!canReorderTask) {
                return;
              }

              event.stopPropagation();
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", task.id);
              onStartTaskDrag();
            }}
            onDragEnd={(event) => {
              event.stopPropagation();
              onFinishTaskDrag();
            }}
          >
            ::
          </button>
        </td>
      ) : null}
      <td>
        <strong>{task.title}</strong>
        <NotesMarkdown
          className="formatted-notes formatted-notes--task task-subtext"
          emptyLabel="No notes"
          value={task.notes}
        />
      </td>
      <td>{task.assigneeName ?? NO_TASK_ASSIGNEE_LABEL}</td>
      <td>
        <span className={`status-pill status-${task.status}`}>
          {task.status}
        </span>
      </td>
      <td>{task.priority}</td>
      <td>{formatDate(task.dueDate)}</td>
      <td className="task-action-cell">
        <button
          type="button"
          className="ghost-button compact-button"
          onClick={onViewHistory}
        >
          History
        </button>
        {canEditTask ? (
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={() => onEdit(task)}
          >
            Edit
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function settingsCardButtonProps(action: () => void) {
  return {
    onClick: action,
    onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action();
      }
    },
    role: "button" as const,
    tabIndex: 0,
  };
}

type ProfilePanelProps = {
  autoCollapse: boolean;
  bulkActions: boolean;
  currentUser: WorkspaceUser;
  fullWidth: boolean;
  isAdmin: boolean;
  isImportExportOpen: boolean;
  isUserHistoryOpen: boolean;
  onAutoCollapseChange: (autoCollapse: boolean) => void;
  onBulkActionsChange: (bulkActions: boolean) => void;
  onClearLocalStorage: () => void;
  onClose: () => void;
  onFullWidthChange: (fullWidth: boolean) => void;
  onNotice: (message: string) => void;
  onThemeChange: (theme: WorkspaceTheme) => void;
  onToggleImportExportPanel: () => void;
  onToggleUserHistory: () => void;
  theme: WorkspaceTheme;
};

function ProfilePanel({
  autoCollapse,
  bulkActions,
  currentUser,
  fullWidth,
  isAdmin,
  isImportExportOpen,
  isUserHistoryOpen,
  onAutoCollapseChange,
  onBulkActionsChange,
  onClearLocalStorage,
  onClose,
  onFullWidthChange,
  onNotice,
  onThemeChange,
  onToggleImportExportPanel,
  onToggleUserHistory,
  theme,
}: ProfilePanelProps) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(currentUser.name);
  const [emailDraft, setEmailDraft] = useState(currentUser.email);
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState("");
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [digestPrefError, setDigestPrefError] = useState<string | null>(null);
  const notificationPreferencesQuery = useQuery({
    queryFn: getNotificationPreferences,
    queryKey: ["notification-preferences"],
    staleTime: 60_000,
  });
  const dailyDigestEnabled =
    notificationPreferencesQuery.data?.dailyDigestEnabled ?? false;
  const configuredDigestTime =
    notificationPreferencesQuery.data?.dailyDigestTime ?? "09:00";
  const currentThemeLabel = getWorkspaceThemeLabel(theme);
  const nextTheme = getNextWorkspaceTheme(theme);
  const nextThemeLabel = getWorkspaceThemeLabel(nextTheme);
  const resetProfileDraft = () => {
    setNameDraft(currentUser.name);
    setEmailDraft(currentUser.email);
    setCurrentPasswordDraft("");
    setPasswordDraft("");
    setPasswordConfirmation("");
    setProfileError(null);
  };

  useEffect(() => {
    if (!isEditing) {
      resetProfileDraft();
    }
  }, [currentUser.email, currentUser.name, isEditing]);

  const notificationPreferencesMutation = useMutation({
    mutationFn: updateNotificationPreferences,
    onMutate: async (variables) => {
      setDigestPrefError(null);
      const previous = queryClient.getQueryData<NotificationPreferences>([
        "notification-preferences",
      ]);
      queryClient.setQueryData<NotificationPreferences>(
        ["notification-preferences"],
        (current) => ({
          dailyDigestEnabled:
            variables.dailyDigestEnabled ??
            current?.dailyDigestEnabled ??
            false,
          dailyDigestTime: current?.dailyDigestTime ?? configuredDigestTime,
          personalTodoRemindersEnabled:
            variables.personalTodoRemindersEnabled ??
            current?.personalTodoRemindersEnabled ??
            true,
        }),
      );
      return { previous };
    },
    onSuccess: (preferences) => {
      queryClient.setQueryData(["notification-preferences"], preferences);
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(
          ["notification-preferences"],
          context.previous,
        );
      }
      setDigestPrefError(
        error instanceof ApiError
          ? error.message
          : "Unable to update daily digest preferences.",
      );
    },
  });
  const toggleDailyDigest = () => {
    if (
      notificationPreferencesMutation.isPending ||
      notificationPreferencesQuery.isPending
    ) {
      return;
    }

    notificationPreferencesMutation.mutate({
      dailyDigestEnabled: !dailyDigestEnabled,
    });
  };
  const updateProfileMutation = useMutation({
    mutationFn: updateMyProfile,
    onSuccess: async ({ account }) => {
      setProfileError(null);
      setIsEditing(false);
      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        current
          ? {
              ...current,
              currentUser: {
                ...current.currentUser,
                email: account.email,
                name: account.name,
                role: account.role,
              },
              users: current.users.map((user) =>
                user.id === account.id
                  ? {
                      ...user,
                      email: account.email,
                      name: account.name,
                      role: account.role,
                    }
                  : user,
              ),
            }
          : current,
      );
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      resetProfileDraft();
      onNotice("Updated your profile.");
      onClose();
    },
    onError: (error) => {
      setProfileError(
        error instanceof ApiError
          ? error.message
          : "Unable to update your profile.",
      );
    },
  });
  const submitProfile = (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = nameDraft.trim();
    const trimmedEmail = emailDraft.trim();
    const hasPasswordInput =
      currentPasswordDraft.trim().length > 0 ||
      passwordDraft.trim().length > 0 ||
      passwordConfirmation.trim().length > 0;

    if (!trimmedName) {
      setProfileError("Enter your name");
      return;
    }

    if (!trimmedEmail) {
      setProfileError("Enter your email");
      return;
    }

    if (hasPasswordInput) {
      if (!currentPasswordDraft.trim()) {
        setProfileError("Enter your current password");
        return;
      }

      if (!passwordDraft.trim()) {
        setProfileError("Enter a new password");
        return;
      }

      if (passwordDraft !== passwordConfirmation) {
        setProfileError("Passwords must match");
        return;
      }
    }

    const payload: UpdateOwnProfilePayload = {};

    if (trimmedName !== currentUser.name) {
      payload.name = trimmedName;
    }

    if (trimmedEmail !== currentUser.email) {
      payload.email = trimmedEmail;
    }

    if (hasPasswordInput) {
      payload.currentPassword = currentPasswordDraft;
      payload.password = passwordDraft;
    }

    if (Object.keys(payload).length === 0) {
      setIsEditing(false);
      onClose();
      return;
    }

    setProfileError(null);
    updateProfileMutation.mutate(payload);
  };
  const beginEditing = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setProfileError(null);
    queueMicrotask(() => setIsEditing(true));
  };

  return (
    <section className="workspace-panel-card">
      <header className="panel-header">
        <div>
          <strong>User Profile</strong>
          <span>
            Your account details, self-service password changes, and personal
            workspace preferences.
          </span>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      <div className="settings-grid">
        <div className="settings-item settings-item-wide">
          <div className="settings-item-header">
            <strong>Account</strong>
            <span>{currentUser.role}</span>
          </div>

          <form className="profile-form" onSubmit={submitProfile}>
            <div className="profile-form-grid">
              <label>
                Name
                {isEditing ? (
                  <input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    placeholder="Your name"
                  />
                ) : (
                  <span className="profile-summary-value">
                    {currentUser.name}
                  </span>
                )}
              </label>
              <label>
                Email
                {isEditing ? (
                  <input
                    type="email"
                    value={emailDraft}
                    onChange={(event) => setEmailDraft(event.target.value)}
                    placeholder="you@example.com"
                  />
                ) : (
                  <span className="profile-summary-value">
                    {currentUser.email}
                  </span>
                )}
              </label>
              {isEditing ? (
                <>
                  <label>
                    Current password
                    <input
                      type="password"
                      value={currentPasswordDraft}
                      onChange={(event) =>
                        setCurrentPasswordDraft(event.target.value)
                      }
                      placeholder="Current password"
                    />
                  </label>
                  <label>
                    Change password
                    <input
                      type="password"
                      value={passwordDraft}
                      onChange={(event) => setPasswordDraft(event.target.value)}
                      placeholder="New password"
                    />
                  </label>
                  <label>
                    Repeat password
                    <input
                      type="password"
                      value={passwordConfirmation}
                      onChange={(event) =>
                        setPasswordConfirmation(event.target.value)
                      }
                      placeholder="Repeat new password"
                    />
                  </label>
                </>
              ) : null}
            </div>

            {profileError ? (
              <p className="error-banner">{profileError}</p>
            ) : null}

            <div className="settings-actions">
              {isEditing ? (
                <>
                  <button
                    type="submit"
                    disabled={updateProfileMutation.isPending}
                  >
                    {updateProfileMutation.isPending ? "Saving..." : "Save"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={updateProfileMutation.isPending}
                    onClick={() => {
                      setIsEditing(false);
                      resetProfileDraft();
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={beginEditing}
                >
                  Edit
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Theme</strong>
            <span>{currentThemeLabel}</span>
          </div>
          <p className="toolbar-hint">
            Keep the workspace compact and readable without leaving the browser.
          </p>
          <div className="theme-cycle-controls">
            <button
              type="button"
              className="ghost-button theme-cycle-button"
              onClick={() => onThemeChange(nextTheme)}
              title={`Next theme: ${nextThemeLabel}`}
            >
              {currentThemeLabel}
            </button>
            <span className="theme-cycle-note">Next: {nextThemeLabel}</span>
          </div>
        </div>

        <div
          className="settings-item settings-item-toggle"
          onClick={() => onAutoCollapseChange(!autoCollapse)}
        >
          <div className="settings-item-header">
            <strong>Auto Collapse</strong>
            <span>{autoCollapse ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            When enabled, opening one project collapses the rest.
          </p>
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Auto Collapse</span>
            <input
              aria-label="Auto Collapse"
              checked={autoCollapse}
              className="settings-switch-input"
              onChange={(event) => onAutoCollapseChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div
          className="settings-item settings-item-toggle"
          onClick={() => onBulkActionsChange(!bulkActions)}
        >
          <div className="settings-item-header">
            <strong>Bulk Actions</strong>
            <span>{bulkActions ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Show task selection checkboxes and the multi-task action bar.
          </p>
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Bulk Actions</span>
            <input
              aria-label="Bulk Actions"
              checked={bulkActions}
              className="settings-switch-input"
              onChange={(event) => onBulkActionsChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div
          className="settings-item settings-item-toggle"
          onClick={() => onFullWidthChange(!fullWidth)}
        >
          <div className="settings-item-header">
            <strong>Full Width</strong>
            <span>{fullWidth ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Let the workspace span the full browser width when needed.
          </p>
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Full Width</span>
            <input
              aria-label="Full Width"
              checked={fullWidth}
              className="settings-switch-input"
              onChange={(event) => onFullWidthChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div
          className="settings-item settings-item-toggle"
          onClick={toggleDailyDigest}
        >
          <div className="settings-item-header">
            <strong>Daily Digest</strong>
            <span>{dailyDigestEnabled ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            {dailyDigestEnabled
              ? `Replace immediate non-admin emails with one digest sent at ${configuredDigestTime} server time.`
              : "Replace immediate non-admin emails with one daily digest instead of sending them right away."}
          </p>
          {digestPrefError ? (
            <p className="error-banner">{digestPrefError}</p>
          ) : null}
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Daily Digest</span>
            <input
              aria-label="Daily Digest"
              checked={dailyDigestEnabled}
              className="settings-switch-input"
              disabled={
                notificationPreferencesMutation.isPending ||
                notificationPreferencesQuery.isPending
              }
              onChange={toggleDailyDigest}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onClearLocalStorage)}
        >
          <div className="settings-item-header">
            <strong>Clear Local Storage</strong>
            <span>Tavi only</span>
          </div>
          <p className="toolbar-hint">
            Remove only Tavi-owned browser state, including theme, auto
            collapse, bulk actions, full width, panel toggles, and per-project
            Add Task preferences.
          </p>
        </div>

        <div
          aria-expanded={isUserHistoryOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleUserHistory)}
        >
          <div className="settings-item-header">
            <strong>User History</strong>
            <span>{currentUser.name}</span>
          </div>
          <p className="toolbar-hint">
            Review sign-in events for this browser session identity.
          </p>
        </div>

        {!isAdmin ? (
          <div
            aria-expanded={isImportExportOpen}
            className="settings-item settings-item-toggle"
            {...settingsCardButtonProps(onToggleImportExportPanel)}
          >
            <div className="settings-item-header">
              <strong>Import/Export</strong>
              <span>{isImportExportOpen ? "Open" : "Closed"}</span>
            </div>
            <p className="toolbar-hint">
              Open workspace export tools and, for admins, the Loop import
              staging panel.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type SettingsPanelProps = {
  currentUser: WorkspaceUser;
  isBackupsOpen: boolean;
  isAdmin: boolean;
  isImportExportOpen: boolean;
  onNotice: (message: string) => void;
  onToggleBackupsPanel: () => void;
  onToggleImportExportPanel: () => void;
  users: WorkspaceUser[];
};

function SettingsPanel({
  currentUser,
  isBackupsOpen,
  isAdmin,
  isImportExportOpen,
  onNotice,
  onToggleBackupsPanel,
  onToggleImportExportPanel,
  users,
}: SettingsPanelProps) {
  if (!isAdmin) {
    return null;
  }

  const [localAccountsOpen, setLocalAccountsOpen] = useState(false);
  const [adminAuditPanel, setAdminAuditPanel] =
    useState<AdminAuditReportType | null>(null);
  const [emailPrefError, setEmailPrefError] = useState<string | null>(null);
  const [dailyDigestTimeDraft, setDailyDigestTimeDraft] = useState("09:00");

  const queryClient = useQueryClient();
  const smtpStatusQuery = useQuery({
    queryFn: getSmtpStatus,
    queryKey: ["smtp-status"],
    staleTime: 60_000,
  });
  const smtpServer =
    smtpStatusQuery.data?.host && smtpStatusQuery.data?.port != null
      ? `${smtpStatusQuery.data.secure ? "smtps" : "smtp"}://${smtpStatusQuery.data.host}:${smtpStatusQuery.data.port}`
      : null;
  const configuredDigestTime = smtpStatusQuery.data?.dailyDigestTime ?? "09:00";
  const emailEnabled = smtpStatusQuery.data?.enabled ?? true;
  const dragHandlesEnabled = smtpStatusQuery.data?.dragHandlesEnabled ?? true;

  useEffect(() => {
    setDailyDigestTimeDraft(configuredDigestTime);
  }, [configuredDigestTime]);

  const syncWorkspaceDragHandlesEnabled = (enabled: boolean) => {
    queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
      current
        ? {
            ...current,
            workspaceSettings: {
              dragHandlesEnabled: enabled,
            },
          }
        : current,
    );
  };

  const emailSettingsMutation = useMutation({
    mutationFn: updateEmailSettings,
    onMutate: async (variables) => {
      setEmailPrefError(null);
      const previous = queryClient.getQueryData<SmtpStatus>(["smtp-status"]);
      const previousWorkspace = queryClient.getQueryData<WorkspaceResponse>([
        "workspace",
      ]);
      queryClient.setQueryData<SmtpStatus>(["smtp-status"], (current) =>
        current
          ? {
              ...current,
              dailyDigestTime: variables.dailyDigestTime,
              dragHandlesEnabled: variables.dragHandlesEnabled,
              enabled: variables.enabled,
            }
          : current,
      );
      syncWorkspaceDragHandlesEnabled(variables.dragHandlesEnabled);
      return { previous, previousWorkspace };
    },
    onSuccess: (status) => {
      queryClient.setQueryData(["smtp-status"], status);
      syncWorkspaceDragHandlesEnabled(status.dragHandlesEnabled);
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["smtp-status"], context.previous);
      }
      if (context?.previousWorkspace) {
        queryClient.setQueryData(["workspace"], context.previousWorkspace);
      }
      setEmailPrefError(
        error instanceof ApiError
          ? error.message
          : "Unable to update email notifications.",
      );
    },
  });
  const toggleEmailNotifications = () => {
    if (emailSettingsMutation.isPending || !smtpStatusQuery.data) {
      return;
    }

    emailSettingsMutation.mutate({
      dailyDigestTime: smtpStatusQuery.data.dailyDigestTime,
      dragHandlesEnabled: smtpStatusQuery.data.dragHandlesEnabled,
      enabled: !smtpStatusQuery.data.enabled,
    });
  };
  const saveDailyDigestTime = () => {
    if (emailSettingsMutation.isPending || !smtpStatusQuery.data) {
      return;
    }

    emailSettingsMutation.mutate({
      dailyDigestTime: dailyDigestTimeDraft,
      dragHandlesEnabled: smtpStatusQuery.data.dragHandlesEnabled,
      enabled: smtpStatusQuery.data.enabled,
    });
  };
  const toggleDragHandles = () => {
    if (emailSettingsMutation.isPending || !smtpStatusQuery.data) {
      return;
    }

    emailSettingsMutation.mutate({
      dailyDigestTime: smtpStatusQuery.data.dailyDigestTime,
      dragHandlesEnabled: !smtpStatusQuery.data.dragHandlesEnabled,
      enabled: smtpStatusQuery.data.enabled,
    });
  };

  const toggleLocalAccounts = () => {
    setLocalAccountsOpen((current) => !current);
  };
  const toggleAdminAuditPanel = (panel: AdminAuditReportType) => {
    setAdminAuditPanel((current) => (current === panel ? null : panel));
  };

  return (
    <section className="workspace-panel-card">
      <header className="panel-header">
        <div>
          <strong>Settings</strong>
          <span>Workspace-wide admin controls, tools, and system reports.</span>
        </div>
        <div className="settings-version">
          <div className="settings-version-row">
            <span>{`${appName} v${appVersion}`}</span>
            <a
              className="settings-link"
              href={appRepositoryUrl}
              rel="noreferrer"
              target="_blank"
            >
              github
            </a>
          </div>
          {isAdmin && smtpServer ? (
            <span className="settings-version-detail">{smtpServer}</span>
          ) : null}
          {isAdmin && smtpStatusQuery.data?.fromAddress ? (
            <span className="settings-version-detail">
              {smtpStatusQuery.data.fromAddress}
            </span>
          ) : null}
        </div>
      </header>

      <div className="settings-grid">
        <div
          className="settings-item settings-item-toggle"
          onClick={toggleEmailNotifications}
        >
          <div className="settings-item-header">
            <strong>Email Notifications</strong>
            <span>{emailEnabled ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Enable or disable all Tavi email delivery for every user.
          </p>
          {emailPrefError ? (
            <p className="error-banner">{emailPrefError}</p>
          ) : null}
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Email Notifications</span>
            <input
              aria-label="Email Notifications"
              checked={emailEnabled}
              className="settings-switch-input"
              onChange={toggleEmailNotifications}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>
        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Daily Digest Time</strong>
            <span>{configuredDigestTime}</span>
          </div>
          <p className="toolbar-hint">
            Choose when daily digest emails are sent in server local time.
          </p>
          {emailPrefError ? (
            <p className="error-banner">{emailPrefError}</p>
          ) : null}
          <div className="settings-time-controls">
            <label className="settings-time-field">
              <input
                aria-label="Daily digest time"
                onChange={(event) =>
                  setDailyDigestTimeDraft(event.target.value)
                }
                type="time"
                value={dailyDigestTimeDraft}
              />
            </label>
            <div className="settings-actions">
              <button
                type="button"
                className="ghost-button compact-button"
                disabled={
                  emailSettingsMutation.isPending ||
                  !smtpStatusQuery.data ||
                  dailyDigestTimeDraft === smtpStatusQuery.data.dailyDigestTime
                }
                onClick={saveDailyDigestTime}
              >
                Save digest time
              </button>
            </div>
          </div>
        </div>
        <div
          className="settings-item settings-item-toggle"
          onClick={toggleDragHandles}
        >
          <div className="settings-item-header">
            <strong>Task Drag Handles</strong>
            <span>{dragHandlesEnabled ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Show or hide manual task-reorder handles for the whole workspace.
          </p>
          {emailPrefError ? (
            <p className="error-banner">{emailPrefError}</p>
          ) : null}
          <label
            className="settings-switch"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="settings-switch-label">Task Drag Handles</span>
            <input
              aria-label="Task Drag Handles"
              checked={dragHandlesEnabled}
              className="settings-switch-input"
              disabled={
                emailSettingsMutation.isPending || !smtpStatusQuery.data
              }
              onChange={toggleDragHandles}
              role="switch"
              type="checkbox"
            />
          </label>
        </div>
        <div
          aria-expanded={isBackupsOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleBackupsPanel)}
        >
          <div className="settings-item-header">
            <strong>Backups</strong>
            <span>{isBackupsOpen ? "Open" : "Closed"}</span>
          </div>
          <p className="toolbar-hint">
            Open the backups panel to manage scheduled snapshots and restore
            backups.
          </p>
        </div>
        <div
          aria-expanded={isImportExportOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(onToggleImportExportPanel)}
        >
          <div className="settings-item-header">
            <strong>Import/Export</strong>
            <span>{isImportExportOpen ? "Open" : "Closed"}</span>
          </div>
          <p className="toolbar-hint">
            Open workspace export tools and the Loop import staging panel.
          </p>
        </div>
        <div
          aria-expanded={localAccountsOpen}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(toggleLocalAccounts)}
        >
          <div className="settings-item-header">
            <strong>Local Accounts</strong>
            <span>Local auth</span>
          </div>
          <p className="toolbar-hint">
            Create, import, export, reset, edit, remove, and set passwords for
            local accounts.
          </p>
        </div>
        <div
          aria-expanded={adminAuditPanel === "logins"}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(() => toggleAdminAuditPanel("logins"))}
        >
          <div className="settings-item-header">
            <strong>Audit logins</strong>
            <span>All users</span>
          </div>
          <p className="toolbar-hint">
            Review sign-in and sign-out history for every account with search,
            date filters, and export.
          </p>
        </div>
        <div
          aria-expanded={adminAuditPanel === "changes"}
          className="settings-item settings-item-toggle"
          {...settingsCardButtonProps(() => toggleAdminAuditPanel("changes"))}
        >
          <div className="settings-item-header">
            <strong>Audit changes</strong>
            <span>Projects and tasks</span>
          </div>
          <p className="toolbar-hint">
            Review project and task changes across the workspace with search,
            filters, and export.
          </p>
        </div>
      </div>

      {localAccountsOpen ? (
        <LocalAccountsPanel
          currentUser={currentUser}
          isAdmin={isAdmin}
          onClose={() => setLocalAccountsOpen(false)}
          onNotice={onNotice}
          emailEnabled={smtpStatusQuery.data?.enabled ?? true}
          smtpConfigured={smtpStatusQuery.data?.configured ?? false}
        />
      ) : null}

      {isAdmin && adminAuditPanel ? (
        <AdminAuditReportPanel
          currentUser={currentUser}
          onClose={() => setAdminAuditPanel(null)}
          type={adminAuditPanel}
          users={users}
        />
      ) : null}
    </section>
  );
}

type AdminAuditReportPanelProps = {
  currentUser: WorkspaceUser;
  onClose: () => void;
  type: AdminAuditReportType;
  users: WorkspaceUser[];
};

function AdminAuditReportPanel({
  currentUser,
  onClose,
  type,
  users,
}: AdminAuditReportPanelProps) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [actorUserId, setActorUserId] = useState("");
  const [action, setAction] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [retentionWindowOverride, setRetentionWindowOverride] =
    useState<AuditLogRetentionWindow | null>(null);
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);

  const userLookup = useMemo(
    () =>
      Object.fromEntries(users.map((user) => [user.id, user])) as Record<
        string,
        WorkspaceUser
      >,
    [users],
  );

  const retentionQuery = useQuery({
    queryKey: ["audit-retention"],
    queryFn: getAuditLogRetention,
  });
  const retentionWindow =
    retentionWindowOverride ??
    retentionQuery.data?.olderThan ??
    DEFAULT_AUDIT_LOG_RETENTION_WINDOW;

  const reportQuery = useQuery({
    queryKey: [
      "audit-report",
      type,
      search,
      actorUserId,
      action,
      fromDate,
      toDate,
    ],
    queryFn: async () => {
      const filters = {
        actorUserId: actorUserId || undefined,
        fromDate: fromDate || undefined,
        limit: 250,
        search,
        toDate: toDate || undefined,
      };

      if (type === "changes") {
        return listAuditChanges({
          ...filters,
          action: action || undefined,
        });
      }

      return listAuditLogins(filters);
    },
  });

  const purgeAuditLogsMutation = useMutation({
    mutationFn: (olderThan: AuditLogRetentionWindow) =>
      purgeAuditLogs({ olderThan }),
    onSuccess: async (result, olderThan) => {
      setRetentionError(null);
      setRetentionMessage(
        `Purged ${result.deletedCount.toString()} audit event${result.deletedCount === 1 ? "" : "s"} older than ${formatAuditLogRetentionWindowLabel(olderThan)}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["audit-report"] });
    },
    onError: (error) => {
      setRetentionMessage(null);
      setRetentionError(
        error instanceof ApiError
          ? error.message
          : "Unable to purge audit logs",
      );
    },
  });

  const setAuditLogRetentionMutation = useMutation({
    mutationFn: (olderThan: AuditLogRetentionWindow) =>
      setAuditLogRetention({ olderThan }),
    onSuccess: (_policy, olderThan) => {
      setRetentionWindowOverride(olderThan);
      setRetentionError(null);
      setRetentionMessage(
        `Automatic log aging is now set to ${formatAuditLogRetentionWindowLabel(olderThan)}.`,
      );
      queryClient.setQueryData(["audit-retention"], { olderThan });
    },
    onError: (error) => {
      setRetentionMessage(null);
      setRetentionError(
        error instanceof ApiError
          ? error.message
          : "Unable to update automatic log aging",
      );
    },
  });

  const events = reportQuery.data ?? [];
  const title = type === "changes" ? "Audit changes" : "Audit logins";
  const subtitle =
    type === "changes"
      ? "Admin-only project and task change history"
      : "Admin-only sign-in and sign-out history";
  const automaticRetentionStatus = retentionQuery.data?.olderThan
    ? `Automatic log aging: ${formatAuditLogRetentionWindowLabel(retentionQuery.data.olderThan)}.`
    : retentionQuery.isSuccess
      ? "Automatic log aging is not set."
      : null;

  const handlePurgeAuditLogs = () => {
    const retentionLabel = formatAuditLogRetentionWindowLabel(retentionWindow);

    if (!window.confirm(`Purge audit logs older than ${retentionLabel}?`)) {
      return;
    }

    setRetentionError(null);
    setRetentionMessage(null);
    purgeAuditLogsMutation.mutate(retentionWindow);
  };

  return (
    <section className="audit-card audit-card--report">
      <div className="panel-header">
        <div>
          <strong>{title}</strong>
          <p className="toolbar-hint">{subtitle}</p>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost-button compact-button"
            disabled={events.length === 0 || reportQuery.isLoading}
            onClick={() =>
              exportAuditReportCsv({
                currentUser,
                events,
                type,
                users: userLookup,
              })
            }
          >
            Export CSV
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="audit-retention-row">
        <label className="workspace-filter">
          Log aging
          <select
            aria-label="Log aging"
            value={retentionWindow}
            onChange={(event) => {
              if (isAuditLogRetentionWindow(event.target.value)) {
                setRetentionWindowOverride(event.target.value);
              }
              setRetentionError(null);
              setRetentionMessage(null);
            }}
          >
            {AUDIT_LOG_RETENTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost-button compact-button"
            disabled={purgeAuditLogsMutation.isPending}
            onClick={handlePurgeAuditLogs}
          >
            {purgeAuditLogsMutation.isPending ? "Purging..." : "Purge logs"}
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            disabled={setAuditLogRetentionMutation.isPending}
            onClick={() => {
              setRetentionError(null);
              setRetentionMessage(null);
              setAuditLogRetentionMutation.mutate(retentionWindow);
            }}
          >
            {setAuditLogRetentionMutation.isPending
              ? "Saving..."
              : "Set automatic aging"}
          </button>
        </div>
      </div>
      {retentionQuery.isLoading ? (
        <p className="toolbar-hint audit-retention-status">
          Loading automatic log aging...
        </p>
      ) : null}
      {retentionQuery.isError ? (
        <p className="error-banner">
          {retentionQuery.error instanceof Error
            ? retentionQuery.error.message
            : "Unable to load automatic log aging."}
        </p>
      ) : null}
      {automaticRetentionStatus ? (
        <p className="toolbar-hint audit-retention-status">
          {automaticRetentionStatus}
        </p>
      ) : null}
      {retentionMessage ? (
        <p className="toolbar-hint audit-retention-status">
          {retentionMessage}
        </p>
      ) : null}
      {retentionError ? <p className="error-banner">{retentionError}</p> : null}

      <div className="audit-filter-grid">
        <label className="workspace-filter search-filter">
          Search
          <input
            type="search"
            placeholder="Search audit history"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label className="workspace-filter">
          User
          <select
            value={actorUserId}
            onChange={(event) => setActorUserId(event.target.value)}
          >
            <option value="">All users</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        {type === "changes" ? (
          <label className="workspace-filter">
            Action
            <select
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              {AUDIT_CHANGE_ACTION_OPTIONS.map((option) => (
                <option key={option.value || "all"} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="workspace-filter">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
          />
        </label>
        <label className="workspace-filter">
          To
          <input
            type="date"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
          />
        </label>
      </div>

      {reportQuery.isLoading ? <p>Loading audit history...</p> : null}
      {reportQuery.isError ? (
        <p className="error-banner">
          {reportQuery.error instanceof Error
            ? reportQuery.error.message
            : "Unable to load audit history."}
        </p>
      ) : null}
      {!reportQuery.isLoading && !reportQuery.isError && events.length === 0 ? (
        <p className="toolbar-hint">No matching audit events.</p>
      ) : null}

      {!reportQuery.isLoading && !reportQuery.isError && events.length > 0 ? (
        <ul className="audit-list">
          {events.map((event) => {
            const auditChanges = readAuditChanges(event.metadata);
            const eventSummary = summarizeAuditMetadata(
              event.metadata,
              userLookup,
              currentUser,
            );
            const entityLabel = formatAuditEntityTitle(event);

            return (
              <li key={event.id} className="audit-event">
                <div className="audit-event-header">
                  <strong>{formatAuditActionLabel(event.action)}</strong>
                  <span>{formatDateTime(event.createdAt)}</span>
                </div>
                <div className="audit-event-meta">
                  <span>{entityLabel}</span>
                  <span>{formatActorSummary(event.actor)}</span>
                </div>
                {auditChanges.length > 0 ? (
                  <ul className="audit-change-list">
                    {auditChanges.map((change) => (
                      <li key={`${event.id}-${change.field}`}>
                        <strong>{formatAuditFieldLabel(change.field)}</strong>
                        <span>
                          {formatAuditChangeValue(
                            change.field,
                            change.from,
                            userLookup,
                            currentUser,
                          )}
                          {" -> "}
                          {formatAuditChangeValue(
                            change.field,
                            change.to,
                            userLookup,
                            currentUser,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {eventSummary.length > 0 ? (
                  <div className="audit-event-meta">
                    <span>{eventSummary.join(" · ")}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

type AuditHistoryPanelProps = {
  currentUser: WorkspaceUser;
  emptyMessage: string;
  errorMessage: string | null;
  events: AuditHistoryEvent[];
  isError: boolean;
  isLoading: boolean;
  onClose: () => void;
  subtitle: string;
  title: string;
  users: Record<string, WorkspaceUser>;
};

function AuditHistoryPanel({
  currentUser,
  emptyMessage,
  errorMessage,
  events,
  isError,
  isLoading,
  onClose,
  subtitle,
  title,
  users,
}: AuditHistoryPanelProps) {
  return (
    <section className="audit-card">
      <header className="audit-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>
          Close
        </button>
      </header>

      {isLoading ? (
        <p className="toolbar-hint">Loading audit history...</p>
      ) : null}
      {isError ? (
        <p className="error-banner">
          {errorMessage ?? "Unable to load history"}
        </p>
      ) : null}
      {!isLoading && !isError && events.length === 0 ? (
        <p className="toolbar-hint">{emptyMessage}</p>
      ) : null}

      {!isLoading && !isError && events.length > 0 ? (
        <ul className="audit-list">
          {events.map((event) => {
            const auditChanges = readAuditChanges(event.metadata);
            const metadataSummary = summarizeAuditMetadata(
              event.metadata,
              users,
              currentUser,
            );

            return (
              <li className="audit-event" key={event.id}>
                <div className="audit-event-header">
                  <strong>{event.actor.name}</strong>
                  <span>{formatAuditActionLabel(event.action)}</span>
                  <span>{formatDateTime(event.createdAt)}</span>
                </div>
                <div className="audit-event-subtitle">
                  <span>{event.actor.role}</span>
                  <span>{event.actor.email}</span>
                </div>
                {auditChanges.length > 0 ? (
                  <ul className="audit-change-list">
                    {auditChanges.map((change) => (
                      <li key={`${event.id}-${change.field}`}>
                        <strong>{formatAuditFieldLabel(change.field)}</strong>
                        <span>
                          {formatAuditChangeValue(
                            change.field,
                            change.from,
                            users,
                            currentUser,
                          )}
                          {" -> "}
                          {formatAuditChangeValue(
                            change.field,
                            change.to,
                            users,
                            currentUser,
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {metadataSummary.length > 0 ? (
                  <div className="audit-event-meta">
                    {metadataSummary.map((item) => (
                      <span className="audit-chip" key={`${event.id}-${item}`}>
                        {item}
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function buildBulkTaskPayload(draft: BulkTaskDraft) {
  return {
    ...(draft.assigneeMode === "set" && draft.assigneeUserId
      ? { assigneeUserId: draft.assigneeUserId }
      : draft.assigneeMode === "clear"
        ? { assigneeUserId: null }
        : {}),
    ...(draft.priority ? { priority: draft.priority } : {}),
    ...(draft.status ? { status: draft.status } : {}),
    ...(draft.notesMode === "clear" ? { notes: null } : {}),
    ...(draft.dueDateMode === "set"
      ? { dueDate: draft.dueDate }
      : draft.dueDateMode === "clear"
        ? { dueDate: null }
        : {}),
  };
}

function normalizeWorkspacePanelState(
  value: Partial<WorkspacePanelState> | null | undefined,
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

function activeBooleanSelection(selection: Record<string, boolean>) {
  return Object.fromEntries(
    Object.entries(selection).filter(([, isSelected]) => isSelected),
  );
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

function getNextWorkspaceTheme(theme: WorkspaceTheme): WorkspaceTheme {
  const currentIndex = WORKSPACE_THEMES.indexOf(theme);
  const nextIndex =
    currentIndex === -1 ? 0 : (currentIndex + 1) % WORKSPACE_THEMES.length;

  return WORKSPACE_THEMES[nextIndex];
}

function getWorkspaceThemeLabel(theme: WorkspaceTheme) {
  return WORKSPACE_THEME_META[theme].label;
}

function normalizeWorkspaceTheme(value: unknown): WorkspaceTheme {
  if (value === "dark") {
    return "ocean";
  }

  if (
    typeof value === "string" &&
    WORKSPACE_THEMES.includes(value as WorkspaceTheme)
  ) {
    return value as WorkspaceTheme;
  }

  return DEFAULT_WORKSPACE_THEME;
}

function formatTaskCompletionPercent(doneCount: number, totalCount: number) {
  if (totalCount === 0) {
    return "0%";
  }

  return `${Math.round((doneCount / totalCount) * 100).toString()}%`;
}

function summarizeAuditMetadata(
  metadata: Record<string, unknown> | null,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (!metadata) {
    return [];
  }

  const summary: string[] = [];
  const title = readMetadataString(metadata.title);
  const name = readMetadataString(metadata.name);
  const changedFields = readMetadataStringArray(metadata.changedFields);
  const status = readMetadataString(metadata.status);
  const manualStatus = readMetadataString(metadata.manualStatus);
  const assigneeUserId =
    "assigneeUserId" in metadata
      ? readMetadataNullableString(metadata.assigneeUserId)
      : null;
  const priority = readMetadataString(metadata.priority);
  const dueDate = metadata.dueDate;
  const notes =
    readMetadataString(metadata.notes) ??
    readMetadataString(metadata.blockedReason) ??
    readMetadataString(metadata.manualStatusReason);
  const selectionSize = readMetadataNumber(metadata.selectionSize);
  const groupBy = readMetadataString(metadata.groupBy);
  const search = readMetadataString(metadata.search);
  const sortBy = readMetadataStringArray(metadata.sortBy).filter(
    isProjectSortField,
  );
  const statusFilters = readMetadataStringArray(metadata.statusFilters).filter(
    isProjectStatus,
  );
  const assigneeUserIds = readMetadataStringArray(metadata.assigneeUserIds);
  const role = readMetadataString(metadata.role);
  const copiedFromProjectTitle = readMetadataString(
    metadata.copiedFromProjectTitle,
  );
  const ownerUserId =
    "ownerUserId" in metadata
      ? readMetadataNullableString(metadata.ownerUserId)
      : null;

  if (title) {
    summary.push(title);
  } else if (name) {
    summary.push(name);
  }

  if (copiedFromProjectTitle) {
    summary.push(`Copied from project ${copiedFromProjectTitle}`);
  }

  if (changedFields.length > 0) {
    summary.push(
      `Changed ${changedFields.map((field) => formatAuditField(field)).join(", ")}`,
    );
  }

  if (status) {
    summary.push(`Status ${formatStatusLabel(status as TaskStatus)}`);
  }

  if (manualStatus) {
    summary.push(
      `Override ${formatStatusLabel(manualStatus as ProjectStatus)}`,
    );
  }

  if (assigneeUserId !== null) {
    summary.push(
      assigneeUserId
        ? `Assignee ${formatUserReference(assigneeUserId, users, currentUser)}`
        : `Assignee ${NO_TASK_ASSIGNEE_LABEL}`,
    );
  }

  if (ownerUserId !== null) {
    summary.push(
      ownerUserId
        ? `Owner ${formatUserReference(ownerUserId, users, currentUser)}`
        : `Owner ${NO_PROJECT_OWNER_LABEL}`,
    );
  }

  if (priority) {
    summary.push(`Priority ${priority}`);
  }

  if (dueDate !== undefined) {
    const nextDueDate = readMetadataNullableString(dueDate);
    summary.push(
      nextDueDate ? `Due ${formatDate(nextDueDate)}` : "Due cleared",
    );
  }

  if (notes) {
    summary.push(`Notes ${notes}`);
  }

  if (selectionSize) {
    summary.push(
      `${selectionSize} task${selectionSize === 1 ? "" : "s"} selected`,
    );
  }

  if (groupBy) {
    summary.push(`Group ${groupBy.replace(/_/g, " ")}`);
  }

  if (search) {
    summary.push(`Search "${search}"`);
  }

  if (sortBy.length > 0) {
    summary.push(
      `Sort ${sortBy.map((field) => formatProjectSortFieldLabel(field)).join(", ")}`,
    );
  }

  if (statusFilters.length > 0) {
    summary.push(
      `Status ${statusFilters.map((statusValue) => formatStatusLabel(statusValue)).join(", ")}`,
    );
  }

  if (assigneeUserIds.length > 0) {
    summary.push(
      `Assignee ${assigneeUserIds
        .map((userId) => formatUserReference(userId, users, currentUser))
        .join(", ")}`,
    );
  }

  if (role) {
    summary.push(`Role ${role}`);
  }

  return summary.slice(0, 6);
}

type AuditChange = {
  field: string;
  from: unknown;
  to: unknown;
};

function readAuditChanges(
  metadata: Record<string, unknown> | null,
): AuditChange[] {
  if (!metadata || !Array.isArray(metadata.changes)) {
    return [];
  }

  return metadata.changes.flatMap((entry) => {
    if (
      entry &&
      typeof entry === "object" &&
      "field" in entry &&
      typeof entry.field === "string"
    ) {
      return [
        {
          field: entry.field,
          from: "from" in entry ? entry.from : null,
          to: "to" in entry ? entry.to : null,
        },
      ];
    }

    return [];
  });
}

function formatAuditFieldLabel(value: string) {
  return formatAuditField(value);
}

function formatAuditChangeValue(
  field: string,
  value: unknown,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (value === null || value === undefined || value === "") {
    if (field === "assigneeUserId") {
      return NO_TASK_ASSIGNEE_LABEL;
    }

    if (field === "ownerUserId") {
      return NO_PROJECT_OWNER_LABEL;
    }

    return "None";
  }

  if (field === "assigneeUserId" || field === "ownerUserId") {
    return typeof value === "string"
      ? formatUserReference(value, users, currentUser)
      : "None";
  }

  if (field === "status" || field === "manualStatus") {
    return typeof value === "string"
      ? formatStatusLabel(value as ProjectStatus | TaskStatus)
      : "None";
  }

  if (field === "priority") {
    return typeof value === "string"
      ? formatPriorityLabel(value as Priority)
      : "None";
  }

  if (field === "dueDate") {
    return typeof value === "string" ? formatDate(value) : "None";
  }

  if (field === "completedAt" || field === "archivedAt") {
    return typeof value === "string" ? formatDateTime(value) : "None";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value)) {
    if (field === "sortBy") {
      const sortLabels = value
        .filter((entry): entry is string => typeof entry === "string")
        .filter(isProjectSortField)
        .map((entry) => formatProjectSortFieldLabel(entry));

      return sortLabels.length > 0 ? sortLabels.join(", ") : "None";
    }

    return value.join(", ");
  }

  return String(value);
}

function formatActorSummary(actor: AuditHistoryEvent["actor"]) {
  return `${actor.name} · ${actor.email}`;
}

function formatAuditEntityTitle(event: AuditHistoryEvent) {
  const metadataTitle =
    readMetadataString(event.metadata?.title) ??
    readMetadataString(event.metadata?.name);
  const entityLabel =
    event.entityType === "project"
      ? "Project"
      : event.entityType === "task"
        ? "Task"
        : "Auth";

  return metadataTitle
    ? `${entityLabel}: ${metadataTitle}`
    : `${entityLabel}: ${event.entityId}`;
}

function exportAuditReportCsv({
  currentUser,
  events,
  type,
  users,
}: {
  currentUser: WorkspaceUser;
  events: AuditHistoryEvent[];
  type: AdminAuditReportType;
  users: Record<string, WorkspaceUser>;
}) {
  const rows = events.map((event) => ({
    Action: formatAuditActionLabel(event.action),
    Actor: event.actor.name,
    "Actor Email": event.actor.email,
    "Changed Values": readAuditChanges(event.metadata)
      .map(
        (change) =>
          `${formatAuditFieldLabel(change.field)}: ${formatAuditChangeValue(
            change.field,
            change.from,
            users,
            currentUser,
          )} -> ${formatAuditChangeValue(change.field, change.to, users, currentUser)}`,
      )
      .join(" | "),
    "Date/Time": event.createdAt,
    Entity: formatAuditEntityTitle(event),
    Summary: summarizeAuditMetadata(event.metadata, users, currentUser).join(
      " | ",
    ),
  }));

  downloadCsvFile(type === "changes" ? "audit-changes" : "audit-logins", rows, [
    "Date/Time",
    "Action",
    "Entity",
    "Actor",
    "Actor Email",
    "Changed Values",
    "Summary",
  ]);
}

function readMetadataString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataNullableString(value: unknown) {
  return typeof value === "string" ? value : value === null ? null : null;
}

function readMetadataNumber(value: unknown) {
  return typeof value === "number" ? value : null;
}

function readMetadataStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function formatAuditActionLabel(action: string) {
  switch (action) {
    case "bulk_copy":
      return "bulk copy";
    case "bulk_delete":
      return "bulk delete";
    case "bulk_update":
      return "bulk update";
    case "convert_from_project":
      return "converted from project";
    case "convert_to_project":
      return "converted to project";
    case "convert_to_task":
      return "converted to task";
    case "status_override_clear":
      return "cleared override";
    case "status_override_set":
      return "set override";
    default:
      return action.replace(/_/g, " ");
  }
}

function formatAuditLogRetentionWindowLabel(value: AuditLogRetentionWindow) {
  switch (value) {
    case "one_day":
      return "1 day";
    case "one_week":
      return "1 week";
    case "one_month":
      return "1 month";
    case "three_months":
      return "3 months";
    case "six_months":
      return "6 months";
    case "one_year":
      return "1 year";
  }
}

function formatAuditField(value: string) {
  switch (value) {
    case "assigneeUserId":
      return "assignee";
    case "archivedAt":
      return "archived at";
    case "blockedReason":
    case "description":
    case "manualStatusReason":
      return "notes";
    case "completedAt":
      return "completed at";
    case "dueDate":
      return "due date";
    case "groupBy":
      return "group by";
    case "sortBy":
      return "sort by";
    case "manualStatus":
      return "override";
    case "ownerUserId":
      return "owner";
    case "trackerLink":
    case "references":
      return "references";
    case "assigneeUserIds":
      return "assignee filter";
    case "statusFilter":
    case "statusFilters":
      return "status filter";
    default:
      return value.replace(/_/g, " ");
  }
}

function isAuditLogRetentionWindow(
  value: string,
): value is AuditLogRetentionWindow {
  return AUDIT_LOG_RETENTION_OPTIONS.some((option) => option.value === value);
}

function formatUserReference(
  userId: string,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (userId === currentUser.id) {
    return currentUser.name;
  }

  return users[userId]?.name ?? userId;
}

function filterProjects({
  assigneeUserIds,
  projects,
  search,
  statusFilters,
}: {
  assigneeUserIds: string[];
  projects: WorkspaceProject[];
  search: string;
  statusFilters: ProjectStatus[];
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const hasAssigneeFilter = assigneeUserIds.length > 0;

  return projects.flatMap((project) => {
    if (
      statusFilters.length > 0 &&
      !statusFilters.includes(project.displayStatus)
    ) {
      return [];
    }

    const tasksAfterAssigneeFilter = project.tasks.filter((task) => {
      const matchesAssignee =
        assigneeUserIds.length === 0 ||
        (task.assigneeUserId === null
          ? assigneeUserIds.includes(UNASSIGNED_FILTER_VALUE)
          : assigneeUserIds.includes(task.assigneeUserId));

      return matchesAssignee;
    });

    if (hasAssigneeFilter && tasksAfterAssigneeFilter.length === 0) {
      return [];
    }

    const candidateTasks = hasAssigneeFilter
      ? tasksAfterAssigneeFilter
      : project.tasks;

    if (!normalizedSearch) {
      return [{ ...project, tasks: candidateTasks }];
    }

    const projectMatchesSearch =
      project.title.toLowerCase().includes(normalizedSearch) ||
      (project.references ?? "").toLowerCase().includes(normalizedSearch) ||
      (project.notes ?? "").toLowerCase().includes(normalizedSearch);
    const matchingTasks = candidateTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(normalizedSearch) ||
        (task.notes ?? "").toLowerCase().includes(normalizedSearch),
    );

    if (!projectMatchesSearch && matchingTasks.length === 0) {
      return [];
    }

    return [
      {
        ...project,
        tasks: projectMatchesSearch ? candidateTasks : matchingTasks,
      },
    ];
  });
}

function groupProjects(
  projects: WorkspaceProject[],
  groupBy: GroupBy,
  sortBy: ProjectSortField[],
) {
  if (groupBy === "none") {
    return [
      { key: GROUP_LABELS.none, projects: sortProjects(projects, sortBy) },
    ];
  }

  const groups = new Map<string, WorkspaceProject[]>();

  for (const project of projects) {
    const key =
      groupBy === "owner"
        ? formatProjectOwnerGroupLabel(project.ownerName)
        : groupBy === "priority"
          ? project.priority
          : groupBy === "progress"
            ? formatProjectProgress(project)
            : formatStatusLabel(project.displayStatus);

    const existing = groups.get(key) ?? [];
    existing.push(project);
    groups.set(key, existing);
  }

  const groupedEntries = [...groups.entries()].map(
    ([key, groupedProjects]) => ({
      key,
      projects: sortProjects(groupedProjects, sortBy),
    }),
  );

  if (groupBy !== "progress") {
    return groupedEntries;
  }

  return groupedEntries.sort(
    (left, right) =>
      parseProgressGroup(right.key) - parseProgressGroup(left.key),
  );
}

function sortProjects(
  projects: WorkspaceProject[],
  sortBy: ProjectSortField[],
) {
  if (sortBy.length === 0) {
    return projects;
  }

  return projects
    .map((project, index) => ({ index, project }))
    .sort((left, right) => {
      for (const sortField of sortBy) {
        const result = compareProjectsByField(
          left.project,
          right.project,
          sortField,
        );

        if (result !== 0) {
          return result;
        }
      }

      return left.index - right.index;
    })
    .map(({ project }) => project);
}

function compareProjectsByField(
  left: WorkspaceProject,
  right: WorkspaceProject,
  field: ProjectSortField,
) {
  switch (field) {
    case "dueDate":
      return compareNullableDateValues(left.dueDate, right.dueDate);
    case "age":
      return compareNullableDateValues(
        left.createdAt ?? null,
        right.createdAt ?? null,
      );
    case "lastUpdated":
      return compareNullableDateValues(
        latestProjectActivity(right),
        latestProjectActivity(left),
      );
    case "priority":
      return prioritySortRank(left.priority) - prioritySortRank(right.priority);
    case "progress":
      return projectCompletionPercent(right) - projectCompletionPercent(left);
    case "title":
      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      });
  }
}

function compareNullableDateValues(left: string | null, right: string | null) {
  if (!left && !right) {
    return 0;
  }

  if (!left) {
    return 1;
  }

  if (!right) {
    return -1;
  }

  return left.localeCompare(right);
}

function latestProjectActivity(project: WorkspaceProject) {
  return project.tasks.reduce<string | null>((latest, task) => {
    const taskUpdatedAt = task.updatedAt ?? null;

    return compareNullableDateValues(taskUpdatedAt, latest) > 0
      ? taskUpdatedAt
      : latest;
  }, project.updatedAt ?? null);
}

function prioritySortRank(value: Priority) {
  switch (value) {
    case "high":
      return 0;
    case "medium":
      return 1;
    case "low":
      return 2;
  }
}

function projectCompletionPercent(project: WorkspaceProject) {
  if (project.taskTotalCount === 0) {
    return 0;
  }

  return Math.round((project.taskDoneCount / project.taskTotalCount) * 100);
}

function formatProjectProgress(project: WorkspaceProject) {
  return `${projectCompletionPercent(project).toString()}%`;
}

function parseProgressGroup(value: string) {
  const match = /^(\d+)%$/.exec(value);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function defaultTaskPayload(currentUserId: string): CreateTaskPayload {
  return {
    projectId: "",
    title: "",
    notes: "",
    assigneeUserId: currentUserId,
    dueDate: "",
    priority: "medium",
    status: "todo",
  };
}

function nextTaskPayload(
  currentUserId: string,
  previousPayload: CreateTaskPayload,
): CreateTaskPayload {
  const nextPayload = defaultTaskPayload(currentUserId);

  return {
    ...nextPayload,
    assigneeUserId: previousPayload.assigneeUserId,
    priority: previousPayload.priority ?? nextPayload.priority,
  };
}

function reorderWorkspaceProjectTasks(
  current: WorkspaceResponse | undefined,
  projectId: string,
  orderedTaskIds: string[],
) {
  if (!current) {
    return current;
  }

  return {
    ...current,
    projects: current.projects.map((project) =>
      project.id === projectId
        ? {
            ...project,
            tasks: reorderTasksByIds(project.tasks, orderedTaskIds),
          }
        : project,
    ),
  };
}

function reorderTasksByIds(tasks: WorkspaceTask[], orderedTaskIds: string[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task] as const));

  return orderedTaskIds
    .map((taskId, index) => {
      const task = taskById.get(taskId);

      if (!task) {
        return null;
      }

      return {
        ...task,
        sortOrder: index,
      };
    })
    .filter((task): task is WorkspaceTask => task !== null);
}

function moveTaskIdRelative(
  taskIds: string[],
  draggedTaskId: string,
  targetTaskId: string,
  position: TaskDropPosition,
) {
  if (draggedTaskId === targetTaskId) {
    return taskIds;
  }

  const nextTaskIds = [...taskIds];
  const draggedIndex = nextTaskIds.indexOf(draggedTaskId);
  const targetIndex = nextTaskIds.indexOf(targetTaskId);

  if (draggedIndex === -1 || targetIndex === -1) {
    return taskIds;
  }

  nextTaskIds.splice(draggedIndex, 1);

  let insertIndex = targetIndex;

  if (draggedIndex < targetIndex) {
    insertIndex -= 1;
  }

  if (position === "after") {
    insertIndex += 1;
  }

  nextTaskIds.splice(insertIndex, 0, draggedTaskId);
  return nextTaskIds;
}

function readTaskDropPosition(event: ReactDragEvent<HTMLTableRowElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY - bounds.top < bounds.height / 2 ? "before" : "after";
}

function normalizeCreateProjectPayload(
  project: CreateProjectPayload,
): CreateProjectPayload {
  const trimmedNotes = project.notes.trim();
  const normalizedReferences = normalizeProjectReferences(project.references);

  return {
    ...project,
    notes: trimmedNotes,
    ownerUserId: project.ownerUserId === "" ? null : project.ownerUserId,
    references: normalizedReferences,
  };
}

function normalizeProjectDraftPayload(
  projectDraft: UpdateProjectPayload,
): UpdateProjectPayload {
  const trimmedNotes = projectDraft.notes?.trim() ?? "";
  const normalizedReferences = normalizeProjectReferences(
    projectDraft.references ?? "",
  );

  return {
    ...projectDraft,
    manualStatus:
      projectDraft.manualStatus === undefined
        ? null
        : projectDraft.manualStatus,
    notes: trimmedNotes ? trimmedNotes : null,
    ownerUserId:
      projectDraft.ownerUserId === undefined
        ? undefined
        : projectDraft.ownerUserId === ""
          ? null
          : projectDraft.ownerUserId,
    references: normalizedReferences ? normalizedReferences : null,
  };
}

function normalizeProjectReferences(value: string) {
  return parseProjectReferences(value).join("\n");
}

function parseProjectReferences(value: string | null) {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n/u)
    .map((reference) => reference.trim())
    .filter((reference) => reference.length > 0);
}

function toProjectReferenceHref(reference: string) {
  if (!/^https?:\/\//i.test(reference)) {
    return null;
  }

  try {
    const parsed = new URL(reference);

    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? reference
      : null;
  } catch {
    return null;
  }
}

function formatProjectReferenceLabel(reference: string) {
  const referenceHref = toProjectReferenceHref(reference);

  if (!referenceHref) {
    return truncateDisplayLinkLabel(reference);
  }

  const fileName = extractUrlFilename(referenceHref);

  if (fileName) {
    return truncateDisplayLinkLabel(fileName);
  }

  const parsed = new URL(referenceHref);
  const normalizedPath = parsed.pathname.replace(/\/+$/u, "");

  return truncateDisplayLinkLabel(
    normalizedPath ? `${parsed.host}${normalizedPath}` : parsed.host,
  );
}

function normalizeTaskDraftPayload(
  taskDraft: UpdateTaskPayload,
): UpdateTaskPayload {
  const trimmedNotes = taskDraft.notes?.trim() ?? "";

  return {
    ...taskDraft,
    assigneeUserId:
      taskDraft.assigneeUserId === undefined
        ? undefined
        : taskDraft.assigneeUserId === ""
          ? null
          : taskDraft.assigneeUserId,
    notes: trimmedNotes ? trimmedNotes : null,
  };
}

function formatProjectOwnerLabel(ownerName: string | null) {
  return ownerName ?? NO_PROJECT_OWNER_LABEL;
}

function formatProjectStatusPillLabel(
  status: ProjectStatus,
  manualStatus: ProjectStatus | null,
) {
  return `${manualStatus ? "Override · " : ""}${formatStatusLabel(status)}`;
}

function formatProjectOwnerGroupLabel(ownerName: string | null) {
  return ownerName ?? NO_PROJECT_OWNER_GROUP;
}

function canConvertProjectToTask(
  project: WorkspaceProject,
  projectDraft: UpdateProjectPayload,
) {
  return projectConvertToTaskNote(project, projectDraft) === null;
}

function projectConvertToTaskNote(
  project: WorkspaceProject,
  projectDraft: UpdateProjectPayload,
) {
  const nextTitle = projectDraft.title ?? project.title;

  if (!nextTitle.trim()) {
    return "Add a title before converting this project into a task.";
  }

  if (project.taskTotalCount > 0) {
    return `Move or delete this project's ${project.taskTotalCount.toString()} active task${project.taskTotalCount === 1 ? "" : "s"} before converting it into a task.`;
  }

  if (isUnassignedProjectTitle(nextTitle)) {
    return `"${UNASSIGNED_PROJECT_TITLE}" stays reserved as the holding project for converted tasks.`;
  }

  return null;
}

function buildSavedViewPayload({
  assigneeUserIds,
  groupBy,
  search,
  sortBy,
  statusFilters,
  collapsedGroups,
  expandedProjects,
}: {
  assigneeUserIds: string[];
  groupBy: GroupBy;
  search: string;
  sortBy: ProjectSortField[];
  statusFilters: ProjectStatus[];
  collapsedGroups: Record<string, boolean>;
  expandedProjects: Record<string, boolean>;
}) {
  return {
    assigneeUserIds,
    groupBy,
    search,
    sortBy,
    statusFilters,
    collapsedGroupKeys: activeSelectionKeys(collapsedGroups),
    expandedProjectIds: activeSelectionKeys(expandedProjects),
  };
}

function activeSelectionKeys(selection: Record<string, boolean>) {
  return Object.entries(selection)
    .filter(([, value]) => value)
    .map(([key]) => key)
    .sort((left, right) => left.localeCompare(right));
}

function toSelectionMap(values: string[]) {
  return Object.fromEntries(values.map((value) => [value, true]));
}

function formatStatusLabel(value: ProjectStatus | TaskStatus) {
  return value.replace(/_/g, " ");
}

function formatPriorityLabel(value: Priority) {
  return value[0].toUpperCase() + value.slice(1);
}

function formatProjectSortFieldLabel(value: ProjectSortField) {
  switch (value) {
    case "dueDate":
      return "Due date";
    case "age":
      return "Age";
    case "lastUpdated":
      return "Last updated";
    case "progress":
      return "Progress";
    case "priority":
      return "Priority";
    case "title":
      return "Title";
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(
    new Date(value),
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function toDateInput(value: string | null) {
  if (!value) {
    return "";
  }

  return value.slice(0, 10);
}

function isUnassignedProjectTitle(value: string) {
  return value.trim().toLowerCase() === UNASSIGNED_PROJECT_TITLE.toLowerCase();
}

function normalizeWorkspaceFilterState(
  value: Partial<WorkspaceFilterState>,
): WorkspaceFilterState {
  return {
    assigneeUserIds: uniqueStringArray(value.assigneeUserIds ?? []),
    groupBy: isGroupBy(value.groupBy) ? value.groupBy : "owner",
    sortBy: normalizeProjectSortBy(value.sortBy ?? []),
    statusFilters: uniqueStringArray(
      (value.statusFilters ?? []).filter(isProjectStatus),
    ),
  };
}

function normalizeCollapsedGroupsByGroup(
  value: WorkspaceCollapsedGroups | null | undefined,
): WorkspaceCollapsedGroups {
  return Object.fromEntries(
    Object.entries(value ?? {}).flatMap(([targetGroupBy, selection]) => {
      if (!isGroupBy(targetGroupBy)) {
        return [];
      }

      const normalizedSelection =
        selection && typeof selection === "object" && !Array.isArray(selection)
          ? normalizeBooleanSelection(selection as Record<string, unknown>)
          : {};

      return Object.keys(normalizedSelection).length === 0
        ? []
        : [[targetGroupBy, normalizedSelection]];
    }),
  ) as WorkspaceCollapsedGroups;
}

function activeCollapsedGroupsByGroup(
  value: WorkspaceCollapsedGroups,
): WorkspaceCollapsedGroups {
  return Object.fromEntries(
    Object.entries(value).flatMap(([targetGroupBy, selection]) => {
      if (!isGroupBy(targetGroupBy)) {
        return [];
      }

      const activeSelection = activeBooleanSelection(selection);

      return Object.keys(activeSelection).length === 0
        ? []
        : [[targetGroupBy, activeSelection]];
    }),
  ) as WorkspaceCollapsedGroups;
}

function shouldHandleNonInteractiveRowClick(
  event: React.MouseEvent<HTMLElement>,
) {
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }

  if (
    event.target instanceof Element &&
    event.target.closest(ROW_EDIT_INTERACTIVE_SELECTOR)
  ) {
    return false;
  }

  return true;
}

function shouldOpenEditorFromModifierClick(
  event: React.MouseEvent<HTMLElement>,
) {
  if (
    !shouldHandleNonInteractiveRowClick(event) ||
    !(event.ctrlKey || event.metaKey)
  ) {
    return false;
  }

  event.preventDefault();
  return true;
}

function shouldToggleProjectFromRowClick(event: React.MouseEvent<HTMLElement>) {
  return (
    shouldHandleNonInteractiveRowClick(event) &&
    !(event.ctrlKey || event.metaKey)
  );
}

function revealElementInViewport(element: HTMLElement | null) {
  if (!element) {
    return;
  }

  const viewportHeight = Math.max(
    globalThis.innerHeight,
    document.documentElement.clientHeight,
  );
  const bounds = element.getBoundingClientRect();
  const aboveViewport = bounds.top < EDITOR_SCROLL_TOP_MARGIN;
  const belowViewport =
    bounds.bottom > viewportHeight - EDITOR_SCROLL_BOTTOM_MARGIN;

  if (
    (aboveViewport || belowViewport) &&
    typeof element.scrollIntoView === "function"
  ) {
    element.scrollIntoView({
      block: aboveViewport ? "start" : "end",
      inline: "nearest",
    });
  }
}

function revealEditor(element: HTMLElement | null) {
  if (!element) {
    return;
  }

  revealElementInViewport(element);

  const firstEditableField = element.querySelector<HTMLElement>(
    EDITOR_INPUT_SELECTOR,
  );

  firstEditableField?.focus({ preventScroll: true });
}

function readViewportScrollOffset() {
  return Math.max(
    typeof globalThis.scrollY === "number" ? globalThis.scrollY : 0,
    typeof globalThis.pageYOffset === "number" ? globalThis.pageYOffset : 0,
    document.documentElement?.scrollTop ?? 0,
    document.body?.scrollTop ?? 0,
  );
}

function normalizeNoteEditorHeights(
  value: Partial<NoteEditorHeights>,
): NoteEditorHeights {
  return {
    project: normalizeNoteEditorHeight(value.project),
    task: normalizeNoteEditorHeight(value.task),
  };
}

function normalizeNoteEditorHeight(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function readTextareaHeight(textarea: HTMLTextAreaElement) {
  return normalizeNoteEditorHeight(textarea.offsetHeight);
}

function toTextareaStyle(
  height: number | null,
): React.CSSProperties | undefined {
  return height === null ? undefined : { height: `${height.toString()}px` };
}

function uniqueStringArray<Value extends string>(values: Value[]) {
  return [...new Set(values)];
}

function normalizeProjectSortBy(values: ProjectSortField[]) {
  return uniqueStringArray(values.filter(isProjectSortField));
}

function sameStringArray<Value extends string>(left: Value[], right: Value[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameBooleanSelection(
  left: Record<string, boolean>,
  right: Record<string, boolean>,
) {
  return sameStringArray(activeSelectionKeys(left), activeSelectionKeys(right));
}

function isGroupBy(value: unknown): value is GroupBy {
  return (
    value === "none" ||
    value === "owner" ||
    value === "priority" ||
    value === "progress" ||
    value === "status"
  );
}

function isProjectSortField(value: string): value is ProjectSortField {
  return PROJECT_SORT_OPTIONS.some((option) => option.value === value);
}

function isProjectStatus(value: string): value is ProjectStatus {
  return PROJECT_STATUS_FILTER_OPTIONS.some((option) => option.value === value);
}

type WorkspaceMenuOption<Value extends string> = {
  label: string;
  value: Value;
};

type MultiSelectFilterProps = {
  label: string;
  onChange: (values: string[]) => void;
  options: WorkspaceMenuOption<string>[];
  selectedValues: string[];
};

function MultiSelectFilter({
  label,
  onChange,
  options,
  selectedValues,
}: MultiSelectFilterProps) {
  const [draftValues, setDraftValues] = useState<string[]>(selectedValues);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = options
    .filter((option) => selectedValues.includes(option.value))
    .map((option) => option.label);
  const summary =
    selectedLabels.length === 0
      ? `${label}: All`
      : selectedLabels.length <= 2
        ? `${label}: ${selectedLabels.join(", ")}`
        : `${label}: ${selectedLabels.length.toString()} selected`;

  const applyAndClose = () => {
    onChange(
      options
        .filter((option) => draftValues.includes(option.value))
        .map((option) => option.value),
    );
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onChange(
          options
            .filter((option) => draftValues.includes(option.value))
            .map((option) => option.value),
        );
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraftValues(selectedValues);
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, draftValues, onChange, options, selectedValues]);

  return (
    <div
      ref={containerRef}
      className="workspace-filter workspace-filter--multi workspace-filter--popup"
    >
      <button
        type="button"
        className={`workspace-filter-trigger${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => {
          if (isOpen) {
            applyAndClose();
            return;
          }

          setDraftValues(selectedValues);
          setIsOpen(true);
        }}
      >
        {summary}
      </button>

      {isOpen ? (
        <div
          className="workspace-multi-filter-menu"
          role="dialog"
          aria-label={label}
        >
          {options.map((option) => {
            const checked = draftValues.includes(option.value);

            return (
              <label
                key={option.value}
                className="workspace-multi-filter-option"
              >
                <input
                  checked={checked}
                  onChange={() =>
                    setDraftValues((current) =>
                      checked
                        ? current.filter((value) => value !== option.value)
                        : [...current, option.value],
                    )
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            );
          })}

          <div className="workspace-multi-filter-actions">
            {draftValues.length > 0 ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => setDraftValues([])}
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="workspace-filter-apply"
              aria-label={`Apply ${label.toLowerCase()}`}
              onClick={applyAndClose}
              title={`Apply ${label.toLowerCase()}`}
            >
              ✓
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

type MultiSortFilterProps = {
  label: string;
  onChange: (values: ProjectSortField[]) => void;
  options: WorkspaceMenuOption<ProjectSortField>[];
  selectedValues: ProjectSortField[];
};

function MultiSortFilter({
  label,
  onChange,
  options,
  selectedValues,
}: MultiSortFilterProps) {
  const [draftValues, setDraftValues] = useState<
    Record<ProjectSortField, number | null>
  >(() => toProjectSortDraft(selectedValues, options));
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedLabels = selectedValues
    .map((value) => options.find((option) => option.value === value)?.label)
    .filter((value): value is string => Boolean(value));
  const summary =
    selectedLabels.length === 0
      ? `${label}: Default`
      : selectedLabels.length <= 2
        ? `${label}: ${selectedLabels
            .map(
              (selectedLabel, index) =>
                `${(index + 1).toString()} ${selectedLabel}`,
            )
            .join(", ")}`
        : `${label}: ${selectedLabels.length.toString()} fields`;

  const applyAndClose = () => {
    onChange(normalizeProjectSortDraft(draftValues, options));
    setIsOpen(false);
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onChange(normalizeProjectSortDraft(draftValues, options));
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraftValues(toProjectSortDraft(selectedValues, options));
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [draftValues, isOpen, onChange, options, selectedValues]);

  return (
    <div
      ref={containerRef}
      className="workspace-filter workspace-filter--multi workspace-filter--popup"
    >
      <button
        type="button"
        className={`workspace-filter-trigger${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => {
          if (isOpen) {
            applyAndClose();
            return;
          }

          setDraftValues(toProjectSortDraft(selectedValues, options));
          setIsOpen(true);
        }}
      >
        {summary}
      </button>

      {isOpen ? (
        <div
          className="workspace-multi-filter-menu"
          role="dialog"
          aria-label={label}
        >
          {options.map((option) => {
            const selectedOrder = draftValues[option.value];

            return (
              <div key={option.value} className="workspace-multi-filter-option">
                <button
                  type="button"
                  className={`sort-order-button${selectedOrder ? " is-active" : ""}`}
                  aria-label={
                    selectedOrder
                      ? `${option.label} sort order ${selectedOrder.toString()}`
                      : `${option.label} not included in the current sort`
                  }
                  onClick={() =>
                    setDraftValues((current) => ({
                      ...current,
                      [option.value]: nextSortOrder(
                        current[option.value] ?? null,
                        options.length,
                      ),
                    }))
                  }
                >
                  {selectedOrder ?? ""}
                </button>
                <span>{option.label}</span>
              </div>
            );
          })}

          <div className="workspace-multi-filter-actions">
            {hasProjectSortDraft(draftValues) ? (
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() =>
                  setDraftValues(createEmptyProjectSortDraft(options))
                }
              >
                Clear
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              className="workspace-filter-apply"
              aria-label="Apply sort"
              onClick={applyAndClose}
              title="Apply sort"
            >
              ✓
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createEmptyProjectSortDraft(
  options: WorkspaceMenuOption<ProjectSortField>[],
) {
  return Object.fromEntries(
    options.map((option) => [option.value, null]),
  ) as Record<ProjectSortField, number | null>;
}

function toProjectSortDraft(
  selectedValues: ProjectSortField[],
  options: WorkspaceMenuOption<ProjectSortField>[],
) {
  const draft = createEmptyProjectSortDraft(options);

  selectedValues.forEach((value, index) => {
    if (value in draft) {
      draft[value] = index + 1;
    }
  });

  return draft;
}

function normalizeProjectSortDraft(
  draft: Record<ProjectSortField, number | null>,
  options: WorkspaceMenuOption<ProjectSortField>[],
) {
  return options
    .map((option, index) => ({
      index,
      order: draft[option.value],
      value: option.value,
    }))
    .filter(
      (
        entry,
      ): entry is {
        index: number;
        order: number;
        value: ProjectSortField;
      } => typeof entry.order === "number",
    )
    .sort((left, right) =>
      left.order === right.order
        ? left.index - right.index
        : left.order - right.order,
    )
    .map((entry) => entry.value);
}

function nextSortOrder(current: number | null, maxOrder: number) {
  if (current === null) {
    return 1;
  }

  return current >= maxOrder ? null : current + 1;
}

function hasProjectSortDraft(draft: Record<ProjectSortField, number | null>) {
  return Object.values(draft).some((value) => value !== null);
}

export default App;
