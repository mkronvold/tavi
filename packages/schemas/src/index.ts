import { z } from "zod";

const PROJECT_NOTES_MAX_LENGTH = 2_000;
const TASK_NOTES_MAX_LENGTH = 2_000;
const TRACKER_LINK_MAX_LENGTH = 2_048;

const trackerLinkUrlSchema = z
  .string()
  .trim()
  .max(TRACKER_LINK_MAX_LENGTH)
  .url();
const optionalTrackerLinkSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? undefined : value,
  trackerLinkUrlSchema.optional(),
);
const nullableTrackerLinkSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim().length === 0 ? null : value,
  trackerLinkUrlSchema.nullable().optional(),
);

export const roleSchema = z.enum(["admin", "editor", "viewer"]);
export type Role = z.infer<typeof roleSchema>;

export const auditEntityTypeSchema = z.enum([
  "auth",
  "project",
  "task",
  "saved_view",
]);
export type AuditEntityType = z.infer<typeof auditEntityTypeSchema>;

export const taskStatusSchema = z.enum([
  "todo",
  "in_progress",
  "blocked",
  "done",
  "canceled",
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const projectStatusSchema = z.enum([
  "not_started",
  "in_progress",
  "blocked",
  "done",
]);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const prioritySchema = z.enum(["low", "medium", "high"]);
export type Priority = z.infer<typeof prioritySchema>;

export const groupBySchema = z.enum(["none", "owner", "status", "priority"]);
export type GroupBy = z.infer<typeof groupBySchema>;

export const emailAddressSchema = z
  .string()
  .trim()
  .email()
  .transform((value) => value.toLowerCase());
export type EmailAddress = z.infer<typeof emailAddressSchema>;

export const localPasswordSchema = z.string().min(8).max(72);
export type LocalPassword = z.infer<typeof localPasswordSchema>;

export const localAccountNameSchema = z.string().trim().min(1).max(120);
export type LocalAccountName = z.infer<typeof localAccountNameSchema>;

export const localLoginSchema = z.object({
  email: emailAddressSchema,
  password: localPasswordSchema,
});
export type LocalLoginInput = z.infer<typeof localLoginSchema>;

export const localAccountSchema = z.object({
  id: z.string().min(1),
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type LocalAccount = z.infer<typeof localAccountSchema>;

export const localAccountResponseSchema = z.object({
  account: localAccountSchema,
});
export type LocalAccountResponse = z.infer<typeof localAccountResponseSchema>;

export const localAccountsResponseSchema = z.object({
  accounts: z.array(localAccountSchema),
});
export type LocalAccountsResponse = z.infer<typeof localAccountsResponseSchema>;

export const createLocalAccountSchema = z.object({
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
  password: localPasswordSchema,
});
export type CreateLocalAccountInput = z.infer<typeof createLocalAccountSchema>;

export const updateLocalAccountSchema = z
  .object({
    email: emailAddressSchema.optional(),
    name: localAccountNameSchema.optional(),
    role: roleSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.email === undefined &&
      value.name === undefined &&
      value.role === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one local account field must be provided",
        path: ["email"],
      });
    }
  });
export type UpdateLocalAccountInput = z.infer<typeof updateLocalAccountSchema>;

export const setLocalAccountPasswordSchema = z.object({
  password: localPasswordSchema,
});
export type SetLocalAccountPasswordInput = z.infer<
  typeof setLocalAccountPasswordSchema
>;

export const setOwnPasswordSchema = setLocalAccountPasswordSchema;
export type SetOwnPasswordInput = z.infer<typeof setOwnPasswordSchema>;

export const localAccountImportSchema = z.object({
  email: emailAddressSchema,
  name: localAccountNameSchema,
  role: roleSchema,
  password: z.union([localPasswordSchema, z.literal("")]).optional(),
});
export type LocalAccountImport = z.infer<typeof localAccountImportSchema>;

export const importLocalAccountsSchema = z
  .object({
    accounts: z.array(localAccountImportSchema).min(1),
  })
  .superRefine((value, context) => {
    const seenEmails = new Set<string>();

    value.accounts.forEach((account, index) => {
      if (seenEmails.has(account.email)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate local account emails are not allowed",
          path: ["accounts", index, "email"],
        });
        return;
      }

      seenEmails.add(account.email);
    });
  });
