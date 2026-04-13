import { useEffect, useMemo, useRef, useState } from "react";
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
import { generateAlphanumericPassword } from "./password-generator";
import type {
  CreateLocalAccountPayload,
  DeleteLocalAccountPayload,
  ExportLocalAccountsResponse,
  ImportLocalAccountsPayload,
  LocalAccount,
  SetOwnPasswordPayload,
  WorkspaceUser,
} from "./types";

type LocalAccountsPanelProps = {
  currentUser: WorkspaceUser;
  isAdmin: boolean;
  onClose: () => void;
  onNotice: (message: string) => void;
};

type PanelMode =
  | {
      kind: "create";
    }
  | {
      account: LocalAccount;
      kind: "delete" | "edit" | "password";
    }
  | null;

type LocalAccountImportDuplicateStrategy = "skip" | "update";

type BulkLocalAccountMode = "password" | "role" | null;

type BulkLocalAccountFailure = {
  account: LocalAccount;
  message: string;
};

type BulkLocalAccountActionResult = {
  failedAccounts: BulkLocalAccountFailure[];
  succeededAccounts: LocalAccount[];
};

const EMPTY_CREATE_DRAFT: CreateLocalAccountPayload = {
  email: "",
  name: "",
  password: "",
  role: "viewer",
};
const NONE_LOCAL_ACCOUNT_REASSIGN_VALUE = "__none__";

