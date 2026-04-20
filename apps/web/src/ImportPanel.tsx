import { useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ApiError,
  commitLoopImport,
  createLocalAccount,
  createLoopImport,
  deleteLoopImport,
  getLoopImport,
  listLoopImports,
  resetWorkspaceExamples,
  updateLoopImportMapping,
  updateLoopImportRowDecisions,
} from "./api";
import { generateAlphanumericPassword } from "./password-generator";
import type {
  LoopImportField,
  LoopImportJob,
  LoopImportJobSummary,
  LoopImportJobStatus,
  LoopImportMapping,
  LoopImportMissingUser,
  LoopImportOverlapAction,
} from "./types";

type ImportPanelProps = {
  isAdmin: boolean;
  onNotice: (message: string) => void;
  onClose?: () => void;
  queryClient: QueryClient;
};

type CreatedImportAccountCredential = {
  email: string;
  name: string;
  password: string;
};

type ResetWorkspaceMode = "clear" | "examples";

const POLLING_STATUSES: LoopImportJobStatus[] = [
  "queued_parse",
  "parsing",
  "queued_commit",
  "committing",
];
const ACTIVE_IMPORT_STATUSES: LoopImportJobStatus[] = [
  "queued_parse",
  "parsing",
  "queued_commit",
  "committing",
];

