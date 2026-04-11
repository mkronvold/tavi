import type { AuditEntityType } from "@tavi/schemas";
import type {
  AuditHistoryEvent,
  BulkDeleteTasksPayload,
  BulkUpdateTasksPayload,
  CreateLocalAccountPayload,
  CreateLoopImportPayload,
  CreateProjectPayload,
  CreateTaskPayload,
  DeleteLocalAccountResponse,
  ExportLocalAccountsResponse,
  ImportLocalAccountsPayload,
  ImportLocalAccountsResponse,
  LoginPayload,
  LocalLoginHintResponse,
  LocalAccountResponse,
  LocalAccountsResponse,
  LoopImportJob,
  LoopImportJobSummary,
  ResetDefaultLocalAccountsResponse,
  SetLocalAccountPasswordPayload,
  SetOwnPasswordPayload,
  UpdateProjectPayload,
  UpdateLoopImportMappingPayload,
  UpdateLocalAccountPayload,
  UpdateSavedViewPayload,
  UpdateTaskPayload,
  RenameSavedViewPayload,
  SavedView,
  SavedViewPayload,
  SuccessResponse,
  WorkspaceResponse,
} from "./types";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "/api";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as {
        error?: string;
        message?: string | string[];
      };

      if (typeof payload.message === "string") {
        message = payload.message;
      } else if (Array.isArray(payload.message)) {
        message = payload.message.join(", ");
      } else if (payload.error) {
        message = payload.error;
      }
    } catch {
      // Ignore JSON parsing errors and keep the HTTP message.
    }

    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}

export const getWorkspace = () => request<WorkspaceResponse>("/workspace");

export const login = (payload: LoginPayload) =>
  request("/auth/login", {
    method: "POST",
    body: payload,
  });

export const getLocalLoginHint = () =>
  request<LocalLoginHintResponse>("/auth/local-login-hint");

export const logout = () =>
  request("/auth/logout", {
    method: "POST",
  });

export const listLocalAccounts = () =>
  request<LocalAccountsResponse>("/auth/accounts");

export const exportLocalAccounts = () =>
  request<ExportLocalAccountsResponse>("/auth/accounts/export");

export const createLocalAccount = (payload: CreateLocalAccountPayload) =>
  request<LocalAccountResponse>("/auth/accounts", {
    method: "POST",
    body: payload,
  });

export const importLocalAccounts = (payload: ImportLocalAccountsPayload) =>
  request<ImportLocalAccountsResponse>("/auth/accounts/import", {
    method: "POST",
    body: payload,
  });

export const resetDefaultLocalAccounts = () =>
  request<ResetDefaultLocalAccountsResponse>("/auth/accounts/reset-defaults", {
    method: "POST",
  });

export const updateLocalAccount = (
  userId: string,
  payload: UpdateLocalAccountPayload,
) =>
  request<LocalAccountResponse>(`/auth/accounts/${userId}`, {
    method: "PATCH",
    body: payload,
  });

export const deleteLocalAccount = (userId: string) =>
  request<DeleteLocalAccountResponse>(`/auth/accounts/${userId}`, {
    method: "DELETE",
  });

export const setLocalAccountPassword = (
  userId: string,
  payload: SetLocalAccountPasswordPayload,
) =>
  request<SuccessResponse>(`/auth/accounts/${userId}/password`, {
    method: "POST",
    body: payload,
  });

export const setMyPassword = (payload: SetOwnPasswordPayload) =>
  request<SuccessResponse>("/auth/me/password", {
    method: "POST",
    body: payload,
  });

export const createProject = (payload: CreateProjectPayload) =>
  request("/projects", {
    method: "POST",
    body: payload,
  });

export const updateProject = (
  projectId: string,
  payload: UpdateProjectPayload,
) =>
  request(`/projects/${projectId}`, {
    method: "PATCH",
    body: payload,
  });

export const createTask = (projectId: string, payload: CreateTaskPayload) =>
  request(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: payload,
  });

export const updateTask = (taskId: string, payload: UpdateTaskPayload) =>
  request(`/tasks/${taskId}`, {
    method: "PATCH",
    body: payload,
  });

export const bulkUpdateTasks = (payload: BulkUpdateTasksPayload) =>
  request<{ updatedCount: number; updatedTaskIds: string[] }>("/tasks/bulk", {
    method: "PATCH",
    body: payload,
  });

export const bulkDeleteTasks = (payload: BulkDeleteTasksPayload) =>
  request<{ archivedCount: number; archivedTaskIds: string[] }>(
    "/tasks/bulk/archive",
    {
      method: "PATCH",
      body: payload,
    },
  );

export const getAuditHistory = (
  entityType: AuditEntityType,
  entityId: string,
  limit = 25,
) =>
  request<AuditHistoryEvent[]>(
    `/audit/${entityType}/${entityId}?limit=${limit.toString()}`,
  );

export const createSavedView = (payload: SavedViewPayload) =>
  request<SavedView>("/views", {
    method: "POST",
    body: payload,
  });

export const updateSavedView = (
  viewId: string,
  payload: UpdateSavedViewPayload,
) =>
  request<SavedView>(`/views/${viewId}`, {
    method: "PATCH",
    body: payload,
  });

export const renameSavedView = (
  viewId: string,
  payload: RenameSavedViewPayload,
) =>
  request<SavedView>(`/views/${viewId}/name`, {
    method: "PATCH",
    body: payload,
  });

export const deleteSavedView = (viewId: string) =>
  request<{ id: string }>(`/views/${viewId}`, {
    method: "DELETE",
  });

export const listLoopImports = () =>
  request<LoopImportJobSummary[]>("/imports");

export const createLoopImport = (payload: CreateLoopImportPayload) =>
  request<LoopImportJobSummary>("/imports/loop", {
    method: "POST",
    body: payload,
  });

export const getLoopImport = (importId: string) =>
  request<LoopImportJob>(`/imports/${importId}`);

export const updateLoopImportMapping = (
  importId: string,
  payload: UpdateLoopImportMappingPayload,
) =>
  request<LoopImportJob>(`/imports/${importId}/mapping`, {
    method: "PATCH",
    body: payload,
  });

export const commitLoopImport = (importId: string) =>
  request<LoopImportJob>(`/imports/${importId}/commit`, {
    method: "POST",
  });