export type ImportLocalAccountsInput = z.infer<
  typeof importLocalAccountsSchema
>;

export const localAccountImportSummarySchema = z.object({
  processed: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});
export type LocalAccountImportSummary = z.infer<
  typeof localAccountImportSummarySchema
>;

export const importLocalAccountsResponseSchema = z.object({
  accounts: z.array(localAccountSchema),
  summary: localAccountImportSummarySchema,
});
export type ImportLocalAccountsResponse = z.infer<
  typeof importLocalAccountsResponseSchema
>;

export const localAccountExportSchema = localAccountImportSchema.omit({
  password: true,
});
export type LocalAccountExport = z.infer<typeof localAccountExportSchema>;

export const exportLocalAccountsResponseSchema = z.object({
  accounts: z.array(localAccountExportSchema),
});
export type ExportLocalAccountsResponse = z.infer<
  typeof exportLocalAccountsResponseSchema
>;

export const resetDefaultLocalAccountsResponseSchema = z.object({
  accounts: z.array(localAccountSchema),
});
export type ResetDefaultLocalAccountsResponse = z.infer<
  typeof resetDefaultLocalAccountsResponseSchema
>;

export const localLoginHintResponseSchema = z.object({
  visible: z.boolean(),
});
export type LocalLoginHintResponse = z.infer<
  typeof localLoginHintResponseSchema
>;

export const deleteLocalAccountResponseSchema = z.object({
  id: z.string().min(1),
});
export type DeleteLocalAccountResponse = z.infer<
  typeof deleteLocalAccountResponseSchema
>;

export const successResponseSchema = z.object({
  success: z.literal(true),
});
export type SuccessResponse = z.infer<typeof successResponseSchema>;

export const createProjectSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.string().max(500).optional(),
  notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).optional(),
  trackerLink: optionalTrackerLinkSchema,
  ownerUserId: z.string().min(1),
  dueDate: z.string().optional(),
  priority: prioritySchema.default("medium"),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial().extend({
  manualStatus: projectStatusSchema.optional().nullable(),
  notes: z.string().max(PROJECT_NOTES_MAX_LENGTH).optional().nullable(),
  trackerLink: nullableTrackerLinkSchema,
});
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1).max(120),
  notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional(),
  assigneeUserId: z.string().min(1),
  dueDate: z.string().optional(),
  priority: prioritySchema.default("medium"),
  status: taskStatusSchema.default("todo"),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema.partial().extend({
  notes: z.string().max(TASK_NOTES_MAX_LENGTH).optional().nullable(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const bulkArchiveTasksSchema = z
  .object({
    taskIds: z.array(z.string().min(1)).min(1).max(200),
  })
  .superRefine((value, context) => {
    if (new Set(value.taskIds).size !== value.taskIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate task ids are not allowed",
        path: ["taskIds"],
      });
    }
  });
export type BulkArchiveTasksInput = z.infer<typeof bulkArchiveTasksSchema>;

export const bulkUpdateTasksSchema = z
  .object({
    taskIds: z.array(z.string().min(1)).min(1).max(200),
    assigneeUserId: z.string().min(1).optional(),
    dueDate: z.string().optional().nullable(),
    priority: prioritySchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .superRefine((value, context) => {
    if (
      value.assigneeUserId === undefined &&
      value.dueDate === undefined &&
      value.priority === undefined &&
      value.status === undefined
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one task field must be provided",
        path: ["taskIds"],
      });
    }

    if (new Set(value.taskIds).size !== value.taskIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate task ids are not allowed",
        path: ["taskIds"],
      });
    }
  });
export type BulkUpdateTasksInput = z.infer<typeof bulkUpdateTasksSchema>;

export const savedViewStateSchema = z.object({
  groupBy: groupBySchema.default("owner"),
  search: z.string().max(250).default(""),
  statusFilter: projectStatusSchema.optional().nullable(),
  collapsedGroupKeys: z.array(z.string().min(1)).max(200).default([]),
  expandedProjectIds: z.array(z.string().min(1)).max(500).default([]),
});
export type SavedViewStateInput = z.infer<typeof savedViewStateSchema>;

export const createSavedViewSchema = savedViewStateSchema.extend({
  name: z.string().trim().min(1).max(80),
});
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;

export const updateSavedViewSchema = savedViewStateSchema;
export type UpdateSavedViewInput = z.infer<typeof updateSavedViewSchema>;