export function ImportPanel({
  isAdmin,
  onNotice,
  onClose,
  queryClient,
}: ImportPanelProps) {
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mappingDraft, setMappingDraft] = useState<LoopImportMapping>({});
  const [draftImportId, setDraftImportId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [createdImportAccounts, setCreatedImportAccounts] = useState<
    CreatedImportAccountCredential[]
  >([]);
  const [resetMode, setResetMode] = useState<ResetWorkspaceMode | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const importsQuery = useQuery({
    queryKey: ["imports"],
    queryFn: listLoopImports,
    enabled: isAdmin,
    retry: false,
  });
  const effectiveSelectedImportId =
    selectedImportId ?? importsQuery.data?.[0]?.id ?? null;

  const selectedImportQuery = useQuery({
    queryKey: ["import", effectiveSelectedImportId ?? ""],
    queryFn: () => getLoopImport(effectiveSelectedImportId!),
    enabled: isAdmin && effectiveSelectedImportId !== null,
    refetchInterval: (query) => {
      const status = (query.state.data as LoopImportJob | undefined)?.status;
      return status && POLLING_STATUSES.includes(status) ? 1500 : false;
    },
    retry: false,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) =>
      createLoopImport({
        content: await file.text(),
        fileName: file.name,
      }),
    onSuccess: async (job) => {
      setPanelError(null);
      setSelectedFile(null);
      setSelectedImportId(job.id);
      setDraftImportId(null);
      setCreatedImportAccounts([]);
      setMappingDraft({});
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["imports"] }),
        queryClient.invalidateQueries({ queryKey: ["import", job.id] }),
      ]);
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError ? error.message : "Unable to stage import",
      );
    },
  });
  const removeImportMutation = useMutation({
    mutationFn: ({
      fileName,
      importId,
    }: {
      fileName: string;
      importId: string;
    }) =>
      deleteLoopImport(importId).then((result) => ({
        ...result,
        fileName,
      })),
    onSuccess: async ({ fileName, id }) => {
      setPanelError(null);
      setDraftImportId(null);
      setCreatedImportAccounts([]);
      setMappingDraft({});

      const remainingImports =
        (
          queryClient.getQueryData<LoopImportJobSummary[]>(["imports"]) ?? []
        ).filter((job) => job.id !== id) ?? [];

      queryClient.setQueryData(["imports"], remainingImports);
      queryClient.removeQueries({ queryKey: ["import", id] });
      setSelectedImportId(remainingImports[0]?.id ?? null);

      await queryClient.invalidateQueries({ queryKey: ["imports"] });
      onNotice(`Removed recent import for ${fileName}.`);
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError ? error.message : "Unable to remove import",
      );
    },
  });

  const updateMappingMutation = useMutation({
    mutationFn: ({
      importId,
      mapping,
    }: {
      importId: string;
      mapping: LoopImportMapping;
    }) => updateLoopImportMapping(importId, { mapping }),
    onSuccess: async (job) => {
      setPanelError(null);
      setDraftImportId(null);
      setCreatedImportAccounts([]);
      setMappingDraft({});
      await queryClient.invalidateQueries({ queryKey: ["import", job.id] });
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError ? error.message : "Unable to update mapping",
      );
    },
  });

  const createMissingUsersMutation = useMutation({
    mutationFn: async ({
      missingUsers,
    }: {
      importId: string;
      missingUsers: LoopImportMissingUser[];
    }) => {
      const createdAccounts: CreatedImportAccountCredential[] = [];

      for (const user of missingUsers) {
        if (!user.email) {
          continue;
        }

        const password = generateAlphanumericPassword();

        try {
          await createLocalAccount({
            email: user.email,
            name: user.name,
            password,
            role: "viewer",
          });
          createdAccounts.push({
            email: user.email,
            name: user.name,
            password,
          });
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            continue;
          }

          throw error;
        }
      }

      return createdAccounts;
    },
    onMutate: () => {
      setPanelError(null);
      setCreatedImportAccounts([]);
    },
    onSuccess: async (createdAccounts, variables) => {
      setPanelError(null);
      setCreatedImportAccounts(createdAccounts);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["import", variables.importId],
        }),
        queryClient.invalidateQueries({ queryKey: ["localAccounts"] }),
      ]);
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError
          ? error.message
          : "Unable to create missing import users",
      );
    },
  });
  const updateRowDecisionsMutation = useMutation({
    mutationFn: ({
      importId,
      payload,
      rowNumber,
    }: {
      importId: string;
      payload: {
        projectAction?: LoopImportOverlapAction;
        taskAction?: LoopImportOverlapAction;
      };
      rowNumber: number;
    }) => updateLoopImportRowDecisions(importId, rowNumber, payload),
    onSuccess: async (job) => {
      setPanelError(null);
      await queryClient.invalidateQueries({ queryKey: ["import", job.id] });
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError
          ? error.message
          : "Unable to update overlap decisions",
      );
    },
  });

  const commitMutation = useMutation({
    mutationFn: (importId: string) => commitLoopImport(importId),
    onSuccess: async (job) => {
      setPanelError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["imports"] }),
        queryClient.invalidateQueries({ queryKey: ["import", job.id] }),
      ]);
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError ? error.message : "Unable to queue import",
      );
    },
  });
  const resetWorkspaceMutation = useMutation({
    mutationFn: ({
      password,
      seedExamples,
    }: {
      password: string;
      seedExamples: boolean;
    }) => resetWorkspaceExamples({ password, seedExamples }),
    onSuccess: async (summary, variables) => {
      setPanelError(null);
      setResetPassword("");
      setResetMode(null);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
      if (variables.seedExamples) {
        onNotice(
          `Reset workspace data: removed ${formatRecordCount(
            summary.deletedProjectCount,
            "project",
          )} and ${formatRecordCount(
            summary.deletedTaskCount,
            "task",
          )}, then seeded ${formatRecordCount(
            summary.createdProjectCount,
            "example project",
          )} and ${formatRecordCount(summary.createdTaskCount, "task")}.`,
        );
        return;
      }

      onNotice(
        `Cleared workspace data: removed ${formatRecordCount(
          summary.deletedProjectCount,
          "project",
        )} and ${formatRecordCount(summary.deletedTaskCount, "task")}.`,
      );
    },
    onError: (error, variables) => {
      setPanelError(
        error instanceof ApiError
          ? error.message
          : variables.seedExamples
            ? "Unable to reset projects and tasks"
            : "Unable to clear projects and tasks",
      );
    },
  });

  const recentImports = importsQuery.data ?? [];
  const selectedImport = selectedImportQuery.data ?? null;
  const hasRecentImports = recentImports.length > 0;
  const showEmptyState = importsQuery.isSuccess && !hasRecentImports;
  const resetConfirmationOpen = resetMode !== null;
  const resetActionSummary =
    resetMode === "clear"
      ? "Delete the current project/task workspace data without seeding example projects."
      : "Delete the current project/task workspace data and seed the example projects/tasks.";
  const importsErrorMessage = importsQuery.isError
    ? formatQueryError(importsQuery.error, "Unable to load recent imports")
    : null;
  const selectedImportErrorMessage =
    selectedImportQuery.isError && effectiveSelectedImportId !== null
      ? formatQueryError(
          selectedImportQuery.error,
          "Unable to load import details",
        )
      : null;
  const creatableMissingUserCount = useMemo(
    () =>
      selectedImport?.preview.missingUsers.filter((user) => user.canCreate)
        .length ?? 0,
    [selectedImport],
  );
  const displayedMapping = useMemo(
    () =>
      draftImportId === effectiveSelectedImportId && selectedImport
        ? mappingDraft
        : (selectedImport?.mapping ?? {}),
    [draftImportId, effectiveSelectedImportId, mappingDraft, selectedImport],
  );
  const mappingChanged = useMemo(() => {
    if (!selectedImport) {
      return false;
    }

    const allKeys = new Set<LoopImportField>([
      ...Object.keys(displayedMapping),
      ...Object.keys(selectedImport.mapping),
    ] as LoopImportField[]);

    for (const key of allKeys) {
      if (
        (displayedMapping[key] ?? null) !==
        (selectedImport.mapping[key] ?? null)
      ) {
        return true;
      }
    }

    return false;
  }, [displayedMapping, selectedImport]);

  const confirmRemoveImport = (job: LoopImportJob) => {
    const statusLabel = formatImportStatus(job.status);

    return window.confirm(
      ACTIVE_IMPORT_STATUSES.includes(job.status)
        ? `Remove recent import for ${job.fileName} while it is still ${statusLabel}?\n\nThis deletes the import history entry and any staged rows. It does not undo any project or task changes that may already have been applied.`
        : `Remove recent import for ${job.fileName}?\n\nThis deletes the import history entry and any staged or result rows. It does not undo any project or task changes from the import.`,
    );
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <section className="toolbar-card import-card">
        <div className="bulk-action-header">
          <div>
            <strong>CSV import</strong>
            <br />
            <span>
              Import from CSV, apply mapping, and commit to database.
            </span>
          </div>
        {onClose ? (
          <div className="import-actions">
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        ) : null}
      </div>

      <div className="import-grid">
        <label>
          Import file
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(event) => {
              setPanelError(null);
              setSelectedFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>

        <div className="import-actions">
          <button
            type="button"
            disabled={!selectedFile || uploadMutation.isPending}
            onClick={() => {
              if (selectedFile) {
                uploadMutation.mutate(selectedFile);
              }
            }}
          >
            {uploadMutation.isPending ? "Staging..." : "Stage import"}
          </button>
        </div>

        <div className="import-selection-control">
          <label>
            Recent imports
            <select
              value={effectiveSelectedImportId ?? ""}
              onChange={(event) => {
                const nextImportId = event.target.value;
                setDraftImportId(null);
                setCreatedImportAccounts([]);
                setMappingDraft({});
                setPanelError(null);
                setSelectedImportId(nextImportId ? nextImportId : null);
              }}
            >
              <option value="">Select an import</option>
              {recentImports.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.fileName} · {formatImportStatus(job.status)}
                </option>
              ))}
            </select>
          </label>

          {selectedImport ? (
            <button
              type="button"
              className="danger-button"
              disabled={removeImportMutation.isPending}
              onClick={() => {
                if (!confirmRemoveImport(selectedImport)) {
                  return;
                }

                removeImportMutation.mutate({
                  fileName: selectedImport.fileName,
                  importId: selectedImport.id,
                });
              }}
            >
              {removeImportMutation.isPending ? "Removing..." : "Remove import"}
            </button>
          ) : null}
        </div>
      </div>

      {panelError ? <p className="error-banner">{panelError}</p> : null}
      {importsErrorMessage ? (
        <p className="error-banner">{importsErrorMessage}</p>
      ) : null}
      {importsQuery.isLoading ? (
        <p className="toolbar-hint">Loading recent imports...</p>
      ) : null}

      <div className="import-subsection import-reset-section">
        <div className="bulk-action-header">
          <div>
            <strong>Projects/Tasks workspace reset</strong>
            <span>
              Delete the current project/task workspace data only, or reseed the
              example projects/tasks. Local accounts, saved views, and import
              history stay in place.
            </span>
          </div>
          {!resetConfirmationOpen ? (
            <div className="import-actions">
              <button
                type="button"
                className="danger-button"
                disabled={resetWorkspaceMutation.isPending}
                onClick={() => {
                  setPanelError(null);
                  setResetPassword("");
                  setResetMode("clear");
                }}
              >
                Clear all Projects/Tasks
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={resetWorkspaceMutation.isPending}
                onClick={() => {
                  setPanelError(null);
                  setResetPassword("");
                  setResetMode("examples");
                }}
              >
                Reset to example Projects/Tasks
              </button>
            </div>
          ) : null}
        </div>

        {resetConfirmationOpen ? (
          <div className="import-reset-confirmation">
            <p className="toolbar-hint">
              {resetActionSummary} Confirm with your current admin password to
              continue.
            </p>
            <label>
              Current password
              <input
                type="password"
                value={resetPassword}
                onChange={(event) => {
                  setPanelError(null);
                  setResetPassword(event.target.value);
                }}
              />
            </label>
            <div className="import-actions">
              <button
                type="button"
                className="ghost-button"
                disabled={resetWorkspaceMutation.isPending}
                onClick={() => {
                  setPanelError(null);
                  setResetPassword("");
                  setResetMode(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger-button"
                disabled={
                  resetPassword.trim().length < 8 ||
                  resetWorkspaceMutation.isPending
                }
                onClick={() => {
                  if (!resetMode) {
                    return;
                  }

                  resetWorkspaceMutation.mutate({
                    password: resetPassword,
                    seedExamples: resetMode === "examples",
                  });
                }}
              >
                {resetWorkspaceMutation.isPending
                  ? resetMode === "clear"
                    ? "Clearing..."
                    : "Resetting..."
                  : resetMode === "clear"
                    ? "Confirm clear"
                    : "Confirm reset"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {selectedImportQuery.isLoading ? (
        <p className="toolbar-hint">Loading import details...</p>
      ) : null}

      {selectedImportErrorMessage ? (
        <p className="error-banner">{selectedImportErrorMessage}</p>
      ) : null}

      {showEmptyState ? (
        <p className="toolbar-hint">
          No imports yet. Upload a CSV export to stage the first job.
        </p>
      ) : null}

      {selectedImport ? (
        <>
          <div className="import-status-grid">
            <div>
              <span className="status-note">Status</span>
              <strong>{formatImportStatus(selectedImport.status)}</strong>
            </div>
            <div>
              <span className="status-note">Rows</span>
              <strong>{selectedImport.totalRowCount.toString()}</strong>
            </div>
            <div>
              <span className="status-note">Created</span>
              <strong>{selectedImport.createdRowCount.toString()}</strong>
            </div>
            <div>
              <span className="status-note">Updated</span>
              <strong>{selectedImport.updatedRowCount.toString()}</strong>
            </div>
            <div>
              <span className="status-note">Skipped</span>
              <strong>{selectedImport.skippedRowCount.toString()}</strong>
            </div>
            <div>
              <span className="status-note">Failed</span>
              <strong>{selectedImport.failedRowCount.toString()}</strong>
            </div>
          </div>

          {selectedImport.lastError ? (
            <p className="error-banner">{selectedImport.lastError}</p>
          ) : null}

          <div className="import-subsection">
            <div className="bulk-action-header">
              <div>
                <strong>Header mapping</strong>
                <span>
                  Required fields are marked with *. Suggested matches are
                  editable.
                </span>
              </div>
              <div className="import-actions">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={
                    selectedImport.status !== "awaiting_review" ||
                    !mappingChanged ||
                    updateMappingMutation.isPending
                  }
                  onClick={() => {
                    if (selectedImport) {
                      updateMappingMutation.mutate({
                        importId: selectedImport.id,
                        mapping: displayedMapping,
                      });
                    }
                  }}
                >
                  {updateMappingMutation.isPending
                    ? "Saving..."
                    : "Apply mapping"}
                </button>
                <button
                  type="button"
                  disabled={
                    selectedImport.status !== "awaiting_review" ||
                    selectedImport.preview.validRowCount === 0 ||
                    selectedImport.preview.blockingMissingUserRowCount > 0 ||
                    createMissingUsersMutation.isPending ||
                    updateRowDecisionsMutation.isPending ||
                    commitMutation.isPending
                  }
                  onClick={() => {
                    commitMutation.mutate(selectedImport.id);
                  }}
                >
                  {commitMutation.isPending
                    ? "Queueing..."
                    : "Commit valid rows"}
                </button>
              </div>
            </div>

            <div className="import-mapping-grid">
              {selectedImport.fields.map((field) => (
                <label key={field.key}>
                  {field.label}
                  {field.required ? " *" : ""}
                  <select
                    value={displayedMapping[field.key] ?? ""}
                    onChange={(event) => {
                      const nextValue = event.target.value;

                      setDraftImportId(effectiveSelectedImportId);
                      setMappingDraft({
                        ...displayedMapping,
                        [field.key]: nextValue ? nextValue : null,
                      });
                    }}
                  >
                    <option value="">Not mapped</option>
                    {selectedImport.headers.map((header) => (
                      <option key={`${field.key}-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                  <span className="toolbar-hint">{field.description}</span>
                </label>
              ))}
            </div>

            {selectedImport.preview.unmappedHeaders.length > 0 ? (
              <p className="toolbar-hint">
                Ignored headers:{" "}
                {selectedImport.preview.unmappedHeaders.join(", ")}
              </p>
            ) : null}
          </div>

            <div className="import-subsection">
              <div className="bulk-action-header">
                <div>
                  <strong>Preview</strong>
                  <br />
                  <span>
                    {selectedImport.preview.validRowCount.toString()} valid ·{" "}
                    {selectedImport.preview.invalidRowCount.toString()} invalid ·{" "}
                  {selectedImport.preview.warningRowCount.toString()} warnings
                </span>
              </div>
            </div>

            {selectedImport.preview.missingRequiredMappings.length > 0 ? (
              <p className="error-banner">
                Missing required mappings:{" "}
                {selectedImport.preview.missingRequiredMappings.join(", ")}
              </p>
            ) : null}

            <div className="import-summary-grid">
              <span className="audit-chip">
                Project ids on{" "}
                {selectedImport.preview.projectSourceIdRowCount.toString()} rows
              </span>
              <span className="audit-chip">
                Task ids on{" "}
                {selectedImport.preview.taskSourceIdRowCount.toString()} rows
              </span>
              {selectedImport.preview.missingUserRowCount > 0 ? (
                <span className="audit-chip import-chip-warning">
                  Missing users on{" "}
                  {selectedImport.preview.missingUserRowCount.toString()} rows
                </span>
              ) : null}
              {selectedImport.preview.overlappingProjectRowCount > 0 ? (
                <span className="audit-chip">
                  Project overlaps on{" "}
                  {selectedImport.preview.overlappingProjectRowCount.toString()}{" "}
                  rows
                </span>
              ) : null}
              {selectedImport.preview.overlappingTaskRowCount > 0 ? (
                <span className="audit-chip">
                  Task overlaps on{" "}
                  {selectedImport.preview.overlappingTaskRowCount.toString()} rows
                </span>
              ) : null}
            </div>

            {selectedImport.preview.missingUsers.length > 0 ? (
              <div className="import-missing-users">
                <div className="bulk-action-header">
                  <div>
                    <strong>Missing users</strong>
                    <span>
                      Tavi can create local viewer accounts when an email is
                      available. Unresolved task assignees still block commit;
                      additional project owners are optional.
                    </span>
                  </div>
                  <div className="import-actions">
                    <button
                      type="button"
                      disabled={
                        creatableMissingUserCount === 0 ||
                        createMissingUsersMutation.isPending
                      }
                      onClick={() => {
                        createMissingUsersMutation.mutate({
                          importId: selectedImport.id,
                          missingUsers: selectedImport.preview.missingUsers,
                        });
                      }}
                    >
                      {createMissingUsersMutation.isPending
                        ? "Creating..."
                        : `Create ${formatUserCount(creatableMissingUserCount)}`}
                    </button>
                  </div>
                </div>

                <div className="import-user-grid">
                  {selectedImport.preview.missingUsers.map((user) => (
                      <article
                        key={`${user.label}-${user.rowNumbers.join("-")}`}
                        className="import-user-card"
                      >
                        <strong>{user.name}</strong>
                        <span className="task-subtext">
                          {user.email ?? "No email available in import data"}
                        </span>
                        <span className="task-subtext">
                          Rows {user.rowNumbers.join(", ")}
                        </span>
                        <span className="task-subtext">
                          {user.sourceLabels.join(", ")}
                        </span>
                        <span
                          className={`audit-chip ${
                            user.blocksCommit ? "import-chip-warning" : ""
                          }`}
                        >
                          {user.blocksCommit
                            ? "Blocks commit"
                            : "Optional"}
                        </span>
                        <span
                          className={`audit-chip ${
                            user.canCreate ? "" : "import-chip-warning"
                          }`}
                        >
                          {user.canCreate
                            ? "Create viewer account"
                            : "Needs email"}
                        </span>
                      </article>
                    ))}
                </div>
              </div>
            ) : null}

            {createdImportAccounts.length > 0 ? (
              <div className="import-created-users">
                <div className="bulk-action-header">
                  <div>
                    <strong>Created users</strong>
                    <span>
                      Save these passwords now. They are only shown in this
                      panel.
                    </span>
                  </div>
                </div>

                <div className="import-user-grid">
                  {createdImportAccounts.map((account) => (
                    <article
                      key={`${account.email}-${account.password}`}
                      className="import-user-card"
                    >
                      <strong>{account.name}</strong>
                      <span className="task-subtext">{account.email}</span>
                      <code className="import-secret">{account.password}</code>
                    </article>
                  ))}
                </div>
              </div>
            ) : null}

            <table className="import-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Project</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Overlap</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {selectedImport.preview.rows.map((row) => {
                  const isProjectOnlyRow =
                    row.taskTitle === null && row.taskExternalId === null;
                  const taskLabel = isProjectOnlyRow
                    ? "No task created"
                    : (row.taskTitle ?? "Missing task title");
                  const taskSubtext = isProjectOnlyRow
                    ? "Project only row"
                    : row.taskExternalId
                      ? `Source id ${row.taskExternalId}`
                      : "Natural-key match";

                  return (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber.toString()}</td>
                    <td>
                      <strong>
                        {row.projectTitle ?? "Missing project title"}
                      </strong>
                      <div className="task-subtext">
                        {row.projectExternalId
                          ? `Source id ${row.projectExternalId}`
                          : "Natural-key match"}
                      </div>
                    </td>
                    <td>
                      <strong>{taskLabel}</strong>
                      <div className="task-subtext">{taskSubtext}</div>
                    </td>
                    <td>
                      {isProjectOnlyRow
                        ? "Project only"
                        : formatTaskStatus(row.taskStatus)}
                    </td>
                    <td>
                      {row.projectOverlap || row.taskOverlap ? (
                        <div className="import-issue-list">
                          {row.projectOverlap ? (
                            <label className="import-overlap-control">
                              Project
                              <select
                                value={row.projectOverlap.action}
                                disabled={
                                  selectedImport.status !== "awaiting_review" ||
                                  updateRowDecisionsMutation.isPending
                                }
                                onChange={(event) => {
                                  updateRowDecisionsMutation.mutate({
                                    importId: selectedImport.id,
                                    payload: {
                                      projectAction:
                                        event.target.value as LoopImportOverlapAction,
                                    },
                                    rowNumber: row.rowNumber,
                                  });
                                }}
                              >
                                <option value="update">
                                  Update existing project
                                </option>
                                <option value="add">Add new project</option>
                                <option value="ignore">
                                  Use existing project unchanged
                                </option>
                              </select>
                              <span className="task-subtext">
                                Matches {row.projectOverlap.title} via{" "}
                                {formatOverlapMatch(row.projectOverlap.matchedBy)}
                                {formatOverlapChanges(
                                  row.projectOverlap.changedFields,
                                )}
                              </span>
                            </label>
                          ) : null}
                          {row.taskOverlap ? (
                            <label className="import-overlap-control">
                              Task
                              <select
                                value={row.taskOverlap.action}
                                disabled={
                                  selectedImport.status !== "awaiting_review" ||
                                  updateRowDecisionsMutation.isPending
                                }
                                onChange={(event) => {
                                  updateRowDecisionsMutation.mutate({
                                    importId: selectedImport.id,
                                    payload: {
                                      taskAction:
                                        event.target.value as LoopImportOverlapAction,
                                    },
                                    rowNumber: row.rowNumber,
                                  });
                                }}
                              >
                                <option value="update">
                                  Update existing task
                                </option>
                                <option value="add">Add new task</option>
                                <option value="ignore">Ignore task row</option>
                              </select>
                              <span className="task-subtext">
                                Matches {row.taskOverlap.title} via{" "}
                                {formatOverlapMatch(row.taskOverlap.matchedBy)}
                                {formatOverlapChanges(
                                  row.taskOverlap.changedFields,
                                )}
                              </span>
                            </label>
                          ) : null}
                        </div>
                      ) : (
                        <span className="task-subtext">No overlap</span>
                      )}
                    </td>
                    <td>
                      {row.errors.length > 0 ? (
                        <div className="import-issue-list">
                          {row.errors.map((error) => (
                            <span
                              key={error}
                              className="audit-chip import-chip-error"
                            >
                              {error}
                            </span>
                          ))}
                        </div>
                      ) : row.warnings.length > 0 ? (
                        <div className="import-issue-list">
                          {row.warnings.map((warning) => (
                            <span
                              key={warning}
                              className="audit-chip import-chip-warning"
                            >
                              {warning}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="task-subtext">Ready</span>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedImport.results.length > 0 ? (
            <div className="import-subsection">
              <div className="bulk-action-header">
                <div>
                  <strong>Commit results</strong>
                  <br />
                  <span>
                    Projects: {selectedImport.createdProjectCount.toString()}{" "}
                    created / {selectedImport.updatedProjectCount.toString()}{" "}
                    updated · Tasks:{" "}
                    {selectedImport.createdTaskCount.toString()} created /{" "}
                    {selectedImport.updatedTaskCount.toString()} updated
                  </span>
                </div>
              </div>

              <table className="import-table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Row outcome</th>
                    <th>Project</th>
                    <th>Task</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedImport.results.map((row) => (
                    <tr key={`result-${row.rowNumber}`}>
                      <td>{row.rowNumber.toString()}</td>
                      <td>{formatOutcome(row.rowOutcome)}</td>
                      <td>{formatOutcome(row.projectOutcome)}</td>
                      <td>{formatOutcome(row.taskOutcome)}</td>
                      <td>
                        <strong>
                          {row.message ?? "No additional details"}
                        </strong>
                        {row.validationErrors.length > 0 ? (
                          <div className="import-issue-list">
                            {row.validationErrors.map((error) => (
                              <span
                                key={`${row.rowNumber}-${error}`}
                                className="audit-chip import-chip-error"
                              >
                                {error}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function formatImportStatus(status: LoopImportJobStatus) {
  return status.replace(/_/g, " ");
}

function formatTaskStatus(status: string) {
  return status.replace(/_/g, " ");
}

function formatOutcome(outcome: string) {
  return outcome.replace(/_/g, " ");
}

function formatUserCount(count: number) {
  return `${count.toString()} ${count === 1 ? "user" : "users"}`;
}

function formatRecordCount(count: number, label: string) {
  return `${count.toString()} ${label}${count === 1 ? "" : "s"}`;
}

function formatOverlapMatch(matchType: "natural_key" | "source_id") {
  return matchType === "source_id" ? "source id" : "natural key";
}

function formatOverlapChanges(changedFields: string[]) {
  if (changedFields.length === 0) {
    return " with no field changes";
  }

  return ` with ${changedFields.length.toString()} field ${
    changedFields.length === 1 ? "change" : "changes"
  }`;
}

function formatQueryError(error: unknown, fallbackMessage: string) {
  if (error instanceof ApiError) {
    return `${fallbackMessage}: ${error.message}`;
  }

  return fallbackMessage;
}
