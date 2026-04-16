import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  applyBackupRestore,
  createBackupNow,
  deleteBackupFile,
  downloadBackupFile,
  getBackupStatus,
  previewBackupRestore,
  updateBackupSettings,
  uploadBackupFile,
} from "./api";
import type { BackupRestorePreview, BackupStatus } from "./types";

type BackupSettingsCardProps = {
  onNotice: (message: string) => void;
  variant?: "panel" | "settings";
};

type RestoreScope = "full" | "projects_tasks" | "users";

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function BackupSettingsCard({
  onNotice,
  variant = "settings",
}: BackupSettingsCardProps) {
  const queryClient = useQueryClient();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState("02:00");
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [selectedStoredFileName, setSelectedStoredFileName] = useState("");
  const [preview, setPreview] = useState<BackupRestorePreview | null>(null);
  const [restoreScope, setRestoreScope] = useState<RestoreScope>("full");
  const [selectedProjectIds, setSelectedProjectIds] = useState<
    Record<string, boolean>
  >({});
  const [selectedUserIds, setSelectedUserIds] = useState<
    Record<string, boolean>
  >({});
  const [projectConflictActions, setProjectConflictActions] = useState<
    Record<string, "replace" | "skip">
  >({});
  const [userConflictActions, setUserConflictActions] = useState<
    Record<string, "replace" | "skip">
  >({});
  const [downloadingFileName, setDownloadingFileName] = useState<string | null>(
    null,
  );

  const backupStatusQuery = useQuery({
    queryFn: getBackupStatus,
    queryKey: ["backup-status"],
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!backupStatusQuery.data) {
      return;
    }

    const availableBackups = backupStatusQuery.data.backups ?? [];
    setScheduleDraft(backupStatusQuery.data.scheduleTime ?? "02:00");
    setSelectedStoredFileName((current) => {
      if (
        current.length > 0 &&
        availableBackups.some((backup) => backup.fileName === current)
      ) {
        return current;
      }

      return availableBackups[0]?.fileName ?? "";
    });
  }, [backupStatusQuery.data]);

  const resetRestorePreview = () => {
    setPreview(null);
    setRestoreError(null);
    setSelectedProjectIds({});
    setSelectedUserIds({});
    setProjectConflictActions({});
    setUserConflictActions({});
  };

  const applyBackupStatus = (status: BackupStatus) => {
    queryClient.setQueryData<BackupStatus>(["backup-status"], status);
  };

  const backupSettingsMutation = useMutation({
    mutationFn: updateBackupSettings,
    onSuccess: (status) => {
      setBackupError(null);
      applyBackupStatus(status);
      onNotice(
        `Automatic backups ${status.enabled ? "enabled" : "disabled"} for ${status.scheduleTime}.`,
      );
    },
    onError: (error) => {
      setBackupError(
        error instanceof ApiError
          ? error.message
          : "Unable to update automatic backup settings.",
      );
    },
  });

  const createBackupMutation = useMutation({
    mutationFn: createBackupNow,
    onSuccess: (status) => {
      setBackupError(null);
      applyBackupStatus(status);
      setSelectedStoredFileName(status.backups[0]?.fileName ?? "");
      onNotice("Backup saved to storage.");
    },
    onError: (error) => {
      setBackupError(
        error instanceof ApiError ? error.message : "Unable to create a backup.",
      );
    },
  });

  const uploadBackupMutation = useMutation({
    mutationFn: uploadBackupFile,
    onSuccess: (status) => {
      setBackupError(null);
      applyBackupStatus(status);
      setSelectedStoredFileName(status.backups[0]?.fileName ?? "");
      onNotice("Backup uploaded to storage.");
    },
    onError: (error) => {
      setBackupError(
        error instanceof ApiError ? error.message : "Unable to upload backup.",
      );
    },
  });

  const deleteBackupMutation = useMutation({
    mutationFn: deleteBackupFile,
    onSuccess: (status, fileName) => {
      setBackupError(null);
      applyBackupStatus(status);

      if (selectedStoredFileName === fileName) {
        setSelectedStoredFileName(status.backups[0]?.fileName ?? "");
        resetRestorePreview();
      }

      onNotice(`Deleted ${fileName}.`);
    },
    onError: (error) => {
      setBackupError(
        error instanceof ApiError ? error.message : "Unable to delete backup.",
      );
    },
  });

  const previewMutation = useMutation({
    mutationFn: (fileName: string) =>
      previewBackupRestore({ source: buildStoredSource(fileName) }),
    onSuccess: (nextPreview, fileName) => {
      setRestoreError(null);
      setSelectedStoredFileName(fileName);
      setPreview(nextPreview);
      setSelectedProjectIds(
        Object.fromEntries(
          nextPreview.projects.map((project) => [project.backupId, true]),
        ),
      );
      setSelectedUserIds(
        Object.fromEntries(
          nextPreview.users.map((user) => [user.backupId, true]),
        ),
      );
      setProjectConflictActions(
        Object.fromEntries(
          nextPreview.projects
            .filter((project) => project.conflict.kind !== "none")
            .map((project) => [project.backupId, "skip"]),
        ),
      );
      setUserConflictActions(
        Object.fromEntries(
          nextPreview.users
            .filter((user) => user.conflict.kind !== "none")
            .map((user) => [user.backupId, "skip"]),
        ),
      );

      if (nextPreview.projects.length === 0 && nextPreview.users.length > 0) {
        setRestoreScope("users");
      } else if (
        nextPreview.users.length === 0 &&
        nextPreview.projects.length > 0
      ) {
        setRestoreScope("projects_tasks");
      } else {
        setRestoreScope("full");
      }
    },
    onError: (error) => {
      setRestoreError(
        error instanceof ApiError
          ? error.message
          : "Unable to preview the selected backup.",
      );
    },
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      applyBackupRestore({
        projectConflictResolutions: projectConflictActions,
        projectIds:
          restoreScope === "projects_tasks"
            ? Object.entries(selectedProjectIds)
                .filter(([, selected]) => selected)
                .map(([id]) => id)
            : undefined,
        scope: restoreScope,
        source: buildStoredSource(selectedStoredFileName),
        userConflictResolutions: userConflictActions,
        userIds:
          restoreScope === "users"
            ? Object.entries(selectedUserIds)
                .filter(([, selected]) => selected)
                .map(([id]) => id)
            : undefined,
      }),
    onSuccess: async (result) => {
      setRestoreError(null);
      resetRestorePreview();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["backup-status"] }),
        queryClient.invalidateQueries({ queryKey: ["localAccounts"] }),
        queryClient.invalidateQueries({
          queryKey: ["notification-preferences"],
        }),
        queryClient.invalidateQueries({ queryKey: ["smtp-status"] }),
        queryClient.invalidateQueries({ queryKey: ["workspace"] }),
      ]);

      if (result.scope === "full") {
        onNotice(
          result.reauthenticateRequired
            ? "Full restore applied. Sign in again if your current account was replaced."
            : "Full restore applied.",
        );
        return;
      }

      if (result.scope === "projects_tasks") {
        onNotice(
          `Restore applied: ${result.summary.projectsCreated} projects created, ${result.summary.projectsReplaced} replaced, ${result.summary.projectsSkipped} skipped, and ${result.summary.tasksCreated} tasks restored.`,
        );
        return;
      }

      onNotice(
        result.reauthenticateRequired
          ? `Restore applied: ${result.summary.usersCreated} users created, ${result.summary.usersReplaced} replaced, and ${result.summary.usersSkipped} skipped. Sign in again if your account changed.`
          : `Restore applied: ${result.summary.usersCreated} users created, ${result.summary.usersReplaced} replaced, and ${result.summary.usersSkipped} skipped.`,
      );
    },
    onError: (error) => {
      setRestoreError(
        error instanceof ApiError
          ? error.message
          : "Unable to apply the selected restore.",
      );
    },
  });

  const backupStatus = backupStatusQuery.data;
  const automaticBackupsEnabled = backupStatus?.enabled ?? false;
  const selectedProjectCount = useMemo(
    () => Object.values(selectedProjectIds).filter(Boolean).length,
    [selectedProjectIds],
  );
  const selectedUserCount = useMemo(
    () => Object.values(selectedUserIds).filter(Boolean).length,
    [selectedUserIds],
  );
  const storedBackups = backupStatus?.backups ?? [];
  const busy =
    backupSettingsMutation.isPending ||
    createBackupMutation.isPending ||
    uploadBackupMutation.isPending ||
    deleteBackupMutation.isPending;

  const toggleAutomaticBackups = () => {
    if (backupSettingsMutation.isPending || !backupStatus) {
      return;
    }

    backupSettingsMutation.mutate({
      enabled: !backupStatus.enabled,
      scheduleTime: backupStatus.scheduleTime,
    });
  };

  const saveSchedule = () => {
    if (backupSettingsMutation.isPending || !backupStatus) {
      return;
    }

    backupSettingsMutation.mutate({
      enabled: backupStatus.enabled,
      scheduleTime: scheduleDraft,
    });
  };

  const submitPreview = () => {
    if (!selectedStoredFileName) {
      setRestoreError("Select a stored backup first.");
      return;
    }

    resetRestorePreview();
    previewMutation.mutate(selectedStoredFileName);
  };

  const startRestorePreview = (fileName: string) => {
    setRestoreOpen(true);
    setSelectedStoredFileName(fileName);
    resetRestorePreview();
    previewMutation.mutate(fileName);
  };

  const applyRestoreChanges = () => {
    if (!preview) {
      return;
    }

    if (restoreScope === "projects_tasks" && selectedProjectCount === 0) {
      setRestoreError("Select at least one project to restore.");
      return;
    }

    if (restoreScope === "users" && selectedUserCount === 0) {
      setRestoreError("Select at least one user to restore.");
      return;
    }

    const confirmed = window.confirm(
      restoreScope === "full"
        ? "Apply a full restore?\n\nThis replaces all current Tavi data with the selected backup."
        : "Apply the selected restore changes?",
    );

    if (!confirmed) {
      return;
    }

    applyMutation.mutate();
  };

  const handleUploadClick = () => {
    if (busy) {
      return;
    }

    uploadInputRef.current?.click();
  };

  const handleUploadSelection = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const content = await file.text();
    uploadBackupMutation.mutate({
      content,
      fileName: file.name,
    });
  };

  const handleDownload = async (fileName: string) => {
    setDownloadingFileName(fileName);
    setBackupError(null);

    try {
      await downloadBackupFile(fileName);
      onNotice(`Downloaded ${fileName}.`);
    } catch (error) {
      setBackupError(
        error instanceof ApiError
          ? error.message
          : "Unable to download backup.",
      );
    } finally {
      setDownloadingFileName(null);
    }
  };

  const handleDelete = (fileName: string) => {
    const confirmed = window.confirm(`Delete ${fileName} from backup storage?`);

    if (!confirmed) {
      return;
    }

    deleteBackupMutation.mutate(fileName);
  };

  const renderAsPanel = variant === "panel";

  return (
    <div
      className={
        renderAsPanel
          ? "backup-settings-panel"
          : "settings-item settings-item-wide"
      }
    >
      {!renderAsPanel ? (
        <div className="settings-item-header">
          <strong>Automatic Backups</strong>
          <span>{automaticBackupsEnabled ? "On" : "Off"}</span>
        </div>
      ) : null}
      <p className="toolbar-hint">
        Store complete Tavi database snapshots in the configured backup
        directory and use them later for full or selective restore.
      </p>
      {backupError ? <p className="error-banner">{backupError}</p> : null}
      <label className="settings-switch">
        <span className="settings-switch-label">Automatic Backups</span>
        <input
          aria-label="Automatic Backups"
          checked={automaticBackupsEnabled}
          className="settings-switch-input"
          disabled={backupSettingsMutation.isPending || !backupStatus}
          onChange={toggleAutomaticBackups}
          role="switch"
          type="checkbox"
        />
      </label>
      <div className="backup-toolbar">
        <div className="settings-time-controls">
          <label className="settings-time-field">
            <span className="settings-label">Backup time</span>
            <input
              aria-label="Backup time"
              onChange={(event) => setScheduleDraft(event.target.value)}
              type="time"
              value={scheduleDraft}
            />
          </label>
          <div className="settings-actions">
            <button
              type="button"
              className="ghost-button compact-button"
              disabled={
                backupSettingsMutation.isPending ||
                !backupStatus ||
                scheduleDraft === backupStatus.scheduleTime
              }
              onClick={saveSchedule}
            >
              Save
            </button>
          </div>
        </div>
        <div className="settings-actions">
          <input
            ref={uploadInputRef}
            accept=".json,application/json"
            className="backup-upload-input"
            onChange={(event) => {
              void handleUploadSelection(event);
            }}
            type="file"
          />
          <button
            type="button"
            className="ghost-button compact-button"
            disabled={busy}
            onClick={handleUploadClick}
          >
            {uploadBackupMutation.isPending ? "Uploading..." : "Upload Backup"}
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            disabled={busy}
            onClick={() => createBackupMutation.mutate()}
          >
            {createBackupMutation.isPending ? "Saving..." : "Backup Now"}
          </button>
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={() => setRestoreOpen((current) => !current)}
          >
            {restoreOpen ? "Hide restore controls" : "Open restore controls"}
          </button>
        </div>
      </div>
      <div className="backup-status-grid">
        <div>
          <span className="settings-label">Directory</span>
          <div className="backup-status-value">
            {backupStatus?.backupDirectory ?? "Loading..."}
          </div>
        </div>
        <div>
          <span className="settings-label">Last success</span>
          <div className="backup-status-value">
            {formatTimestamp(backupStatus?.lastSuccessAt ?? null)}
          </div>
        </div>
        <div>
          <span className="settings-label">Last failure</span>
          <div className="backup-status-value">
            {formatTimestamp(backupStatus?.lastFailureAt ?? null)}
          </div>
        </div>
        <div>
          <span className="settings-label">Stored backups</span>
          <div className="backup-status-value">{storedBackups.length}</div>
        </div>
      </div>
      {!backupStatus?.backupDirectoryAccessible ? (
        <p className="error-banner">
          The backup directory is not currently accessible to the API process.
        </p>
      ) : null}
      {backupStatus?.lastError ? (
        <p className="error-banner">{backupStatus.lastError}</p>
      ) : null}

      <div className="backup-storage-list">
        <div className="backup-storage-header">
          <strong>Stored Backups</strong>
          <span>{storedBackups.length === 0 ? "None yet" : `${storedBackups.length} total`}</span>
        </div>
        {storedBackups.length === 0 ? (
          <p className="toolbar-hint">
            Use Upload Backup or Backup Now to add a backup to storage.
          </p>
        ) : (
          <div className="backup-storage-rows">
            {storedBackups.map((backup) => (
              <div
                key={backup.fileName}
                className={`backup-storage-row${selectedStoredFileName === backup.fileName ? " is-selected" : ""}`}
              >
                <div className="backup-storage-main">
                  <strong>{backup.fileName}</strong>
                  <span>{`${formatTimestamp(backup.modifiedAt)} · ${formatBytes(backup.sizeBytes)}`}</span>
                </div>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={previewMutation.isPending || applyMutation.isPending}
                    onClick={() => startRestorePreview(backup.fileName)}
                  >
                    {previewMutation.isPending &&
                    selectedStoredFileName === backup.fileName
                      ? "Loading..."
                      : "Restore"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={downloadingFileName === backup.fileName}
                    onClick={() => {
                      void handleDownload(backup.fileName);
                    }}
                  >
                    {downloadingFileName === backup.fileName
                      ? "Downloading..."
                      : "Download"}
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={deleteBackupMutation.isPending}
                    onClick={() => handleDelete(backup.fileName)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {restoreOpen ? (
        <div className="backup-restore-panel">
          <div className="backup-restore-header">
            <label className="settings-time-field">
              <span className="settings-label">Stored backup file</span>
              <select
                aria-label="Stored backup file"
                className="workspace-filter"
                onChange={(event) => {
                  setSelectedStoredFileName(event.target.value);
                  resetRestorePreview();
                }}
                value={selectedStoredFileName}
              >
                <option value="">Select a stored backup</option>
                {storedBackups.map((backup) => (
                  <option key={backup.fileName} value={backup.fileName}>
                    {`${backup.fileName} · ${formatBytes(backup.sizeBytes)}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-actions">
              <button
                type="button"
                className="ghost-button compact-button"
                disabled={previewMutation.isPending || selectedStoredFileName.length === 0}
                onClick={submitPreview}
              >
                {previewMutation.isPending ? "Previewing..." : "Preview restore"}
              </button>
            </div>
          </div>

          {restoreError ? <p className="error-banner">{restoreError}</p> : null}

          {preview ? (
            <div className="backup-preview">
              <div className="backup-preview-header">
                <div>
                  <strong>{preview.fileName}</strong>
                  <span>{`${preview.sourceLabel} · ${formatTimestamp(
                    preview.createdAt,
                  )}`}</span>
                </div>
                <span className="backup-preview-format">{preview.format}</span>
              </div>

              <div className="backup-preview-counts">
                <span>{`${preview.counts.projects} projects`}</span>
                <span>{`${preview.counts.tasks} tasks`}</span>
                <span>{`${preview.counts.users} users`}</span>
                <span>{`${preview.counts.savedViews} saved views`}</span>
                <span>{`${preview.counts.auditEvents} audit events`}</span>
              </div>

              <div className="backup-scope-controls">
                <label className="backup-radio">
                  <input
                    checked={restoreScope === "full"}
                    name="restore-scope"
                    onChange={() => setRestoreScope("full")}
                    type="radio"
                  />
                  <span>Full restore</span>
                </label>
                <label className="backup-radio">
                  <input
                    checked={restoreScope === "projects_tasks"}
                    disabled={preview.projects.length === 0}
                    name="restore-scope"
                    onChange={() => setRestoreScope("projects_tasks")}
                    type="radio"
                  />
                  <span>Projects and tasks only</span>
                </label>
                <label className="backup-radio">
                  <input
                    checked={restoreScope === "users"}
                    disabled={preview.users.length === 0}
                    name="restore-scope"
                    onChange={() => setRestoreScope("users")}
                    type="radio"
                  />
                  <span>Users only</span>
                </label>
              </div>

              {restoreScope === "projects_tasks" ? (
                <div className="backup-selection-group">
                  <div className="backup-selection-header">
                    <strong>{`Projects (${selectedProjectCount}/${preview.projects.length})`}</strong>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        onClick={() =>
                          setSelectedProjectIds(
                            Object.fromEntries(
                              preview.projects.map((project) => [
                                project.backupId,
                                true,
                              ]),
                            ),
                          )
                        }
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        onClick={() =>
                          setSelectedProjectIds(
                            Object.fromEntries(
                              preview.projects.map((project) => [
                                project.backupId,
                                false,
                              ]),
                            ),
                          )
                        }
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="backup-selection-list">
                    {preview.projects.map((project) => (
                      <div key={project.backupId} className="backup-selection-row">
                        <label className="backup-selection-main">
                          <input
                            checked={selectedProjectIds[project.backupId] ?? false}
                            onChange={(event) =>
                              setSelectedProjectIds((current) => ({
                                ...current,
                                [project.backupId]: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          <span>
                            <strong>{project.title}</strong>
                            <span>{`${project.taskCount} tasks`}</span>
                            {project.ownerName ? (
                              <span>{`Owner: ${project.ownerName}`}</span>
                            ) : null}
                            {project.missingOwner ? (
                              <span>
                                Owner will be cleared if that user is missing.
                              </span>
                            ) : null}
                            {project.missingAssigneeCount > 0 ? (
                              <span>{`${project.missingAssigneeCount} assignees will be cleared unless matching users already exist.`}</span>
                            ) : null}
                          </span>
                        </label>
                        {project.conflict.kind !== "none" ? (
                          <label className="backup-conflict-control">
                            <span className="settings-label">
                              {project.conflict.kind === "source_identity"
                                ? `Matches ${project.conflict.existingTitle ?? "an existing project"} by source identity`
                                : "Conflict action"}
                            </span>
                            <select
                              value={
                                projectConflictActions[project.backupId] ?? "skip"
                              }
                              onChange={(event) =>
                                setProjectConflictActions((current) => ({
                                  ...current,
                                  [project.backupId]: event.target.value as
                                    | "replace"
                                    | "skip",
                                }))
                              }
                            >
                              <option value="skip">Skip</option>
                              <option value="replace">Replace existing</option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {restoreScope === "users" ? (
                <div className="backup-selection-group">
                  <div className="backup-selection-header">
                    <strong>{`Users (${selectedUserCount}/${preview.users.length})`}</strong>
                    <div className="settings-actions">
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        onClick={() =>
                          setSelectedUserIds(
                            Object.fromEntries(
                              preview.users.map((user) => [user.backupId, true]),
                            ),
                          )
                        }
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        onClick={() =>
                          setSelectedUserIds(
                            Object.fromEntries(
                              preview.users.map((user) => [
                                user.backupId,
                                false,
                              ]),
                            ),
                          )
                        }
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                  <div className="backup-selection-list">
                    {preview.users.map((user) => (
                      <div key={user.backupId} className="backup-selection-row">
                        <label className="backup-selection-main">
                          <input
                            checked={selectedUserIds[user.backupId] ?? false}
                            onChange={(event) =>
                              setSelectedUserIds((current) => ({
                                ...current,
                                [user.backupId]: event.target.checked,
                              }))
                            }
                            type="checkbox"
                          />
                          <span>
                            <strong>{user.name}</strong>
                            <span>{user.email}</span>
                            <span>{user.role}</span>
                          </span>
                        </label>
                        {user.conflict.kind !== "none" ? (
                          <label className="backup-conflict-control">
                            <span className="settings-label">
                              {user.conflict.kind === "email"
                                ? `Matches ${user.conflict.existingEmail ?? "an existing user"} by email`
                                : "Conflict action"}
                            </span>
                            <select
                              value={userConflictActions[user.backupId] ?? "skip"}
                              onChange={(event) =>
                                setUserConflictActions((current) => ({
                                  ...current,
                                  [user.backupId]: event.target.value as
                                    | "replace"
                                    | "skip",
                                }))
                              }
                            >
                              <option value="skip">Skip</option>
                              <option value="replace">Replace existing</option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="settings-actions">
                <button
                  type="button"
                  className="ghost-button compact-button"
                  disabled={applyMutation.isPending}
                  onClick={applyRestoreChanges}
                >
                  {applyMutation.isPending ? "Applying..." : "Apply restore"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function buildStoredSource(selectedStoredFileName: string) {
  if (!selectedStoredFileName) {
    throw new Error("Select a stored backup first.");
  }

  return {
    fileName: selectedStoredFileName,
    kind: "stored" as const,
  };
}