export const renameSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type RenameSavedViewInput = z.infer<typeof renameSavedViewSchema>;

export const auditHistoryParamsSchema = z.object({
  entityType: auditEntityTypeSchema,
  entityId: z.string().min(1),
});
export type AuditHistoryParams = z.infer<typeof auditHistoryParamsSchema>;

export const auditHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditHistoryQuery = z.infer<typeof auditHistoryQuerySchema>;

export const loopImportJobStatusSchema = z.enum([
  "queued_parse",
  "parsing",
  "awaiting_review",
  "queued_commit",
  "committing",
  "completed",
  "failed",
]);
export type LoopImportJobStatus = z.infer<typeof loopImportJobStatusSchema>;

export const importRowOutcomeSchema = z.enum([
  "pending",
  "created",
  "updated",
  "skipped",
  "failed",
]);
export type ImportRowOutcome = z.infer<typeof importRowOutcomeSchema>;

export const loopImportFieldSchema = z.enum([
  "projectExternalId",
  "projectTitle",
  "projectSummary",
  "projectNotes",
  "projectOwner",
  "projectDueDate",
  "projectPriority",
  "taskExternalId",
  "taskTitle",
  "taskNotes",
  "taskAssignee",
  "taskDueDate",
  "taskPriority",
  "taskStatus",
  "taskBlockedReason",
]);
export type LoopImportField = z.infer<typeof loopImportFieldSchema>;

export type LoopImportFieldDefinition = {
  key: LoopImportField;
  label: string;
  required: boolean;
  description: string;
};

export const loopImportFieldDefinitions: ReadonlyArray<LoopImportFieldDefinition> =
  [
    {
      key: "projectTitle",
      label: "Project title",
      required: true,
      description: "Top-level Loop track or project name.",
    },
    {
      key: "taskTitle",
      label: "Task title",
      required: true,
      description: "Checklist item or task title to create under the project.",
    },
    {
      key: "projectExternalId",
      label: "Project source id",
      required: false,
      description:
        "Stable source identifier used for idempotent project updates.",
    },
    {
      key: "taskExternalId",
      label: "Task source id",
      required: false,
      description: "Stable source identifier used for idempotent task updates.",
    },
    {
      key: "projectSummary",
      label: "Project summary",
      required: false,
      description: "Optional project summary or short description.",
    },
    {
      key: "projectNotes",
      label: "Project notes",
      required: false,
      description:
        "Optional project notes. Manual override reasons from prior exports can map here.",
    },
    {
      key: "projectOwner",
      label: "Project owner",
      required: false,
      description:
        "Owner email or display name. Defaults to the import creator.",
    },
    {
      key: "projectDueDate",
      label: "Project due date",
      required: false,
      description: "Project due date.",
    },
    {
      key: "projectPriority",
      label: "Project priority",
      required: false,
      description: "Maps to low, medium, or high.",
    },
    {
      key: "taskNotes",
      label: "Task notes",
      required: false,
      description: "Optional task notes, details, or longer-form context.",
    },
    {
      key: "taskAssignee",
      label: "Task assignee",
      required: false,
      description:
        "Assignee email or display name. Defaults to the import creator.",
    },
    {
      key: "taskDueDate",
      label: "Task due date",
      required: false,
      description: "Task due date.",
    },
    {
      key: "taskPriority",
      label: "Task priority",
      required: false,
      description: "Maps to low, medium, or high.",
    },
    {
      key: "taskStatus",
      label: "Task status",
      required: false,
      description:
        "Maps common Loop-style status values to Tavi task statuses.",
    },
    {
      key: "taskBlockedReason",
      label: "Task blocked detail",
      required: false,
      description:
        "Optional source column to append into task notes when blockers are tracked separately.",
    },
  ] as const;

export type LoopImportMapping = Partial<Record<LoopImportField, string | null>>;

