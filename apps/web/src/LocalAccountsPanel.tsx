import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createLocalAccount,
  deleteLocalAccount,
  exportLocalAccounts,
  importLocalAccounts,
  listLocalAccounts,
  resetDefaultLocalAccounts,
  setLocalAccountPassword,
  setMyPassword,
  updateLocalAccount,
} from "./api";
import type {
  CreateLocalAccountPayload,
  ExportLocalAccountsResponse,
  ImportLocalAccountsPayload,
  LocalAccount,
  SetOwnPasswordPayload,
  WorkspaceUser,
} from "./types";

type LocalAccountsPanelProps = {
  currentUser: WorkspaceUser;
  isAdmin: boolean;
  onNotice: (message: string) => void;
};

type PanelMode =
  | {
      kind: "create";
    }
  | {
      account: LocalAccount;
      kind: "edit" | "password";
    }
  | null;

const EMPTY_CREATE_DRAFT: CreateLocalAccountPayload = {
  email: "",
  name: "",
  password: "",
  role: "viewer",
};

const GENERATED_PASSWORD_LENGTH = 20;
const PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateAlphanumericPassword(length = GENERATED_PASSWORD_LENGTH) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Unable to generate a secure password in this browser.");
  }

  const password: string[] = [];
  const maxValidRandomValue =
    Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length;

  while (password.length < length) {
    const randomValues = globalThis.crypto.getRandomValues(
      new Uint8Array(length - password.length),
    );

    for (const randomValue of randomValues) {
      if (randomValue >= maxValidRandomValue) {
        continue;
      }

      password.push(PASSWORD_ALPHABET[randomValue % PASSWORD_ALPHABET.length]);
      if (password.length === length) {
        break;
      }
    }
  }

  return password.join("");
}

