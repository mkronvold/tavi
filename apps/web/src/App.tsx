import { useEffect, useMemo, useState } from "react";
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
  bulkDeleteTasks,
  bulkUpdateTasks,
  createProject,
  createSavedView,
  createTask,
  deleteSavedView,
  getAuditHistory,
  getLocalLoginHint,
  getWorkspace,
  login,
  logout,
  renameSavedView,
  updateProject,
  updateSavedView,
  updateTask,
} from "./api";
import { ExportPanel } from "./ExportPanel";
import { ImportPanel } from "./ImportPanel";
import { LocalAccountsPanel } from "./LocalAccountsPanel";
import { getAppHomeUrl } from "./runtime-config";
import {
  clearTaviStorage,
  readTaviStorage,
  removeTaviStorage,
  writeTaviStorage,
} from "./storage";
import type {
  AuditHistoryEvent,
  CreateProjectPayload,
  CreateTaskPayload,
  GroupBy,
  LoginPayload,
  SavedView,
  WorkspaceUser,
  UpdateProjectPayload,
  UpdateTaskPayload,
  WorkspaceProject,
  WorkspaceResponse,
  WorkspaceTask,
} from "./types";

const GROUP_LABELS: Record<GroupBy, string> = {
  none: "All projects",
  owner: "Owner",
  priority: "Priority",
  status: "Status",
};

const EMPTY_PROJECT_FORM: CreateProjectPayload = {
  title: "",
  summary: "",
  trackerLink: "",
  ownerUserId: "",
  dueDate: "",
  priority: "medium",
};

const EMPTY_LOGIN_FORM: LoginPayload = {
  email: "",
  password: "",
};

const BRAND_MARK = "ᴛᴀᴠi";

type WorkspacePanelState = {
  importExport: boolean;
  newProject: boolean;
  settings: boolean;
  view: boolean;
};

type WorkspaceTheme = "dark" | "light";

type WorkspacePreferences = {
  autoCollapse: boolean;
  bulkActions: boolean;
  fullWidth: boolean;
  theme: WorkspaceTheme;
};

type BulkTaskDraft = {
  assigneeUserId: string;
  dueDate: string;
  dueDateMode: "keep" | "set" | "clear";
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

const createEmptyBulkTaskDraft = (): BulkTaskDraft => ({
  assigneeUserId: "",
  dueDate: "",
  dueDateMode: "keep",
  priority: "",
  status: "",
});

const DEFAULT_WORKSPACE_PANEL_STATE: WorkspacePanelState = {
  importExport: false,
  newProject: false,
  settings: false,
  view: false,
};

const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  autoCollapse: true,
  bulkActions: true,
  fullWidth: false,
  theme: "light",
};

