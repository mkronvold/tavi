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

const createResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

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
      summary: "Validate overrides",
      notes: "Awaiting dependency",
      trackerLink: "https://tracker.example.com/projects/roadmap-refresh",
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
      statusFilter: "blocked",
      collapsedGroupKeys: ["done"],
      expandedProjectIds: ["project-1"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
});

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
    const projectCard = screen.getByText(title).closest("article");

    expect(projectCard).not.toBeNull();

    const expandButton = projectCard?.querySelector("button.group-toggle");

    expect(expandButton).toBeTruthy();
    fireEvent.click(expandButton!);

    return projectCard!;
  };

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    Reflect.deleteProperty(window, "__TAVI_RUNTIME_CONFIG__");
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
    expect(brandLink).toHaveAttribute("href", "https://tavi.example.com/current");
    expect(brandLink.querySelector(".brand-logo")).not.toBeNull();
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
    expect(screen.getByText("Notes: Awaiting dependency")).toBeInTheDocument();
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
      expect(screen.getByLabelText("Project status")).toHaveValue("blocked");
    });
  });

  it("shows completion percentages in project rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    expect(screen.getByText("0/2 0% done")).toBeInTheDocument();
  });

  it("renders tracker links as safe external links", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );

    renderApp();

    await waitFor(() => {
      expect(screen.getByText("Roadmap refresh")).toBeInTheDocument();
    });

    const trackerLink = screen.getByRole("link", { name: /tracker link/i });

    expect(trackerLink).toHaveAttribute(
      "href",
      "https://tracker.example.com/projects/roadmap-refresh",
    );
    expect(trackerLink).toHaveAttribute("target", "_blank");
    expect(trackerLink.getAttribute("rel")).toContain("noopener");
    expect(trackerLink.getAttribute("rel")).toContain("noreferrer");
  });

  it("includes tracker links when creating projects", async () => {
    const workspacePayload = createWorkspacePayload();
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
              summary: "",
              trackerLink: "https://tracker.example.com/projects/launch-planning",
              ownerUserId: "user-1",
              dueDate: "",
              priority: "medium",
            }),
          );

          workspacePayload.projects.push({
            id: "project-2",
            title: "Launch planning",
            summary: null,
            notes: null,
            trackerLink:
              "https://tracker.example.com/projects/launch-planning",
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
      expect(screen.getByPlaceholderText("Tracker link")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("New project title"), {
      target: { value: "Launch planning" },
    });
    fireEvent.change(screen.getByPlaceholderText("Tracker link"), {
      target: {
        value: "https://tracker.example.com/projects/launch-planning",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Add project" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects",
        expect.objectContaining({
          body: JSON.stringify({
            title: "Launch planning",
            summary: "",
            trackerLink:
              "https://tracker.example.com/projects/launch-planning",
            ownerUserId: "user-1",
            dueDate: "",
            priority: "medium",
          }),
          method: "POST",
        }),
      );
    });
  });

  it("includes tracker links when editing projects", async () => {
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
              title: "Roadmap refresh",
              summary: "Validate overrides",
              notes: "Awaiting dependency",
              trackerLink: "https://tracker.example.com/projects/roadmap-v2",
              ownerUserId: "user-1",
              dueDate: "",
              priority: "medium",
              manualStatus: "blocked",
            }),
          );

          workspacePayload.projects[0] = {
            ...workspacePayload.projects[0],
            trackerLink: "https://tracker.example.com/projects/roadmap-v2",
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

    const trackerLinkInput = within(projectCard!).getByDisplayValue(
      "https://tracker.example.com/projects/roadmap-refresh",
    );

    fireEvent.change(trackerLinkInput, {
      target: { value: "https://tracker.example.com/projects/roadmap-v2" },
    });
    fireEvent.click(within(projectCard!).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/projects/project-1",
        expect.objectContaining({
          body: JSON.stringify({
            title: "Roadmap refresh",
            summary: "Validate overrides",
            notes: "Awaiting dependency",
            trackerLink: "https://tracker.example.com/projects/roadmap-v2",
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
    expect(screen.getByRole("switch", { name: "Bulk Actions" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Full Width" })).toBeChecked();
    expect(screen.getByRole("main")).toHaveClass("workspace-shell--full-width");
  });

  it("shows local accounts first in settings and links the version tile to the repo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
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
    expect(
      within(settingsItems[0] as HTMLElement).getByText("Local Accounts"),
    ).toBeInTheDocument();
    expect(
      within(settingsItems[settingsItems.length - 1] as HTMLElement).getByText(
        "Version",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "github" })).toHaveAttribute(
      "href",
      appRepositoryUrl,
    );
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
      expect(within(projectCard).getByDisplayValue("Kickoff")).toBeInTheDocument();
      expect(within(projectCard).getByText("Review plan")).toBeInTheDocument();
    });

    const projectToggle = projectCard.querySelector("button.group-toggle");
    const editingRow = within(projectCard).getByDisplayValue("Kickoff").closest("tr");

    expect(editingRow).not.toBeNull();
    expect(projectToggle).toHaveTextContent("-");
    expect(editingRow?.querySelector("td[colspan]")).toBeNull();
    expect(editingRow?.querySelectorAll("td")).toHaveLength(7);
    expect(
      within(editingRow!).getByRole("button", { name: "Save" }),
    ).toHaveClass("mini-button");
    expect(
      within(editingRow!).getByRole("button", {
        name: "Cancel editing task",
      }),
    ).toHaveTextContent("X");
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
      expect(within(projectCard).getByDisplayValue("Kickoff")).toBeInTheDocument();
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
        title: "Kickoff updated",
        notes: "Confirm milestone scope",
        assigneeUserId: "user-1",
        dueDate: "",
        priority: "medium",
        status: "todo",
      }),
    );
  });

  it("clears only tavi-owned local storage keys from settings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => createResponse(createWorkspacePayload())),
    );
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
      expect(
        screen.getByRole("button", { name: "Clear Local Storage" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Clear Local Storage" }),
    );

    await waitFor(() => {
      expect(localStorage.getItem("unrelated")).toBe("keep");
      expect(localStorage.getItem("tavi.workspace.panels")).toBeNull();
      expect(localStorage.getItem("tavi.workspace.projectAddTask")).toBeNull();
      expect(
        screen.getByText(/Cleared 2 Tavi browser-local preferences/i),
      ).toBeInTheDocument();
    });
  });

  it("auto-collapses projects by default and keeps them open when disabled", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      summary: "Prepare the rollout window",
      notes: null,
      trackerLink: null,
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

    vi.stubGlobal("fetch", vi.fn(async () => createResponse(workspacePayload)));

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

  it("clears selected tasks for a collapsed project without affecting other open projects", async () => {
    const workspacePayload = createWorkspacePayload();

    workspacePayload.projects.push({
      id: "project-2",
      title: "Beta rollout",
      summary: "Coordinate launch timing",
      notes: null,
      trackerLink: null,
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

    vi.stubGlobal("fetch", vi.fn(async () => createResponse(workspacePayload)));

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

    fireEvent.click(screen.getByLabelText("Select all tasks in Roadmap refresh"));
    fireEvent.click(screen.getByLabelText("Select all tasks in Beta rollout"));

    await waitFor(() => {
      expect(screen.getByText("3 selected tasks")).toBeInTheDocument();
    });

    toggleProjectByTitle("Roadmap refresh");

    await waitFor(() => {
      expect(screen.queryByText("Kickoff")).not.toBeInTheDocument();
      expect(screen.getByText("1 selected task")).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Select all tasks in Beta rollout")).toBeChecked();

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
      expect(screen.queryByLabelText("Select task Kickoff")).not.toBeInTheDocument();
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
    ).toEqual(["Clear", "Delete", "Apply"]);

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
