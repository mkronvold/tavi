import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BackupSettingsCard } from "./BackupSettingsCard";
import type { BackupRestorePreview, BackupStatus } from "./types";

function createResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createBackupStatus(
  overrides: Partial<BackupStatus> = {},
): BackupStatus {
  return {
    backupDirectory: "/var/tavi/backups",
    backupDirectoryAccessible: true,
    backups: [
      {
        createdAt: "2026-04-18T10:00:00.000Z",
        fileName: "backup-1.json",
        modifiedAt: "2026-04-18T10:00:00.000Z",
        sizeBytes: 1024,
      },
    ],
    enabled: true,
    lastError: null,
    lastFailureAt: null,
    lastScheduledRunAt: null,
    lastSuccessAt: null,
    scheduleTime: "02:00",
    ...overrides,
  };
}

function createPreview(
  overrides: Partial<BackupRestorePreview> = {},
): BackupRestorePreview {
  return {
    counts: {
      auditEvents: 0,
      backupSettings: 1,
      emailSettings: 1,
      importJobs: 0,
      importRows: 0,
      notificationDeliveryAttempts: 0,
      notificationEvents: 0,
      projects: 1,
      roleAssignments: 0,
      savedViews: 0,
      tasks: 2,
      users: 0,
    },
    createdAt: "2026-04-18T10:00:00.000Z",
    fileName: "backup-1.json",
    format: "tavi-backup-v1",
    projects: [
      {
        backupId: "project-1",
        conflict: { kind: "none" },
        dueDate: null,
        missingAssigneeCount: 0,
        missingOwner: false,
        ownerName: "Tavi Admin",
        taskCount: 2,
        title: "Roadmap refresh",
      },
    ],
    sourceLabel: "Stored backup",
    users: [],
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const onNotice = vi.fn();

  return {
    onNotice,
    ...render(
      <QueryClientProvider client={queryClient}>
        <BackupSettingsCard onNotice={onNotice} variant="panel" />
      </QueryClientProvider>,
    ),
  };
}

describe("BackupSettingsCard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("clears existing projects and tasks from restore controls without seeding examples", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/backups") && !init?.method) {
        return createResponse(createBackupStatus());
      }

      if (url.endsWith("/backups/restore/preview") && init?.method === "POST") {
        return createResponse(createPreview());
      }

      if (url.endsWith("/workspace/reset-examples") && init?.method === "POST") {
        expect(JSON.parse(init.body as string)).toEqual({
          password: "current-password-123",
          seedExamples: false,
        });

        return createResponse({
          createdProjectCount: 0,
          createdTaskCount: 0,
          deletedProjectCount: 3,
          deletedTaskCount: 9,
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    const { onNotice } = renderCard();

    await screen.findByText("backup-1.json");

    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    await waitFor(() => {
      expect(screen.getByText("Projects (1/1)")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear all existing projects/tasks",
      }),
    );

    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "current-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));

    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(
        "Cleared workspace data: removed 3 projects and 9 tasks.",
      );
    });
  });
});
