import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAccountsPanel } from "./LocalAccountsPanel";
import type { WorkspaceUser } from "./types";

const adminUser: WorkspaceUser = {
  id: "user-1",
  email: "admin@tavi.local",
  name: "Admin",
  role: "admin",
};

const editorUser: WorkspaceUser = {
  id: "user-2",
  email: "editor@tavi.local",
  name: "Editor",
  role: "editor",
};

function createResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createAccountRecord(
  id: string,
  email: string,
  name: string,
  role: "admin" | "editor" | "viewer",
) {
  return {
    id,
    email,
    name,
    role,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function renderPanel(currentUser: WorkspaceUser, isAdmin: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const onNotice = vi.fn();

  return {
    onNotice,
    ...render(
      <QueryClientProvider client={queryClient}>
        <LocalAccountsPanel
          currentUser={currentUser}
          isAdmin={isAdmin}
          onNotice={onNotice}
        />
      </QueryClientProvider>,
    ),
  };
}

describe("LocalAccountsPanel", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("filters local accounts live for admins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        createResponse({
          accounts: [
            createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
            createAccountRecord(
              "user-2",
              "viewer@tavi.local",
              "Viewer",
              "viewer",
            ),
          ],
        }),
      ),
    );

    renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("viewer@tavi.local")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText("Filter by name, email, or role"), {
      target: { value: "viewer" },
    });

    expect(screen.getByText("viewer@tavi.local")).toBeInTheDocument();
    expect(screen.queryByText("admin@tavi.local")).not.toBeInTheDocument();
  });

  it("generates a password for new local accounts", async () => {
    let generatedPassword = "";
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts") && init?.method === "POST") {
        const payload = JSON.parse(String(init.body)) as {
          email: string;
          name: string;
          password: string;
          role: "admin" | "editor" | "viewer";
        };

        expect(payload).toMatchObject({
          email: "generated.user@tavi.local",
          name: "Generated User",
          role: "viewer",
        });
        expect(payload.password).toBe(generatedPassword);
        expect(payload.password).toMatch(/^[A-Za-z0-9]{20}$/);

        const createdAccount = createAccountRecord(
          "user-2",
          payload.email,
          payload.name,
          payload.role,
        );
        listResponse = {
          accounts: [...listResponse.accounts, createdAccount],
        };

        return createResponse({ account: createdAccount });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "New Account" }));
    fireEvent.change(screen.getByPlaceholderText("Name"), {
      target: { value: "Generated User" },
    });
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "generated.user@tavi.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));

    const passwordInput = screen.getByPlaceholderText("Password") as HTMLInputElement;
    generatedPassword = passwordInput.value;

    expect(generatedPassword).toMatch(/^[A-Za-z0-9]{20}$/);

    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("generated.user@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Created local account for Generated User.",
    );
  });

  it("lets non-admins set only their own password", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return createResponse({ success: true });
      }

      throw new Error("Unexpected fetch");
    });

    vi.stubGlobal("fetch", fetchMock);

    renderPanel(editorUser, false);

    fireEvent.change(screen.getByPlaceholderText("New password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.change(screen.getByPlaceholderText("Confirm password"), {
      target: { value: "newpassword123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set Password" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/me/password",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });
  });

  it("exports local accounts as JSON for admins", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts")) {
        return createResponse({
          accounts: [
            createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
          ],
        });
      }

      if (url.endsWith("/auth/accounts/export")) {
        return createResponse({
          accounts: [
            {
              email: "admin@tavi.local",
              name: "Admin",
              role: "admin",
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    const createObjectURL = vi.fn(() => "blob:local-accounts");
    const revokeObjectURL = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    });

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/export",
        expect.objectContaining({
          credentials: "include",
        }),
      );
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith("Downloaded 1 local account as JSON.");
  });

  it("imports local accounts from JSON for admins", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord("user-1", "admin@tavi.local", "Admin", "admin"),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/import") && init?.method === "POST") {
        expect(init.body).toBe(
          JSON.stringify({
            accounts: [
              {
                email: "new.user@tavi.local",
                name: "New User",
                password: "new-password-123",
                role: "editor",
              },
            ],
          }),
        );

        listResponse = {
          accounts: [
            ...listResponse.accounts,
            createAccountRecord(
              "user-2",
              "new.user@tavi.local",
              "New User",
              "editor",
            ),
          ],
        };

        return createResponse({
          accounts: listResponse.accounts,
          summary: {
            processed: 1,
            created: 1,
            updated: 0,
            unchanged: 0,
          },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const { container, onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
    });

    const fileInput = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement | null;
    const fileContents = JSON.stringify({
      accounts: [
        {
          email: "new.user@tavi.local",
          name: "New User",
          password: "new-password-123",
          role: "editor",
        },
      ],
    });
    const importFile = new File(["placeholder"], "local-accounts.json", {
      type: "application/json",
    });

    expect(fileInput).not.toBeNull();
    Object.defineProperty(importFile, "text", {
      value: vi.fn(async () => fileContents),
    });

    fireEvent.change(fileInput!, {
      target: {
        files: [importFile],
      },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/import",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("new.user@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Imported 1 local account (1 created, 0 updated, 0 unchanged).",
    );
  });

  it("resets the default local accounts for admins", async () => {
    let listResponse = {
      accounts: [
        createAccountRecord(
          "user-9",
          "other.user@tavi.local",
          "Other User",
          "viewer",
        ),
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.endsWith("/auth/accounts") && !init?.method) {
        return createResponse(listResponse);
      }

      if (url.endsWith("/auth/accounts/reset-defaults") && init?.method === "POST") {
        listResponse = {
          accounts: [
            ...listResponse.accounts,
            createAccountRecord(
              "admin-1",
              "admin@tavi.local",
              "Tavi Admin",
              "admin",
            ),
            createAccountRecord(
              "editor-1",
              "editor@tavi.local",
              "Tavi Editor",
              "editor",
            ),
            createAccountRecord(
              "viewer-1",
              "viewer@tavi.local",
              "Tavi Viewer",
              "viewer",
            ),
          ],
        };

        return createResponse(listResponse);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { onNotice } = renderPanel(adminUser, true);

    await waitFor(() => {
      expect(screen.getByText("other.user@tavi.local")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reset Defaults" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/accounts/reset-defaults",
        expect.objectContaining({
          method: "POST",
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText("admin@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("editor@tavi.local")).toBeInTheDocument();
      expect(screen.getByText("viewer@tavi.local")).toBeInTheDocument();
    });

    expect(onNotice).toHaveBeenCalledWith(
      "Reset the default @tavi.local accounts to password123 and re-enabled the login hint.",
    );
  });
});