export function LocalAccountsPanel({
  currentUser,
  isAdmin,
  onNotice,
}: LocalAccountsPanelProps) {
  const queryClient = useQueryClient();
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<PanelMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [accountDraft, setAccountDraft] =
    useState<CreateLocalAccountPayload>(EMPTY_CREATE_DRAFT);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");

  const accountsQuery = useQuery({
    queryKey: ["localAccounts"],
    queryFn: listLocalAccounts,
    enabled: isAdmin,
    retry: false,
  });

  const accounts = accountsQuery.data?.accounts;
  const filteredAccounts = useMemo(() => {
    const availableAccounts = accounts ?? [];
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return availableAccounts;
    }

    return availableAccounts.filter((account) =>
      [account.name, account.email, account.role].some((value) =>
        value.toLowerCase().includes(normalizedSearch),
      ),
    );
  }, [accounts, search]);

  const refreshAccountData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["localAccounts"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
    ]);
  };

  const createAccountMutation = useMutation({
    mutationFn: createLocalAccount,
    onSuccess: async ({ account }) => {
      setError(null);
      resetEditorState();
      await refreshAccountData();
      onNotice(`Created local account for ${account.name}.`);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to create local account",
      );
    },
  });

  const updateAccountMutation = useMutation({
    mutationFn: ({
      payload,
      userId,
    }: {
      payload: Omit<CreateLocalAccountPayload, "password">;
      userId: string;
    }) => updateLocalAccount(userId, payload),
    onSuccess: async ({ account }) => {
      setError(null);
      resetEditorState();
      await refreshAccountData();
      onNotice(`Updated local account for ${account.name}.`);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to update local account",
      );
    },
  });

  const deleteAccountMutation = useMutation({
    mutationFn: deleteLocalAccount,
    onSuccess: async ({ id }) => {
      setError(null);
      setMode((currentMode) =>
        currentMode?.kind !== "create" && currentMode?.account.id === id
          ? null
          : currentMode,
      );
      await refreshAccountData();
      onNotice("Removed local account.");
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to remove local account",
      );
    },
  });

  const setAccountPasswordMutation = useMutation({
    mutationFn: ({
      password,
      userId,
    }: {
      password: string;
      userId: string;
    }) => setLocalAccountPassword(userId, { password }),
    onSuccess: async (_, variables) => {
      setError(null);
      resetEditorState();
      await refreshAccountData();
      const targetAccount = accounts?.find(
        (account) => account.id === variables.userId,
      );
      onNotice(
        `Set password for ${targetAccount?.name ?? "the selected local account"}.`,
      );
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to set account password",
      );
    },
  });

  const setMyPasswordMutation = useMutation({
    mutationFn: (payload: SetOwnPasswordPayload) => setMyPassword(payload),
    onSuccess: async () => {
      setError(null);
      setPasswordDraft("");
      setPasswordConfirmation("");
      await refreshAccountData();
      onNotice("Updated your password.");
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to update your password",
      );
    },
  });

  const resetPasswordDrafts = () => {
    setPasswordDraft("");
    setPasswordConfirmation("");
  };

  const resetEditorState = () => {
    setMode(null);
    setAccountDraft(EMPTY_CREATE_DRAFT);
    resetPasswordDrafts();
  };

  const exportAccountsMutation = useMutation({
    mutationFn: exportLocalAccounts,
    onSuccess: (payload) => {
      setError(null);
      downloadLocalAccountsExport(payload);
      onNotice(
        `Downloaded ${payload.accounts.length.toString()} local account${payload.accounts.length === 1 ? "" : "s"} as JSON.`,
      );
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to export local accounts",
      );
    },
  });

  const importAccountsMutation = useMutation({
    mutationFn: async (file: File) =>
      importLocalAccounts(parseLocalAccountsImport(await file.text())),
    onSuccess: async ({ summary }) => {
      setError(null);
      resetEditorState();
      await refreshAccountData();
      onNotice(
        `Imported ${summary.processed.toString()} local account${summary.processed === 1 ? "" : "s"} (${summary.created.toString()} created, ${summary.updated.toString()} updated, ${summary.unchanged.toString()} unchanged).`,
      );
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : mutationError instanceof Error
            ? mutationError.message
            : "Unable to import local accounts",
      );
    },
  });

  const resetDefaultAccountsMutation = useMutation({
    mutationFn: resetDefaultLocalAccounts,
    onSuccess: async () => {
      setError(null);
      resetEditorState();
      await refreshAccountData();
      onNotice(
        "Reset the default @tavi.local accounts to password123 and re-enabled the login hint.",
      );
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : "Unable to reset default local accounts",
      );
    },
  });

  const bulkActionPending =
    exportAccountsMutation.isPending ||
    importAccountsMutation.isPending ||
    resetDefaultAccountsMutation.isPending;

  const submitPassword = (targetAccount?: LocalAccount) => {
    if (!passwordDraft.trim()) {
      setError("Enter a password");
      return;
    }

    if (passwordDraft !== passwordConfirmation) {
      setError("Passwords must match");
      return;
    }

    setError(null);

    if (targetAccount) {
      setAccountPasswordMutation.mutate({
        password: passwordDraft,
        userId: targetAccount.id,
      });
      return;
    }

    setMyPasswordMutation.mutate({ password: passwordDraft });
  };

  const generateAccountPassword = () => {
    try {
      setAccountDraft((current) => ({
        ...current,
        password: generateAlphanumericPassword(),
      }));
      setError(null);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Unable to generate password",
      );
    }
  };

  return (
    <section className="workspace-panel-card local-accounts-panel">
      <header className="panel-header">
        <div>
          <strong>Local Accounts</strong>
          <span>
            {isAdmin
              ? "Create, import, export, reset, edit, remove, and set passwords for local accounts."
              : "Change your own password in local-auth mode."}
          </span>
        </div>
      </header>

      {error ? <p className="error-banner">{error}</p> : null}

      {isAdmin ? (
        <>
          <div className="local-accounts-toolbar">
            <div className="settings-actions">
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => {
                  setMode({ kind: "create" });
                  setAccountDraft(EMPTY_CREATE_DRAFT);
                  resetPasswordDrafts();
                  setError(null);
                }}
              >
                New Account
              </button>
              <button
                type="button"
                className="ghost-button compact-button"
                disabled={bulkActionPending}
                onClick={() => exportAccountsMutation.mutate()}
              >
                {exportAccountsMutation.isPending ? "Exporting..." : "Export JSON"}
              </button>
              <button
                type="button"
                className="ghost-button compact-button"
                disabled={bulkActionPending}
                onClick={() => importFileInputRef.current?.click()}
              >
                {importAccountsMutation.isPending ? "Importing..." : "Import JSON"}
              </button>
              <button
                type="button"
                className="ghost-button danger-button compact-button"
                disabled={bulkActionPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Reset admin@tavi.local, editor@tavi.local, and viewer@tavi.local to password123? Other local accounts will stay in place.",
                    )
                  ) {
                    resetDefaultAccountsMutation.mutate();
                  }
                }}
              >
                {resetDefaultAccountsMutation.isPending
                  ? "Resetting..."
                  : "Reset Defaults"}
              </button>
              <input
                ref={importFileInputRef}
                hidden
                type="file"
                accept="application/json,.json"
                aria-label="Import local accounts JSON"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0];

                  event.target.value = "";
                  if (!selectedFile) {
                    return;
                  }

                  setError(null);
                  importAccountsMutation.mutate(selectedFile);
                }}
              />
            </div>
            <label className="workspace-filter search-filter">
              Search accounts
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Filter by name, email, or role"
              />
            </label>
          </div>

          <p className="toolbar-hint">
            JSON exports omit passwords. Imports match accounts by email, keep
            existing passwords when the password field is blank, and require a
            password for any new account. Reset Defaults restores the default
            @tavi.local users with password123.
          </p>

          {mode?.kind === "create" ? (
            <form
              className="inline-form local-account-form"
              onSubmit={(event) => {
                event.preventDefault();
                createAccountMutation.mutate(accountDraft);
              }}
            >
              <input
                value={accountDraft.name}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Name"
              />
              <input
                type="email"
                value={accountDraft.email}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                placeholder="Email"
              />
              <select
                value={accountDraft.role}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    role: event.target.value as CreateLocalAccountPayload["role"],
                  }))
                }
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <div className="local-account-password-field">
                <input
                  type="password"
                  value={accountDraft.password}
                  onChange={(event) =>
                    setAccountDraft((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  placeholder="Password"
                />
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={generateAccountPassword}
                >
                  Generate
                </button>
              </div>
              <div className="settings-actions">
                <button type="submit" disabled={createAccountMutation.isPending}>
                  {createAccountMutation.isPending ? "Creating..." : "Create"}
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => {
                    setMode(null);
                    setAccountDraft(EMPTY_CREATE_DRAFT);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {mode?.kind === "edit" ? (
            <form
              className="inline-form local-account-form"
              onSubmit={(event) => {
                event.preventDefault();
                updateAccountMutation.mutate({
                  payload: {
                    email: accountDraft.email,
                    name: accountDraft.name,
                    role: accountDraft.role,
                  },
                  userId: mode.account.id,
                });
              }}
            >
              <input
                value={accountDraft.name}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="Name"
              />
              <input
                type="email"
                value={accountDraft.email}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
                placeholder="Email"
              />
              <select
                value={accountDraft.role}
                onChange={(event) =>
                  setAccountDraft((current) => ({
                    ...current,
                    role: event.target.value as CreateLocalAccountPayload["role"],
                  }))
                }
              >
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="admin">Admin</option>
              </select>
              <div className="settings-actions">
                <button type="submit" disabled={updateAccountMutation.isPending}>
                  {updateAccountMutation.isPending ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => {
                    setMode(null);
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {mode?.kind === "password" ? (
            <form
              className="inline-form local-account-form"
              onSubmit={(event) => {
                event.preventDefault();
                submitPassword(mode.account);
              }}
            >
              <strong>{`Set password · ${mode.account.name}`}</strong>
              <input
                type="password"
                value={passwordDraft}
                onChange={(event) => setPasswordDraft(event.target.value)}
                placeholder="New password"
              />
              <input
                type="password"
                value={passwordConfirmation}
                onChange={(event) => setPasswordConfirmation(event.target.value)}
                placeholder="Confirm password"
              />
              <div className="settings-actions">
                <button
                  type="submit"
                  disabled={setAccountPasswordMutation.isPending}
                >
                  {setAccountPasswordMutation.isPending
                    ? "Saving..."
                    : "Set Password"}
                </button>
                <button
                  type="button"
                  className="ghost-button compact-button"
                  onClick={() => {
                    setMode(null);
                    resetPasswordDrafts();
                    setError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {accountsQuery.isLoading ? (
            <p className="toolbar-hint">Loading local accounts...</p>
          ) : null}

          {accountsQuery.isError ? (
            <p className="error-banner">
              {accountsQuery.error instanceof Error
                ? accountsQuery.error.message
                : "Unable to load local accounts"}
            </p>
          ) : null}

          {!accountsQuery.isLoading && filteredAccounts.length === 0 ? (
            <p className="toolbar-hint">
              {search
                ? "No local accounts match the current filter."
                : "No local accounts found."}
            </p>
          ) : null}

          {filteredAccounts.length > 0 ? (
            <ul className="local-accounts-list">
              {filteredAccounts.map((account) => (
                <li key={account.id} className="local-account-row">
                  <div className="local-account-main">
                    <strong>{account.name}</strong>
                    <span>{account.email}</span>
                    <span className="audit-chip">{account.role}</span>
                  </div>
                  <div className="local-account-actions">
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      onClick={() => {
                        setMode({ account, kind: "edit" });
                        setAccountDraft({
                          email: account.email,
                          name: account.name,
                          password: "",
                          role: account.role,
                        });
                        resetPasswordDrafts();
                        setError(null);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      onClick={() => {
                        setMode({ account, kind: "password" });
                        resetPasswordDrafts();
                        setError(null);
                      }}
                    >
                      Set Password
                    </button>
                    <button
                      type="button"
                      className="ghost-button danger-button compact-button"
                      disabled={deleteAccountMutation.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove local account for ${account.name}?`,
                          )
                        ) {
                          deleteAccountMutation.mutate(account.id);
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <form
          className="inline-form local-account-form"
          onSubmit={(event) => {
            event.preventDefault();
            submitPassword();
          }}
        >
          <strong>{`Set password · ${currentUser.name}`}</strong>
          <input
            type="password"
            value={passwordDraft}
            onChange={(event) => setPasswordDraft(event.target.value)}
            placeholder="New password"
          />
          <input
            type="password"
            value={passwordConfirmation}
            onChange={(event) => setPasswordConfirmation(event.target.value)}
            placeholder="Confirm password"
          />
          <div className="settings-actions">
            <button type="submit" disabled={setMyPasswordMutation.isPending}>
              {setMyPasswordMutation.isPending ? "Saving..." : "Set Password"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function parseLocalAccountsImport(content: string): ImportLocalAccountsPayload {
  let parsedContent: unknown;

  try {
    parsedContent = JSON.parse(content);
  } catch {
    throw new Error("Choose a valid local accounts JSON file.");
  }

  if (
    !parsedContent ||
    typeof parsedContent !== "object" ||
    !Array.isArray((parsedContent as { accounts?: unknown }).accounts)
  ) {
    throw new Error("Choose a JSON file with an accounts array.");
  }

  return parsedContent as ImportLocalAccountsPayload;
}

function downloadLocalAccountsExport(payload: ExportLocalAccountsResponse) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `tavi-local-accounts-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