export const loopImportMappingSchema = z.object({
  projectExternalId: z.string().trim().min(1).max(200).nullable().optional(),
  projectTitle: z.string().trim().min(1).max(200).nullable().optional(),
  projectSummary: z.string().trim().min(1).max(200).nullable().optional(),
  projectNotes: z.string().trim().min(1).max(200).nullable().optional(),
  projectOwner: z.string().trim().min(1).max(200).nullable().optional(),
  projectDueDate: z.string().trim().min(1).max(200).nullable().optional(),
  projectPriority: z.string().trim().min(1).max(200).nullable().optional(),
  taskExternalId: z.string().trim().min(1).max(200).nullable().optional(),
  taskTitle: z.string().trim().min(1).max(200).nullable().optional(),
  taskNotes: z.string().trim().min(1).max(200).nullable().optional(),
  taskAssignee: z.string().trim().min(1).max(200).nullable().optional(),
  taskDueDate: z.string().trim().min(1).max(200).nullable().optional(),
  taskPriority: z.string().trim().min(1).max(200).nullable().optional(),
  taskStatus: z.string().trim().min(1).max(200).nullable().optional(),
  taskBlockedReason: z.string().trim().min(1).max(200).nullable().optional(),
});

export const createLoopImportSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  content: z.string().min(1).max(5_000_000),
});
export type CreateLoopImportInput = z.infer<typeof createLoopImportSchema>;

export const updateLoopImportMappingSchema = z.object({
  mapping: loopImportMappingSchema,
});
export type UpdateLoopImportMappingInput = z.infer<
  typeof updateLoopImportMappingSchema
>;

export type LoopImportUser = {
  id: string;
  email: string;
  name: string;
};

export type PreparedLoopImportEntity = {
  dueDate: string | null;
  externalId: string | null;
  identityStrategy: "natural_key" | "source_id";
  priority: Priority;
};

export type PreparedLoopImportProject = PreparedLoopImportEntity & {
  notes: string | null;
  ownerUserId: string;
  summary: string | null;
  title: string | null;
};

export type PreparedLoopImportTask = PreparedLoopImportEntity & {
  assigneeUserId: string;
  notes: string | null;
  status: TaskStatus;
  title: string | null;
};

export type PreparedLoopImportRow = {
  errors: string[];
  project: PreparedLoopImportProject;
  rawRow: Record<string, string | null>;
  rowNumber: number;
  task: PreparedLoopImportTask;
  warnings: string[];
};

export type LoopImportPreview = {
  invalidRowCount: number;
  missingRequiredMappings: LoopImportField[];
  projectSourceIdRowCount: number;
  rows: PreparedLoopImportRow[];
  taskSourceIdRowCount: number;
  totalRowCount: number;
  validRowCount: number;
  warningRowCount: number;
};

const LOOP_IMPORT_REQUIRED_FIELDS = ["projectTitle", "taskTitle"] as const;

const LOOP_IMPORT_FIELD_ALIASES: Record<LoopImportField, string[]> = {
  projectExternalId: ["project id", "project external id", "track id"],
  projectTitle: ["project title", "project", "track title", "track name"],
  projectSummary: ["project summary", "project description"],
  projectNotes: [
    "project notes",
    "manual status reason",
    "override reason",
    "project reason",
  ],
  projectOwner: ["project owner", "owner", "project lead"],
  projectDueDate: ["project due date", "project due"],
  projectPriority: ["project priority"],
  taskExternalId: ["task id", "task external id", "checklist item id"],
  taskTitle: ["task title", "task", "checklist item", "checklist title"],
  taskNotes: ["task notes", "task description", "task details"],
  taskAssignee: ["task assignee", "assignee"],
  taskDueDate: ["task due date", "item due date"],
  taskPriority: ["task priority"],
  taskStatus: ["task status", "item status", "checklist status"],
  taskBlockedReason: ["blocked reason", "task blocked reason", "blocker"],
};

export function suggestLoopImportMapping(headers: string[]): LoopImportMapping {
  const normalizedHeaders = new Map<string, string[]>();

  for (const header of headers) {
    const normalizedHeader = normalizeLoopImportHeader(header);
    const existing = normalizedHeaders.get(normalizedHeader) ?? [];
    existing.push(header);
    normalizedHeaders.set(normalizedHeader, existing);
  }

  const usedHeaders = new Set<string>();
  const mapping: LoopImportMapping = {};

  for (const field of loopImportFieldDefinitions) {
    const aliases = LOOP_IMPORT_FIELD_ALIASES[field.key] ?? [];

    for (const alias of aliases) {
      const candidates = normalizedHeaders.get(alias) ?? [];
      const match = candidates.find((candidate) => !usedHeaders.has(candidate));

      if (!match) {
        continue;
      }

      mapping[field.key] = match;
      usedHeaders.add(match);
      break;
    }
  }

  return mapping;
}

