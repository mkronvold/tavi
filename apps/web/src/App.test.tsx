import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { appRepositoryUrl } from "@tavi/config";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { AuditHistoryEvent, WorkspaceResponse } from "./types";

const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);

const createResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const formatExpectedCalendarDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(
    new Date(value),
  );

const createWorkspacePayload = (): WorkspaceResponse => ({
  currentUser: {
    id: "user-1",
    email: "editor@tavi.local",
    name: "Tavi Editor",
    role: "editor",
  },
  users: [
    {
      id: "user-1",
      email: "editor@tavi.local",
      name: "Tavi Editor",
      role: "editor",
    },
    {
      id: "user-2",
      email: "viewer@tavi.local",
      name: "Tavi Viewer",
      role: "viewer",
    },
  ],
  projects: [
    {
      id: "project-1",
      title: "Roadmap refresh",
      notes: "Awaiting dependency",
      references: "https://tracker.example.com/projects/roadmap-refresh",
      ownerUserId: "user-1",
      ownerName: "Tavi Editor",
      dueDate: null,
      priority: "medium",
      derivedStatus: "in_progress",
      displayStatus: "blocked",
      manualStatus: "blocked",
      taskTotalCount: 2,
      taskTodoCount: 1,
      taskInProgressCount: 1,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-04-01T09:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
      tasks: [
        {
          id: "task-1",
          projectId: "project-1",
          title: "Kickoff",
          notes: "Confirm milestone scope",
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: null,
          priority: "medium",
          status: "todo",
          sortOrder: 0,
          completedAt: null,
          createdAt: "2026-04-01T11:00:00.000Z",
          updatedAt: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "task-2",
          projectId: "project-1",
          title: "Review plan",
          notes: "Validate timing",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "medium",
          status: "in_progress",
          sortOrder: 1,
          completedAt: null,
          createdAt: "2026-04-01T12:00:00.000Z",
          updatedAt: "2026-04-02T12:00:00.000Z",
        },
      ],
    },
  ],
  savedViews: [
    {
      id: "view-1",
      name: "Blocked review",
      groupBy: "status",
      search: "Roadmap",
      sortBy: ["progress"],
      statusFilters: ["blocked"],
      assigneeUserIds: [],
      collapsedGroupKeys: ["done"],
      expandedProjectIds: ["project-1"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
});

const createAdminWorkspacePayload = (): WorkspaceResponse => {
  const payload = createWorkspacePayload();

  payload.currentUser = {
    ...payload.currentUser,
    role: "admin",
  };
  payload.users[0] = {
    ...payload.users[0],
    role: "admin",
  };

  return payload;
};

const createSortedWorkspacePayload = (): WorkspaceResponse => {
  const payload = createWorkspacePayload();

  payload.projects = [
    {
      id: "project-1",
      title: "Roadmap refresh",
      notes: "Awaiting dependency",
      references: "https://tracker.example.com/projects/roadmap-refresh",
      ownerUserId: "user-1",
      ownerName: "Tavi Editor",
      dueDate: null,
      priority: "medium",
      derivedStatus: "in_progress",
      displayStatus: "blocked",
      manualStatus: "blocked",
      taskTotalCount: 2,
      taskTodoCount: 1,
      taskInProgressCount: 1,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-01-15T09:00:00.000Z",
      updatedAt: "2026-04-02T10:00:00.000Z",
      tasks: [
        {
          id: "task-1",
          projectId: "project-1",
          title: "Kickoff",
          notes: "Confirm milestone scope",
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: null,
          priority: "medium",
          status: "todo",
          sortOrder: 0,
          completedAt: null,
          createdAt: "2026-01-16T09:00:00.000Z",
          updatedAt: "2026-04-03T10:00:00.000Z",
        },
        {
          id: "task-2",
          projectId: "project-1",
          title: "Review plan",
          notes: "Validate timing",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "medium",
          status: "in_progress",
          sortOrder: 1,
          completedAt: null,
          createdAt: "2026-01-17T09:00:00.000Z",
          updatedAt: "2026-04-07T11:00:00.000Z",
        },
      ],
    },
    {
      id: "project-2",
      title: "Beta rollout",
      notes: "Track launch blockers",
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: "2026-04-10T00:00:00.000Z",
      priority: "high",
      derivedStatus: "in_progress",
      displayStatus: "in_progress",
      manualStatus: null,
      taskTotalCount: 2,
      taskTodoCount: 1,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 1,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-02-01T09:00:00.000Z",
      updatedAt: "2026-04-06T08:00:00.000Z",
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Check release notes",
          notes: null,
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: "2026-04-09T00:00:00.000Z",
          priority: "high",
          status: "done",
          sortOrder: 0,
          completedAt: "2026-04-01T12:00:00.000Z",
          createdAt: "2026-02-02T09:00:00.000Z",
          updatedAt: "2026-04-06T08:00:00.000Z",
        },
        {
          id: "task-4",
          projectId: "project-2",
          title: "Confirm staging",
          notes: null,
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: "2026-04-08T00:00:00.000Z",
          priority: "medium",
          status: "todo",
          sortOrder: 1,
          completedAt: null,
          createdAt: "2026-02-03T09:00:00.000Z",
          updatedAt: "2026-04-05T09:00:00.000Z",
        },
      ],
    },
    {
      id: "project-3",
      title: "Alpha planning",
      notes: "Prep the next cycle",
      references: null,
      ownerUserId: null,
      ownerName: null,
      dueDate: "2026-04-05T00:00:00.000Z",
      priority: "low",
      derivedStatus: "done",
      displayStatus: "done",
      manualStatus: null,
      taskTotalCount: 2,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 2,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-03-01T09:00:00.000Z",
      updatedAt: "2026-04-01T07:00:00.000Z",
      tasks: [
        {
          id: "task-5",
          projectId: "project-3",
          title: "Outline milestones",
          notes: null,
          assigneeUserId: "user-1",
          assigneeName: "Tavi Editor",
          dueDate: "2026-04-03T00:00:00.000Z",
          priority: "low",
          status: "done",
          sortOrder: 0,
          completedAt: "2026-03-30T09:00:00.000Z",
          createdAt: "2026-03-02T09:00:00.000Z",
          updatedAt: "2026-04-01T07:00:00.000Z",
        },
        {
          id: "task-6",
          projectId: "project-3",
          title: "Close prep work",
          notes: null,
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: "2026-04-04T00:00:00.000Z",
          priority: "low",
          status: "done",
          sortOrder: 1,
          completedAt: "2026-03-31T11:00:00.000Z",
          createdAt: "2026-03-03T09:00:00.000Z",
          updatedAt: "2026-04-02T06:00:00.000Z",
        },
      ],
    },
  ];

  return payload;
};

describe("App", () => {
  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

  const renderApp = () =>
    render(
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>,
    );

  const toggleProjectByTitle = (title: string) => {
    const projectHeading = screen
      .getAllByText(title)
      .find((element) => element.closest("article"));

    expect(projectHeading).toBeDefined();

    const projectCard = projectHeading?.closest("article");

    expect(projectCard).not.toBeNull();

    const expandButton = projectCard?.querySelector("button.group-toggle");

    expect(expandButton).toBeTruthy();
    fireEvent.click(expandButton!);

    return projectCard!;
  };

  const toggleGroupByTitle = (title: string) => {
    const groupCard = screen
      .getByRole("heading", { name: title })
      .closest("section");

    expect(groupCard).not.toBeNull();

    const toggleButton = groupCard?.querySelector(
      ".group-header .group-toggle",
    );

    expect(toggleButton).toBeTruthy();
    fireEvent.click(toggleButton!);

    return groupCard!;
  };

  const getVisibleProjectTitles = () =>
    Array.from(document.querySelectorAll(".project-card .project-main strong"))
      .map((element) => element.textContent?.trim())
      .filter((value): value is string => Boolean(value));

  const mockElementHeight = (element: HTMLElement, getHeight: () => number) => {
    Object.defineProperty(element, "offsetHeight", {
      configurable: true,
      get: getHeight,
    });
  };

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    Reflect.deleteProperty(window, "__TAVI_RUNTIME_CONFIG__");
    if (originalScrollIntoViewDescriptor) {
      Object.defineProperty(
        HTMLElement.prototype,
        "scrollIntoView",
        originalScrollIntoViewDescriptor,
      );
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the login screen hint when the backend says default local users still exist", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse({ message: "Authentication required" }, 401);
      }

      if (url.endsWith("/auth/local-login-hint")) {
        return createResponse({ visible: true });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Local dev users")).toBeInTheDocument();
    });
  });

  it("hides the login screen hint when the backend says defaults were removed", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse({ message: "Authentication required" }, 401);
      }

      if (url.endsWith("/auth/local-login-hint")) {
        return createResponse({ visible: false });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.queryByText("Local dev users")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });

  it("retries workspace loading with fibonacci backoff while the API is unavailable", async () => {
    vi.useFakeTimers();
    const workspacePayload = createWorkspacePayload();
    let workspaceRequests = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (!url.endsWith("/workspace")) {
          throw new Error(`Unexpected fetch: ${url}`);
        }

        workspaceRequests += 1;

        if (workspaceRequests < 4) {
          return createResponse("Bad Gateway", 502);
        }

        return createResponse(workspacePayload);
      }),
    );

    renderApp();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(
      screen.getByText(
        "The Tavi API is unavailable and may be restarting. Please wait a moment and try again.",
      ),
    ).toBeInTheDocument();
    expect(workspaceRequests).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(998);
    });
    expect(workspaceRequests).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(workspaceRequests).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(998);
    });
    expect(workspaceRequests).toBe(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(workspaceRequests).toBe(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    expect(workspaceRequests).toBe(4);
  });

  it("shows the compact workspace header without the workspace title", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.currentUser.name = "Tavi Admin";
    workspacePayload.users[0] = {
      ...workspacePayload.users[0],
      name: "Tavi Admin",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );
    Object.assign(window, {
      __TAVI_RUNTIME_CONFIG__: {
        appHomeUrl: "https://tavi.example.com/current",
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(
      screen.queryByRole("heading", { level: 1, name: "Workspace" }),
    ).not.toBeInTheDocument();

    const signOutButton = screen.getByRole("button", { name: "Sign out" });
    const headerActions = signOutButton.parentElement;
    const brandLink = screen.getByRole("link", { name: "ᴛᴀᴠi" });

    expect(headerActions).toHaveClass("header-actions");
    expect(headerActions?.firstElementChild).toHaveTextContent("Tavi Admin");
    expect(headerActions?.lastElementChild).toBe(signOutButton);
    expect(brandLink).toHaveAttribute(
      "href",
      "https://tavi.example.com/current",
    );
    expect(brandLink.querySelector(".brand-logo")).not.toBeNull();
    expect(screen.getByLabelText("Search")).toBeInTheDocument();
    expect(
      Array.from(
        screen.getByLabelText("Group by").querySelectorAll("option"),
      ).map((option) => option.textContent),
    ).toEqual(expect.arrayContaining(["Projects", "Progress"]));
    expect(screen.queryByText("Search")).not.toBeInTheDocument();
    expect(screen.queryByText("Group by")).not.toBeInTheDocument();
  });

  it("uses the runtime API base URL override for workspace requests", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "https://api.tavi.example.com/base/workspace") {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    Object.assign(window, {
      __TAVI_RUNTIME_CONFIG__: {
        apiBaseUrl: "https://api.tavi.example.com/base/",
      },
    });

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.tavi.example.com/base/workspace",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  it("applies personal saved views and shows override context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(screen.getByText("Derived: in progress")).toBeInTheDocument();
    expect(screen.getByText("Awaiting dependency")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View" }));

    await waitFor(() => {
      expect(screen.getByLabelText("My view")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("My view"), {
      target: { value: "view-1" },
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Search")).toHaveValue("Roadmap");
      expect(screen.getByLabelText("Group by")).toHaveValue("status");
      expect(
        screen.getByRole("button", { name: "Sort by: 1 Progress" }),
      ).toBeInTheDocument();
      expect(screen.getByText("Status: Blocked")).toBeInTheDocument();
    });
  });

  it("applies project status filters only when the green checkmark is used", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Status: All" }));

    const statusMenu = screen.getByRole("dialog", { name: "Status" });
    fireEvent.click(
      within(statusMenu).getByRole("checkbox", { name: "Blocked" }),
    );

    expect(screen.getByText("Kickoff")).toBeInTheDocument();
    expect(screen.getByText("Review plan")).toBeInTheDocument();

    fireEvent.click(
      within(statusMenu).getByRole("button", { name: "Apply status" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Status: Blocked" }),
      ).toBeInTheDocument();
    });
  });

  it("normalizes multi-sort order and applies it when the menu closes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "none" },
    });

    expect(getVisibleProjectTitles()).toEqual([
      "Roadmap refresh",
      "Beta rollout",
      "Alpha planning",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Sort by: Default" }));

    const sortMenu = screen.getByRole("dialog", { name: "Sort by" });
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Title not included in the current sort",
      }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", { name: "Title sort order 1" }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Progress not included in the current sort",
      }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Due Date not included in the current sort",
      }),
    );
    fireEvent.click(
      within(sortMenu).getByRole("button", { name: "Due Date sort order 1" }),
    );
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(
        JSON.parse(localStorage.getItem("tavi.workspace.filters") ?? "{}"),
      ).toEqual(
        expect.objectContaining({
          sortBy: ["progress", "title", "dueDate"],
        }),
      );
    });

    expect(
      screen.getByRole("button", { name: "Sort by: 3 fields" }),
    ).toBeInTheDocument();
    expect(getVisibleProjectTitles()).toEqual([
      "Alpha planning",
      "Beta rollout",
      "Roadmap refresh",
    ]);
  });

  it("sorts projects by age using project creation time", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "none" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sort by: Default" }));

    const sortMenu = screen.getByRole("dialog", { name: "Sort by" });
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Age not included in the current sort",
      }),
    );
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(getVisibleProjectTitles()).toEqual([
        "Roadmap refresh",
        "Beta rollout",
        "Alpha planning",
      ]);
    });
  });

  it("sorts projects by the latest project or task update", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "none" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sort by: Default" }));

    const sortMenu = screen.getByRole("dialog", { name: "Sort by" });
    fireEvent.click(
      within(sortMenu).getByRole("button", {
        name: "Last Updated not included in the current sort",
      }),
    );
    fireEvent.pointerDown(document.body);

    await waitFor(() => {
      expect(getVisibleProjectTitles()).toEqual([
        "Roadmap refresh",
        "Beta rollout",
        "Alpha planning",
      ]);
    });
  });

  it("shows completion percentages in project rows", async () => {
    const workspacePayload = createWorkspacePayload();
    const dueDate = "2026-05-01T00:00:00.000Z";

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      derivedStatus: "in_progress",
      displayStatus: "in_progress",
      dueDate,
      manualStatus: null,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(
      screen.queryByText("Derived from task rollup"),
    ).not.toBeInTheDocument();

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();

    const projectMetaItems = Array.from(
      projectCard!.querySelectorAll(".project-meta > *"),
    ).map((element) => element.textContent?.trim());

    expect(projectMetaItems).toEqual([
      "Tavi Editor",
      "Medium",
      "0%",
      formatExpectedCalendarDate(dueDate),
      "tracker.example.com/projects/roa... ↗",
    ]);
  });

  it("renders due dates without local timezone drift", async () => {
    const workspacePayload = createWorkspacePayload();
    const dueDate = "2026-05-01T00:00:00.000Z";

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      dueDate,
      tasks: workspacePayload.projects[0]!.tasks.map((task, index) =>
        index === 0
          ? {
              ...task,
              dueDate,
            }
          : task,
      ),
    };

    const localDateSpy = vi
      .spyOn(Date.prototype, "toLocaleDateString")
      .mockReturnValue("LOCAL-DRIFT");
    const dateTimeFormatSpy = vi
      .spyOn(Intl, "DateTimeFormat")
      .mockImplementation(
        function DateTimeFormatMock(
          this: Intl.DateTimeFormat,
          _locales?: string | string[],
          options?: Intl.DateTimeFormatOptions,
        ) {
          return {
            format: () =>
              options?.timeZone === "UTC" ? "UTC-STABLE-DATE" : "NON-UTC-DATE",
          } as Intl.DateTimeFormat;
        } as unknown as typeof Intl.DateTimeFormat,
      );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(screen.getByText("UTC-STABLE-DATE")).toBeInTheDocument();

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getAllByText("UTC-STABLE-DATE")).toHaveLength(2);
    });

    expect(localDateSpy).not.toHaveBeenCalled();
    expect(dateTimeFormatSpy).toHaveBeenCalledWith(undefined, {
      timeZone: "UTC",
    });
  });

  it("renders project notes as markdown with CRLF line breaks and linked URLs", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      notes:
        "Blocked on **approvals**\r\nhttps://docs.example.com/spec\r\n- confirm legal",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    expect(
      within(projectCard!).getByText("approvals", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(within(projectCard!).getByText("confirm legal")).toBeInTheDocument();

    const link = within(projectCard!).getByRole("link", {
      name: "https://docs.example.com/spec",
    });

    expect(link).toHaveAttribute("href", "https://docs.example.com/spec");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders task notes as markdown with CRLF line breaks and linked URLs", async () => {
    const workspacePayload = createWorkspacePayload();
    const fileUrl =
      "https://wisetechglobal-my.sharepoint.com/:x:/r/personal/michael_kronvold_wisetechglobal_com/Documents/Documents/KPE/Very%20Long%20Maintenance%20Workbook%202026%20Final%20Review.xlsx?d=wb762eb1726a84dcaa6cab3df556a0cfb&csf=1&web=1&e=rhQ0Pg";

    workspacePayload.projects[0].tasks[0] = {
      ...workspacePayload.projects[0].tasks[0],
      notes: `Review **scope**\r\n${fileUrl}\r\n- confirm owner`,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    expect(
      within(kickoffRow!).getByText("scope", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(within(kickoffRow!).getByText("confirm owner")).toBeInTheDocument();

    const link = within(kickoffRow!).getByRole("link", {
      name: "Very Long Maintenance Workbook 2...",
    });

    expect(link).toHaveAttribute("href", fileUrl);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("renders URL references as safe external links with shortened labels", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      references:
        "https://tracker.example.com/projects/roadmap-refresh?tab=board#milestones",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const references = screen.getByRole("link", {
      name: "tracker.example.com/projects/roa... ↗",
    });

    expect(references).toHaveAttribute(
      "href",
      "https://tracker.example.com/projects/roadmap-refresh?tab=board#milestones",
    );
    expect(references).toHaveAttribute("target", "_blank");
    expect(references.getAttribute("rel")).toContain("noopener");
    expect(references.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders filename references using only the decoded filename label", async () => {
    const workspacePayload = createWorkspacePayload();
    const fileUrl =
      "https://wisetechglobal-my.sharepoint.com/:x:/r/personal/michael_kronvold_wisetechglobal_com/Documents/Documents/KPE/Very%20Long%20Maintenance%20Workbook%202026%20Final%20Review.xlsx?d=wb762eb1726a84dcaa6cab3df556a0cfb&csf=1&web=1&e=rhQ0Pg";

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      references: fileUrl,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reference = screen.getByRole("link", {
      name: "Very Long Maintenance Workbook 2... ↗",
    });

    expect(reference).toHaveAttribute("href", fileUrl);
    expect(reference).toHaveAttribute("target", "_blank");
    expect(reference.getAttribute("rel")).toContain("noopener");
    expect(reference.getAttribute("rel")).toContain("noreferrer");
  });

  it("renders multiple references one per line with URLs and plain text", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      references:
        "https://tracker.example.com/projects/roadmap-refresh?tab=board#milestones\nLoop board - roadmap refresh",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    expect(
      within(projectCard!).getByText("Loop board - roadmap refresh"),
    ).toBeInTheDocument();
    expect(
      within(projectCard!).getByRole("link", {
        name: "tracker.example.com/projects/roa... ↗",
      }),
    ).toBeInTheDocument();
  });

  it("includes multiline references when creating projects", async () => {
    const workspacePayload = createWorkspacePayload();
    const references =
      "Loop board - launch planning\nhttps://tracker.example.com/projects/launch-planning?view=board";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects") && init?.method === "POST") {
          expect(init.body).toBe(
            JSON.stringify({
              title: "Launch planning",
              notes: "",
              references: references,
              ownerUserId: "user-1",
              dueDate: "",
              priority: "medium",
            }),
          );

          workspacePayload.projects.push({
            id: "project-2",
            title: "Launch planning",
            notes: null,
            references: references,
            ownerUserId: "user-1",
            ownerName: "Tavi Editor",
            dueDate: null,
            priority: "medium",
            derivedStatus: "not_started",
            displayStatus: "not_started",
            manualStatus: null,
            taskTotalCount: 0,
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskBlockedCount: 0,
            taskDoneCount: 0,
            taskCanceledCount: 0,
            taskOverdueCount: 0,
            tasks: [],
          });

          return createResponse({ id: "project-2" }, 201);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "New Project" }));

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("References (one per line)"),
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("New project title"), {
      target: { value: "Launch planning" },
    });
    fireEvent.change(screen.getByPlaceholderText("References (one per line)"), {
      target: {
        value: references,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects",
        expect.objectContaining({
          body: JSON.stringify({
            title: "Launch planning",
            notes: "",
            references: references,
            ownerUserId: "user-1",
            dueDate: "",
            priority: "medium",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("includes multiline references when editing projects and uses a textarea", async () => {
    const workspacePayload = createWorkspacePayload();
    const references =
      "Loop board - roadmap v2\nhttps://tracker.example.com/projects/roadmap-v2?tab=overview";
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects/project-1") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              title: "Roadmap refresh",
              notes: "Awaiting dependency",
              references: references,
              ownerUserId: "user-1",
              dueDate: "",
              priority: "medium",
              manualStatus: "blocked",
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            references: references,
          };

          return createResponse(workspacePayload.projects[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    const referencesInput = within(projectCard!).getByDisplayValue(
      "https://tracker.example.com/projects/roadmap-refresh",
    );

    expect(referencesInput.tagName).toBe("TEXTAREA");
    expect(referencesInput).toHaveClass("resizable-notes");

    fireEvent.change(referencesInput, {
      target: { value: references },
    });
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        expect.objectContaining({
          body: JSON.stringify({
            title: "Roadmap refresh",
            notes: "Awaiting dependency",
            references: references,
            ownerUserId: "user-1",
            dueDate: "",
            priority: "medium",
            manualStatus: "blocked",
          }),
          method: "PATCH",
        }),
      );
    });
  });

  it("keeps convert guidance off the main project edit form", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    const convertButton = within(projectCard!).getByRole("button", {
      name: "Convert to Task",
    });

    expect(convertButton).toBeDisabled();
    expect(convertButton).toHaveAttribute(
      "title",
      "Move or delete this project's 2 active tasks before converting it into a task.",
    );
    expect(
      within(projectCard!).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();
  });

  it("opens project edit mode on control-click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");
    const projectRow = projectCard?.querySelector(".project-row");

    expect(projectCard).not.toBeNull();
    expect(projectRow).not.toBeNull();
    fireEvent.click(projectRow!, { ctrlKey: true });

    await waitFor(() => {
      expect(
        within(projectCard!).getByDisplayValue("Roadmap refresh"),
      ).toBeInTheDocument();
    });
  });

  it("toggles project expansion when clicking the project row", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");
    const projectRow = projectCard?.querySelector(".project-row");

    expect(projectCard).not.toBeNull();
    expect(projectRow).not.toBeNull();
    expect(within(projectCard!).queryByText("Kickoff")).not.toBeInTheDocument();

    fireEvent.click(projectRow!);

    await waitFor(() => {
      expect(within(projectCard!).getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(projectRow!);

    await waitFor(() => {
      expect(
        within(projectCard!).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });
  });

  it("scrolls the inline project editor into view when editing starts", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard!).getByDisplayValue("Roadmap refresh"),
      ).toBeInTheDocument();
    });

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("deletes a project from the inline project editor", async () => {
    const workspacePayload = createWorkspacePayload();
    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects/project-1") && init?.method === "DELETE") {
          workspacePayload.projects = [];
          return createResponse({
            id: "project-1",
            archivedTaskCount: 2,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Delete" }),
    );

    expect(confirmMock).toHaveBeenCalledWith(
      'Delete project "Roadmap refresh" and remove its 2 tasks from the workspace?',
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.queryByText("Roadmap refresh")).not.toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'Deleted project "Roadmap refresh" and 2 tasks from the workspace.',
      ),
    ).toBeInTheDocument();
  });

  it("disables project conversion while a project still has active tasks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    const convertButton = within(projectCard!).getByRole("button", {
      name: "Convert to Task",
    });

    expect(convertButton).toBeDisabled();
    expect(convertButton).toHaveAttribute(
      "title",
      "Move or delete this project's 2 active tasks before converting it into a task.",
    );
    expect(
      within(projectCard!).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();
  });

  it("converts a taskless project into a task inside Unassigned", async () => {
    const workspacePayload = createWorkspacePayload();
    let convertBody: string | null = null;

    workspacePayload.projects[0] = {
      ...workspacePayload.projects[0],
      taskTotalCount: 0,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      tasks: [],
    };

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/projects/project-1/convert-to-task") &&
          init?.method === "POST"
        ) {
          convertBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects = [
            {
              id: "project-unassigned",
              title: "Unassigned",
              notes: null,
              references: null,
              ownerUserId: "user-1",
              ownerName: "Tavi Editor",
              dueDate: null,
              priority: "medium",
              derivedStatus: "blocked",
              displayStatus: "blocked",
              manualStatus: null,
              taskTotalCount: 1,
              taskTodoCount: 0,
              taskInProgressCount: 0,
              taskBlockedCount: 1,
              taskDoneCount: 0,
              taskCanceledCount: 0,
              taskOverdueCount: 0,
              tasks: [
                {
                  id: "task-3",
                  projectId: "project-unassigned",
                  title: "Roadmap refresh",
                  notes: "Awaiting dependency",
                  assigneeUserId: "user-1",
                  assigneeName: "Tavi Editor",
                  dueDate: null,
                  priority: "medium",
                  status: "blocked",
                  sortOrder: 0,
                  completedAt: null,
                },
              ],
            },
          ];

          return createResponse({
            projectId: "project-unassigned",
            taskId: "task-3",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Convert to Task" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Unassigned")).toBeInTheDocument();
    });

    const unassignedProject = screen.getByText("Unassigned").closest("article");

    expect(unassignedProject).not.toBeNull();
    expect(
      within(unassignedProject!).getByText("Roadmap refresh"),
    ).toBeInTheDocument();
    expect(JSON.parse(convertBody ?? "{}")).toEqual({
      title: "Roadmap refresh",
      notes: "Awaiting dependency",
      references: "https://tracker.example.com/projects/roadmap-refresh",
      ownerUserId: "user-1",
      dueDate: "",
      priority: "medium",
      manualStatus: "blocked",
    });
    expect(
      screen.getByText(
        'Converted project "Roadmap refresh" into a task in Unassigned.',
      ),
    ).toBeInTheDocument();
  });

  it("persists workspace panel toggles across reloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "New Project" }));

    await waitFor(() => {
      expect(screen.getByLabelText("My view")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("New project title"),
      ).toBeInTheDocument();
    });

    expect(
      JSON.parse(localStorage.getItem("tavi.workspace.panels") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        newProject: true,
        view: true,
      }),
    );

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByLabelText("My view")).toBeInTheDocument();
      expect(
        screen.getByPlaceholderText("New project title"),
      ).toBeInTheDocument();
    });
  });

  it("persists grouped collapse state for each group-by mode across reloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createSortedWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    toggleGroupByTitle("Tavi Viewer");

    await waitFor(() => {
      expect(screen.queryByText("Beta rollout")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "status" },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "done" })).toBeInTheDocument();
      expect(screen.getByText("Alpha planning")).toBeInTheDocument();
    });

    toggleGroupByTitle("done");

    await waitFor(() => {
      expect(screen.queryByText("Alpha planning")).not.toBeInTheDocument();
    });

    expect(
      JSON.parse(
        localStorage.getItem("tavi.workspace.collapsedGroups") ?? "{}",
      ),
    ).toEqual(
      expect.objectContaining({
        owner: {
          "Tavi Viewer": true,
        },
        status: {
          done: true,
        },
      }),
    );

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "owner" },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Tavi Viewer" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Beta rollout")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "status" },
    });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "done" })).toBeInTheDocument();
      expect(screen.queryByText("Alpha planning")).not.toBeInTheDocument();
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "done" })).toBeInTheDocument();
      expect(screen.queryByText("Alpha planning")).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Group by"), {
      target: { value: "owner" },
    });

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Tavi Viewer" }),
      ).toBeInTheDocument();
      expect(screen.queryByText("Beta rollout")).not.toBeInTheDocument();
    });
  });

  it("persists workspace preference toggles across reloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(document.documentElement).toHaveAttribute("data-theme", "light");

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const darkModeSwitch = screen.getByRole("switch", { name: "Dark mode" });
    const autoCollapseSwitch = screen.getByRole("switch", {
      name: "Auto Collapse",
    });
    const bulkActionsSwitch = screen.getByRole("switch", {
      name: "Bulk Actions",
    });
    const fullWidthSwitch = screen.getByRole("switch", {
      name: "Full Width",
    });
    const workspaceShell = screen.getByRole("main");

    expect(darkModeSwitch).not.toBeChecked();
    expect(autoCollapseSwitch).toBeChecked();
    expect(bulkActionsSwitch).toBeChecked();
    expect(fullWidthSwitch).not.toBeChecked();
    expect(workspaceShell).not.toHaveClass("workspace-shell--full-width");

    fireEvent.click(darkModeSwitch);
    fireEvent.click(autoCollapseSwitch);
    fireEvent.click(bulkActionsSwitch);
    fireEvent.click(fullWidthSwitch);

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
      expect(workspaceShell).toHaveClass("workspace-shell--full-width");
      expect(
        JSON.parse(localStorage.getItem("tavi.workspace.preferences") ?? "{}"),
      ).toEqual({
        autoCollapse: false,
        bulkActions: false,
        fullWidth: true,
        theme: "dark",
      });
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const settingsButton = screen.getByRole("button", { name: "Settings" });

    if (settingsButton.getAttribute("aria-pressed") !== "true") {
      fireEvent.click(settingsButton);
    }

    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("switch", { name: "Dark mode" })).toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Auto Collapse" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("switch", { name: "Bulk Actions" }),
    ).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Full Width" })).toBeChecked();
    expect(screen.getByRole("main")).toHaveClass("workspace-shell--full-width");
  });

  it("keeps the global email notifications toggle in sync after saving", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    let emailSettingsRequestBody: string | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/auth/email/status")) {
          return createResponse({
            configured: true,
            dailyDigestTime: "14:30",
            enabled: true,
            fromAddress: "noreply@tavi.local",
            host: "10.120.64.99",
            port: 25,
            secure: false,
          });
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "14:30",
          });
        }

        if (url.endsWith("/auth/email/settings") && init?.method === "PUT") {
          emailSettingsRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse({
            configured: true,
            dailyDigestTime: "14:30",
            enabled: false,
            fromAddress: "noreply@tavi.local",
            host: "10.120.64.99",
            port: 25,
            secure: false,
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByText("smtp://10.120.64.99:25")).toBeInTheDocument();
    });

    const emailNotificationsSwitch = screen.getByRole("switch", {
      name: "Email Notifications",
    });

    expect(emailNotificationsSwitch).toBeChecked();

    fireEvent.click(emailNotificationsSwitch);

    await waitFor(() => {
      expect(emailSettingsRequestBody).toBe(
        JSON.stringify({ dailyDigestTime: "14:30", enabled: false }),
      );
      expect(emailNotificationsSwitch).not.toBeChecked();
    });
  });

  it("keeps the daily digest toggle in sync after saving", async () => {
    const workspacePayload = createWorkspacePayload();
    let notificationPreferencesRequestBody: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/auth/notification/preferences") &&
          init?.method === "PUT"
        ) {
          notificationPreferencesRequestBody =
            typeof init.body === "string" ? init.body : null;
          return createResponse({
            dailyDigestEnabled: true,
            dailyDigestTime: "14:30",
          });
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "14:30",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const dailyDigestSwitch = screen.getByRole("switch", {
      name: "Daily Digest",
    });

    await waitFor(() => {
      expect(dailyDigestSwitch).not.toBeDisabled();
    });

    expect(dailyDigestSwitch).not.toBeChecked();

    fireEvent.click(dailyDigestSwitch);

    await waitFor(() => {
      expect(notificationPreferencesRequestBody).toBe(
        JSON.stringify({ dailyDigestEnabled: true }),
      );
      expect(dailyDigestSwitch).toBeChecked();
    });
  });

  it("hides the email notifications toggle for non-admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "09:00",
          });
        }

        return createResponse(createWorkspacePayload());
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    expect(
      screen.queryByRole("switch", { name: "Email Notifications" }),
    ).not.toBeInTheDocument();
  });

  it("shows settings cards in the requested order and links the version tile to the repo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/auth/email/status")) {
          return createResponse({
            configured: true,
            dailyDigestTime: "09:00",
            enabled: true,
            fromAddress: "noreply@tavi.local",
            host: "10.120.64.99",
            port: 25,
            secure: false,
          });
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "09:00",
          });
        }

        return createResponse(createAdminWorkspacePayload());
      }),
    );

    const { container } = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const settingsItems = Array.from(
      container.querySelectorAll(".settings-grid > .settings-item"),
    );

    expect(settingsItems).not.toHaveLength(0);
    expect(settingsItems).toHaveLength(14);
    expect(settingsItems[0]?.textContent).toContain("Theme");
    expect(settingsItems[1]?.textContent).toContain("Auto Collapse");
    expect(settingsItems[2]?.textContent).toContain("Bulk Actions");
    expect(settingsItems[3]?.textContent).toContain("Full Width");
    expect(settingsItems[4]?.textContent).toContain("Daily Digest");
    expect(settingsItems[5]?.textContent).toContain("Clear Local Storage");
    expect(settingsItems[6]?.textContent).toContain("My Auth History");
    expect(settingsItems[7]?.textContent).toContain("Email Notifications");
    expect(settingsItems[8]?.textContent).toContain("Daily Digest Time");
    expect(settingsItems[9]?.textContent).toContain("Backups");
    expect(settingsItems[10]?.textContent).toContain("Import/Export");
    expect(settingsItems[11]?.textContent).toContain("Local Accounts");
    expect(settingsItems[12]?.textContent).toContain("Audit logins");
    expect(settingsItems[13]?.textContent).toContain("Audit changes");
    expect(screen.getByRole("link", { name: "github" })).toHaveAttribute(
      "href",
      appRepositoryUrl,
    );
    await waitFor(() => {
      expect(screen.getByText("smtp://10.120.64.99:25")).toBeInTheDocument();
      expect(screen.getByText("noreply@tavi.local")).toBeInTheDocument();
    });
  });

  it("opens import/export and backups panels from settings cards and closes them from panel headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(createAdminWorkspacePayload());
        }

        if (url.endsWith("/auth/email/status")) {
          return createResponse({
            configured: true,
            dailyDigestTime: "09:00",
            enabled: true,
            fromAddress: "noreply@tavi.local",
            host: "10.120.64.99",
            port: 25,
            secure: false,
          });
        }

        if (url.endsWith("/auth/notification/preferences")) {
          return createResponse({
            dailyDigestEnabled: false,
            dailyDigestTime: "09:00",
          });
        }

        if (url.endsWith("/backups")) {
          return createResponse({
            backupDirectory: "/var/tavi/backups",
            backupDirectoryAccessible: true,
            backups: [],
            enabled: true,
            lastError: null,
            lastFailureAt: null,
            lastSuccessAt: null,
            scheduleTime: "02:00",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const importExportCard =
      screen.getByText("Import/Export").closest(".settings-item");
    const backupsCard = screen.getByText("Backups").closest(".settings-item");

    expect(importExportCard).not.toBeNull();
    expect(backupsCard).not.toBeNull();

    fireEvent.click(importExportCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Download the current filtered workspace as CSV, XLSX, JSON, or a Loop-oriented CSV.",
        ),
      ).toBeInTheDocument();
    });

    const exportPanel = screen.getByText("Export").closest(".workspace-panel-card");
    const importPanel =
      screen.getByText("CSV import").closest(".toolbar-card");

    expect(exportPanel).not.toBeNull();
    expect(importPanel).not.toBeNull();
    expect(
      within(exportPanel as HTMLElement).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();
    expect(
      within(importPanel as HTMLElement).getByRole("button", { name: "Close" }),
    ).toBeInTheDocument();

    fireEvent.click(backupsCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Configure scheduled snapshots and preview restore changes.",
        ),
      ).toBeInTheDocument();
    });

    const backupsPanel = screen
      .getByText("Configure scheduled snapshots and preview restore changes.")
      .closest(".workspace-panel-card");

    expect(backupsPanel).not.toBeNull();

    fireEvent.click(
      within(backupsPanel as HTMLElement).getByRole("button", { name: "Close" }),
    );
    fireEvent.click(
      within(exportPanel as HTMLElement).getByRole("button", { name: "Close" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Download the current filtered workspace as CSV, XLSX, JSON, or a Loop-oriented CSV.",
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          "Configure scheduled snapshots and preview restore changes.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("toggles the local accounts panel from the settings card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const { container } = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const localAccountsCard =
      screen.getByText("Local Accounts").closest(".settings-item");

    expect(localAccountsCard).not.toBeNull();
    fireEvent.click(localAccountsCard as HTMLElement);

    await waitFor(() => {
      expect(container.querySelector(".local-accounts-panel")).not.toBeNull();
    });

    fireEvent.click(localAccountsCard as HTMLElement);

    await waitFor(() => {
      expect(container.querySelector(".local-accounts-panel")).toBeNull();
    });
  });

  it("toggles my auth history from the settings card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.includes("/audit/auth/user-1")) {
          return createResponse([]);
        }

        return createResponse(createWorkspacePayload());
      }),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const authHistoryCard =
      screen.getByText("My Auth History").closest(".settings-item");

    expect(authHistoryCard).not.toBeNull();
    fireEvent.click(authHistoryCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "My Auth History" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(authHistoryCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "My Auth History" }),
      ).not.toBeInTheDocument();
    });
  });

  it("persists the per-project add task toggle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });

    expect(
      JSON.parse(localStorage.getItem("tavi.workspace.projectAddTask") ?? "{}"),
    ).toEqual(
      expect.objectContaining({
        "project-1": true,
      }),
    );

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reloadedProjectCard = screen
      .getByText("Roadmap refresh")
      .closest("article");

    expect(reloadedProjectCard).not.toBeNull();
    expect(
      within(reloadedProjectCard!).getByRole("button", { name: "Add Task" }),
    ).toHaveAttribute("aria-pressed", "true");

    const expandButton = reloadedProjectCard?.querySelector(
      "button.group-toggle",
    );

    expect(expandButton).toBeTruthy();
    fireEvent.click(expandButton!);

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });
  });

  it("keeps the last assignee and priority when adding tasks consecutively", async () => {
    const workspacePayload = createWorkspacePayload();
    let createBody: string | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/projects/project-1/tasks") &&
          init?.method === "POST"
        ) {
          createBody = typeof init.body === "string" ? init.body : null;

          const payload = JSON.parse(createBody ?? "{}") as {
            assigneeUserId?: string;
            notes?: string;
            priority?: "low" | "medium" | "high";
            status?: string;
            title?: string;
          };

          workspacePayload.projects[0]!.tasks.push({
            id: "task-3",
            projectId: "project-1",
            title: payload.title ?? "",
            notes: payload.notes ?? null,
            assigneeUserId: payload.assigneeUserId ?? "user-1",
            assigneeName:
              payload.assigneeUserId === "user-2"
                ? "Tavi Viewer"
                : "Tavi Editor",
            dueDate: null,
            priority: payload.priority ?? "medium",
            status: payload.status === "done" ? "done" : "todo",
            sortOrder: 2,
            completedAt: null,
            createdAt: "2026-04-03T09:00:00.000Z",
            updatedAt: "2026-04-03T09:00:00.000Z",
          });
          workspacePayload.projects[0]!.taskTotalCount += 1;
          workspacePayload.projects[0]!.taskTodoCount += 1;

          return createResponse(workspacePayload.projects[0]!.tasks[2]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("New task title")).toBeInTheDocument();
    });

    const titleInput = screen.getByPlaceholderText(
      "New task title",
    ) as HTMLInputElement;
    const taskCreateRow = titleInput.closest("tr");

    expect(taskCreateRow).not.toBeNull();
    if (!(taskCreateRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected add-task row");
    }

    fireEvent.change(titleInput, {
      target: { value: "Prepare handoff" },
    });
    fireEvent.change(within(taskCreateRow).getByDisplayValue("Tavi Editor"), {
      target: { value: "user-2" },
    });
    fireEvent.change(within(taskCreateRow).getByDisplayValue("Medium"), {
      target: { value: "high" },
    });
    fireEvent.click(within(taskCreateRow).getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(screen.getByText("Prepare handoff")).toBeInTheDocument();
    });

    const refreshedTitleInput = screen.getByPlaceholderText(
      "New task title",
    ) as HTMLInputElement;
    const refreshedTaskCreateRow = refreshedTitleInput.closest("tr");

    expect(refreshedTaskCreateRow).not.toBeNull();
    if (!(refreshedTaskCreateRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected refreshed add-task row");
    }

    expect(createBody).toContain('"assigneeUserId":"user-2"');
    expect(createBody).toContain('"priority":"high"');
    expect(refreshedTitleInput).toHaveValue("");
    expect(
      within(refreshedTaskCreateRow).getByDisplayValue("Tavi Viewer"),
    ).toHaveValue(
      "user-2",
    );
    expect(
      within(refreshedTaskCreateRow).getByDisplayValue("High"),
    ).toHaveValue("high");
    expect(
      within(refreshedTaskCreateRow).getByDisplayValue("Todo"),
    ).toHaveValue("todo");
  });

  it("reorders tasks with the drag handle and saves the new order", async () => {
    const workspacePayload = createWorkspacePayload();
    let reorderBody: string | null = null;

    workspacePayload.projects[0]!.tasks.push({
      id: "task-3",
      projectId: "project-1",
      title: "Share update",
      notes: "Notify stakeholders",
      assigneeUserId: "user-1",
      assigneeName: "Tavi Editor",
      dueDate: null,
      priority: "low",
      status: "todo",
      sortOrder: 2,
      completedAt: null,
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T09:00:00.000Z",
    });
    workspacePayload.projects[0]!.taskTotalCount = 3;
    workspacePayload.projects[0]!.taskTodoCount = 2;
    workspacePayload.projects[0]!.taskInProgressCount = 1;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/projects/project-1/tasks/reorder") &&
          init?.method === "PATCH"
        ) {
          reorderBody = typeof init.body === "string" ? init.body : null;
          const payload = JSON.parse(reorderBody ?? "{}") as {
            taskIds?: string[];
          };
          const taskById = new Map(
            workspacePayload.projects[0]!.tasks.map((task) => [task.id, task] as const),
          );

          workspacePayload.projects[0]!.tasks =
            payload.taskIds?.map((taskId, index) => ({
              ...taskById.get(taskId)!,
              sortOrder: index,
            })) ?? workspacePayload.projects[0]!.tasks;

          return createResponse({ success: true });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
      expect(screen.getByText("Share update")).toBeInTheDocument();
    });

    const kickoffHandle = screen.getByRole("button", {
      name: "Drag to reorder Kickoff",
    });
    const reviewPlanRow = screen.getByText("Review plan").closest("tr");

    expect(reviewPlanRow).not.toBeNull();
    if (!(reviewPlanRow instanceof HTMLTableRowElement)) {
      throw new Error("Expected target task row");
    }

    reviewPlanRow.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 40,
        left: 0,
        right: 400,
        top: 0,
        width: 400,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const dataTransfer = {
      dropEffect: "move",
      effectAllowed: "move",
      getData: vi.fn(() => "task-1"),
      setData: vi.fn(),
    } as unknown as DataTransfer;

    fireEvent.dragStart(kickoffHandle, { dataTransfer });
    fireEvent.dragOver(reviewPlanRow, { clientY: 30, dataTransfer });
    fireEvent.drop(reviewPlanRow, { clientY: 30, dataTransfer });
    fireEvent.dragEnd(kickoffHandle, { dataTransfer });

    await waitFor(() => {
      expect(reorderBody).toContain('"taskIds":["task-2","task-1","task-3"]');
    });

    const reorderedTaskTitles = Array.from(
      projectCard.querySelectorAll(".task-table tbody tr strong"),
    ).map((element) => element.textContent?.trim());

    expect(reorderedTaskTitles).toEqual([
      "Review plan",
      "Kickoff",
      "Share update",
    ]);
  });

  it("keeps the project open while editing tasks with compact aligned actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
      expect(within(projectCard).getByText("Review plan")).toBeInTheDocument();
    });

    const projectToggle = projectCard.querySelector("button.group-toggle");
    const editingRow = within(projectCard)
      .getByDisplayValue("Kickoff")
      .closest("tr");

    expect(editingRow).not.toBeNull();
    expect(projectToggle).toHaveTextContent("-");
    expect(editingRow?.querySelector("td[colspan]")).toBeNull();
    expect(editingRow?.querySelectorAll("td")).toHaveLength(8);
    expect(
      within(editingRow!).getByRole("button", { name: "Save" }),
    ).toHaveClass("mini-button");
    expect(
      within(editingRow!).getByRole("button", {
        name: "Cancel editing task",
      }),
    ).toHaveTextContent("X");
  });

  it("persists the project note editor height in local storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard!).getByPlaceholderText("Project notes"),
      ).toBeInTheDocument();
    });

    const projectNotes = within(projectCard!).getByPlaceholderText(
      "Project notes",
    ) as HTMLTextAreaElement;
    let projectNotesHeight = 72;

    mockElementHeight(projectNotes, () => projectNotesHeight);
    fireEvent.pointerDown(projectNotes);
    projectNotesHeight = 180;
    fireEvent.pointerUp(projectNotes);

    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem("tavi.workspace.noteEditorHeights") ?? "{}",
        ),
      ).toEqual(
        expect.objectContaining({
          project: 180,
        }),
      );
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reloadedProjectCard = screen
      .getByText("Roadmap refresh")
      .closest("article");

    expect(reloadedProjectCard).not.toBeNull();
    fireEvent.click(
      within(reloadedProjectCard!).getByRole("button", { name: "Edit" }),
    );

    await waitFor(() => {
      expect(
        within(reloadedProjectCard!).getByPlaceholderText("Project notes"),
      ).toHaveStyle({ height: "180px" });
    });
  });

  it("persists the task note editor height in local storage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    const firstRender = renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByPlaceholderText("Task notes"),
      ).toBeInTheDocument();
    });

    const taskNotes = within(projectCard).getByPlaceholderText(
      "Task notes",
    ) as HTMLTextAreaElement;
    let taskNotesHeight = 72;

    mockElementHeight(taskNotes, () => taskNotesHeight);
    fireEvent.pointerDown(taskNotes);
    taskNotesHeight = 156;
    fireEvent.pointerUp(taskNotes);

    await waitFor(() => {
      expect(
        JSON.parse(
          localStorage.getItem("tavi.workspace.noteEditorHeights") ?? "{}",
        ),
      ).toEqual(
        expect.objectContaining({
          task: 156,
        }),
      );
    });

    firstRender.unmount();
    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const reloadedProjectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const reloadedKickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(reloadedKickoffRow).not.toBeNull();
    fireEvent.click(
      within(reloadedKickoffRow!).getByRole("button", { name: "Edit" }),
    );

    await waitFor(() => {
      expect(
        within(reloadedProjectCard).getByPlaceholderText("Task notes"),
      ).toHaveStyle({ height: "156px" });
    });
  });

  it("defers task edit mode so the first click cannot submit the inline save button", async () => {
    const workspacePayload = createWorkspacePayload();
    let queuedAnimationFrame: FrameRequestCallback | null = null;
    let patchBody: string | null = null;
    let patchCount = 0;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchCount += 1;
          patchBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0].tasks[0] = {
            ...workspacePayload.projects[0].tasks[0],
            title: "Kickoff updated",
          };

          return createResponse(workspacePayload.projects[0].tasks[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        queuedAnimationFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    expect(patchCount).toBe(0);
    expect(queuedAnimationFrame).not.toBeNull();
    expect(
      within(projectCard).queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      within(projectCard).queryByDisplayValue("Kickoff"),
    ).not.toBeInTheDocument();

    act(() => {
      queuedAnimationFrame?.(16);
    });

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.change(within(projectCard).getByDisplayValue("Kickoff"), {
      target: { value: "Kickoff updated" },
    });
    fireEvent.click(within(projectCard).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchCount).toBe(1);
      expect(screen.getByText("Kickoff updated")).toBeInTheDocument();
    });

    expect(patchBody).toBe(
      JSON.stringify({
        projectId: "project-1",
        title: "Kickoff updated",
        notes: "Confirm milestone scope",
        assigneeUserId: "user-1",
        dueDate: "",
        priority: "medium",
        status: "todo",
      }),
    );
  });

  it("opens task edit mode on control-click", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(kickoffRow!, { ctrlKey: true });

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });
  });

  it("moves a task to another project from the inline task editor", async () => {
    const workspacePayload = createWorkspacePayload();
    let patchBody: string | null = null;

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 0,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [],
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchBody = typeof init.body === "string" ? init.body : null;

          const movedTask = {
            ...workspacePayload.projects[0].tasks[0],
            projectId: "project-2",
          };

          workspacePayload.projects[0].tasks =
            workspacePayload.projects[0].tasks.filter(
              (task) => task.id !== "task-1",
            );
          workspacePayload.projects[0].taskTotalCount = 1;
          workspacePayload.projects[0].taskTodoCount = 1;
          workspacePayload.projects[1].tasks = [movedTask];
          workspacePayload.projects[1].taskTotalCount = 1;
          workspacePayload.projects[1].taskTodoCount = 1;

          return createResponse(movedTask);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    const sourceProject = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(sourceProject).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.change(
      within(sourceProject).getByRole("combobox", { name: "Project" }),
      {
        target: { value: "project-2" },
      },
    );
    fireEvent.click(
      within(sourceProject).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      expect(
        within(sourceProject).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      const destinationHeading = screen
        .getAllByText("Beta rollout")
        .find((element) => element.closest("article"));

      expect(destinationHeading).toBeDefined();

      const destinationProject = destinationHeading?.closest("article");

      expect(destinationProject).not.toBeNull();
      expect(
        within(destinationProject!).getByText("Kickoff"),
      ).toBeInTheDocument();
    });

    expect(patchBody).toBe(
      JSON.stringify({
        projectId: "project-2",
        title: "Kickoff",
        notes: "Confirm milestone scope",
        assigneeUserId: "user-1",
        dueDate: "",
        priority: "medium",
        status: "todo",
      }),
    );
  });

  it("clears a task assignee to None without leaving the project editor open", async () => {
    const workspacePayload = createWorkspacePayload();
    let patchBody: string | null = null;
    let convertToTaskCount = 0;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "PATCH") {
          patchBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0].tasks[0] = {
            ...workspacePayload.projects[0].tasks[0],
            assigneeUserId: null,
            assigneeName: null,
          };

          return createResponse(workspacePayload.projects[0].tasks[0]);
        }

        if (
          url.endsWith("/projects/project-1/convert-to-task") &&
          init?.method === "POST"
        ) {
          convertToTaskCount += 1;
          return createResponse(
            {
              message:
                "Move or delete this project's 2 active tasks before converting it into a task.",
            },
            400,
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");
    const projectActions = projectCard.querySelector(".project-row-actions");

    expect(projectActions).toBeInstanceOf(HTMLElement);
    if (!(projectActions instanceof HTMLElement)) {
      throw new Error("Expected project actions");
    }
    fireEvent.click(
      within(projectActions).getByRole("button", { name: "Edit" }),
    );

    expect(
      within(projectCard).getByRole("button", { name: "Convert to Task" }),
    ).toHaveAttribute(
      "title",
      "Move or delete this project's 2 active tasks before converting it into a task.",
    );
    expect(
      within(projectCard).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    expect(
      within(projectCard).queryByRole("button", { name: "Convert to Task" }),
    ).not.toBeInTheDocument();
    expect(
      within(projectCard).queryByText(
        "Move or delete this project's 2 active tasks before converting it into a task.",
      ),
    ).not.toBeInTheDocument();

    fireEvent.change(
      within(projectCard).getByRole("combobox", { name: "Assignee" }),
      {
        target: { value: "" },
      },
    );
    fireEvent.click(within(projectCard).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchBody).toBe(
        JSON.stringify({
          projectId: "project-1",
          title: "Kickoff",
          notes: "Confirm milestone scope",
          assigneeUserId: null,
          dueDate: "",
          priority: "medium",
          status: "todo",
        }),
      );
    });

    expect(convertToTaskCount).toBe(0);
  });

  it("scrolls the inline task editor into view when editing starts", async () => {
    const workspacePayload = createWorkspacePayload();
    const scrollIntoViewMock = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    expect(scrollIntoViewMock).toHaveBeenCalled();
  });

  it("converts a task into a project from the inline task editor", async () => {
    const workspacePayload = createWorkspacePayload();
    let convertBody: string | null = null;

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (
          url.endsWith("/tasks/task-1/convert-to-project") &&
          init?.method === "POST"
        ) {
          convertBody = typeof init.body === "string" ? init.body : null;
          workspacePayload.projects[0].tasks =
            workspacePayload.projects[0].tasks.filter(
              (task) => task.id !== "task-1",
            );
          workspacePayload.projects[0].taskTotalCount = 1;
          workspacePayload.projects[0].taskTodoCount = 0;
          workspacePayload.projects[0].taskInProgressCount = 1;
          workspacePayload.projects.push({
            id: "project-2",
            title: "Kickoff project",
            notes: "Confirm milestone scope",
            references: null,
            ownerUserId: "user-1",
            ownerName: "Tavi Editor",
            dueDate: null,
            priority: "medium",
            derivedStatus: "not_started",
            displayStatus: "not_started",
            manualStatus: null,
            taskTotalCount: 0,
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskBlockedCount: 0,
            taskDoneCount: 0,
            taskCanceledCount: 0,
            taskOverdueCount: 0,
            tasks: [],
          });

          return createResponse({
            projectId: "project-2",
            taskId: "task-1",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const sourceProject = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(sourceProject).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.change(within(sourceProject).getByDisplayValue("Kickoff"), {
      target: { value: "Kickoff project" },
    });

    const projectSelect = within(sourceProject).getByRole("combobox", {
      name: "Project",
    }) as HTMLSelectElement;
    const lastOption = projectSelect.options[projectSelect.options.length - 1];

    expect(lastOption.textContent).toBe("Convert to Project");
    fireEvent.change(projectSelect, {
      target: { value: lastOption.value },
    });
    fireEvent.click(
      within(sourceProject).getByRole("button", { name: "Convert" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Kickoff project")).toBeInTheDocument();
      expect(
        within(sourceProject).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });

    expect(JSON.parse(convertBody ?? "{}")).toEqual({
      title: "Kickoff project",
      notes: "Confirm milestone scope",
      assigneeUserId: "user-1",
      dueDate: "",
      priority: "medium",
      status: "todo",
    });
    expect(
      screen.getByText('Converted task "Kickoff project" into a project.'),
    ).toBeInTheDocument();
  });

  it("deletes a task from the inline task editor", async () => {
    const workspacePayload = createWorkspacePayload();
    const confirmMock = vi.fn(() => true);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/task-1") && init?.method === "DELETE") {
          workspacePayload.projects[0].tasks =
            workspacePayload.projects[0].tasks.filter(
              (task) => task.id !== "task-1",
            );
          workspacePayload.projects[0].taskTotalCount = 1;
          workspacePayload.projects[0].taskTodoCount = 0;

          return createResponse({
            id: "task-1",
            projectId: "project-1",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirmMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const projectCard = toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(within(kickoffRow!).getByRole("button", { name: "Edit" }));

    await waitFor(() => {
      expect(
        within(projectCard).getByDisplayValue("Kickoff"),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      within(projectCard).getByRole("button", { name: "Delete" }),
    );

    expect(confirmMock).toHaveBeenCalledWith(
      'Delete task "Kickoff" from the workspace?',
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/tasks/task-1",
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

    await waitFor(() => {
      expect(
        within(projectCard).queryByText("Kickoff"),
      ).not.toBeInTheDocument();
    });

    expect(
      screen.getByText('Deleted task "Kickoff" from the workspace.'),
    ).toBeInTheDocument();
  });

  it("clears only tavi-owned local storage keys from settings", async () => {
    const confirmMock = vi.fn(() => true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
    vi.stubGlobal("confirm", confirmMock);
    window.localStorage.setItem("unrelated", "keep");

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "View" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const projectCard = screen.getByText("Roadmap refresh").closest("article");

    expect(projectCard).not.toBeNull();
    fireEvent.click(
      within(projectCard!).getByRole("button", { name: "Add Task" }),
    );

    await waitFor(() => {
      expect(localStorage.getItem("tavi.workspace.panels")).not.toBeNull();
      expect(
        localStorage.getItem("tavi.workspace.projectAddTask"),
      ).not.toBeNull();
      expect(screen.getByText("Clear Local Storage")).toBeInTheDocument();
    });

    const clearLocalStorageCard =
      screen.getByText("Clear Local Storage").closest(".settings-item");

    expect(clearLocalStorageCard).not.toBeNull();
    fireEvent.click(clearLocalStorageCard as HTMLElement);

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        "Clear all Tavi browser-local preferences stored in this browser?",
      );
      expect(localStorage.getItem("unrelated")).toBe("keep");
      expect(localStorage.getItem("tavi.workspace.panels")).toBeNull();
      expect(localStorage.getItem("tavi.workspace.projectAddTask")).toBeNull();
      expect(
        screen.getByText(/Cleared 2 Tavi browser-local preferences/i),
      ).toBeInTheDocument();
    });
  });

  it("shows admin audit changes with filters and changed values", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const auditRequests: string[] = [];
    const retentionRequests: string[] = [];
    const purgeRequests: string[] = [];
    const auditEvents: AuditHistoryEvent[] = [
      {
        id: "event-1",
        entityType: "task",
        entityId: "task-1",
        action: "update",
        metadata: {
          title: "Kickoff",
          changedFields: ["assigneeUserId", "status"],
          changes: [
            {
              field: "assigneeUserId",
              from: "user-1",
              to: null,
            },
            {
              field: "status",
              from: "todo",
              to: "in_progress",
            },
          ],
        },
        createdAt: "2026-02-01T12:00:00.000Z",
        actor: {
          id: "user-1",
          email: "editor@tavi.local",
          name: "Tavi Editor",
          role: "admin",
        },
      },
    ];
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/audit/retention")) {
          if (method === "PUT") {
            const payload = JSON.parse(String(init?.body ?? "{}")) as {
              olderThan: string;
            };
            retentionRequests.push(payload.olderThan);
            return createResponse({ olderThan: payload.olderThan });
          }

          return createResponse({ olderThan: "six_months" });
        }

        if (url.endsWith("/audit/purge")) {
          const payload = JSON.parse(String(init?.body ?? "{}")) as {
            olderThan: string;
          };
          purgeRequests.push(payload.olderThan);
          return createResponse({ deletedCount: 3 });
        }

        if (url.includes("/audit/changes")) {
          auditRequests.push(url);
          return createResponse(auditEvents);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditChangesCard =
      screen.getByText("Audit changes").closest(".settings-item");

    expect(auditChangesCard).not.toBeNull();
    fireEvent.click(auditChangesCard as HTMLElement);

    const panel = await waitFor(() => {
      const element = screen
        .getByText("Admin-only project and task change history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(within(panel).getByText("Task: Kickoff")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        within(panel).getByText("Automatic log aging: 6 months."),
      ).toBeInTheDocument();
    });

    expect(within(panel).getByText("Tavi Editor -> None")).toBeInTheDocument();
    expect(within(panel).getByText("todo -> in progress")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Export CSV" }),
    ).toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("Log aging"), {
      target: { value: "one_month" },
    });
    fireEvent.click(
      within(panel).getByRole("button", { name: "Set automatic aging" }),
    );

    await waitFor(() => {
      expect(
        within(panel).getByText("Automatic log aging is now set to 1 month."),
      ).toBeInTheDocument();
    });
    expect(retentionRequests).toEqual(["one_month"]);

    fireEvent.click(within(panel).getByRole("button", { name: "Purge logs" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Purge audit logs older than 1 month?",
    );
    await waitFor(() => {
      expect(
        within(panel).getByText("Purged 3 audit events older than 1 month."),
      ).toBeInTheDocument();
    });
    expect(purgeRequests).toEqual(["one_month"]);

    fireEvent.change(within(panel).getByLabelText("Action"), {
      target: { value: "update" },
    });
    fireEvent.change(within(panel).getByLabelText("User"), {
      target: { value: "user-2" },
    });
    fireEvent.change(within(panel).getByLabelText("Search"), {
      target: { value: "Kickoff" },
    });

    await waitFor(() => {
      expect(
        auditRequests.some((requestUrl) => {
          const params = new URL(requestUrl, "http://localhost").searchParams;

          return (
            params.get("action") === "update" &&
            params.get("actorUserId") === "user-2" &&
            params.get("search") === "Kickoff"
          );
        }),
      ).toBe(true);
    });

    fireEvent.click(auditChangesCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.queryByText("Admin-only project and task change history"),
      ).not.toBeInTheDocument();
    });
  });

  it("shows admin audit logins with search and date filters", async () => {
    const workspacePayload = createAdminWorkspacePayload();
    const auditRequests: string[] = [];
    const auditEvents: AuditHistoryEvent[] = [
      {
        id: "event-login-1",
        entityType: "auth",
        entityId: "session-1",
        action: "login",
        metadata: {
          title: "Viewer session",
        },
        createdAt: "2026-02-01T08:30:00.000Z",
        actor: {
          id: "user-2",
          email: "viewer@tavi.local",
          name: "Tavi Viewer",
          role: "viewer",
        },
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/workspace")) {
        return createResponse(workspacePayload);
      }

      if (url.endsWith("/audit/retention")) {
        return createResponse({ olderThan: null });
      }

      if (url.includes("/audit/logins")) {
        auditRequests.push(url);
        return createResponse(auditEvents);
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const auditLoginsCard =
      screen.getByText("Audit logins").closest(".settings-item");

    expect(auditLoginsCard).not.toBeNull();
    fireEvent.click(auditLoginsCard as HTMLElement);

    const panel = await waitFor(() => {
      const element = screen
        .getByText("Admin-only sign-in and sign-out history")
        .closest("section");

      expect(element).not.toBeNull();
      return element!;
    });

    await waitFor(() => {
      expect(
        within(panel).getByText("Tavi Viewer · viewer@tavi.local"),
      ).toBeInTheDocument();
    });
    expect(
      within(panel).getByRole("button", { name: "Purge logs" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "Set automatic aging" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        within(panel).getByText("Automatic log aging is not set."),
      ).toBeInTheDocument();
    });

    expect(within(panel).queryByLabelText("Action")).not.toBeInTheDocument();

    fireEvent.change(within(panel).getByLabelText("User"), {
      target: { value: "user-2" },
    });
    fireEvent.change(within(panel).getByLabelText("From"), {
      target: { value: "2026-02-01" },
    });
    fireEvent.change(within(panel).getByLabelText("Search"), {
      target: { value: "viewer" },
    });

    await waitFor(() => {
      expect(
        auditRequests.some((requestUrl) => {
          const params = new URL(requestUrl, "http://localhost").searchParams;

          return (
            params.get("actorUserId") === "user-2" &&
            params.get("fromDate") === "2026-02-01" &&
            params.get("search") === "viewer"
          );
        }),
      ).toBe(true);
    });

    fireEvent.click(auditLoginsCard as HTMLElement);

    await waitFor(() => {
      expect(
        screen.queryByText("Admin-only sign-in and sign-out history"),
      ).not.toBeInTheDocument();
    });
  });

  it("auto-collapses projects by default and keeps them open when disabled", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 1,
      taskTodoCount: 1,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Draft brief",
          notes: "Confirm the launch checklist",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "high",
          status: "todo",
          sortOrder: 0,
          completedAt: null,
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    toggleProjectByTitle("Beta rollout");

    await waitFor(() => {
      expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto Collapse" }));

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
    });
  });

  it("uses tighter card spacing only while a project is collapsed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const collapsedProjectCard = screen
      .getByText("Roadmap refresh")
      .closest("article");

    expect(collapsedProjectCard).not.toBeNull();
    expect(collapsedProjectCard).toHaveClass("project-card--collapsed");

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(collapsedProjectCard).not.toHaveClass("project-card--collapsed");
    });
  });

  it("toggles done tasks inside an expanded project without keeping hidden selections", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects[0]?.tasks.push({
      id: "task-3",
      projectId: "project-1",
      title: "Ship recap",
      notes: "Already wrapped",
      assigneeUserId: "user-1",
      assigneeName: "Tavi Editor",
      dueDate: null,
      priority: "low",
      status: "done",
      sortOrder: 2,
      completedAt: "2026-04-03T10:00:00.000Z",
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
    });
    workspacePayload.projects[0]!.taskTotalCount = 3;
    workspacePayload.projects[0]!.taskDoneCount = 1;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Review plan")).toBeInTheDocument();
      expect(screen.getByText("Ship recap")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Ship recap"));

    await waitFor(() => {
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Hide done tasks in Roadmap refresh" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Ship recap")).not.toBeInTheDocument();
      expect(screen.queryByText("1 selected task")).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select all tasks in Roadmap refresh"));

    await waitFor(() => {
      expect(screen.getByText("2 selected tasks")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Show done tasks in Roadmap refresh" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Ship recap")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Select task Kickoff")).toBeChecked();
    expect(screen.getByLabelText("Select task Review plan")).toBeChecked();
    expect(screen.getByLabelText("Select task Ship recap")).not.toBeChecked();
  });

  it("clears selected tasks for a collapsed project without affecting other open projects", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      notes: null,
      references: null,
      ownerUserId: "user-2",
      ownerName: "Tavi Viewer",
      dueDate: null,
      priority: "high",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 1,
      taskTodoCount: 1,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      tasks: [
        {
          id: "task-3",
          projectId: "project-2",
          title: "Draft brief",
          notes: "Confirm the launch checklist",
          assigneeUserId: "user-2",
          assigneeName: "Tavi Viewer",
          dueDate: null,
          priority: "high",
          status: "todo",
          sortOrder: 0,
          completedAt: null,
        },
      ],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(workspacePayload)),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Beta rollout")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("switch", { name: "Auto Collapse" }));

    toggleProjectByTitle("Roadmap refresh");
    toggleProjectByTitle("Beta rollout");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Draft brief")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByLabelText("Select all tasks in Roadmap refresh"),
    );
    fireEvent.click(screen.getByLabelText("Select all tasks in Beta rollout"));

    await waitFor(() => {
      expect(screen.getByText("3 selected tasks")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });

    expect(
      screen.getByLabelText("Select all tasks in Beta rollout"),
    ).toBeChecked();

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    expect(
      screen.getByLabelText("Select all tasks in Roadmap refresh"),
    ).not.toBeChecked();
    expect(screen.getByLabelText("Select task Kickoff")).not.toBeChecked();
    expect(screen.getByLabelText("Select task Review plan")).not.toBeChecked();
    expect(screen.getByLabelText("Select task Draft brief")).toBeChecked();
  });

  it("hides bulk actions UI and clears task selection when bulk actions is disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));

    await waitFor(() => {
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    const bulkActionsSwitch = screen.getByRole("switch", {
      name: "Bulk Actions",
    });

    fireEvent.click(bulkActionsSwitch);

    await waitFor(() => {
      expect(screen.queryByText("1 selected task")).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Select task Kickoff"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("Select all tasks in Roadmap refresh"),
      ).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("switch", { name: "Bulk Actions" }));

    await waitFor(() => {
      expect(screen.getByLabelText("Select task Kickoff")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Select task Kickoff")).not.toBeChecked();
    expect(
      screen.getByLabelText("Select all tasks in Roadmap refresh"),
    ).not.toBeChecked();
    expect(screen.queryByText("1 selected task")).not.toBeInTheDocument();
  });

  it("clears project overrides from the project row action", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/projects/project-1") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              manualStatus: null,
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            displayStatus: "in_progress",
            manualStatus: null,
          };

          return createResponse(workspacePayload.projects[0]);
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        expect.objectContaining({
          body: JSON.stringify({
            manualStatus: null,
          }),
          method: "PATCH",
        }),
      );
    });
  });

  it("shows audit history and applies bulk task updates", async () => {
    const workspacePayload = createWorkspacePayload();
    let auditEvents: AuditHistoryEvent[] = [
      {
        id: "event-1",
        entityType: "task",
        entityId: "task-1",
        action: "update",
        metadata: {
          changedFields: ["status"],
          status: "in_progress",
        },
        createdAt: "2026-02-01T12:00:00.000Z",
        actor: {
          id: "user-1",
          email: "editor@tavi.local",
          name: "Tavi Editor",
          role: "editor",
        },
      },
    ];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.includes("/audit/task/task-1")) {
          return createResponse(auditEvents);
        }

        if (url.endsWith("/tasks/bulk") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              status: "done",
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            derivedStatus: "done",
            displayStatus: "blocked",
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskDoneCount: 2,
            tasks: workspacePayload.projects[0].tasks.map((task) => ({
              ...task,
              status: "done",
              completedAt: "2026-02-01T14:00:00.000Z",
            })),
          };
          auditEvents = [
            {
              id: "event-2",
              entityType: "task",
              entityId: "task-1",
              action: "bulk_update",
              metadata: {
                changedFields: ["status"],
                selectionSize: 2,
                status: "done",
              },
              createdAt: "2026-02-01T14:00:00.000Z",
              actor: {
                id: "user-1",
                email: "editor@tavi.local",
                name: "Tavi Editor",
                role: "editor",
              },
            },
            ...auditEvents,
          ];

          return createResponse({
            updatedCount: 2,
            updatedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      const projectCard = screen
        .getByText("Roadmap refresh")
        .closest("article");
      const expandButton = projectCard?.querySelector("button.group-toggle");

      expect(expandButton).toBeTruthy();
      fireEvent.click(expandButton!);
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    const kickoffRow = screen.getByText("Kickoff").closest("tr");

    expect(kickoffRow).not.toBeNull();
    fireEvent.click(
      within(kickoffRow!).getByRole("button", { name: "History" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Task history · Kickoff")).toBeInTheDocument();
      expect(screen.getByText("Status in progress")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.change(within(bulkCard!).getByLabelText("Status"), {
      target: { value: "done" },
    });
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
      expect(screen.getByText("2 tasks selected")).toBeInTheDocument();
      expect(screen.getByText("Status done")).toBeInTheDocument();
    });
  });

  it("clears task notes through bulk task actions", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              notes: null,
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            tasks: workspacePayload.projects[0].tasks.map((task) => ({
              ...task,
              notes: null,
            })),
          };

          return createResponse({
            updatedCount: 2,
            updatedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.change(within(bulkCard!).getByLabelText("Notes"), {
      target: { value: "clear" },
    });
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
    });
  });

  it("clears task assignees through bulk task actions", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              assigneeUserId: null,
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            tasks: workspacePayload.projects[0].tasks.map((task) => ({
              ...task,
              assigneeUserId: null,
              assigneeName: null,
            })),
          };

          return createResponse({
            updatedCount: 2,
            updatedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.change(within(bulkCard!).getByLabelText("Assignee"), {
      target: { value: "__none__" },
    });
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Apply" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
    });

    expect(screen.getAllByText("None").length).toBeGreaterThanOrEqual(2);
  });

  it("copies selected tasks to another project through bulk task actions", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Operations uplift",
      notes: null,
      references: null,
      ownerUserId: null,
      ownerName: null,
      dueDate: null,
      priority: "low",
      derivedStatus: "not_started",
      displayStatus: "not_started",
      manualStatus: null,
      taskTotalCount: 0,
      taskTodoCount: 0,
      taskInProgressCount: 0,
      taskBlockedCount: 0,
      taskDoneCount: 0,
      taskCanceledCount: 0,
      taskOverdueCount: 0,
      createdAt: "2026-04-03T09:00:00.000Z",
      updatedAt: "2026-04-03T10:00:00.000Z",
      tasks: [],
    });

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk/copy") && init?.method === "POST") {
          expect(init.body).toBe(
            JSON.stringify({
              targetProjectId: "project-2",
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[1] = {
            ...workspacePayload.projects[1],
            derivedStatus: "in_progress",
            displayStatus: "in_progress",
            taskTotalCount: 2,
            taskTodoCount: 1,
            taskInProgressCount: 1,
            updatedAt: "2026-04-03T11:00:00.000Z",
            tasks: [
              {
                ...workspacePayload.projects[0].tasks[0],
                id: "task-3",
                projectId: "project-2",
                sortOrder: 0,
                createdAt: "2026-04-03T11:00:00.000Z",
                updatedAt: "2026-04-03T11:00:00.000Z",
              },
              {
                ...workspacePayload.projects[0].tasks[1],
                id: "task-4",
                projectId: "project-2",
                sortOrder: 1,
                createdAt: "2026-04-03T11:00:01.000Z",
                updatedAt: "2026-04-03T11:00:01.000Z",
              },
            ],
          };

          return createResponse({
            copiedCount: 2,
            copiedTaskIds: ["task-3", "task-4"],
            targetProjectId: "project-2",
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
      expect(screen.getByText("Operations uplift")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.change(within(bulkCard!).getByLabelText("Copy to project"), {
      target: { value: "project-2" },
    });
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
      expect(
        screen.getByText('Copied 2 tasks to "Operations uplift".'),
      ).toBeInTheDocument();
    });
  });

  it("shows Delete between Clear and Apply and archives selected tasks", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk/archive") && init?.method === "PATCH") {
          expect(init.body).toBe(
            JSON.stringify({
              taskIds: ["task-1", "task-2"],
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            derivedStatus: "not_started",
            displayStatus: "blocked",
            taskTotalCount: 0,
            taskTodoCount: 0,
            taskInProgressCount: 0,
            taskBlockedCount: 0,
            taskDoneCount: 0,
            taskCanceledCount: 0,
            taskOverdueCount: 0,
            tasks: [],
          };

          return createResponse({
            archivedCount: 2,
            archivedTaskIds: ["task-1", "task-2"],
          });
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));
    fireEvent.click(screen.getByLabelText("Select task Review plan"));

    const bulkCard = screen.getByText("2 selected tasks").closest("section");

    expect(bulkCard).not.toBeNull();

    const bulkActionButtons = bulkCard?.querySelector(".bulk-action-buttons");

    expect(bulkActionButtons).not.toBeNull();
    expect(
      within(bulkActionButtons as HTMLElement)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Clear", "Delete", "Copy", "Apply"]);

    fireEvent.click(
      within(bulkActionButtons as HTMLElement).getByRole("button", {
        name: "Delete",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("2 selected tasks")).not.toBeInTheDocument();
      expect(
        screen.getByText("Deleted 2 tasks from the workspace."),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
    expect(screen.queryByText("Review plan")).not.toBeInTheDocument();
  });

  it("shows a bulk delete error when archival fails", async () => {
    const workspacePayload = createWorkspacePayload();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();

        if (url.endsWith("/workspace")) {
          return createResponse(workspacePayload);
        }

        if (url.endsWith("/tasks/bulk/archive") && init?.method === "PATCH") {
          return createResponse(
            { message: "Unable to delete selected tasks" },
            500,
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );

    vi.stubGlobal("fetch", fetchMock);

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    if (!screen.queryByText("Kickoff")) {
      toggleProjectByTitle("Roadmap refresh");
    }

    await waitFor(() => {
      expect(screen.getByText("Kickoff")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("Select task Kickoff"));

    const bulkCard = screen.getByText("1 selected task").closest("section");

    expect(bulkCard).not.toBeNull();
    fireEvent.click(within(bulkCard!).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(
        screen.getByText("Unable to delete selected tasks"),
      ).toBeInTheDocument();
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });
  });
});
