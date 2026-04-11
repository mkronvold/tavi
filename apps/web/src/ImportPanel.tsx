import { useMemo, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ApiError,
  commitLoopImport,
  createLoopImport,
  getLoopImport,
  listLoopImports,
  updateLoopImportMapping,
} from "./api";
import type {
  LoopImportField,
  LoopImportJob,
  LoopImportJobStatus,
  LoopImportMapping,
} from "./types";

type ImportPanelProps = {
  isAdmin: boolean;
  queryClient: QueryClient;
};

const POLLING_STATUSES: LoopImportJobStatus[] = [
  "queued_parse",
  "parsing",
  "queued_commit",
  "committing",
];

export function ImportPanel({ isAdmin, queryClient }: ImportPanelProps) {
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [mappingDraft, setMappingDraft] = useState<LoopImportMapping>({});
  const [draftImportId, setDraftImportId] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

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
      setMappingDraft({});
      await queryClient.invalidateQueries({ queryKey: ["import", job.id] });
    },
    onError: (error) => {
      setPanelError(
        error instanceof ApiError ? error.message : "Unable to update mapping",
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

  const selectedImport = selectedImportQuery.data ?? null;
  const displayedMapping = useMemo(
    () =>
      draftImportId === effectiveSelectedImportId && selectedImport
        ? mappingDraft
        : selectedImport?.mapping ?? {},
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
        (displayedMapping[key] ?? null) !== (selectedImport.mapping[key] ?? null)
      ) {
        return true;
      }
    }

    return false;
  }, [displayedMapping, selectedImport]);

  if (!isAdmin) {
    return null;
  }

  return (
    <section className="toolbar-card import-card">
      <div className="bulk-action-header">
        <div>
          <strong>Loop import</strong>
          <span>Stage CSV exports, review mapping, then commit in the worker.</span>
        </div>
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

        <label>
          Recent imports
          <select
            value={effectiveSelectedImportId ?? ""}
            onChange={(event) => {
              const nextImportId = event.target.value;
              setDraftImportId(null);
              setMappingDraft({});
              setPanelError(null);
              setSelectedImportId(nextImportId ? nextImportId : null);
            }}
          >
            <option value="">Select an import</option>
            {importsQuery.data?.map((job) => (
              <option key={job.id} value={job.id}>
                {job.fileName} · {formatImportStatus(job.status)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {panelError ? <p className="error-banner">{panelError}</p> : null}
      {importsQuery.isLoading ? (
        <p className="toolbar-hint">Loading recent imports...</p>
      ) : null}

      {selectedImportQuery.isLoading ? (
        <p className="toolbar-hint">Loading import details...</p>
      ) : null}

      {!selectedImport && !selectedImportQuery.isLoading ? (
        <p className="toolbar-hint">
          No imports yet. Upload a Loop CSV export to stage the first job.
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
                  Required fields are marked with *. Suggested matches are editable.
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
                  {updateMappingMutation.isPending ? "Saving..." : "Apply mapping"}
                </button>
                <button
                  type="button"
                  disabled={
                    selectedImport.status !== "awaiting_review" ||
                    selectedImport.preview.validRowCount === 0 ||
                    commitMutation.isPending
                  }
                  onClick={() => {
                    commitMutation.mutate(selectedImport.id);
                  }}
                >
                  {commitMutation.isPending ? "Queueing..." : "Commit valid rows"}
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
                Ignored headers: {selectedImport.preview.unmappedHeaders.join(", ")}
              </p>
            ) : null}
          </div>

          <div className="import-subsection">
            <div className="bulk-action-header">
              <div>
                <strong>Preview</strong>
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
                Task ids on {selectedImport.preview.taskSourceIdRowCount.toString()} rows
              </span>
            </div>

            <table className="import-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Project</th>
                  <th>Task</th>
                  <th>Status</th>
                  <th>Issues</th>
                </tr>
              </thead>
              <tbody>
                {selectedImport.preview.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber.toString()}</td>
                    <td>
                      <strong>{row.projectTitle ?? "Missing project title"}</strong>
                      <div className="task-subtext">
                        {row.projectExternalId
                          ? `Source id ${row.projectExternalId}`
                          : "Natural-key match"}
                      </div>
                    </td>
                    <td>
                      <strong>{row.taskTitle ?? "Missing task title"}</strong>
                      <div className="task-subtext">
                        {row.taskExternalId
                          ? `Source id ${row.taskExternalId}`
                          : "Natural-key match"}
                      </div>
                    </td>
                    <td>{formatTaskStatus(row.taskStatus)}</td>
                    <td>
                      {row.errors.length > 0 ? (
                        <div className="import-issue-list">
                          {row.errors.map((error) => (
                            <span key={error} className="audit-chip import-chip-error">
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
                ))}
              </tbody>
            </table>
          </div>

          {selectedImport.results.length > 0 ? (
            <div className="import-subsection">
              <div className="bulk-action-header">
                <div>
                  <strong>Commit results</strong>
                  <span>
                    Projects: {selectedImport.createdProjectCount.toString()} created
                    / {selectedImport.updatedProjectCount.toString()} updated · Tasks:{" "}
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
                        <strong>{row.message ?? "No additional details"}</strong>
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
