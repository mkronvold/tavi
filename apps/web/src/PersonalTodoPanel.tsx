import {
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appName, appVersion } from "@tavi/config";
import { importPersonalTodosSchema } from "@tavi/schemas";
import {
  ApiError,
  createPersonalTodo,
  deletePersonalTodo,
  getNotificationPreferences,
  importPersonalTodos,
  reorderPersonalTodos,
  updateNotificationPreferences,
  updatePersonalTodo,
} from "./api";
import { downloadJsonFile } from "./export-utils";
import { NotesMarkdown } from "./NotesMarkdown";
import type {
  CreatePersonalTodoPayload,
  NotificationPreferences,
  UpdatePersonalTodoPayload,
  WorkspacePersonalTodo,
  WorkspaceResponse,
} from "./types";

type PersonalTodoPanelProps = {
  hideDoneTodos: boolean;
  onClose: () => void;
  onHideDoneChange: (hideDone: boolean) => void;
  onNotice: (message: string) => void;
  personalTodos: WorkspacePersonalTodo[];
};

type PersonalTodoDraft = {
  dueDate: string;
  notes: string;
  title: string;
};

type PersonalTodoDragState = {
  position: "after" | "before";
  todoId: string;
  overTodoId: string;
};

type PersonalTodoSortField = "dueDate" | "status" | "title";
type PersonalTodoSortDirection = "asc" | "desc";
type PersonalTodoSortState = {
  direction: PersonalTodoSortDirection;
  field: PersonalTodoSortField;
} | null;

const createEmptyPersonalTodoDraft = (): PersonalTodoDraft => ({
  dueDate: getTomorrowDateInput(),
  notes: "",
  title: "",
});

