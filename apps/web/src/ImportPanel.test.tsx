import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImportPanel } from "./ImportPanel";
import type { LoopImportJob, LoopImportJobSummary } from "./types";

const createResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const createSummary = (
  overrides: Partial<LoopImportJobSummary> = {},
): LoopImportJobSummary => ({
  completedAt: null,
  createdAt: "2026-03-01T10:00:00.000Z",
  createdProjectCount: 0,
  createdRowCount: 0,
  createdTaskCount: 0,
  failedRowCount: 0,
  fileName: "loop.csv",
  id: "import-1",
  lastError: null,
  skippedRowCount: 0,
  sourceSystem: "loop",
  status: "awaiting_review",
  totalRowCount: 1,
  updatedAt: "2026-03-01T10:00:00.000Z",
  updatedProjectCount: 0,
  updatedRowCount: 0,
  updatedTaskCount: 0,
  ...overrides,
});

const createDetail = (overrides: Partial<LoopImportJob> = {}): LoopImportJob => ({
  ...createSummary(),
  fields: [
    {
      description: "Top-level Loop track or project name.",
      key: "projectTitle",
      label: "Project title",
      required: true,
    },
    {
      description: "Checklist item or task title to create under the project.",
      key: "taskTitle",
      label: "Task title",
      required: true,
    },
    {
      description: "Maps common Loop-style status values to Tavi task statuses.",
      key: "taskStatus",
      label: "Task status",
      required: false,
    },
  ],
  headers: ["Project Title", "Checklist Item", "Task Status"],
  mapping: {
    projectTitle: "Project Title",
    taskStatus: "Task Status",
    taskTitle: "Checklist Item",
  },
  preview: {
    invalidRowCount: 0,
    missingRequiredMappings: [],
    projectSourceIdRowCount: 0,
    rows: [
      {
        errors: [],
        projectExternalId: null,
        projectIdentityStrategy: "natural_key",
        projectTitle: "Loop migration",
        rowNumber: 1,
        taskExternalId: null,
        taskIdentityStrategy: "natural_key",
        taskStatus: "done",
        taskTitle: "Confirm mapping",
        warnings: [],
      },
    ],
    taskSourceIdRowCount: 0,
    totalRowCount: 1,
    unmappedHeaders: [],
    validRowCount: 1,
    warningRowCount: 0,
  },
  results: [],
  suggestedMapping: {
    projectTitle: "Project Title",
    taskStatus: "Task Status",
    taskTitle: "Checklist Item",
  },
  ...overrides,
});

describe("ImportPanel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stages, previews, and commits Loop imports", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    let hasImport = false;
    let detail: LoopImportJob = createDetail({
      status: "awaiting_review",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/imports") && (!init || init.method === undefined)) {
        return createResponse(hasImport ? [createSummary()] : []);
      }

      if (url.endsWith("/imports/loop") && init?.method === "POST") {
        expect(typeof init.body).toBe("string");
        expect(JSON.parse(init.body as string)).toEqual({
          content: "Project Title,Checklist Item,Task Status\nLoop migration,Confirm mapping,done\n",
          fileName: "loop.csv",
        });

        hasImport = true;
        return createResponse(createSummary());
      }

      if (url.endsWith("/imports/import-1") && (!init || init.method === undefined)) {
        return createResponse(detail);
      }

      if (url.endsWith("/imports/import-1/commit") && init?.method === "POST") {
        detail = createDetail({
          completedAt: "2026-03-01T10:01:00.000Z",
          createdProjectCount: 1,
          createdRowCount: 1,
          createdTaskCount: 1,
          results: [
            {
              message: "Project created, task created",
              projectId: "project-1",
              projectOutcome: "created",
              rowNumber: 1,
              rowOutcome: "created",
              taskId: "task-1",
              taskOutcome: "created",
              validationErrors: [],
            },
          ],
          status: "completed",
        });

        return createResponse(detail);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    render(
      <QueryClientProvider client={queryClient}>
        <ImportPanel isAdmin queryClient={queryClient} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No imports yet. Upload a Loop CSV export to stage the first job."),
      ).toBeInTheDocument();
    });

    const file = new File(
      ["Project Title,Checklist Item,Task Status\nLoop migration,Confirm mapping,done\n"],
      "loop.csv",
      {
        type: "text/csv",
      },
    );
    Object.defineProperty(file, "text", {
      value: () =>
        Promise.resolve(
          "Project Title,Checklist Item,Task Status\nLoop migration,Confirm mapping,done\n",
        ),
    });

    fireEvent.change(screen.getByLabelText("Import file"), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stage import" }));

    await waitFor(() => {
      expect(screen.getByText("Loop migration")).toBeInTheDocument();
      expect(screen.getByText("Confirm mapping")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Commit valid rows" }));

    await waitFor(() => {
      expect(screen.getByText("Project created, task created")).toBeInTheDocument();
      expect(screen.getByText("completed")).toBeInTheDocument();
    });
  });
});
