import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

const createDetail = (
  overrides: Partial<LoopImportJob> = {},
): LoopImportJob => ({
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
      description:
        "Maps common Loop-style status values to Tavi task statuses.",
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
    blockingMissingUserRowCount: 0,
    invalidRowCount: 0,
    missingUserRowCount: 0,
    missingUsers: [],
    missingTaskAssigneeRowCount: 0,
    missingTaskAssignees: [],
    missingRequiredMappings: [],
    overlappingProjectRowCount: 0,
    overlappingTaskRowCount: 0,
    projectSourceIdRowCount: 0,
    rows: [
      {
        errors: [],
        projectExternalId: null,
        projectIdentityStrategy: "natural_key",
        projectOverlap: null,
        projectTitle: "Loop migration",
        rowNumber: 1,
        taskExternalId: null,
        taskIdentityStrategy: "natural_key",
        taskOverlap: null,
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
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const renderImportPanel = (
    queryClient: QueryClient,
    onNotice = vi.fn(),
  ) => {
    render(
      <QueryClientProvider client={queryClient}>
        <ImportPanel isAdmin onNotice={onNotice} queryClient={queryClient} />
      </QueryClientProvider>,
    );

    return { onNotice };
  };

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
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse(hasImport ? [createSummary()] : []);
        }

        if (url.endsWith("/imports/loop") && init?.method === "POST") {
          expect(typeof init.body).toBe("string");
          expect(JSON.parse(init.body as string)).toEqual({
            content:
              "Project Title,Checklist Item,Task Status\nLoop migration,Confirm mapping,done\n",
            fileName: "loop.csv",
          });

          hasImport = true;
          return createResponse(createSummary());
        }

        if (
          url.endsWith("/imports/import-1") &&
          (!init || init.method === undefined)
        ) {
          return createResponse(detail);
        }

        if (
          url.endsWith("/imports/import-1/commit") &&
          init?.method === "POST"
        ) {
          expect(init.body).toBeUndefined();
          expect(
            new Headers(init.headers).has("Content-Type"),
          ).toBeFalsy();

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
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderImportPanel(queryClient);

    await waitFor(() => {
      expect(
        screen.getByText(
          "No imports yet. Upload a CSV export to stage the first job.",
        ),
      ).toBeInTheDocument();
    });

    const file = new File(
      [
        "Project Title,Checklist Item,Task Status\nLoop migration,Confirm mapping,done\n",
      ],
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
      expect(
        screen.getByText("Project created, task created"),
      ).toBeInTheDocument();
      expect(screen.getByText("completed")).toBeInTheDocument();
    });
  });

  it("removes a pending import from the recent list", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let imports = [createSummary()];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse(imports);
        }

        if (
          url.endsWith("/imports/import-1") &&
          (!init || init.method === undefined)
        ) {
          return createResponse(
            createDetail({
              status: "awaiting_review",
            }),
          );
        }

        if (url.endsWith("/imports/import-1") && init?.method === "DELETE") {
          imports = [];
          return createResponse({ id: "import-1" });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderImportPanel(queryClient);

    await waitFor(() => {
      expect(screen.getByText("Remove import")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove import" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove recent import for loop.csv?\n\nThis deletes the import history entry and any staged or result rows. It does not undo any project or task changes from the import.",
    );

    await waitFor(() => {
      expect(screen.queryByText("Remove import")).not.toBeInTheDocument();
      expect(
        screen.getByText("No imports yet. Upload a CSV export to stage the first job."),
      ).toBeInTheDocument();
    });
  });

  it("removes a completed import from recent history", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let imports = [createSummary({ status: "completed" })];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse(imports);
        }

        if (
          url.endsWith("/imports/import-1") &&
          (!init || init.method === undefined)
        ) {
          return createResponse(
            createDetail({
              status: "completed",
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
            }),
          );
        }

        if (url.endsWith("/imports/import-1") && init?.method === "DELETE") {
          imports = [];
          return createResponse({ id: "import-1" });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderImportPanel(queryClient);

    await waitFor(() => {
      expect(screen.getByText("Project created, task created")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove import" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Remove recent import for loop.csv?\n\nThis deletes the import history entry and any staged or result rows. It does not undo any project or task changes from the import.",
    );

    await waitFor(() => {
      expect(screen.queryByText("Remove import")).not.toBeInTheDocument();
      expect(
        screen.getByText("No imports yet. Upload a CSV export to stage the first job."),
      ).toBeInTheDocument();
    });
  });

  it("shows a detail error instead of the empty state when a recent import cannot be loaded", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse([createSummary()]);
        }

        if (
          url.endsWith("/imports/import-1") &&
          (!init || init.method === undefined)
        ) {
          return createResponse(
            {
              message: "Import detail lookup failed",
            },
            500,
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderImportPanel(queryClient);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Unable to load import details: Import detail lookup failed",
        ),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("option", { name: "loop.csv · awaiting review" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "No imports yet. Upload a CSV export to stage the first job.",
      ),
    ).not.toBeInTheDocument();
  });

  it("shows an error when the recent import list cannot be loaded", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse(
            {
              message: "Import history unavailable",
            },
            503,
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderImportPanel(queryClient);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Unable to load recent imports: Import history unavailable",
        ),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(
        "No imports yet. Upload a CSV export to stage the first job.",
      ),
    ).not.toBeInTheDocument();
  });

  it("offers to create missing assignee accounts from the import preview", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    let detail: LoopImportJob = createDetail({
      preview: {
        blockingMissingUserRowCount: 1,
        invalidRowCount: 0,
        missingUserRowCount: 1,
        missingUsers: [
          {
            blocksCommit: true,
            canCreate: true,
            email: "jane@example.com",
            label: "Jane Doe <jane@example.com>",
            name: "Jane Doe",
            rowCount: 1,
            rowNumbers: [1],
            sourceLabels: ["Task assignee"],
          },
        ],
        missingTaskAssigneeRowCount: 1,
        missingTaskAssignees: [
          {
            canCreate: true,
            email: "jane@example.com",
            label: "Jane Doe <jane@example.com>",
            name: "Jane Doe",
            rowCount: 1,
            rowNumbers: [1],
          },
        ],
        missingRequiredMappings: [],
        projectSourceIdRowCount: 0,
        rows: [
          {
            errors: [],
            projectExternalId: null,
            projectIdentityStrategy: "natural_key",
            projectOverlap: null,
            projectTitle: "Loop migration",
            rowNumber: 1,
            taskExternalId: null,
            taskIdentityStrategy: "natural_key",
            taskOverlap: null,
            taskStatus: "todo",
            taskTitle: "Confirm mapping",
            warnings: [
              'Task assignee "Jane Doe <jane@example.com>" did not match a known user. Create the account or update the import before committing.',
            ],
          },
        ],
        overlappingProjectRowCount: 0,
        overlappingTaskRowCount: 0,
        taskSourceIdRowCount: 0,
        totalRowCount: 1,
        unmappedHeaders: [],
        validRowCount: 1,
        warningRowCount: 1,
      },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse([createSummary()]);
        }

        if (
          url.endsWith("/imports/import-1") &&
          (!init || init.method === undefined)
        ) {
          return createResponse(detail);
        }

        if (url.endsWith("/auth/accounts") && init?.method === "POST") {
          expect(typeof init.body).toBe("string");

          const payload = JSON.parse(init.body as string);
          expect(payload).toMatchObject({
            email: "jane@example.com",
            name: "Jane Doe",
            role: "viewer",
          });
          expect(typeof payload.password).toBe("string");
          expect(payload.password).toHaveLength(20);

          detail = createDetail();

          return createResponse({
            account: {
              createdAt: "2026-03-01T10:00:00.000Z",
              email: "jane@example.com",
              id: "user-9",
              name: "Jane Doe",
              role: "viewer",
              updatedAt: "2026-03-01T10:00:00.000Z",
            },
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderImportPanel(queryClient);

    await waitFor(() => {
      expect(screen.getByText("Missing users")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Create 1 user" }));

    await waitFor(() => {
      expect(screen.getByText("Created users")).toBeInTheDocument();
      expect(screen.getByText("jane@example.com")).toBeInTheDocument();
    });
  });

  it("updates per-row overlap actions from the preview table", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    let detail: LoopImportJob = createDetail({
      preview: {
        ...createDetail().preview,
        overlappingProjectRowCount: 1,
        rows: [
          {
            ...createDetail().preview.rows[0],
            projectOverlap: {
              action: "update",
              changedFields: ["summary"],
              existingId: "project-1",
              matchedBy: "natural_key",
              title: "Loop migration",
            },
          },
        ],
      },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse([createSummary()]);
        }

        if (
          url.endsWith("/imports/import-1") &&
          (!init || init.method === undefined)
        ) {
          return createResponse(detail);
        }

        if (
          url.endsWith("/imports/import-1/rows/1/decisions") &&
          init?.method === "PATCH"
        ) {
          expect(typeof init.body).toBe("string");
          expect(JSON.parse(init.body as string)).toEqual({
            projectAction: "add",
          });

          detail = createDetail({
            preview: {
              ...detail.preview,
              rows: [
                {
                  ...detail.preview.rows[0],
                  projectOverlap: {
                    ...(detail.preview.rows[0].projectOverlap ?? {
                      changedFields: [],
                      existingId: "project-1",
                      matchedBy: "natural_key" as const,
                      title: "Loop migration",
                    }),
                    action: "add",
                  },
                },
              ],
            },
          });

          return createResponse(detail);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderImportPanel(queryClient);

    const projectSelect = await screen.findByDisplayValue(
      "Update existing project",
    );
    expect(projectSelect).toHaveValue("update");

    fireEvent.change(projectSelect, {
      target: { value: "add" },
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Add new project")).toHaveValue("add");
    });
  });

  it("requires password confirmation before clearing projects and tasks", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse([]);
        }

        if (
          url.endsWith("/workspace/reset-examples") &&
          init?.method === "POST"
        ) {
          expect(typeof init.body).toBe("string");
          expect(JSON.parse(init.body as string)).toEqual({
            password: "current-password-123",
            seedExamples: false,
          });

          return createResponse({
            createdProjectCount: 0,
            createdTaskCount: 0,
            deletedProjectCount: 2,
            deletedTaskCount: 5,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    const { onNotice } = renderImportPanel(queryClient);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Clear all Projects/Tasks",
      }),
    );
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "current-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear" }));

    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(
        "Cleared workspace data: removed 2 projects and 5 tasks.",
      );
    });
  });

  it("requires password confirmation before resetting to example projects and tasks", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/imports") && (!init || init.method === undefined)) {
          return createResponse([]);
        }

        if (
          url.endsWith("/workspace/reset-examples") &&
          init?.method === "POST"
        ) {
          expect(typeof init.body).toBe("string");
          expect(JSON.parse(init.body as string)).toEqual({
            password: "current-password-123",
            seedExamples: true,
          });

          return createResponse({
            createdProjectCount: 4,
            createdTaskCount: 11,
            deletedProjectCount: 2,
            deletedTaskCount: 5,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    const { onNotice } = renderImportPanel(queryClient);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Reset to example Projects/Tasks",
      }),
    );
    fireEvent.change(screen.getByLabelText("Current password"), {
      target: { value: "current-password-123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));

    await waitFor(() => {
      expect(onNotice).toHaveBeenCalledWith(
        "Reset workspace data: removed 2 projects and 5 tasks, then seeded 4 example projects and 11 tasks.",
      );
    });
  });
});