export function PersonalTodoPanel({
  hideDoneTodos,
  onClose,
  onHideDoneChange,
  onNotice,
  personalTodos,
}: PersonalTodoPanelProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeDraggedTodoIdRef = useRef<string | null>(null);
  const pendingDragCleanupRef = useRef<number | null>(null);
  const [createDraft, setCreateDraft] = useState<PersonalTodoDraft>(() =>
    createEmptyPersonalTodoDraft(),
  );
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<PersonalTodoDraft>(
    createEmptyPersonalTodoDraft(),
  );
  const [panelError, setPanelError] = useState<string | null>(null);
  const [remindersError, setRemindersError] = useState<string | null>(null);
  const [dragState, setDragState] = useState<PersonalTodoDragState | null>(
    null,
  );
  const [isDragGuardActive, setIsDragGuardActive] = useState(false);
  const [sortState, setSortState] = useState<PersonalTodoSortState>(null);
  const doneTodoCount = personalTodos.filter(
    (todo) => todo.status === "done",
  ).length;
  const showReorderHandles = sortState === null;
  const visibleTodos = useMemo(
    () =>
      sortPersonalTodos(
        hideDoneTodos
          ? personalTodos.filter((todo) => todo.status !== "done")
          : personalTodos,
        sortState,
      ),
    [hideDoneTodos, personalTodos, sortState],
  );

  const invalidateWorkspace = () =>
    queryClient.invalidateQueries({ queryKey: ["workspace"] });
  const clearPendingDragCleanup = () => {
    if (pendingDragCleanupRef.current === null) {
      return;
    }

    window.clearTimeout(pendingDragCleanupRef.current);
    pendingDragCleanupRef.current = null;
  };
  const clearActiveDragSession = () => {
    clearPendingDragCleanup();
    activeDraggedTodoIdRef.current = null;
    setIsDragGuardActive(false);
    setDragState(null);
  };
  const scheduleActiveDragSessionCleanup = () => {
    clearPendingDragCleanup();
    pendingDragCleanupRef.current = window.setTimeout(() => {
      pendingDragCleanupRef.current = null;
      activeDraggedTodoIdRef.current = null;
      setIsDragGuardActive(false);
      setDragState(null);
    }, 0);
  };

  useEffect(
    () => () => {
      clearPendingDragCleanup();
    },
    [],
  );

  useEffect(() => {
    if (!isDragGuardActive) {
      return;
    }

    const suppressNativeDrop = (event: DragEvent) => {
      event.preventDefault();
    };

    window.addEventListener("dragover", suppressNativeDrop);
    window.addEventListener("drop", suppressNativeDrop);

    return () => {
      window.removeEventListener("dragover", suppressNativeDrop);
      window.removeEventListener("drop", suppressNativeDrop);
    };
  }, [isDragGuardActive]);

  const notificationPreferencesQuery = useQuery({
    queryFn: getNotificationPreferences,
    queryKey: ["notification-preferences"],
    staleTime: 60_000,
  });
  const personalTodoRemindersEnabled =
    notificationPreferencesQuery.data?.personalTodoRemindersEnabled ?? true;

  const notificationPreferencesMutation = useMutation({
    mutationFn: updateNotificationPreferences,
    onMutate: async (variables) => {
      setRemindersError(null);
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
          dailyDigestTime:
            variables.dailyDigestTime ?? current?.dailyDigestTime ?? "11:00",
          personalTodoRetention:
            variables.personalTodoRetention ??
            current?.personalTodoRetention ??
            "never",
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

      setRemindersError(
        error instanceof ApiError
          ? error.message
          : "Unable to update personal to do reminders.",
      );
    },
  });

  const createPersonalTodoMutation = useMutation({
    mutationFn: createPersonalTodo,
    onSuccess: async () => {
      setCreateDraft(createEmptyPersonalTodoDraft());
      setPanelError(null);
      onNotice("Added a personal to do.");
      await invalidateWorkspace();
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError
          ? error.message
          : "Unable to add personal to do.",
      );
    },
  });

  const updatePersonalTodoMutation = useMutation({
    mutationFn: ({
      payload,
      todoId,
    }: {
      payload: UpdatePersonalTodoPayload;
      todoId: string;
    }) => updatePersonalTodo(todoId, payload),
    onSuccess: async () => {
      setEditingTodoId(null);
      setPanelError(null);
      await invalidateWorkspace();
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError
          ? error.message
          : "Unable to update personal to do.",
      );
    },
  });

  const deletePersonalTodoMutation = useMutation({
    mutationFn: ({ todoId }: { title: string; todoId: string }) =>
      deletePersonalTodo(todoId),
    onSuccess: async (_result, variables) => {
      if (editingTodoId === variables.todoId) {
        setEditingTodoId(null);
      }
      setPanelError(null);
      onNotice(`Deleted personal to do "${variables.title}".`);
      await invalidateWorkspace();
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError
          ? error.message
          : "Unable to delete personal to do.",
      );
    },
  });

  const reorderPersonalTodosMutation = useMutation({
    mutationFn: reorderPersonalTodos,
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey: ["workspace"] });
      const previous = queryClient.getQueryData<WorkspaceResponse>([
        "workspace",
      ]);

      queryClient.setQueryData<WorkspaceResponse>(["workspace"], (current) =>
        reorderWorkspacePersonalTodos(current, variables.todoIds),
      );

      return { previous };
    },
    onSuccess: async () => {
      setPanelError(null);
      await invalidateWorkspace();
    },
    onError: (error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["workspace"], context.previous);
      }

      setPanelError(
        error instanceof ApiError
          ? error.message
          : "Unable to reorder personal to dos.",
      );
    },
    onSettled: () => {
      clearActiveDragSession();
    },
  });

  const importPersonalTodosMutation = useMutation({
    mutationFn: importPersonalTodos,
    onSuccess: async (result) => {
      setEditingTodoId(null);
      setPanelError(null);
      onNotice(
        `Imported ${result.importedCount.toString()} personal to do${result.importedCount === 1 ? "" : "s"}.`,
      );
      await invalidateWorkspace();
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError
          ? error.message
          : "Unable to import personal to dos.",
      );
    },
  });
  const reorderDisabledReason = reorderReason({
    doneTodoCount,
    hideDoneTodos,
    isPending: reorderPersonalTodosMutation.isPending,
    isSorted: sortState !== null,
    totalCount: personalTodos.length,
  });
  const canReorderTodos = reorderDisabledReason === null;

  const beginEditing = (todo: WorkspacePersonalTodo) => {
    setEditingTodoId(todo.id);
    setEditDraft({
      dueDate: toDateInput(todo.dueDate),
      notes: todo.notes ?? "",
      title: todo.title,
    });
    setPanelError(null);
  };

  const submitCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = normalizeCreatePersonalTodoPayload(createDraft);

    if (!payload.title) {
      setPanelError("Enter a task name");
      return;
    }

    setPanelError(null);
    createPersonalTodoMutation.mutate(payload);
  };

  const submitEdit = (todo: WorkspacePersonalTodo) => {
    const payload = buildPersonalTodoUpdatePayload(todo, editDraft);

    if (!editDraft.title.trim()) {
      setPanelError("Enter a task name");
      return;
    }

    if (!payload) {
      setEditingTodoId(null);
      setPanelError(null);
      return;
    }

    setPanelError(null);
    updatePersonalTodoMutation.mutate({
      payload,
      todoId: todo.id,
    });
  };

  const toggleTodoStatus = (todo: WorkspacePersonalTodo, checked: boolean) => {
    setPanelError(null);
    updatePersonalTodoMutation.mutate({
      payload: {
        status: checked ? "done" : "todo",
      },
      todoId: todo.id,
    });
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    try {
      const raw = JSON.parse(await file.text()) as {
        personalTodos?: unknown;
      };
      if (
        typeof raw !== "object" ||
        raw === null ||
        !("personalTodos" in raw)
      ) {
        throw new Error("Import file must include a personalTodos array.");
      }

      const payload = importPersonalTodosSchema.parse(raw);

      if (
        !window.confirm(
          "Importing personal to dos will replace your current list. Continue?",
        )
      ) {
        return;
      }

      setPanelError(null);
      importPersonalTodosMutation.mutate(payload);
    } catch (error) {
      setPanelError(
        error instanceof Error
          ? error.message
          : "Unable to read the personal to do import file.",
      );
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  return (
    <section className="workspace-panel-card">
      <header className="panel-header">
        <div>
          <strong>Personal ToDo</strong>
          <span>Private tasks visible only to you.</span>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={handleImportClick}
          >
            Import
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={() =>
              downloadJsonFile("personal-todo", {
                app: {
                  name: appName,
                  version: appVersion,
                },
                exportedAt: new Date().toISOString(),
                personalTodos: personalTodos.map((todo) => ({
                  dueDate: todo.dueDate,
                  notes: todo.notes,
                  status: todo.status,
                  title: todo.title,
                })),
              })
            }
          >
            Export
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onClose}
          >
            Close
          </button>
          <input
            ref={fileInputRef}
            accept="application/json"
            className="hidden-file-input"
            onChange={(event) =>
              void handleImportFile(event.target.files?.[0] ?? null)
            }
            type="file"
          />
        </div>
      </header>

      <div className="personal-todo-toolbar">
        <label className="personal-todo-inline-toggle">
          <span>Enable reminders</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Enable reminders"
            className="settings-switch-input"
            checked={personalTodoRemindersEnabled}
            disabled={
              notificationPreferencesMutation.isPending ||
              notificationPreferencesQuery.isPending
            }
            onChange={() =>
              notificationPreferencesMutation.mutate({
                personalTodoRemindersEnabled: !personalTodoRemindersEnabled,
              })
            }
          />
        </label>
      </div>

      <form className="personal-todo-form" onSubmit={submitCreate}>
        <input
          value={createDraft.title}
          onChange={(event) =>
            setCreateDraft((current) => ({
              ...current,
              title: event.target.value,
            }))
          }
          placeholder="Task name"
        />
        <textarea
          value={createDraft.notes}
          onChange={(event) =>
            setCreateDraft((current) => ({
              ...current,
              notes: event.target.value,
            }))
          }
          className="resizable-notes"
          placeholder="Notes"
          rows={2}
        />
        <input
          type="date"
          value={createDraft.dueDate}
          onChange={(event) =>
            setCreateDraft((current) => ({
              ...current,
              dueDate: event.target.value,
            }))
          }
        />
        <button type="submit" disabled={createPersonalTodoMutation.isPending}>
          {createPersonalTodoMutation.isPending ? "Adding..." : "Add"}
        </button>
      </form>

      {panelError ? <p className="error-banner">{panelError}</p> : null}
      {remindersError ? <p className="error-banner">{remindersError}</p> : null}

      <div className="task-panel personal-todo-panel">
        <table className="task-table personal-todo-table">
          <thead>
            <tr>
              {showReorderHandles ? (
                <th className="task-reorder-cell" />
              ) : null}
              <th>
                <PersonalTodoSortHeader
                  field="title"
                  label="Task"
                  onChange={setSortState}
                  sortState={sortState}
                />
              </th>
              <th>
                <PersonalTodoSortHeader
                  field="dueDate"
                  label="Due date"
                  onChange={setSortState}
                  sortState={sortState}
                />
              </th>
              <th className="personal-todo-complete-column">
                <span className="task-status-heading">
                  <PersonalTodoSortHeader
                    field="status"
                    label="Done"
                    onChange={setSortState}
                    sortState={sortState}
                  />
                  <button
                    type="button"
                    className={`ghost-button compact-button task-done-toggle${hideDoneTodos ? " is-active" : ""}`}
                    aria-label={
                      hideDoneTodos
                        ? "Show done personal to dos"
                        : "Hide done personal to dos"
                    }
                    aria-pressed={hideDoneTodos}
                    onClick={() => onHideDoneChange(!hideDoneTodos)}
                    title={
                      hideDoneTodos
                        ? "Show done personal to dos"
                        : "Hide done personal to dos"
                    }
                  >
                    D
                  </button>
                </span>
              </th>
              <th className="task-action-cell">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleTodos.length === 0 ? (
              <tr>
                <td
                  className="personal-todo-empty-state"
                  colSpan={showReorderHandles ? 5 : 4}
                >
                  {personalTodos.length === 0
                    ? "No personal ToDo items yet."
                    : "All done personal to dos are hidden."}
                </td>
              </tr>
            ) : (
              visibleTodos.map((todo) => {
                const isEditing = editingTodoId === todo.id;
                const isDragging = dragState?.todoId === todo.id;
                const reorderIndicator =
                  dragState?.overTodoId === todo.id ? dragState.position : null;

                if (isEditing) {
                  return (
                    <tr key={todo.id}>
                      {showReorderHandles ? (
                        <td className="task-reorder-cell" />
                      ) : null}
                      <td>
                        <input
                          value={editDraft.title}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          placeholder="Task name"
                        />
                        <textarea
                          value={editDraft.notes}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              notes: event.target.value,
                            }))
                          }
                          className="resizable-notes"
                          placeholder="Notes"
                          rows={2}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          value={editDraft.dueDate}
                          onChange={(event) =>
                            setEditDraft((current) => ({
                              ...current,
                              dueDate: event.target.value,
                            }))
                          }
                        />
                      </td>
                      <td className="personal-todo-complete-column">
                        <input
                          aria-label={`Complete ${todo.title}`}
                          checked={todo.status === "done"}
                          onChange={(event) =>
                            toggleTodoStatus(todo, event.target.checked)
                          }
                          type="checkbox"
                        />
                      </td>
                      <td className="task-action-cell personal-todo-actions">
                        <button
                          type="button"
                          className="compact-button mini-button"
                          onClick={() => submitEdit(todo)}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="ghost-button compact-button mini-button"
                          onClick={() => {
                            setEditingTodoId(null);
                            setPanelError(null);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="ghost-button compact-button mini-button icon-compact-button"
                          aria-label={`Delete ${todo.title}`}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `Delete personal to do "${todo.title}"?`,
                              )
                            ) {
                              return;
                            }

                            deletePersonalTodoMutation.mutate({
                              title: todo.title,
                              todoId: todo.id,
                            });
                          }}
                        >
                          X
                        </button>
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={todo.id}
                    className={
                      [
                        isDragging ? "task-row--dragging" : null,
                        reorderIndicator === "before"
                          ? "task-row--drop-before"
                          : null,
                        reorderIndicator === "after"
                          ? "task-row--drop-after"
                          : null,
                      ]
                        .filter((value): value is string => Boolean(value))
                        .join(" ") || undefined
                    }
                    onDragOver={(event) => {
                      if (!canReorderTodos) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      clearPendingDragCleanup();
                      const draggedTodoId = readDraggedPersonalTodoId(
                        event,
                        dragState,
                        activeDraggedTodoIdRef.current,
                      );

                      if (!draggedTodoId) {
                        return;
                      }

                      const position = readDropPosition(event);

                      setDragState((current) =>
                        current
                          ? {
                              ...current,
                              overTodoId: todo.id,
                              position,
                            }
                          : {
                              todoId: draggedTodoId,
                              overTodoId: todo.id,
                              position,
                            },
                      );
                    }}
                    onDrop={(event) => {
                      if (!canReorderTodos) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      clearPendingDragCleanup();
                      const draggedTodoId = readDraggedPersonalTodoId(
                        event,
                        dragState,
                        activeDraggedTodoIdRef.current,
                      );

                      if (!draggedTodoId) {
                        clearActiveDragSession();
                        return;
                      }

                      const nextTodoIds = reorderTodoIds(
                        personalTodos.map((item) => item.id),
                        draggedTodoId,
                        todo.id,
                        readDropPosition(event),
                      );

                      if (
                        nextTodoIds.length === personalTodos.length &&
                        nextTodoIds.every((todoId, index) => todoId === personalTodos[index]?.id)
                      ) {
                        clearActiveDragSession();
                        return;
                      }

                      reorderPersonalTodosMutation.mutate({
                        todoIds: nextTodoIds,
                      });
                    }}
                  >
                    {showReorderHandles ? (
                      <td className="task-reorder-cell">
                        <button
                          type="button"
                          className={`ghost-button compact-button task-reorder-handle${
                            isDragging ? " is-active" : ""
                          }`}
                          aria-label={`Drag to reorder ${todo.title}`}
                          title={reorderDisabledReason ?? "Drag to reorder"}
                          disabled={!canReorderTodos}
                          draggable={canReorderTodos}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onDragStart={(event) => {
                            if (!canReorderTodos) {
                              return;
                            }

                            event.stopPropagation();
                            clearPendingDragCleanup();
                            activeDraggedTodoIdRef.current = todo.id;
                            setIsDragGuardActive(true);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", todo.id);
                            setDragState({
                              todoId: todo.id,
                              overTodoId: todo.id,
                              position: "before",
                            });
                          }}
                          onDragEnd={(event) => {
                            event.stopPropagation();
                            scheduleActiveDragSessionCleanup();
                          }}
                        >
                          ::
                        </button>
                      </td>
                    ) : null}
                    <td className="personal-todo-title-cell">
                      <strong>{todo.title}</strong>
                      <NotesMarkdown
                        className="formatted-notes formatted-notes--task task-subtext"
                        emptyLabel="No notes"
                        value={todo.notes}
                      />
                    </td>
                    <td>{formatDate(todo.dueDate)}</td>
                    <td className="personal-todo-complete-column">
                      <input
                        aria-label={`Complete ${todo.title}`}
                        checked={todo.status === "done"}
                        onChange={(event) =>
                          toggleTodoStatus(todo, event.target.checked)
                        }
                        type="checkbox"
                      />
                    </td>
                    <td className="task-action-cell personal-todo-actions">
                      <button
                        type="button"
                        className="ghost-button compact-button mini-button"
                        onClick={() => beginEditing(todo)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact-button mini-button icon-compact-button"
                        aria-label={`Delete ${todo.title}`}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Delete personal to do "${todo.title}"?`,
                            )
                          ) {
                            return;
                          }

                          deletePersonalTodoMutation.mutate({
                            title: todo.title,
                            todoId: todo.id,
                          });
                        }}
                      >
                        X
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

type PersonalTodoSortHeaderProps = {
  field: PersonalTodoSortField;
  label: string;
  onChange: Dispatch<SetStateAction<PersonalTodoSortState>>;
  sortState: PersonalTodoSortState;
};

function PersonalTodoSortHeader({
  field,
  label,
  onChange,
  sortState,
}: PersonalTodoSortHeaderProps) {
  const active = sortState?.field === field ? sortState.direction : null;
  const suffix = active === "asc" ? " ↑" : active === "desc" ? " ↓" : "";
  const ariaState =
    active === "asc"
      ? "forward sort"
      : active === "desc"
        ? "reverse sort"
        : "no sort";

  return (
    <button
      type="button"
      className={`ghost-button compact-button personal-todo-sort-button${
        active ? " is-active" : ""
      }`}
      aria-label={`${label}: ${ariaState}`}
      aria-pressed={active !== null}
      onClick={() =>
        onChange((current) => nextPersonalTodoSort(current, field))
      }
    >
      {label}
      {suffix}
    </button>
  );
}

function nextPersonalTodoSort(
  current: PersonalTodoSortState,
  field: PersonalTodoSortField,
): PersonalTodoSortState {
  if (current?.field !== field) {
    return { field, direction: "asc" };
  }

  if (current.direction === "asc") {
    return { field, direction: "desc" };
  }

  return null;
}

function normalizeCreatePersonalTodoPayload(
  draft: PersonalTodoDraft,
): CreatePersonalTodoPayload {
  return {
    title: draft.title.trim(),
    notes: draft.notes,
    dueDate: draft.dueDate,
  };
}

function buildPersonalTodoUpdatePayload(
  todo: WorkspacePersonalTodo,
  draft: PersonalTodoDraft,
): UpdatePersonalTodoPayload | null {
  const payload: UpdatePersonalTodoPayload = {};
  const trimmedTitle = draft.title.trim();
  const trimmedNotes = draft.notes.trim();
  const nextDueDate = draft.dueDate || null;
  const currentDueDate = toDateInput(todo.dueDate) || null;
  const currentNotes = (todo.notes ?? "").trim();

  if (trimmedTitle !== todo.title) {
    payload.title = trimmedTitle;
  }

  if (trimmedNotes !== currentNotes) {
    payload.notes = trimmedNotes.length > 0 ? trimmedNotes : null;
  }

  if (nextDueDate !== currentDueDate) {
    payload.dueDate = nextDueDate;
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function reorderWorkspacePersonalTodos(
  current: WorkspaceResponse | undefined,
  todoIds: string[],
) {
  if (!current) {
    return current;
  }

  const todoById = new Map(
    current.personalTodos.map((todo) => [todo.id, todo] as const),
  );
  const orderedTodos = todoIds
    .map((todoId, index) => {
      const todo = todoById.get(todoId);

      if (!todo) {
        return null;
      }

      return {
        ...todo,
        sortOrder: index,
      };
    })
    .filter((todo): todo is WorkspacePersonalTodo => todo !== null);

  if (orderedTodos.length !== current.personalTodos.length) {
    return current;
  }

  return {
    ...current,
    personalTodos: orderedTodos,
  };
}

function reorderTodoIds(
  todoIds: string[],
  draggedTodoId: string,
  targetTodoId: string,
  position: "after" | "before",
) {
  if (draggedTodoId === targetTodoId) {
    return todoIds;
  }

  const remainingTodoIds = todoIds.filter((todoId) => todoId !== draggedTodoId);
  const targetIndex = remainingTodoIds.indexOf(targetTodoId);

  if (targetIndex === -1) {
    return todoIds;
  }

  const insertIndex = position === "before" ? targetIndex : targetIndex + 1;
  const nextTodoIds = [...remainingTodoIds];

  nextTodoIds.splice(insertIndex, 0, draggedTodoId);
  return nextTodoIds;
}

function readDraggedPersonalTodoId(
  event: ReactDragEvent<HTMLElement>,
  dragState: PersonalTodoDragState | null,
  activeDraggedTodoId: string | null,
) {
  const draggedTodoId =
    dragState?.todoId ||
    activeDraggedTodoId ||
    event.dataTransfer.getData("text/plain");

  return draggedTodoId.trim().length > 0 ? draggedTodoId : null;
}

function readDropPosition(event: ReactDragEvent<HTMLTableRowElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  const midpoint = bounds.top + bounds.height / 2;
  return event.clientY < midpoint ? "before" : "after";
}

function reorderReason(input: {
  doneTodoCount: number;
  hideDoneTodos: boolean;
  isPending: boolean;
  isSorted: boolean;
  totalCount: number;
}) {
  if (input.isPending) {
    return "Saving personal to do order...";
  }

  if (input.isSorted) {
    return "Clear sort to reorder personal to dos.";
  }

  if (input.hideDoneTodos && input.doneTodoCount > 0) {
    return "Show done personal to dos to reorder them.";
  }

  if (input.totalCount < 2) {
    return "At least two personal to dos are required to reorder.";
  }

  return null;
}

function sortPersonalTodos(
  personalTodos: WorkspacePersonalTodo[],
  sortState: PersonalTodoSortState,
) {
  if (!sortState) {
    return personalTodos;
  }

  return personalTodos
    .map((todo, index) => ({ index, todo }))
    .sort((left, right) => {
      const sortedResult = comparePersonalTodosByField(
        left.todo,
        right.todo,
        sortState.field,
      );
      const directionalResult =
        sortState.direction === "asc" ? sortedResult : -sortedResult;

      if (directionalResult !== 0) {
        return directionalResult;
      }

      return (
        left.todo.sortOrder - right.todo.sortOrder || left.index - right.index
      );
    })
    .map(({ todo }) => todo);
}

function comparePersonalTodosByField(
  left: WorkspacePersonalTodo,
  right: WorkspacePersonalTodo,
  field: PersonalTodoSortField,
) {
  switch (field) {
    case "dueDate":
      return compareNullableDateValues(left.dueDate, right.dueDate);
    case "status":
      return personalTodoStatusRank(left) - personalTodoStatusRank(right);
    case "title":
      return left.title.localeCompare(right.title, undefined, {
        sensitivity: "base",
      });
  }
}

function personalTodoStatusRank(todo: WorkspacePersonalTodo) {
  return todo.status === "done" ? 1 : 0;
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

function getTomorrowDateInput() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  return formatDateInput(tomorrow);
}

function formatDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year.toString()}-${month}-${day}`;
}

function toDateInput(value: string | null) {
  return value ? value.slice(0, 10) : "";
}

function formatDate(value: string | null) {
  if (!value) {
    return "No due date";
  }

  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(
    new Date(value),
  );
}
