import { useState } from "react";
import type { GroupBy, ProjectStatus, WorkspaceProject } from "./types";
import {
  downloadLoopCsv,
  downloadWorkspaceCsv,
  downloadWorkspaceJson,
  downloadWorkspaceXlsx,
} from "./export-utils";

type ExportPanelProps = {
  groupBy: GroupBy;
  onNotice: (message: string) => void;
  projects: WorkspaceProject[];
  search: string;
  statusFilter: ProjectStatus | "all";
};

type ExportFormat = "csv" | "xlsx" | "json" | "loop";

export function ExportPanel({
  groupBy,
  onNotice,
  projects,
  search,
  statusFilter,
}: ExportPanelProps) {
  const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);

  const handleExport = async (format: ExportFormat) => {
    setPendingFormat(format);

    try {
      if (format === "csv") {
        downloadWorkspaceCsv({ groupBy, projects, search, statusFilter });
      } else if (format === "xlsx") {
        await downloadWorkspaceXlsx({ groupBy, projects, search, statusFilter });
      } else if (format === "json") {
        downloadWorkspaceJson({ groupBy, projects, search, statusFilter });
      } else {
        downloadLoopCsv(projects);
      }

      onNotice(
        format === "loop"
          ? "Downloaded Loop export for the current filtered workspace."
          : `Downloaded ${format.toUpperCase()} export for the current filtered workspace.`,
      );
    } finally {
      setPendingFormat(null);
    }
  };

  return (
    <section className="workspace-panel-card">
      <header className="panel-header">
        <div>
          <strong>Export</strong>
          <span>
            Download the current filtered workspace as CSV, XLSX, JSON, or a
            Loop-oriented CSV.
          </span>
        </div>
      </header>

      <div className="export-actions">
        <button
          type="button"
          className="ghost-button compact-button"
          disabled={pendingFormat !== null}
          onClick={() => void handleExport("csv")}
        >
          {pendingFormat === "csv" ? "Exporting..." : "CSV"}
        </button>
        <button
          type="button"
          className="ghost-button compact-button"
          disabled={pendingFormat !== null}
          onClick={() => void handleExport("xlsx")}
        >
          {pendingFormat === "xlsx" ? "Exporting..." : "XLSX"}
        </button>
        <button
          type="button"
          className="ghost-button compact-button"
          disabled={pendingFormat !== null}
          onClick={() => void handleExport("json")}
        >
          {pendingFormat === "json" ? "Exporting..." : "JSON"}
        </button>
        <button
          type="button"
          className="ghost-button compact-button"
          disabled={pendingFormat !== null}
          onClick={() => void handleExport("loop")}
        >
          {pendingFormat === "loop" ? "Exporting..." : "Loop"}
        </button>
      </div>

      <p className="toolbar-hint">
        Exports follow the current search, group, and project-status filters and
        include only the data visible to you.
      </p>
    </section>
  );
}
