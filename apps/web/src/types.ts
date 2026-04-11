import type {
  AuditEntityType,
  CreateLocalAccountInput,
  GroupBy,
  ImportLocalAccountsInput,
  ImportRowOutcome,
  LoopImportField,
  LoopImportJobStatus,
  Priority,
  ProjectStatus,
  Role,
  SetLocalAccountPasswordInput,
  SetOwnPasswordInput,
  TaskStatus,
  UpdateLocalAccountInput,
} from "@tavi/schemas";

export type {
  AuditEntityType,
  DeleteLocalAccountResponse,
  ExportLocalAccountsResponse,
  GroupBy,
  ImportLocalAccountsResponse,
  ImportRowOutcome,
  LocalAccount,
  LocalLoginHintResponse,
  LocalAccountResponse,
  LocalAccountsResponse,
  LoopImportField,
  LoopImportJobStatus,
  ProjectStatus,
  ResetDefaultLocalAccountsResponse,
  SuccessResponse,
} from "@tavi/schemas";

export type WorkspaceUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type WorkspaceTask = {
  id: string;
  projectId: string;
  title: string;
  notes: string | null;
  assigneeUserId: string;
  assigneeName: string;
  dueDate: string | null;
  priority: Priority;
  status: TaskStatus;
  sortOrder: number;
  completedAt: string | null;
};

export type WorkspaceProject = {
  id: string;
  title: string;
  summary: string | null;
  notes: string | null;
  trackerLink: string | null;
  ownerUserId: string;
  ownerName: string;
  dueDate: string | null;
  priority: Priority;
  derivedStatus: ProjectStatus;
  displayStatus: ProjectStatus;
  manualStatus: ProjectStatus | null;
  taskTotalCount: number;
  taskTodoCount: number;
  taskInProgressCount: number;
  taskBlockedCount: number;
  taskDoneCount: number;
  taskCanceledCount: number;
  taskOverdueCount: number;
  tasks: WorkspaceTask[];
};

export type SavedView = {
  id: string;
  name: string;
  groupBy: GroupBy;
  search: string;
  statusFilter: ProjectStatus | null;
  collapsedGroupKeys: string[];
  expandedProjectIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceResponse = {
  currentUser: WorkspaceUser;
  users: WorkspaceUser[];
  projects: WorkspaceProject[];
  savedViews: SavedView[];
};

export type AuditHistoryActor = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

export type AuditHistoryEvent = {
  id: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  actor: AuditHistoryActor;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type CreateLocalAccountPayload = CreateLocalAccountInput;

export type UpdateLocalAccountPayload = UpdateLocalAccountInput;

export type SetLocalAccountPasswordPayload = SetLocalAccountPasswordInput;

export type SetOwnPasswordPayload = SetOwnPasswordInput;

export type ImportLocalAccountsPayload = ImportLocalAccountsInput;

export type CreateProjectPayload = {
  title: string;
  summary: string;
  notes?: string;
  trackerLink?: string;
  ownerUserId: string;
  dueDate: string;
  priority: Priority;
};

export type UpdateProjectPayload = Omit<
  Partial<CreateProjectPayload>,
  "notes" | "trackerLink"
> & {
  manualStatus?: ProjectStatus | null;
  notes?: string | null;
  trackerLink?: string | null;
};

export type CreateTaskPayload = {
  projectId: string;
  title: string;
  notes: string;
  assigneeUserId: string;
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
};

export type UpdateTaskPayload = Omit<Partial<CreateTaskPayload>, "notes"> & {
  notes?: string | null;
};

export type BulkUpdateTasksPayload = {
  taskIds: string[];
  assigneeUserId?: string;
  dueDate?: string | null;
  priority?: Priority;
  status?: TaskStatus;
};

export type BulkDeleteTasksPayload = {
  taskIds: string[];
};

export type SavedViewPayload = {
  name: string;
  groupBy: GroupBy;
  search: string;
  statusFilter: ProjectStatus | null;
  collapsedGroupKeys: string[];
  expandedProjectIds: string[];
};

export type UpdateSavedViewPayload = Omit<SavedViewPayload, "name">;

export type RenameSavedViewPayload = Pick<SavedViewPayload, "name">;

export type LoopImportMapping = Partial<Record<LoopImportField, string | null>>;

export type LoopImportFieldDefinition = {
  key: LoopImportField;
  label: string;
  required: boolean;
  description: string;
};

export type LoopImportCreatedBy = {
  id: string;
  email: string;
  name: string;
};

export type LoopImportPreviewRow = {
  rowNumber: number;
  projectTitle: string | null;
  projectExternalId: string | null;
  projectIdentityStrategy: "natural_key" | "source_id";
  taskTitle: string | null;
  taskExternalId: string | null;
  taskIdentityStrategy: "natural_key" | "source_id";
  taskStatus: TaskStatus;
  errors: string[];
  warnings: string[];
};

export type LoopImportPreview = {
  totalRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  warningRowCount: number;
  missingRequiredMappings: LoopImportField[];
  projectSourceIdRowCount: number;
  taskSourceIdRowCount: number;
  unmappedHeaders: string[];
  rows: LoopImportPreviewRow[];
};

export type LoopImportResultRow = {
  rowNumber: number;
  rowOutcome: ImportRowOutcome;
  projectOutcome: ImportRowOutcome;
  taskOutcome: ImportRowOutcome;
  projectId: string | null;
  taskId: string | null;
  message: string | null;
  validationErrors: string[];
};

export type LoopImportJobSummary = {
  id: string;
  fileName: string;
  sourceSystem: string;
  status: LoopImportJobStatus;
  totalRowCount: number;
  createdRowCount: number;
  updatedRowCount: number;
  skippedRowCount: number;
  failedRowCount: number;
  createdProjectCount: number;
  updatedProjectCount: number;
  createdTaskCount: number;
  updatedTaskCount: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  createdBy?: LoopImportCreatedBy;
};

export type LoopImportJob = LoopImportJobSummary & {
  fields: LoopImportFieldDefinition[];
  headers: string[];
  mapping: LoopImportMapping;
  suggestedMapping: LoopImportMapping;
  preview: LoopImportPreview;
  results: LoopImportResultRow[];
};

export type CreateLoopImportPayload = {
  fileName: string;
  content: string;
};

export type UpdateLoopImportMappingPayload = {
  mapping: LoopImportMapping;
};