const PANEL_STORAGE_KEY = "workspace.panels";
const ADD_TASK_PANEL_STORAGE_KEY = "workspace.projectAddTask";
const PREFERENCES_STORAGE_KEY = "workspace.preferences";

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
      workspacePreferences.fullWidth ===
        DEFAULT_WORKSPACE_PREFERENCES.fullWidth
    ) {
      removeTaviStorage(PREFERENCES_STORAGE_KEY);
      return;
    }

    writeTaviStorage(PREFERENCES_STORAGE_KEY, workspacePreferences);
  }, [workspacePreferences]);

  useEffect(() => {
    document.documentElement.dataset.theme = workspacePreferences.theme;
    document.documentElement.style.colorScheme = workspacePreferences.theme;

    return () => {
      delete document.documentElement.dataset.theme;
      document.documentElement.style.removeProperty("color-scheme");
    };
  }, [workspacePreferences.theme]);

  const workspaceQuery = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
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
              <span>admin@tavi.local, editor@tavi.local, viewer@tavi.local</span>
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
  const [groupBy, setGroupBy] = useState<GroupBy>("owner");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">(
    "all",
  );
  const [collapsedGroups, setCollapsedGroups] = useState<
    Record<string, boolean>
  >({});
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const [projectForm, setProjectForm] = useState<CreateProjectPayload>({
    ...EMPTY_PROJECT_FORM,
    ownerUserId: data.currentUser.id,
  });
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDraft, setProjectDraft] = useState<UpdateProjectPayload>({
    title: "",
    summary: "",
    notes: null,
    trackerLink: "",
    ownerUserId: "",
    dueDate: "",
    priority: "medium",
    manualStatus: null,
  });
  const [projectEditError, setProjectEditError] = useState<string | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
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
  const canEditWorkspace = data.currentUser.role !== "viewer";
  const appHomeUrl = getAppHomeUrl();
  const { autoCollapse, bulkActions, fullWidth, theme } = preferences;
  const canSelectTasks = canEditWorkspace && bulkActions;
  const invalidateWorkspaceAndAudit = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);

  useEffect(() => {
    const activePanels = activeBooleanSelection(panelState);

    if (Object.keys(activePanels).length === 0) {
      removeTaviStorage(PANEL_STORAGE_KEY);
      return;
    }

    writeTaviStorage(PANEL_STORAGE_KEY, activePanels);
  }, [panelState]);

  useEffect(() => {
    const activeAddTaskPanels = activeBooleanSelection(addTaskPanels);

    if (Object.keys(activeAddTaskPanels).length === 0) {
      removeTaviStorage(ADD_TASK_PANEL_STORAGE_KEY);
      return;
    }

    writeTaviStorage(ADD_TASK_PANEL_STORAGE_KEY, activeAddTaskPanels);
  }, [addTaskPanels]);

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

  const setProjectExpanded = (projectId: string, nextValue: boolean) => {
    if (!nextValue) {
      clearSelectedTasksForProjects([projectId]);
    } else if (autoCollapse) {
      clearSelectedTasksForProjects(
        Object.keys(expandedProjects).filter(
          (expandedProjectId) => expandedProjectId !== projectId,
        ),
      );
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
  };

  const openTaskEditor = (projectId: string, selectedTask: WorkspaceTask) => {
    const enterEditMode = () => {
      setEditingTaskId(selectedTask.id);
      setTaskDraft({
        title: selectedTask.title,
        notes: selectedTask.notes ?? "",
        assigneeUserId: selectedTask.assigneeUserId,
        dueDate: toDateInput(selectedTask.dueDate),
        priority: selectedTask.priority,
        status: selectedTask.status,
      });
    };

    setProjectExpanded(projectId, true);

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
        [variables.projectId]: defaultTaskPayload(data.currentUser.id),
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
    onSuccess: async () => {
      setEditingTaskId(null);
      await invalidateWorkspaceAndAudit();
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
    () => filterProjects(data.projects, search, statusFilter),
    [data.projects, search, statusFilter],
  );
  const groupedProjects = useMemo(
    () => groupProjects(filteredProjects, groupBy),
    [filteredProjects, groupBy],
  );
  const selectedSavedView = useMemo(
    () =>
      data.savedViews.find(
        (savedView) => savedView.id === selectedSavedViewId,
      ) ?? null,
    [data.savedViews, selectedSavedViewId],
  );
  const allTasks = useMemo(
    () => data.projects.flatMap((project) => project.tasks),
    [data.projects],
  );
  const selectedTaskItems = useMemo(
    () => allTasks.filter((task) => selectedTasks[task.id]),
    [allTasks, selectedTasks],
  );
  const selectedTaskIds = useMemo(
    () => selectedTaskItems.map((task) => task.id),
    [selectedTaskItems],
  );
  const selectedProjectCount = useMemo(
    () => new Set(selectedTaskItems.map((task) => task.projectId)).size,
    [selectedTaskItems],
  );
  const userLookup = useMemo(
    () =>
      Object.fromEntries(data.users.map((user) => [user.id, user])) as Record<
        string,
        WorkspaceUser
      >,
    [data.users],
  );
  const hasBulkChanges =
    bulkTaskDraft.assigneeUserId !== "" ||
    bulkTaskDraft.dueDateMode !== "keep" ||
    bulkTaskDraft.priority !== "" ||
    bulkTaskDraft.status !== "";
  const bulkTaskActionPending =
    bulkUpdateTaskMutation.isPending || bulkDeleteTaskMutation.isPending;
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
    setStatusFilter(savedView.statusFilter ?? "all");
    setCollapsedGroups(toSelectionMap(savedView.collapsedGroupKeys));
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
    const clearedKeyCount = clearTaviStorage();

    setPanelState({ ...DEFAULT_WORKSPACE_PANEL_STATE });
    setAddTaskPanels({});
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
          <span className="header-user">{data.currentUser.name}</span>
          <button type="button" className="ghost-button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="workspace-controls">
        <div className="workspace-controls-row">
          <div className="workspace-filter-row">
            <label className="workspace-filter search-filter">
              Search
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search projects and tasks"
              />
            </label>

            <label className="workspace-filter">
              Group by
              <select
                value={groupBy}
                onChange={(event) => setGroupBy(event.target.value as GroupBy)}
              >
                {Object.entries(GROUP_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="workspace-filter">
              Project status
              <select
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as ProjectStatus | "all")
                }
              >
                <option value="all">All</option>
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="blocked">Blocked</option>
                <option value="done">Done</option>
              </select>
            </label>
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
              className={`ghost-button compact-button panel-toggle-button${panelState.importExport ? " is-active" : ""}`}
              aria-pressed={panelState.importExport}
              onClick={() => toggleWorkspacePanel("importExport")}
            >
              Import/Export
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
            <button
              type="button"
              className={`ghost-button compact-button panel-toggle-button${panelState.settings ? " is-active" : ""}`}
              aria-pressed={panelState.settings}
              onClick={() => toggleWorkspacePanel("settings")}
            >
              Settings
            </button>
          </div>
        </div>

        {workspaceNotice ? (
          <p className="workspace-notice">{workspaceNotice}</p>
        ) : null}

        {!canEditWorkspace ? (
          <p className="toolbar-hint">
            Viewer access is read-only for projects and tasks. Filters, saved
            views, and audit history remain available.
          </p>
        ) : null}

        <div className="workspace-panel-stack">
          {panelState.view ? (
            <section className="workspace-panel-card">
              <header className="panel-header">
                <div>
                  <strong>Views</strong>
                  <span>
                    Save search, grouping, project status filtering, and
                    expansion defaults.
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
                        groupBy,
                        search,
                        statusFilter,
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
                        groupBy,
                        search,
                        statusFilter,
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

          {panelState.importExport ? (
            <>
              {data.currentUser.role === "admin" ? (
                <ImportPanel
                  isAdmin={data.currentUser.role === "admin"}
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
                  </header>

                  <p className="toolbar-hint">
                    Ask an admin to stage imports while export wiring lands.
                  </p>
                </section>
              )}

              <ExportPanel
                groupBy={groupBy}
                onNotice={setWorkspaceNotice}
                projects={filteredProjects}
                search={search}
                statusFilter={statusFilter}
              />
            </>
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
                  createProjectMutation.mutate(projectForm);
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
                <input
                  value={projectForm.summary}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      summary: event.target.value,
                    }))
                  }
                  placeholder="Summary"
                />
                <input
                  type="url"
                  autoComplete="url"
                  value={projectForm.trackerLink ?? ""}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      trackerLink: event.target.value,
                    }))
                  }
                  placeholder="Tracker link"
                />
                <select
                  value={projectForm.ownerUserId}
                  onChange={(event) =>
                    setProjectForm((current) => ({
                      ...current,
                      ownerUserId: event.target.value,
                    }))
                  }
                >
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
              autoCollapse={autoCollapse}
              bulkActions={bulkActions}
              currentUser={data.currentUser}
              fullWidth={fullWidth}
              isAdmin={data.currentUser.role === "admin"}
              onClearLocalStorage={handleClearLocalStorage}
              onAutoCollapseChange={onAutoCollapseChange}
              onBulkActionsChange={handleBulkActionsChange}
              onFullWidthChange={onFullWidthChange}
              onNotice={setWorkspaceNotice}
              onThemeChange={onThemeChange}
              onViewAuthHistory={() =>
                openAuditHistory({
                  emptyMessage: "No sign-in events yet for this account.",
                  entityId: data.currentUser.id,
                  entityType: "auth",
                  subtitle: data.currentUser.email,
                  title: "My Auth History",
                })
              }
              theme={theme}
            />
          ) : null}
        </div>
      </section>

      {canSelectTasks && selectedTaskItems.length > 0 ? (
        <section className="bulk-action-card">
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
                <option value="done">Done</option>
                <option value="canceled">Canceled</option>
              </select>
            </label>

            <label>
              Assignee
              <select
                value={bulkTaskDraft.assigneeUserId}
                onChange={(event) => {
                  setBulkTaskDraft((current) => ({
                    ...current,
                    assigneeUserId: event.target.value,
                  }));
                  setBulkTaskError(null);
                }}
              >
                <option value="">No change</option>
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
                const addTaskOpen = addTaskPanels[project.id] ?? false;
                const taskDraftValue =
                  newTaskByProject[project.id] ??
                  defaultTaskPayload(data.currentUser.id);
                const projectTaskIds = project.tasks.map((task) => task.id);
                const selectedProjectTaskCount = projectTaskIds.filter(
                  (taskId) => selectedTasks[taskId],
                ).length;
                const allProjectTasksSelected =
                  projectTaskIds.length > 0 &&
                  selectedProjectTaskCount === projectTaskIds.length;

                return (
                  <article className="project-card" key={project.id}>
                    <div className="project-row">
                      <button
                        type="button"
                        className="group-toggle"
                        onClick={() => setProjectExpanded(project.id, !expanded)}
                      >
                        {expanded ? "-" : "+"}
                      </button>

                      <div className="project-main">
                        <strong>{project.title}</strong>
                        <span>{project.summary ?? "No summary"}</span>
                      </div>

                      <div className="project-status">
                        <span
                          className={`status-pill status-${project.displayStatus}`}
                        >
                          {project.manualStatus ? "Override · " : ""}
                          {formatStatusLabel(project.displayStatus)}
                        </span>
                        {project.manualStatus ? (
                          <>
                            <span className="status-note">
                              Derived:{" "}
                              {formatStatusLabel(project.derivedStatus)}
                            </span>
                          </>
                        ) : (
                          <span className="status-note">
                            Derived from task rollup
                          </span>
                        )}
                        {project.notes ? (
                          <span className="status-note">
                            Notes: {project.notes}
                          </span>
                        ) : null}
                      </div>

                      <div className="project-meta">
                        <span>{project.ownerName}</span>
                        <span>{project.priority}</span>
                        <span>{formatDate(project.dueDate)}</span>
                        <span>
                          {formatTaskCompletion(
                            project.taskDoneCount,
                            project.taskTotalCount,
                          )}{" "}
                          done
                        </span>
                        {project.trackerLink ? (
                          <a
                            className="project-tracker-link"
                            href={project.trackerLink}
                            rel="noopener noreferrer"
                            target="_blank"
                            title={project.trackerLink}
                          >
                            Tracker Link ↗
                          </a>
                        ) : null}
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
                              subtitle: project.ownerName,
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
                            onClick={() => {
                              setProjectExpanded(project.id, true);
                              setProjectEditError(null);
                              setEditingProjectId(project.id);
                              setProjectDraft({
                                title: project.title,
                                summary: project.summary ?? "",
                                notes: project.notes ?? "",
                                trackerLink: project.trackerLink ?? "",
                                ownerUserId: project.ownerUserId,
                                dueDate: toDateInput(project.dueDate),
                                priority: project.priority,
                                manualStatus: project.manualStatus,
                              });
                            }}
                          >
                            Edit
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {canEditWorkspace && editingProjectId === project.id ? (
                      <form
                        className="inline-form nested-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const trimmedNotes = projectDraft.notes?.trim() ?? "";
                          const trimmedTrackerLink =
                            projectDraft.trackerLink?.trim() ?? "";

                          updateProjectMutation.mutate({
                            projectId: project.id,
                            payload: {
                              ...projectDraft,
                              manualStatus:
                                projectDraft.manualStatus === undefined
                                  ? null
                                  : projectDraft.manualStatus,
                              notes: trimmedNotes ? trimmedNotes : null,
                              trackerLink: trimmedTrackerLink
                                ? trimmedTrackerLink
                                : null,
                            },
                          });
                        }}
                      >
                        <input
                          value={projectDraft.title ?? ""}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                        />
                        <input
                          value={projectDraft.summary ?? ""}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              summary: event.target.value,
                            }))
                          }
                        />
                        <select
                          value={
                            projectDraft.ownerUserId ?? data.currentUser.id
                          }
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              ownerUserId: event.target.value,
                            }))
                          }
                        >
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
                          <option value="done">Done</option>
                        </select>
                        <input
                          value={projectDraft.notes ?? ""}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          placeholder="Project notes"
                        />
                        <input
                          type="url"
                          autoComplete="url"
                          value={projectDraft.trackerLink ?? ""}
                          onChange={(event) =>
                            setProjectDraft((current) => ({
                              ...current,
                              trackerLink: event.target.value,
                            }))
                          }
                          placeholder="Tracker link"
                        />
                        <button type="submit">Save</button>
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
                              <th>Task</th>
                              <th>Assignee</th>
                              <th>Status</th>
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
                                    value={taskDraftValue.assigneeUserId}
                                    onChange={(event) =>
                                      setNewTaskByProject((current) => ({
                                        ...current,
                                        [project.id]: {
                                          ...taskDraftValue,
                                          assigneeUserId: event.target.value,
                                        },
                                      }))
                                    }
                                  >
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
                            {project.tasks.map((task) => (
                              <TaskRow
                                canEditTask={canEditWorkspace}
                                canSelectTasks={canSelectTasks}
                                data={data}
                                editingTaskId={editingTaskId}
                                isSelected={selectedTasks[task.id] ?? false}
                                key={task.id}
                                onEdit={(selectedTask) =>
                                  openTaskEditor(project.id, selectedTask)
                                }
                                onSave={(payload) =>
                                  updateTaskMutation.mutate({
                                    taskId: task.id,
                                    payload,
                                  })
                                }
                                onCancel={() => setEditingTaskId(null)}
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
                                task={task}
                                taskDraft={taskDraft}
                                setTaskDraft={setTaskDraft}
                              />
                            ))}
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
    </main>
  );
}

