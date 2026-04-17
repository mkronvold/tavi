import type { AuditEntityType } from "@tavi/schemas";
import type {
  ApplyBackupRestorePayload,
  ApplyBackupRestoreResult,
  AuditChangesQueryPayload,
  AuditHistoryEvent,
  AuditLogRetentionPolicy,
  AuditLoginsQueryPayload,
  BackupRestorePreview,
  BackupStatus,
  BulkCopyTasksPayload,
  BulkDeleteTasksPayload,
  BulkUpdateTasksPayload,
  ConvertProjectToTaskResponse,
  ConvertTaskToProjectResponse,
  CreatePersonalTodoPayload,
  CreateLocalAccountPayload,
  CreateLoopImportPayload,
  CreateProjectPayload,
  CreateTaskPayload,
  DeleteLocalAccountPayload,
  DeleteLocalAccountResponse,
  DeletePersonalTodoResponse,
  DeleteProjectResponse,
  DeleteTaskResponse,
  ExportLocalAccountsResponse,
  ImportPersonalTodosPayload,
  ImportPersonalTodosResponse,
  ImportLocalAccountsPayload,
  ImportLocalAccountsResponse,
  LoginPayload,
  LocalLoginHintResponse,
  LocalAccountResponse,
  LocalAccountsResponse,
  LoopImportJob,
  LoopImportJobSummary,
  NotificationPreferences,
  ReorderPersonalTodosPayload,
  PurgeAuditLogsPayload,
  PurgeAuditLogsResponse,
  ResetDefaultLocalAccountsResponse,
  SetLocalAccountPasswordPayload,
  SetAuditLogRetentionPayload,
  SetOwnPasswordPayload,
  SmtpStatus,
  UpdateEmailSettingsPayload,
  UpdateNotificationPreferencesPayload,
  UpdateOwnProfilePayload,
  UpdatePersonalTodoPayload,
  UpdateProjectPayload,
  UpdateLoopImportMappingPayload,
  UpdateLoopImportRowDecisionsPayload,
  UpdateLocalAccountPayload,
  UpdateSavedViewPayload,
  UpdateTaskPayload,
  RenameSavedViewPayload,
  ResetWorkspaceExamplesPayload,
  ResetWorkspaceExamplesResponse,
  SavedView,
  SavedViewPayload,
  SuccessResponse,
  UpdateBackupSettingsPayload,
  UploadBackupFileInput,
  WorkspaceResponse,
  PreviewBackupRestorePayload,
} from "./types";
import { getApiBaseUrl } from "./runtime-config";

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
};

const API_UNAVAILABLE_MESSAGE =
  "The Tavi API is unavailable and may be restarting. Please wait a moment and try again.";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isApiUnavailableError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 502 || error.status === 503) &&
    error.message === API_UNAVAILABLE_MESSAGE
  );
}

type ApiErrorPayload = {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  formErrors?: string[];
  message?: string | string[];
};

function toApiErrorMessage(payload: ApiErrorPayload, fallback: string): string {
  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (Array.isArray(payload.message) && payload.message.length > 0) {
    return payload.message.join(", ");
  }

  const messages = [
    ...(payload.formErrors ?? []).filter((message) => message.length > 0),
    ...Object.entries(payload.fieldErrors ?? {}).flatMap(
      ([field, fieldMessages]) =>
        (fieldMessages ?? [])
          .filter((message) => message.length > 0)
          .map((message) => `${field}: ${message}`),
    ),
  ];

  if (messages.length > 0) {
    return messages.join(", ");
  }

  return payload.error ?? fallback;
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const hasBody = options.body !== undefined;
  const headers = new Headers(options.headers);

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;

  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      ...options,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError(503, API_UNAVAILABLE_MESSAGE);
  }

  if (!response.ok) {
    if (response.status === 502) {
      throw new ApiError(response.status, API_UNAVAILABLE_MESSAGE);
    }

    let message = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as ApiErrorPayload;
      message = toApiErrorMessage(payload, message);
    } catch {
      // Ignore JSON parsing errors and keep the HTTP message.
    }

    throw new ApiError(response.status, message);
  }

  return (await response.json()) as T;
}