export function LocalAccountsPanel({
  currentUser,
  isAdmin,
  onClose,
  onNotice,
}: LocalAccountsPanelProps) {
  const queryClient = useQueryClient();
  const importFileInputRef = useRef<HTMLInputElement | null>(null);
  const errorBannerRef = useRef<HTMLParagraphElement | null>(null);
  const activeModeRef = useRef<HTMLElement | null>(null);
  const [mode, setMode] = useState<PanelMode>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bulkMode, setBulkMode] = useState<BulkLocalAccountMode>(null);
  const [selectedAccountIds, setSelectedAccountIds] = useState<
    Record<string, boolean>
  >({});
  const [accountDraft, setAccountDraft] =
    useState<CreateLocalAccountPayload>(EMPTY_CREATE_DRAFT);
  const [bulkRoleDraft, setBulkRoleDraft] =
    useState<CreateLocalAccountPayload["role"]>("viewer");
  const [deleteProjectOwnerUserId, setDeleteProjectOwnerUserId] = useState(
    NONE_LOCAL_ACCOUNT_REASSIGN_VALUE,
  );
  const [deleteTaskAssigneeUserId, setDeleteTaskAssigneeUserId] = useState(
    NONE_LOCAL_ACCOUNT_REASSIGN_VALUE,
  );
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
  const selectedAccounts = useMemo(
    () =>
      (accounts ?? []).filter((account) => selectedAccountIds[account.id] === true),
    [accounts, selectedAccountIds],
  );
  const selectedAccountCount = selectedAccounts.length;
  const totalAdminCount = useMemo(
    () => (accounts ?? []).filter((account) => account.role === "admin").length,
    [accounts],
  );
  const activeRowMode =
    mode?.kind && mode.kind !== "create" ? mode.kind : null;

  useEffect(() => {
    if (!error) {
      return;
    }

    const target = activeRowMode ? activeModeRef.current : errorBannerRef.current;

    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    }
    target?.focus();
  }, [activeRowMode, error]);

  const refreshAccountData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["localAccounts"] }),
      queryClient.invalidateQueries({ queryKey: ["workspace"] }),
    ]);
  };
  const clearSelectedAccounts = () => {
    setSelectedAccountIds({});
  };
  const selectOnlyFailedAccounts = (failedAccounts: BulkLocalAccountFailure[]) => {
    setSelectedAccountIds(
      Object.fromEntries(
        failedAccounts.map((failure) => [failure.account.id, true]),
      ),
    );
  };
  const resetBulkEditorState = () => {
    setBulkMode(null);
    setBulkRoleDraft("viewer");
    resetPasswordDrafts();
  };
  const finishBulkAction = async ({
    failurePrefix,
    notice,
    result,
  }: {
    failurePrefix: string;
    notice: string;
    result: BulkLocalAccountActionResult;
  }) => {
    if (result.succeededAccounts.length > 0) {
      await refreshAccountData();
      onNotice(
        result.failedAccounts.length === 0
          ? notice
          : `${notice} ${formatLocalAccountCount(result.failedAccounts.length)} ${result.failedAccounts.length === 1 ? "was" : "were"} skipped.`,
      );
    }

    if (result.failedAccounts.length > 0) {
      selectOnlyFailedAccounts(result.failedAccounts);
      setError(
        formatBulkLocalAccountFailureMessage(
          failurePrefix,
          result.failedAccounts,
        ),
      );
      return;
    }

    clearSelectedAccounts();
    resetBulkEditorState();
    setError(null);
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
    mutationFn: ({
      payload,
      userId,
    }: {
      payload?: DeleteLocalAccountPayload;
      userId: string;
    }) => deleteLocalAccount(userId, payload),
    onSuccess: async ({ id }) => {
      setError(null);
      resetDeleteDraft();
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
    mutationFn: ({ password, userId }: { password: string; userId: string }) =>
      setLocalAccountPassword(userId, { password }),
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
  const bulkSetPasswordMutation = useMutation({
    mutationFn: ({
      accounts,
      password,
    }: {
      accounts: LocalAccount[];
      password: string;
    }) =>
      runBulkLocalAccountAction(accounts, (account) =>
        setLocalAccountPassword(account.id, { password }),
      ),
    onSuccess: async (result) => {
      await finishBulkAction({
        failurePrefix: "Bulk password reset",
        notice: `Set a shared password for ${formatLocalAccountCount(
          result.succeededAccounts.length,
        )}.`,
        result,
      });
    },
  });
  const bulkUpdateRoleMutation = useMutation({
    mutationFn: ({
      accounts,
      role,
    }: {
      accounts: LocalAccount[];
      role: CreateLocalAccountPayload["role"];
    }) =>
      runBulkLocalAccountAction(accounts, (account) =>
        updateLocalAccount(account.id, { role }),
      ),
    onSuccess: async (result, variables) => {
      await finishBulkAction({
        failurePrefix: "Bulk role change",
        notice: `Changed role to ${variables.role} for ${formatLocalAccountCount(
          result.succeededAccounts.length,
        )}.`,
        result,
      });
    },
  });
  const bulkDeleteAccountMutation = useMutation({
    mutationFn: ({ accounts }: { accounts: LocalAccount[] }) =>
      runBulkLocalAccountAction(accounts, (account) => deleteLocalAccount(account.id)),
    onSuccess: async (result) => {
      await finishBulkAction({
        failurePrefix: "Bulk delete",
        notice: `Removed ${formatLocalAccountCount(
          result.succeededAccounts.length,
        )}.`,
        result,
      });
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
  const resetDeleteDraft = () => {
    setDeleteProjectOwnerUserId(NONE_LOCAL_ACCOUNT_REASSIGN_VALUE);
    setDeleteTaskAssigneeUserId(NONE_LOCAL_ACCOUNT_REASSIGN_VALUE);
  };

  const resetEditorState = () => {
    setMode(null);
    setAccountDraft(EMPTY_CREATE_DRAFT);
    resetDeleteDraft();
    resetPasswordDrafts();
  };
  const openBulkMode = (nextMode: Exclude<BulkLocalAccountMode, null>) => {
    setMode(null);
    setBulkMode(nextMode);
    resetDeleteDraft();
    resetPasswordDrafts();
    setError(null);
  };
  const openAccountMode = (nextMode: Exclude<PanelMode, null>) => {
    resetBulkEditorState();
    setMode(nextMode);
    setError(null);
  };
  const openEditMode = (account: LocalAccount) => {
    openAccountMode({ account, kind: "edit" });
    setAccountDraft({
      email: account.email,
      name: account.name,
      password: "",
      role: account.role,
    });
    resetPasswordDrafts();
  };
  const openPasswordMode = (account: LocalAccount) => {
    openAccountMode({ account, kind: "password" });
    resetPasswordDrafts();
  };
  const openDeleteMode = (account: LocalAccount) => {
    const fallbackReassignmentId =
      (accounts ?? []).find((candidate) => candidate.id !== account.id)?.id ??
      NONE_LOCAL_ACCOUNT_REASSIGN_VALUE;

    openAccountMode({ account, kind: "delete" });
    resetPasswordDrafts();
    setDeleteProjectOwnerUserId(fallbackReassignmentId);
    setDeleteTaskAssigneeUserId(fallbackReassignmentId);
  };
  const toggleSelectedAccount = (accountId: string, checked: boolean) => {
    if (!checked && selectedAccountCount === 1 && selectedAccountIds[accountId]) {
      resetBulkEditorState();
    }

    setSelectedAccountIds((current) => {
      if (!checked) {
        if (!(accountId in current)) {
          return current;
        }

        const nextSelection = { ...current };

        delete nextSelection[accountId];
        return nextSelection;
      }

      if (current[accountId]) {
        return current;
      }

      return {
        ...current,
        [accountId]: true,
      };
    });
  };
  const submitBulkPasswordReset = () => {
    if (selectedAccountCount === 0) {
      setError("Select at least one local account");
      return;
    }

    if (!passwordDraft.trim()) {
      setError("Enter a password");
      return;
    }

    if (passwordDraft !== passwordConfirmation) {
      setError("Passwords must match");
      return;
    }

    setError(null);
    bulkSetPasswordMutation.mutate({
      accounts: selectedAccounts,
      password: passwordDraft,
    });
  };
  const submitBulkRoleChange = () => {
    if (selectedAccountCount === 0) {
      setError("Select at least one local account");
      return;
    }

    const accountsToChange = selectedAccounts.filter(
      (account) => account.role !== bulkRoleDraft,
    );

    if (accountsToChange.length === 0) {
      setError(`Selected accounts already use the ${bulkRoleDraft} role.`);
      return;
    }

    const selectedAdminCount = accountsToChange.filter(
      (account) => account.role === "admin",
    ).length;

    if (
      bulkRoleDraft !== "admin" &&
      selectedAdminCount > 0 &&
      totalAdminCount - selectedAdminCount < 1
    ) {
      setError("At least one admin account must remain");
      return;
    }

    setError(null);
    bulkUpdateRoleMutation.mutate({
      accounts: accountsToChange,
      role: bulkRoleDraft,
    });
  };
  const submitBulkDelete = () => {
    if (selectedAccountCount === 0) {
      setError("Select at least one local account");
      return;
    }

    const selectedAdminCount = selectedAccounts.filter(
      (account) => account.role === "admin",
    ).length;

    if (selectedAdminCount > 0 && totalAdminCount - selectedAdminCount < 1) {
      setError("At least one admin account must remain");
      return;
    }

    if (
      !window.confirm(
        `Remove ${formatLocalAccountCount(selectedAccountCount)}? Accounts with blockers stay selected and will report an error.`,
      )
    ) {
      return;
    }

    setError(null);
    bulkDeleteAccountMutation.mutate({
      accounts: selectedAccounts,
    });
  };
  const handleDeleteAccount = (account: LocalAccount) => {
    const ownedProjectCount = account.ownedProjectCount ?? 0;
    const assignedTaskCount = account.assignedTaskCount ?? 0;

    if (ownedProjectCount > 0 || assignedTaskCount > 0) {
      openDeleteMode(account);
      return;
    }

    if (!window.confirm(`Remove local account for ${account.name}?`)) {
      return;
    }

    setError(null);
    deleteAccountMutation.mutate({ userId: account.id });
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
    mutationFn: importLocalAccounts,
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
  const handleImportAccountsFile = async (selectedFile: File) => {
    setError(null);

    try {
      const parsedImport = await parseLocalAccountsImport(selectedFile);
      const availableAccounts =
        accounts ??
        (
          await queryClient.ensureQueryData({
            queryKey: ["localAccounts"],
            queryFn: listLocalAccounts,
          })
        ).accounts;
      const preparedImport = prepareLocalAccountsImport(
        parsedImport,
        availableAccounts,
      );

      if (!preparedImport) {
        return;
      }

      if (preparedImport.accounts.length === 0) {
        onNotice("Skipped duplicate local accounts. No new accounts were imported.");
        return;
      }

      importAccountsMutation.mutate(preparedImport);
    } catch (mutationError) {
      setError(
        mutationError instanceof ApiError
          ? mutationError.message
          : mutationError instanceof Error
            ? mutationError.message
            : "Unable to import local accounts",
      );
    }
  };

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
    bulkDeleteAccountMutation.isPending ||
    bulkSetPasswordMutation.isPending ||
    bulkUpdateRoleMutation.isPending ||
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

  const generateDraftPassword = (
    applyGeneratedPassword: (password: string) => void,
  ) => {
    try {
      const nextPassword = generateAlphanumericPassword();

      applyGeneratedPassword(nextPassword);
      setError(null);
    } catch (generationError) {
      setError(
        generationError instanceof Error
          ? generationError.message
          : "Unable to generate password",
      );
    }
  };

  const generateAccountPassword = () => {
    generateDraftPassword((nextPassword) => {
      setAccountDraft((current) => ({
        ...current,
        password: nextPassword,
      }));
    });
  };

  const generatePasswordDrafts = () => {
    generateDraftPassword((nextPassword) => {
      setPasswordDraft(nextPassword);
      setPasswordConfirmation(nextPassword);
    });
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
        <div className="settings-actions">
          <button
            type="button"
            className="ghost-button compact-button"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </header>

      {error && !activeRowMode ? (
        <p
          ref={errorBannerRef}
          className="error-banner local-account-error-panel"
          tabIndex={-1}
        >
          {error}
        </p>
      ) : null}

      {isAdmin ? (
        <>
          <div className="local-accounts-toolbar">
            <div className="settings-actions">
              <button
                type="button"
                className="ghost-button compact-button"
                onClick={() => {
                  resetBulkEditorState();
                  setMode({ kind: "create" });
                  setAccountDraft(EMPTY_CREATE_DRAFT);
                  resetDeleteDraft();
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
                {exportAccountsMutation.isPending
                  ? "Exporting..."
                  : "Export JSON"}
              </button>
              <button
                type="button"
                className="ghost-button compact-button"
                disabled={bulkActionPending}
                onClick={() => importFileInputRef.current?.click()}
              >
                {importAccountsMutation.isPending
                  ? "Importing..."
                  : "Import JSON/CSV"}
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
                accept="application/json,.json,text/csv,.csv"
                aria-label="Import local accounts JSON or CSV"
                onChange={(event) => {
                  const selectedFile = event.target.files?.[0];

                  event.target.value = "";
                  if (!selectedFile) {
                    return;
                  }

                  void handleImportAccountsFile(selectedFile);
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
            JSON exports omit passwords. JSON and CSV imports match accounts by
            email, keep existing passwords when the password field is blank,
            and require a password for any new account. CSV imports use name,
            email, role, and optional password columns. Reset Defaults
            restores the default @tavi.local users with password123.
          </p>

          {selectedAccountCount > 0 ? (
            <section className="bulk-action-card local-account-bulk-card">
              <div className="bulk-action-header">
                <div>
                  <strong>{`${formatLocalAccountCount(selectedAccountCount)} selected`}</strong>
                  <span>
                    Reset passwords, change roles, or remove the selected local
                    accounts.
                  </span>
                </div>
                <div className="bulk-action-buttons">
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={bulkActionPending}
                    onClick={() => openBulkMode("password")}
                  >
                    Bulk Password Reset
                  </button>
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    disabled={bulkActionPending}
                    onClick={() => openBulkMode("role")}
                  >
                    Bulk Change Role
                  </button>
                  <button
                    type="button"
                    className="ghost-button danger-button compact-button"
                    disabled={bulkActionPending}
                    onClick={submitBulkDelete}
                  >
                    Bulk Delete
                  </button>
                </div>
              </div>

              {bulkMode === "password" ? (
                <form
                  className="inline-form local-account-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitBulkPasswordReset();
                  }}
                >
                  <strong>{`Bulk password reset · ${formatLocalAccountCount(selectedAccountCount)}`}</strong>
                  <input
                    type="password"
                    value={passwordDraft}
                    onChange={(event) => setPasswordDraft(event.target.value)}
                    placeholder="New password"
                  />
                  <input
                    type="password"
                    value={passwordConfirmation}
                    onChange={(event) =>
                      setPasswordConfirmation(event.target.value)
                    }
                    placeholder="Confirm password"
                  />
                  <button
                    type="button"
                    className="ghost-button compact-button"
                    onClick={generatePasswordDrafts}
                  >
                    Generate
                  </button>
                  <div className="settings-actions">
                    <button
                      type="submit"
                      disabled={bulkSetPasswordMutation.isPending}
                    >
                      {bulkSetPasswordMutation.isPending
                        ? "Saving..."
                        : "Apply"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      onClick={() => {
                        resetBulkEditorState();
                        setError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}

              {bulkMode === "role" ? (
                <form
                  className="inline-form local-account-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitBulkRoleChange();
                  }}
                >
                  <strong>{`Bulk role change · ${formatLocalAccountCount(selectedAccountCount)}`}</strong>
                  <select
                    value={bulkRoleDraft}
                    onChange={(event) =>
                      setBulkRoleDraft(
                        event.target.value as CreateLocalAccountPayload["role"],
                      )
                    }
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="admin">Admin</option>
                  </select>
                  <div className="settings-actions">
                    <button
                      type="submit"
                      disabled={bulkUpdateRoleMutation.isPending}
                    >
                      {bulkUpdateRoleMutation.isPending
                        ? "Saving..."
                        : "Apply"}
                    </button>
                    <button
                      type="button"
                      className="ghost-button compact-button"
                      onClick={() => {
                        resetBulkEditorState();
                        setError(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </section>
          ) : null}

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
                    role: event.target
                      .value as CreateLocalAccountPayload["role"],
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
                <button
                  type="submit"
                  disabled={createAccountMutation.isPending}
                >
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

          {accountsQuery.isLoading ? (
            <p className="toolbar-hint">Loading local accounts...</p>
          ) : null}

          {accountsQuery.isError ? (
            <p className="error-banner local-account-error-panel">
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
              {filteredAccounts.map((account) => {
                const isEditMode =
                  mode?.kind === "edit" && mode.account.id === account.id;
                const isPasswordMode =
                  mode?.kind === "password" && mode.account.id === account.id;
                const isDeleteMode =
                  mode?.kind === "delete" && mode.account.id === account.id;
                const isInlineMode = isEditMode || isPasswordMode || isDeleteMode;
                const deleteReplacementOptions = (accounts ?? []).filter(
                  (candidate) => candidate.id !== account.id,
                );

                return (
                  <li
                    key={account.id}
                    className={`local-account-row${isInlineMode ? " local-account-row--active" : ""}`}
                  >
                    <label className="local-account-select">
                      <input
                        type="checkbox"
                        checked={selectedAccountIds[account.id] === true}
                        disabled={bulkActionPending}
                        aria-label={`Select local account ${account.name}`}
                        onChange={(event) =>
                          toggleSelectedAccount(account.id, event.target.checked)
                        }
                      />
                    </label>
                    <div className="local-account-main">
                      <strong>{account.name}</strong>
                      <span>{account.email}</span>
                      <span className="audit-chip">{account.role}</span>
                    </div>
                    <div className="local-account-actions">
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        disabled={bulkActionPending}
                        onClick={() => openEditMode(account)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="ghost-button compact-button"
                        disabled={bulkActionPending}
                        onClick={() => openPasswordMode(account)}
                      >
                        Set Password
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger-button compact-button"
                        disabled={deleteAccountMutation.isPending || bulkActionPending}
                        onClick={() => handleDeleteAccount(account)}
                      >
                        Remove
                      </button>
                    </div>

                    {isEditMode ? (
                      <form
                        ref={(element) => {
                          if (element) {
                            activeModeRef.current = element;
                          }
                        }}
                        tabIndex={-1}
                        className="inline-form local-account-form local-account-inline-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          updateAccountMutation.mutate({
                            payload: {
                              email: accountDraft.email,
                              name: accountDraft.name,
                              role: accountDraft.role,
                            },
                            userId: account.id,
                          });
                        }}
                      >
                        <strong>{`Edit account · ${account.name}`}</strong>
                        {error ? (
                          <p className="error-banner local-account-inline-error">
                            {error}
                          </p>
                        ) : null}
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
                              role: event.target
                                .value as CreateLocalAccountPayload["role"],
                            }))
                          }
                        >
                          <option value="viewer">Viewer</option>
                          <option value="editor">Editor</option>
                          <option value="admin">Admin</option>
                        </select>
                        <div className="settings-actions">
                          <button
                            type="submit"
                            disabled={updateAccountMutation.isPending}
                          >
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

                    {isPasswordMode ? (
                      <form
                        ref={(element) => {
                          if (element) {
                            activeModeRef.current = element;
                          }
                        }}
                        tabIndex={-1}
                        className="inline-form local-account-form local-account-inline-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitPassword(account);
                        }}
                      >
                        <strong>{`Set password · ${account.name}`}</strong>
                        {error ? (
                          <p className="error-banner local-account-inline-error">
                            {error}
                          </p>
                        ) : null}
                        <input
                          type="password"
                          value={passwordDraft}
                          onChange={(event) => setPasswordDraft(event.target.value)}
                          placeholder="New password"
                        />
                        <input
                          type="password"
                          value={passwordConfirmation}
                          onChange={(event) =>
                            setPasswordConfirmation(event.target.value)
                          }
                          placeholder="Confirm password"
                        />
                        <div className="settings-actions">
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={generatePasswordDrafts}
                          >
                            Generate
                          </button>
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

                    {isDeleteMode ? (
                      <form
                        ref={(element) => {
                          if (element) {
                            activeModeRef.current = element;
                          }
                        }}
                        tabIndex={-1}
                        className="inline-form local-account-form local-account-inline-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          deleteAccountMutation.mutate({
                            userId: account.id,
                            payload: {
                              ...((account.ownedProjectCount ?? 0) > 0
                                ? {
                                    nextProjectOwnerUserId:
                                      deleteProjectOwnerUserId ===
                                      NONE_LOCAL_ACCOUNT_REASSIGN_VALUE
                                        ? null
                                        : deleteProjectOwnerUserId,
                                  }
                                : {}),
                              ...((account.assignedTaskCount ?? 0) > 0
                                ? {
                                    nextTaskAssigneeUserId:
                                      deleteTaskAssigneeUserId ===
                                      NONE_LOCAL_ACCOUNT_REASSIGN_VALUE
                                        ? null
                                        : deleteTaskAssigneeUserId,
                                  }
                                : {}),
                            },
                          });
                        }}
                      >
                        <strong>{`Remove account · ${account.name}`}</strong>
                        {error ? (
                          <p className="error-banner local-account-inline-error">
                            {error}
                          </p>
                        ) : null}
                        <p className="toolbar-hint local-account-inline-note">
                          {buildLocalAccountDeleteBlockerMessage(account)}
                        </p>
                        {(account.ownedProjectCount ?? 0) > 0 ? (
                          <label>
                            Owned projects
                            <select
                              aria-label={`Owned projects for ${account.name}`}
                              value={deleteProjectOwnerUserId}
                              onChange={(event) =>
                                setDeleteProjectOwnerUserId(event.target.value)
                              }
                            >
                              {deleteReplacementOptions.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                              <option value={NONE_LOCAL_ACCOUNT_REASSIGN_VALUE}>
                                None
                              </option>
                            </select>
                          </label>
                        ) : null}
                        {(account.assignedTaskCount ?? 0) > 0 ? (
                          <label>
                            Assigned tasks
                            <select
                              aria-label={`Assigned tasks for ${account.name}`}
                              value={deleteTaskAssigneeUserId}
                              onChange={(event) =>
                                setDeleteTaskAssigneeUserId(event.target.value)
                              }
                            >
                              {deleteReplacementOptions.map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                              <option value={NONE_LOCAL_ACCOUNT_REASSIGN_VALUE}>
                                None
                              </option>
                            </select>
                          </label>
                        ) : null}
                        <div className="settings-actions">
                          <button
                            type="submit"
                            disabled={deleteAccountMutation.isPending}
                          >
                            {deleteAccountMutation.isPending
                              ? "Removing..."
                              : "Remove Account"}
                          </button>
                          <button
                            type="button"
                            className="ghost-button compact-button"
                            onClick={() => {
                              setMode(null);
                              resetDeleteDraft();
                              setError(null);
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </li>
                );
              })}
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
            <button
              type="button"
              className="ghost-button compact-button"
              onClick={generatePasswordDrafts}
            >
              Generate
            </button>
            <button type="submit" disabled={setMyPasswordMutation.isPending}>
              {setMyPasswordMutation.isPending ? "Saving..." : "Set Password"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

async function runBulkLocalAccountAction(
  accounts: LocalAccount[],
  action: (account: LocalAccount) => Promise<unknown>,
): Promise<BulkLocalAccountActionResult> {
  const failedAccounts: BulkLocalAccountFailure[] = [];
  const succeededAccounts: LocalAccount[] = [];

  for (const account of accounts) {
    try {
      await action(account);
      succeededAccounts.push(account);
    } catch (error) {
      failedAccounts.push({
        account,
        message:
          error instanceof ApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Unexpected error",
      });
    }
  }

  return {
    failedAccounts,
    succeededAccounts,
  };
}

function formatLocalAccountCount(count: number) {
  return `${count.toString()} local account${count === 1 ? "" : "s"}`;
}

function buildLocalAccountDeleteBlockerMessage(account: LocalAccount) {
  const blockers: string[] = [];

  if ((account.ownedProjectCount ?? 0) > 0) {
    blockers.push("owned projects");
  }

  if ((account.assignedTaskCount ?? 0) > 0) {
    blockers.push("assigned tasks");
  }

  return blockers.length === 0
    ? "Remove this local account from Tavi."
    : `Reassign or remove related data before deleting this account: ${blockers.join(", ")}`;
}

function formatBulkLocalAccountFailureMessage(
  prefix: string,
  failures: BulkLocalAccountFailure[],
) {
  const details = failures
    .slice(0, 3)
    .map((failure) => `${failure.account.name}: ${failure.message}`)
    .join(" ");
  const remainingCount = failures.length - 3;

  return `${prefix} failed for ${formatLocalAccountCount(failures.length)}. ${details}${remainingCount > 0 ? ` ${remainingCount.toString()} more failed.` : ""}`;
}

function prepareLocalAccountsImport(
  payload: ImportLocalAccountsPayload,
  existingAccounts: LocalAccount[],
): ImportLocalAccountsPayload | null {
  const duplicateSummary = summarizeLocalAccountImportDuplicates(
    payload.accounts,
    existingAccounts,
  );

  if (
    duplicateSummary.existingEmailCount === 0 &&
    duplicateSummary.fileDuplicateEmailCount === 0
  ) {
    return payload;
  }

  const duplicateStrategy =
    chooseLocalAccountImportDuplicateStrategy(duplicateSummary);

  if (!duplicateStrategy) {
    return null;
  }

  return {
    accounts: filterImportedLocalAccounts(
      payload.accounts,
      existingAccounts,
      duplicateStrategy,
    ),
  };
}

function summarizeLocalAccountImportDuplicates(
  importedAccounts: ImportLocalAccountsPayload["accounts"],
  existingAccounts: LocalAccount[],
) {
  const existingEmails = new Set(
    existingAccounts.map((account) => normalizeLocalAccountEmail(account.email)),
  );
  const seenImportedEmails = new Set<string>();
  const duplicateExistingEmails = new Set<string>();
  const duplicateFileEmails = new Set<string>();

  importedAccounts.forEach((account) => {
    const normalizedEmail = normalizeLocalAccountEmail(account.email);

    if (seenImportedEmails.has(normalizedEmail)) {
      duplicateFileEmails.add(normalizedEmail);
    }

    seenImportedEmails.add(normalizedEmail);

    if (existingEmails.has(normalizedEmail)) {
      duplicateExistingEmails.add(normalizedEmail);
    }
  });

  return {
    existingEmailCount: duplicateExistingEmails.size,
    fileDuplicateEmailCount: duplicateFileEmails.size,
  };
}

function chooseLocalAccountImportDuplicateStrategy({
  existingEmailCount,
  fileDuplicateEmailCount,
}: {
  existingEmailCount: number;
  fileDuplicateEmailCount: number;
}): LocalAccountImportDuplicateStrategy | null {
  const duplicateNotes: string[] = [];

  if (existingEmailCount > 0) {
    duplicateNotes.push(
      `${existingEmailCount.toString()} email${existingEmailCount === 1 ? "" : "s"} already in Tavi`,
    );
  }

  if (fileDuplicateEmailCount > 0) {
    duplicateNotes.push(
      `${fileDuplicateEmailCount.toString()} duplicate email${fileDuplicateEmailCount === 1 ? "" : "s"} inside the import file`,
    );
  }

  if (
    window.confirm(
      `This import includes ${duplicateNotes.join(" and ")}.\n\nSelect OK to update matching accounts and use the last imported row for duplicate emails.\nSelect Cancel to review a skip option.`,
    )
  ) {
    return "update";
  }

  return window.confirm(
    "Select OK to skip duplicate emails and keep the current account or first imported row for each duplicate email.\nSelect Cancel to stop this import.",
  )
    ? "skip"
    : null;
}

function filterImportedLocalAccounts(
  importedAccounts: ImportLocalAccountsPayload["accounts"],
  existingAccounts: LocalAccount[],
  duplicateStrategy: LocalAccountImportDuplicateStrategy,
) {
  const dedupedAccounts =
    duplicateStrategy === "update"
      ? dedupeImportedAccounts(importedAccounts, true)
      : dedupeImportedAccounts(importedAccounts, false);

  if (duplicateStrategy === "update") {
    return dedupedAccounts;
  }

  const existingEmails = new Set(
    existingAccounts.map((account) => normalizeLocalAccountEmail(account.email)),
  );

  return dedupedAccounts.filter(
    (account) => !existingEmails.has(normalizeLocalAccountEmail(account.email)),
  );
}

function dedupeImportedAccounts(
  importedAccounts: ImportLocalAccountsPayload["accounts"],
  preferLastDuplicate: boolean,
) {
  if (!preferLastDuplicate) {
    const seenEmails = new Set<string>();

    return importedAccounts.filter((account) => {
      const normalizedEmail = normalizeLocalAccountEmail(account.email);

      if (seenEmails.has(normalizedEmail)) {
        return false;
      }

      seenEmails.add(normalizedEmail);
      return true;
    });
  }

  const seenEmails = new Set<string>();
  const dedupedAccounts: ImportLocalAccountsPayload["accounts"] = [];

  for (let index = importedAccounts.length - 1; index >= 0; index -= 1) {
    const account = importedAccounts[index];
    const normalizedEmail = normalizeLocalAccountEmail(account.email);

    if (seenEmails.has(normalizedEmail)) {
      continue;
    }

    seenEmails.add(normalizedEmail);
    dedupedAccounts.push(account);
  }

  return dedupedAccounts.reverse();
}

function normalizeLocalAccountEmail(email: string) {
  return email.trim().toLowerCase();
}

async function parseLocalAccountsImport(
  file: File,
): Promise<ImportLocalAccountsPayload> {
  const content = await file.text();

  if (isLocalAccountsCsvFile(file)) {
    return parseLocalAccountsCsvImport(content);
  }

  return parseLocalAccountsJsonImport(content);
}

function isLocalAccountsCsvFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/csv"
  );
}

function parseLocalAccountsJsonImport(content: string): ImportLocalAccountsPayload {
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

async function parseLocalAccountsCsvImport(
  content: string,
): Promise<ImportLocalAccountsPayload> {
  const { read, utils } = await import("xlsx");
  const workbook = read(content, { type: "string" });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error("Choose a CSV file with name, email, role, and optional password columns.");
  }

  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
    defval: "",
  });
  const accounts = rows.flatMap((row, index) => {
    const parsedRow = parseLocalAccountsCsvRow(row, index + 2);

    return parsedRow ? [parsedRow] : [];
  });

  if (accounts.length === 0) {
    throw new Error("Choose a CSV file with at least one local account row.");
  }

  return { accounts };
}

function parseLocalAccountsCsvRow(
  row: Record<string, unknown>,
  rowNumber: number,
): ImportLocalAccountsPayload["accounts"][number] | null {
  const normalizedRow = new Map<string, string>();

  Object.entries(row).forEach(([key, value]) => {
    normalizedRow.set(
      normalizeLocalAccountsCsvHeader(key),
      typeof value === "string" ? value.trim() : String(value ?? "").trim(),
    );
  });

  const email = readLocalAccountsCsvValue(normalizedRow, ["email"]);
  const name = readLocalAccountsCsvValue(normalizedRow, ["name"]);
  const roleValue = readLocalAccountsCsvValue(normalizedRow, ["role"]);
  const password = readLocalAccountsCsvValue(normalizedRow, ["password"]);

  if (!email && !name && !roleValue && !password) {
    return null;
  }

  if (!email || !name || !roleValue) {
    throw new Error(
      `CSV row ${rowNumber.toString()} must include name, email, and role values.`,
    );
  }

  return {
    email,
    name,
    password,
    role: parseLocalAccountImportRole(roleValue, rowNumber),
  };
}

function normalizeLocalAccountsCsvHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function readLocalAccountsCsvValue(
  row: Map<string, string>,
  headerAliases: string[],
) {
  for (const headerAlias of headerAliases) {
    const value = row.get(normalizeLocalAccountsCsvHeader(headerAlias));

    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

function parseLocalAccountImportRole(
  value: string,
  rowNumber: number,
): ImportLocalAccountsPayload["accounts"][number]["role"] {
  const normalizedValue = value.trim().toLowerCase();

  if (
    normalizedValue === "admin" ||
    normalizedValue === "editor" ||
    normalizedValue === "viewer"
  ) {
    return normalizedValue;
  }

  throw new Error(
    `CSV row ${rowNumber.toString()} has an invalid role "${value}". Use admin, editor, or viewer.`,
  );
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