export function prepareLoopImportRow({
  defaultUserId,
  mapping,
  rawRow,
  rowNumber,
  users,
}: {
  defaultUserId: string;
  mapping: LoopImportMapping;
  rawRow: Record<string, unknown>;
  rowNumber: number;
  users: LoopImportUser[];
}): PreparedLoopImportRow {
  const normalizedRawRow = Object.fromEntries(
    Object.entries(rawRow).map(([key, value]) => [key, toImportString(value)]),
  ) as Record<string, string | null>;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const field of LOOP_IMPORT_REQUIRED_FIELDS) {
    if (!mapping[field]) {
      const fieldDefinition = loopImportFieldDefinitions.find(
        (definition) => definition.key === field,
      );
      errors.push(`Map a column to ${fieldDefinition?.label ?? field}`);
    }
  }

  const projectTitle = readMappedValue(normalizedRawRow, mapping.projectTitle);
  const taskTitle = readMappedValue(normalizedRawRow, mapping.taskTitle);
  const projectExternalId = readMappedValue(
    normalizedRawRow,
    mapping.projectExternalId,
  );
  const taskExternalId = readMappedValue(
    normalizedRawRow,
    mapping.taskExternalId,
  );
  const projectSummary = readMappedValue(
    normalizedRawRow,
    mapping.projectSummary,
  );
  const projectNotes = readMappedValue(normalizedRawRow, mapping.projectNotes);
  const taskNotes = readMappedValue(normalizedRawRow, mapping.taskNotes);
  const taskBlockedReason = readMappedValue(
    normalizedRawRow,
    mapping.taskBlockedReason,
  );

  if (mapping.projectTitle && !projectTitle) {
    errors.push("Project title is required");
  }

  if (mapping.taskTitle && !taskTitle) {
    errors.push("Task title is required");
  }

  const projectDueDate = normalizeImportDate(
    readMappedValue(normalizedRawRow, mapping.projectDueDate),
    "Project due date",
    errors,
  );
  const taskDueDate = normalizeImportDate(
    readMappedValue(normalizedRawRow, mapping.taskDueDate),
    "Task due date",
    errors,
  );
  const projectPriority = normalizeImportPriority(
    readMappedValue(normalizedRawRow, mapping.projectPriority),
    "Project priority",
    errors,
  );
  const taskPriority = normalizeImportPriority(
    readMappedValue(normalizedRawRow, mapping.taskPriority),
    "Task priority",
    errors,
  );
  const taskStatus = normalizeImportTaskStatus(
    readMappedValue(normalizedRawRow, mapping.taskStatus),
    errors,
  );
  const projectOwnerUserId = resolveImportUser({
    defaultUserId,
    fieldLabel: "Project owner",
    users,
    value: readMappedValue(normalizedRawRow, mapping.projectOwner),
    warnings,
  });
  const taskAssigneeUserId = resolveImportUser({
    defaultUserId,
    fieldLabel: "Task assignee",
    users,
    value: readMappedValue(normalizedRawRow, mapping.taskAssignee),
    warnings,
  });

  return {
    errors,
    project: {
      dueDate: projectDueDate,
      externalId: projectExternalId,
      identityStrategy: projectExternalId ? "source_id" : "natural_key",
      notes: projectNotes,
      ownerUserId: projectOwnerUserId,
      priority: projectPriority,
      summary: projectSummary,
      title: projectTitle,
    },
    rawRow: normalizedRawRow,
    rowNumber,
    task: {
      assigneeUserId: taskAssigneeUserId,
      dueDate: taskDueDate,
      externalId: taskExternalId,
      identityStrategy: taskExternalId ? "source_id" : "natural_key",
      notes: mergeTaskNotes(taskNotes, taskBlockedReason),
      priority: taskPriority,
      status: taskStatus,
      title: taskTitle,
    },
    warnings,
  };
}