function toQueryString(params: Record<string, number | string | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") {
      continue;
    }

    searchParams.set(key, value.toString());
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

export const getWorkspace = async () => {
  const response = await request<
    WorkspaceResponse & {
      personalTodos?: WorkspaceResponse["personalTodos"];
    }
  >("/workspace");

  return {
    ...response,
    personalTodos: Array.isArray(response.personalTodos)
      ? response.personalTodos
      : [],
  } satisfies WorkspaceResponse;
};

export const resetWorkspaceExamples = (
  payload: ResetWorkspaceExamplesPayload,
) =>
  request<ResetWorkspaceExamplesResponse>("/workspace/reset-examples", {
    method: "POST",
    body: payload,
  });

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

export const deleteLocalAccount = (
  userId: string,
  payload?: DeleteLocalAccountPayload,
) =>
  request<DeleteLocalAccountResponse>(`/auth/accounts/${userId}`, {
    method: "DELETE",
    body: payload,
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

export const updateMyProfile = (payload: UpdateOwnProfilePayload) =>
  request<LocalAccountResponse>("/auth/me", {
    method: "PATCH",
    body: payload,
  });

export const createProject = (payload: CreateProjectPayload) =>
  request<{ id: string }>("/projects", {
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

export const convertProjectToTask = (
  projectId: string,
  payload: UpdateProjectPayload,
) =>
  request<ConvertProjectToTaskResponse>(
    `/projects/${projectId}/convert-to-task`,
    {
      method: "POST",
      body: payload,
    },
  );

export const deleteProject = (projectId: string) =>
  request<DeleteProjectResponse>(`/projects/${projectId}`, {
    method: "DELETE",
  });

export const createTask = (projectId: string, payload: CreateTaskPayload) =>
  request(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: payload,
  });

export const createPersonalTodo = (payload: CreatePersonalTodoPayload) =>
  request("/personal-todos", {
    method: "POST",
    body: payload,
  });

export const reorderProjectTasks = (
  projectId: string,
  payload: { taskIds: string[] },
) =>
  request<SuccessResponse>(`/projects/${projectId}/tasks/reorder`, {
    method: "PATCH",
    body: payload,
  });

export const reorderPersonalTodos = (payload: ReorderPersonalTodosPayload) =>
  request<SuccessResponse>("/personal-todos/reorder", {
    method: "PATCH",
    body: payload,
  });

export const updateTask = (taskId: string, payload: UpdateTaskPayload) =>
  request(`/tasks/${taskId}`, {
    method: "PATCH",
    body: payload,
  });

export const updatePersonalTodo = (
  todoId: string,
  payload: UpdatePersonalTodoPayload,
) =>
  request(`/personal-todos/${todoId}`, {
    method: "PATCH",
    body: payload,
  });

export const convertTaskToProject = (
  taskId: string,
  payload: Omit<UpdateTaskPayload, "projectId">,
) =>
  request<ConvertTaskToProjectResponse>(`/tasks/${taskId}/convert-to-project`, {
    method: "POST",
    body: payload,
  });

export const deleteTask = (taskId: string) =>
  request<DeleteTaskResponse>(`/tasks/${taskId}`, {
    method: "DELETE",
  });

export const deletePersonalTodo = (todoId: string) =>
  request<DeletePersonalTodoResponse>(`/personal-todos/${todoId}`, {
    method: "DELETE",
  });

export const importPersonalTodos = (payload: ImportPersonalTodosPayload) =>
  request<ImportPersonalTodosResponse>("/personal-todos/import", {
    method: "POST",
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

export const bulkCopyTasks = (payload: BulkCopyTasksPayload) =>
  request<{
    copiedCount: number;
    copiedTaskIds: string[];
    targetProjectId: string;
  }>("/tasks/bulk/copy", {
    method: "POST",
    body: payload,
  });

export const getAuditHistory = (
  entityType: AuditEntityType,
  entityId: string,
  limit = 25,
) =>
  request<AuditHistoryEvent[]>(
    `/audit/${entityType}/${entityId}?limit=${limit.toString()}`,
  );

export const listAuditChanges = (query: AuditChangesQueryPayload) =>
  request<AuditHistoryEvent[]>(`/audit/changes${toQueryString(query)}`);

export const listAuditLogins = (query: AuditLoginsQueryPayload) =>
  request<AuditHistoryEvent[]>(`/audit/logins${toQueryString(query)}`);

export const getAuditLogRetention = () =>
  request<AuditLogRetentionPolicy>("/audit/retention");

export const setAuditLogRetention = (payload: SetAuditLogRetentionPayload) =>
  request<AuditLogRetentionPolicy>("/audit/retention", {
    method: "PUT",
    body: payload,
  });

export const purgeAuditLogs = (payload: PurgeAuditLogsPayload) =>
  request<PurgeAuditLogsResponse>("/audit/purge", {
    method: "POST",
    body: payload,
  });

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

export const deleteLoopImport = (importId: string) =>
  request<{ id: string }>(`/imports/${importId}`, {
    method: "DELETE",
  });

export const updateLoopImportMapping = (
  importId: string,
  payload: UpdateLoopImportMappingPayload,
) =>
  request<LoopImportJob>(`/imports/${importId}/mapping`, {
    method: "PATCH",
    body: payload,
  });

export const updateLoopImportRowDecisions = (
  importId: string,
  rowNumber: number,
  payload: UpdateLoopImportRowDecisionsPayload,
) =>
  request<LoopImportJob>(
    `/imports/${importId}/rows/${rowNumber.toString()}/decisions`,
    {
      method: "PATCH",
      body: payload,
    },
  );

export const commitLoopImport = (importId: string) =>
  request<LoopImportJob>(`/imports/${importId}/commit`, {
    method: "POST",
  });

// Email

export const updateEmailSettings = (payload: UpdateEmailSettingsPayload) =>
  request<SmtpStatus>("/auth/email/settings", {
    method: "PUT",
    body: payload,
  });

export const getSmtpStatus = () => request<SmtpStatus>("/auth/email/status");

export const getBackupStatus = () => request<BackupStatus>("/backups");

export const updateBackupSettings = (payload: UpdateBackupSettingsPayload) =>
  request<BackupStatus>("/backups", {
    method: "PUT",
    body: payload,
  });

export const createBackupNow = () =>
  request<BackupStatus>("/backups/create", {
    method: "POST",
  });

export const uploadBackupFile = (payload: UploadBackupFileInput) =>
  request<BackupStatus>("/backups/upload", {
    method: "POST",
    body: payload,
  });

export const deleteBackupFile = (fileName: string) =>
  request<BackupStatus>(`/backups/${encodeURIComponent(fileName)}`, {
    method: "DELETE",
  });

export async function downloadBackupFile(fileName: string) {
  const response = await fetch(
    `${getApiBaseUrl()}/backups/${encodeURIComponent(fileName)}/download`,
    {
      credentials: "include",
    },
  );

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;

    try {
      const payload = (await response.json()) as ApiErrorPayload;
      message = toApiErrorMessage(payload, message);
    } catch {
      // Fall back to the HTTP status when the response body is not JSON.
    }

    throw new ApiError(response.status, message);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  window.URL.revokeObjectURL(objectUrl);
}

export const previewBackupRestore = (payload: PreviewBackupRestorePayload) =>
  request<BackupRestorePreview>("/backups/restore/preview", {
    method: "POST",
    body: payload,
  });

export const applyBackupRestore = (payload: ApplyBackupRestorePayload) =>
  request<ApplyBackupRestoreResult>("/backups/restore/apply", {
    method: "POST",
    body: payload,
  });

export const getNotificationPreferences = () =>
  request<NotificationPreferences>("/auth/notification/preferences");

export const updateNotificationPreferences = (
  payload: UpdateNotificationPreferencesPayload,
) =>
  request<NotificationPreferences>("/auth/notification/preferences", {
    method: "PUT",
    body: payload,
  });