type TaskRowProps = {
  canEditTask: boolean;
  canSelectTasks: boolean;
  data: WorkspaceResponse;
  editingTaskId: string | null;
  isSelected: boolean;
  onEdit: (task: WorkspaceTask) => void;
  onSave: (payload: UpdateTaskPayload) => void;
  onCancel: () => void;
  onToggleSelected: (checked: boolean) => void;
  onViewHistory: () => void;
  task: WorkspaceTask;
  taskDraft: UpdateTaskPayload;
  setTaskDraft: React.Dispatch<React.SetStateAction<UpdateTaskPayload>>;
};

function TaskRow({
  canEditTask,
  canSelectTasks,
  data,
  editingTaskId,
  isSelected,
  onEdit,
  onSave,
  onCancel,
  onToggleSelected,
  onViewHistory,
  task,
  taskDraft,
  setTaskDraft,
}: TaskRowProps) {
  if (editingTaskId === task.id) {
    const taskEditFormId = `task-edit-${task.id}`;

    return (
      <tr className="editing-row">
        {canSelectTasks ? <td className="task-select-cell" /> : null}
        <td>
          <div className="task-create-field">
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
            <input
              form={taskEditFormId}
              value={taskDraft.notes ?? ""}
              onChange={(event) =>
                setTaskDraft((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Task notes"
            />
          </div>
        </td>
        <td>
          <select
            form={taskEditFormId}
            value={taskDraft.assigneeUserId ?? data.currentUser.id}
            onChange={(event) =>
              setTaskDraft((current) => ({
                ...current,
                assigneeUserId: event.target.value,
              }))
            }
          >
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
            Save
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

  return (
    <tr>
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
      <td>
        <strong>{task.title}</strong>
        <div className="task-subtext">{task.notes ?? "No notes"}</div>
      </td>
      <td>{task.assigneeName}</td>
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

type SettingsPanelProps = {
  autoCollapse: boolean;
  bulkActions: boolean;
  currentUser: WorkspaceUser;
  fullWidth: boolean;
  isAdmin: boolean;
  onClearLocalStorage: () => void;
  onAutoCollapseChange: (autoCollapse: boolean) => void;
  onBulkActionsChange: (bulkActions: boolean) => void;
  onFullWidthChange: (fullWidth: boolean) => void;
  onNotice: (message: string) => void;
  onThemeChange: (theme: WorkspaceTheme) => void;
  onViewAuthHistory: () => void;
  theme: WorkspaceTheme;
};

function SettingsPanel({
  autoCollapse,
  bulkActions,
  currentUser,
  fullWidth,
  isAdmin,
  onClearLocalStorage,
  onAutoCollapseChange,
  onBulkActionsChange,
  onFullWidthChange,
  onNotice,
  onThemeChange,
  onViewAuthHistory,
  theme,
}: SettingsPanelProps) {
  const [localAccountsOpen, setLocalAccountsOpen] = useState(false);

  return (
    <section className="workspace-panel-card">
      <header className="panel-header">
        <div>
          <strong>Settings</strong>
          <span>
            Browser-local preferences, audit access, and local account entry
            points.
          </span>
        </div>
      </header>

      <div className="settings-grid">
        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Local Accounts</strong>
            <span>{isAdmin ? "Local auth" : "Self-service"}</span>
          </div>
          <p className="toolbar-hint">
            {isAdmin
              ? "Create, import, export, reset, edit, remove, and set passwords for local accounts."
              : "Only your own password is available here."}
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={() => setLocalAccountsOpen((current) => !current)}
            >
              {localAccountsOpen ? "Hide local accounts" : "Open local accounts"}
            </button>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Theme</strong>
            <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
          </div>
          <p className="toolbar-hint">
            Keep the workspace compact and readable without leaving the browser.
          </p>
          <label className="settings-switch">
            <span className="settings-switch-label">Dark mode</span>
            <input
              aria-label="Dark mode"
              checked={theme === "dark"}
              className="settings-switch-input"
              onChange={(event) =>
                onThemeChange(event.target.checked ? "dark" : "light")
              }
              role="switch"
              type="checkbox"
            />
          </label>
        </div>

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Auto Collapse</strong>
            <span>{autoCollapse ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            When enabled, opening one project collapses the rest.
          </p>
          <label className="settings-switch">
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

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Bulk Actions</strong>
            <span>{bulkActions ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Show task selection checkboxes and the multi-task action bar.
          </p>
          <label className="settings-switch">
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

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Full Width</strong>
            <span>{fullWidth ? "On" : "Off"}</span>
          </div>
          <p className="toolbar-hint">
            Let the workspace span the full browser width when needed.
          </p>
          <label className="settings-switch">
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

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>My Auth History</strong>
            <span>{currentUser.email}</span>
          </div>
          <p className="toolbar-hint">
            Review sign-in events for this browser session identity.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={onViewAuthHistory}
            >
              Open history
            </button>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-header">
            <strong>Clear Local Storage</strong>
            <span>Tavi only</span>
          </div>
          <p className="toolbar-hint">
            Remove only Tavi-owned browser state, including theme, auto
            collapse, bulk actions, full width, panel toggles, and per-project
            Add Task preferences.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="ghost-button danger-button compact-button"
              onClick={onClearLocalStorage}
            >
              Clear Local Storage
            </button>
          </div>
        </div>

        <div className="settings-item">
          <span className="settings-label">Version</span>
          <strong>{`${appName} v${appVersion}`}</strong>
          <a
            className="settings-link"
            href={appRepositoryUrl}
            rel="noreferrer"
            target="_blank"
          >
            github
          </a>
        </div>
      </div>

      {localAccountsOpen ? (
        <LocalAccountsPanel
          currentUser={currentUser}
          isAdmin={isAdmin}
          onNotice={onNotice}
        />
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
    ...(draft.assigneeUserId ? { assigneeUserId: draft.assigneeUserId } : {}),
    ...(draft.priority ? { priority: draft.priority } : {}),
    ...(draft.status ? { status: draft.status } : {}),
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
    importExport: value?.importExport === true,
    newProject: value?.newProject === true,
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
    theme: value?.theme === "dark" ? "dark" : "light",
  };
}

function formatTaskCompletion(doneCount: number, totalCount: number) {
  const completionPercentage =
    totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);

  return `${doneCount}/${totalCount} ${completionPercentage}%`;
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
  const assigneeUserId = readMetadataString(metadata.assigneeUserId);
  const priority = readMetadataString(metadata.priority);
  const dueDate = metadata.dueDate;
  const notes =
    readMetadataString(metadata.notes) ??
    readMetadataString(metadata.blockedReason) ??
    readMetadataString(metadata.manualStatusReason);
  const selectionSize = readMetadataNumber(metadata.selectionSize);
  const groupBy = readMetadataString(metadata.groupBy);
  const search = readMetadataString(metadata.search);
  const statusFilter = readMetadataString(metadata.statusFilter);
  const role = readMetadataString(metadata.role);
  const ownerUserId = readMetadataString(metadata.ownerUserId);

  if (title) {
    summary.push(title);
  } else if (name) {
    summary.push(name);
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

  if (assigneeUserId) {
    summary.push(
      `Assignee ${formatUserReference(assigneeUserId, users, currentUser)}`,
    );
  }

  if (ownerUserId) {
    summary.push(
      `Owner ${formatUserReference(ownerUserId, users, currentUser)}`,
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

  if (statusFilter) {
    summary.push(`Filter ${formatStatusLabel(statusFilter as ProjectStatus)}`);
  }

  if (role) {
    summary.push(`Role ${role}`);
  }

  return summary.slice(0, 6);
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
    case "bulk_delete":
      return "bulk delete";
    case "bulk_update":
      return "bulk update";
    case "status_override_clear":
      return "cleared override";
    case "status_override_set":
      return "set override";
    default:
      return action.replace(/_/g, " ");
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
    case "manualStatus":
      return "override";
    case "ownerUserId":
      return "owner";
    case "trackerLink":
      return "tracker link";
    case "statusFilter":
      return "status filter";
    default:
      return value.replace(/_/g, " ");
  }
}

function formatUserReference(
  userId: string,
  users: Record<string, WorkspaceUser>,
  currentUser: WorkspaceUser,
) {
  if (userId === currentUser.id) {
    return "you";
  }

  return users[userId]?.name ?? userId;
}

function filterProjects(
  projects: WorkspaceProject[],
  search: string,
  statusFilter: ProjectStatus | "all",
) {
  const normalizedSearch = search.trim().toLowerCase();

  return projects.filter((project) => {
    const matchesStatus =
      statusFilter === "all" || project.displayStatus === statusFilter;

    if (!matchesStatus) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return (
      project.title.toLowerCase().includes(normalizedSearch) ||
      (project.summary ?? "").toLowerCase().includes(normalizedSearch) ||
      (project.trackerLink ?? "").toLowerCase().includes(normalizedSearch) ||
      (project.notes ?? "").toLowerCase().includes(normalizedSearch) ||
      project.tasks.some(
        (task) =>
          task.title.toLowerCase().includes(normalizedSearch) ||
          (task.notes ?? "").toLowerCase().includes(normalizedSearch),
      )
    );
  });
}

function groupProjects(projects: WorkspaceProject[], groupBy: GroupBy) {
  if (groupBy === "none") {
    return [{ key: GROUP_LABELS.none, projects }];
  }

  const groups = new Map<string, WorkspaceProject[]>();

  for (const project of projects) {
    const key =
      groupBy === "owner"
        ? project.ownerName
        : groupBy === "priority"
          ? project.priority
          : formatStatusLabel(project.displayStatus);

    const existing = groups.get(key) ?? [];
    existing.push(project);
    groups.set(key, existing);
  }

  return [...groups.entries()].map(([key, groupedProjects]) => ({
    key,
    projects: groupedProjects,
  }));
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

function buildSavedViewPayload({
  groupBy,
  search,
  statusFilter,
  collapsedGroups,
  expandedProjects,
}: {
  groupBy: GroupBy;
  search: string;
  statusFilter: ProjectStatus | "all";
  collapsedGroups: Record<string, boolean>;
  expandedProjects: Record<string, boolean>;
}) {
  return {
    groupBy,
    search,
    statusFilter: statusFilter === "all" ? null : statusFilter,
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

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleDateString();
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

export default App;