export function buildLoopImportPreview({
  defaultUserId,
  mapping,
  rawRows,
  sampleSize = 25,
  users,
}: {
  defaultUserId: string;
  mapping: LoopImportMapping;
  rawRows: Array<Record<string, unknown>>;
  sampleSize?: number;
  users: LoopImportUser[];
}): LoopImportPreview {
  const rows = rawRows.map((rawRow, index) =>
    prepareLoopImportRow({
      defaultUserId,
      mapping,
      rawRow,
      rowNumber: index + 1,
      users,
    }),
  );

  return {
    invalidRowCount: rows.filter((row) => row.errors.length > 0).length,
    missingRequiredMappings: LOOP_IMPORT_REQUIRED_FIELDS.filter(
      (field) => !mapping[field],
    ),
    projectSourceIdRowCount: rows.filter(
      (row) => row.project.identityStrategy === "source_id",
    ).length,
    rows: sampleSize > 0 ? rows.slice(0, sampleSize) : rows,
    taskSourceIdRowCount: rows.filter(
      (row) => row.task.identityStrategy === "source_id",
    ).length,
    totalRowCount: rows.length,
    validRowCount: rows.filter((row) => row.errors.length === 0).length,
    warningRowCount: rows.filter((row) => row.warnings.length > 0).length,
  };
}

export function normalizeLoopImportHeader(header: string) {
  return header
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .trim();
}

function readMappedValue(
  rawRow: Record<string, string | null>,
  header: string | null | undefined,
) {
  if (!header) {
    return null;
  }

  return rawRow[header] ?? null;
}

function toImportString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const nextValue = String(value).trim();
  return nextValue ? nextValue : null;
}

function normalizeImportDate(
  value: string | null,
  fieldLabel: string,
  errors: string[],
) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    errors.push(`${fieldLabel} is not a valid date`);
    return null;
  }

  return parsed.toISOString();
}

function normalizeImportPriority(
  value: string | null,
  fieldLabel: string,
  errors: string[],
): Priority {
  if (!value) {
    return "medium";
  }

  const normalizedValue = normalizeLoopImportHeader(value).replace(/ /g, "_");

  switch (normalizedValue) {
    case "low":
    case "minor":
    case "p3":
      return "low";
    case "medium":
    case "normal":
    case "med":
    case "p2":
      return "medium";
    case "high":
    case "urgent":
    case "critical":
    case "p1":
      return "high";
    default:
      errors.push(`${fieldLabel} must map to low, medium, or high`);
      return "medium";
  }
}

function normalizeImportTaskStatus(value: string | null, errors: string[]) {
  if (!value) {
    return "todo";
  }

  const normalizedValue = normalizeLoopImportHeader(value).replace(/ /g, "_");

  switch (normalizedValue) {
    case "todo":
    case "to_do":
    case "not_started":
    case "open":
    case "pending":
      return "todo";
    case "in_progress":
    case "inprogress":
    case "doing":
    case "active":
      return "in_progress";
    case "blocked":
    case "on_hold":
    case "stuck":
      return "blocked";
    case "done":
    case "complete":
    case "completed":
    case "closed":
      return "done";
    case "canceled":
    case "cancelled":
    case "wont_do":
      return "canceled";
    default:
      errors.push(`Task status "${value}" is not supported`);
      return "todo";
  }
}

function resolveImportUser({
  defaultUserId,
  fieldLabel,
  users,
  value,
  warnings,
}: {
  defaultUserId: string;
  fieldLabel: string;
  users: LoopImportUser[];
  value: string | null;
  warnings: string[];
}) {
  if (!value) {
    return defaultUserId;
  }

  const normalizedValue = value.trim().toLowerCase();
  const matchedUser = users.find(
    (user) =>
      user.email.trim().toLowerCase() === normalizedValue ||
      user.name.trim().toLowerCase() === normalizedValue,
  );

  if (matchedUser) {
    return matchedUser.id;
  }

  warnings.push(
    `${fieldLabel} "${value}" did not match a known user. Defaulted to the import creator.`,
  );
  return defaultUserId;
}

function mergeTaskNotes(notes: string | null, blockedReason: string | null) {
  const normalizedNotes = normalizeOptionalImportText(notes);
  const normalizedBlockedReason = normalizeOptionalImportText(blockedReason);

  if (normalizedNotes && normalizedBlockedReason) {
    return `${normalizedNotes}\n\nBlocked: ${normalizedBlockedReason}`;
  }

  if (normalizedNotes) {
    return normalizedNotes;
  }

  if (normalizedBlockedReason) {
    return `Blocked: ${normalizedBlockedReason}`;
  }

  return null;
}

function normalizeOptionalImportText(value: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
