import { setTimeout as delay } from "node:timers/promises";
import {
  buildAuditChanges,
  buildPreparedLoopImportProjectKey,
  buildPreparedLoopImportTaskKey,
  expandLoopImportRows,
  hasPreparedLoopImportTask,
  loopImportMappingSchema,
  prepareLoopImportRow,
  suggestLoopImportMapping,
} from "@tavi/schemas";
import type { LoopImportMapping, LoopImportUser } from "@tavi/schemas";
import { parse } from "csv-parse/sync";
import { Prisma, PrismaClient } from "@prisma/client";
import type { WorkerObservability } from "./worker-observability.js";

const DEFAULT_IDLE_DELAY_MS = 3_000;
const DEFAULT_WORK_DELAY_MS = 250;
const IMPORT_BATCH_SIZE = 50;

type WorkerOptions = {
  idleDelayMs?: number;
  workDelayMs?: number;
};

type ImportJobRecord = {
  createdByUserId: string;
  fileName: string;
  id: string;
  mapping: Prisma.JsonValue | null;
  sourceContent: string;
  sourceSystem: string;
  status:
    | "awaiting_review"
    | "committing"
    | "parsing"
    | "queued_commit"
    | "queued_parse";
};

type ImportRowRecord = {
  id: string;
  projectOverlapAction: "add" | "ignore" | "update";
  rawData: Prisma.JsonValue;
  rowNumber: number;
  taskOverlapAction: "add" | "ignore" | "update";
};

type WorkerState = {
  nextSortOrderByProjectId: Map<string, number>;
  projectIdByKey: Map<string, string>;
  taskIdByKey: Map<string, string>;
};

type ImportAuditActor = {
  email: string;
  id: string;
  name: string;
  role: "admin" | "editor" | "viewer";
};

type ProjectMutationResult = {
  changedFields: string[];
  id: string;
  outcome: "created" | "skipped" | "updated";
  ownerUserId: string | null;
  priority: "high" | "low" | "medium";
  sourceExternalId: string | null;
  title: string;
};

type TaskMutationResult = {
  changedFields: string[];
  id: string | null;
  outcome: "created" | "skipped" | "updated";
  previousProjectId: string | null;
  projectId: string;
  sourceExternalId: string | null;
  status: "blocked" | "canceled" | "done" | "in_progress" | "on_hold" | "todo";
  title: string | null;
};

function isImportCleanupRaceError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2003" || error.code === "P2025")
  );
}

export class LoopImportWorker {
  private readonly idleDelayMs: number;

  private readonly workDelayMs: number;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly observability: WorkerObservability,
    options: WorkerOptions = {},
  ) {
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
    this.workDelayMs = options.workDelayMs ?? DEFAULT_WORK_DELAY_MS;
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      const handledJob = await this.processNextJob();
      await delay(handledJob ? this.workDelayMs : this.idleDelayMs, undefined, {
        signal,
      }).catch(() => undefined);
    }
  }

  private async processNextJob() {
    const parseJobId = await this.claimJob("queued_parse", "parsing");

    if (parseJobId) {
      await this.processParseJob(parseJobId);
      return true;
    }

    const commitJobId = await this.claimJob("queued_commit", "committing");

    if (commitJobId) {
      await this.processCommitJob(commitJobId);
      return true;
    }

    return false;
  }

  private async claimJob(
    from: "queued_commit" | "queued_parse",
    to: "committing" | "parsing",
  ) {
    const candidate = await this.prisma.importJob.findFirst({
      where: { status: from },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!candidate) {
      return null;
    }

    const claimed = await this.prisma.importJob.updateMany({
      where: {
        id: candidate.id,
        status: from,
      },
      data: {
        completedAt: null,
        lastError: null,
        status: to,
      },
    });

    return claimed.count === 1 ? candidate.id : null;
  }

  private async processParseJob(jobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: {
        fileName: true,
        id: true,
        sourceContent: true,
      },
    });

    if (!job) {
      return;
    }

    const startedAt = this.observability.startJob("parse");

    try {
      const parsed = parseImportContent(job.sourceContent);
      const suggestedMapping = suggestLoopImportMapping(parsed.headers);
      const stagedRows = expandLoopImportRows({
        mapping: suggestedMapping,
        rawRows: parsed.rows,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.importRow.deleteMany({
          where: { importId: job.id },
        });

        if (stagedRows.length > 0) {
          await tx.importRow.createMany({
            data: stagedRows.map((row, index) => ({
              importId: job.id,
              rawData: row as Prisma.InputJsonValue,
              rowNumber: index + 1,
            })),
          });
        }

        await tx.importJob.update({
          where: { id: job.id },
          data: {
            createdProjectCount: 0,
            createdRowCount: 0,
            createdTaskCount: 0,
            failedRowCount: 0,
            headers: parsed.headers as Prisma.InputJsonValue,
            lastError: null,
            mapping: suggestedMapping as Prisma.InputJsonValue,
            skippedRowCount: 0,
            status: "awaiting_review",
            suggestedMapping: suggestedMapping as Prisma.InputJsonValue,
            totalRowCount: stagedRows.length,
            updatedProjectCount: 0,
            updatedRowCount: 0,
            updatedTaskCount: 0,
          },
        });
      });

      this.observability.logger.info("worker.import.parsed", {
        fileName: job.fileName,
        importId: job.id,
        jobType: "parse",
        stagedRows: stagedRows.length,
      });
      this.observability.finishJob("parse", "completed", startedAt);
    } catch (error) {
      if (isImportCleanupRaceError(error)) {
        this.observability.logger.info("worker.import.removed", {
          fileName: job.fileName,
          importId: job.id,
          jobType: "parse",
        });
        this.observability.finishJob("parse", "completed", startedAt);
        return;
      }

      try {
        await this.failJob(job.id, error);
      } finally {
        this.observability.finishJob("parse", "failed", startedAt);
      }
    }
  }

  private async processCommitJob(jobId: string) {
      const job = await this.prisma.importJob.findUnique({
        where: { id: jobId },
        select: {
          createdBy: {
            select: {
              email: true,
              id: true,
              name: true,
              roleAssignment: {
                select: {
                  role: true,
                },
              },
            },
          },
          createdByUserId: true,
          fileName: true,
          id: true,
        mapping: true,
        sourceSystem: true,
        sourceContent: true,
        status: true,
      },
    });

      if (!job) {
        return;
      }

      const auditActor: ImportAuditActor = {
        email: job.createdBy?.email ?? "unknown@tavi.local",
        id: job.createdBy?.id ?? job.createdByUserId,
        name: job.createdBy?.name ?? "Unknown user",
        role: job.createdBy?.roleAssignment?.role ?? "viewer",
      };

    const startedAt = this.observability.startJob("commit");

    try {
      const users = await this.getImportUsers();
      const rows = await this.prisma.importRow.findMany({
        where: { importId: job.id },
        orderBy: { rowNumber: "asc" },
        select: {
          id: true,
          projectOverlapAction: true,
          rawData: true,
          rowNumber: true,
          taskOverlapAction: true,
        },
      });

      if (rows.length === 0) {
        throw new Error("No staged rows are available for commit");
      }

      const mapping = readLoopImportMapping(job.mapping);
      const state: WorkerState = {
        nextSortOrderByProjectId: new Map<string, number>(),
        projectIdByKey: new Map<string, string>(),
        taskIdByKey: new Map<string, string>(),
      };
      const touchedProjectIds = new Set<string>();

      for (let index = 0; index < rows.length; index += IMPORT_BATCH_SIZE) {
        const batch = rows.slice(index, index + IMPORT_BATCH_SIZE);

        for (const row of batch) {
          const affectedProjectIds = await this.processImportRow(
            job,
            auditActor,
            row,
            mapping,
            users,
            state,
          );

          for (const projectId of affectedProjectIds) {
            touchedProjectIds.add(projectId);
          }
        }
      }

      await this.recalculateProjects([...touchedProjectIds]);

      const summary = await summarizeRowOutcomes(this.prisma, job.id);

      await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          completedAt: new Date(),
          createdProjectCount: summary.createdProjectCount,
          createdRowCount: summary.createdRowCount,
          createdTaskCount: summary.createdTaskCount,
          failedRowCount: summary.failedRowCount,
          lastError: null,
          skippedRowCount: summary.skippedRowCount,
          status: "completed",
          updatedProjectCount: summary.updatedProjectCount,
          updatedRowCount: summary.updatedRowCount,
          updatedTaskCount: summary.updatedTaskCount,
        },
      });

      this.observability.logger.info("worker.import.committed", {
        createdRows: summary.createdRowCount,
        failedRows: summary.failedRowCount,
        fileName: job.fileName,
        importId: job.id,
        jobType: "commit",
        updatedRows: summary.updatedRowCount,
      });
      this.observability.finishJob("commit", "completed", startedAt);
    } catch (error) {
      if (isImportCleanupRaceError(error)) {
        this.observability.logger.info("worker.import.removed", {
          fileName: job.fileName,
          importId: job.id,
          jobType: "commit",
        });
        this.observability.finishJob("commit", "completed", startedAt);
        return;
      }

      try {
        await this.failJob(job.id, error);
      } finally {
        this.observability.finishJob("commit", "failed", startedAt);
      }
    }
  }

  private async processImportRow(
    job: Pick<ImportJobRecord, "createdByUserId" | "id" | "sourceSystem">,
    auditActor: ImportAuditActor,
    row: ImportRowRecord,
    mapping: LoopImportMapping,
    users: LoopImportUser[],
    state: WorkerState,
  ) {
    const prepared = prepareLoopImportRow({
      defaultUserId: job.createdByUserId,
      mapping,
      rawRow: parseRawRow(row.rawData),
      rowNumber: row.rowNumber,
      users,
    });

    if (prepared.errors.length > 0) {
      await this.markRowFailed(row.id, prepared.errors);
      return [];
    }

    try {
      const touchedProjectIds = await this.prisma.$transaction(async (tx) => {
        const projectResult = await this.upsertProject(
          tx,
          job,
          auditActor,
          prepared,
          row.projectOverlapAction,
          row.rowNumber,
          state,
        );
        const taskResult = hasPreparedLoopImportTask(prepared.task)
          ? await this.upsertTask(
              tx,
              job,
              auditActor,
              prepared,
              projectResult,
              row.taskOverlapAction,
              row.rowNumber,
              state,
            )
          : {
              changedFields: [],
              id: null,
              outcome: "skipped" as const,
              previousProjectId: null,
              projectId: projectResult.id,
              sourceExternalId: prepared.task.externalId,
              status: prepared.task.status,
              title: prepared.task.title,
            };
        const rowOutcome = deriveRowOutcome(
          projectResult.outcome,
          taskResult.outcome,
        );

        await tx.importRow.update({
          where: { id: row.id },
          data: {
            message: buildOutcomeMessage(
              projectResult.outcome,
              taskResult.outcome,
            ),
            projectId: projectResult.id,
            projectOutcome: projectResult.outcome,
            rowOutcome,
            taskId: taskResult.id,
            taskOutcome: taskResult.outcome,
            validationErrors: Prisma.DbNull,
          },
        });

        const affectedProjectIds = new Set<string>([projectResult.id]);

        if (
          taskResult.previousProjectId &&
          taskResult.previousProjectId !== projectResult.id
        ) {
          affectedProjectIds.add(taskResult.previousProjectId);
        }

        return [...affectedProjectIds];
      });

      return touchedProjectIds;
    } catch (error) {
      await this.markRowFailed(row.id, [toErrorMessage(error)]);
      return [];
    }
  }

  private async upsertProject(
    tx: Prisma.TransactionClient,
    job: Pick<ImportJobRecord, "createdByUserId" | "id" | "sourceSystem">,
    auditActor: ImportAuditActor,
    prepared: ReturnType<typeof prepareLoopImportRow>,
    projectOverlapAction: "add" | "ignore" | "update",
    rowNumber: number,
    state: WorkerState,
  ): Promise<ProjectMutationResult> {
    const cacheKey = buildPreparedLoopImportProjectKey(prepared);
    const cachedId = state.projectIdByKey.get(cacheKey);
    const isCachedProject = cachedId !== undefined;
    const existing = cachedId
      ? await tx.project.findUnique({
          where: { id: cachedId },
        })
      : await findExistingProject(tx, job.sourceSystem, prepared);
    const nextSourceExternalId =
      projectOverlapAction === "add" && !isCachedProject && existing
        ? null
        : prepared.project.externalId;

    if (!existing || (!isCachedProject && projectOverlapAction === "add")) {
      const created = await tx.project.create({
        data: {
          derivedStatus: "not_started",
          displayStatus: "not_started",
          dueDate: toDate(prepared.project.dueDate),
          notes: prepared.project.notes,
          ownerUserId: prepared.project.ownerUserId,
          priority: prepared.project.priority,
          sourceExternalId: nextSourceExternalId,
          sourceSystem: job.sourceSystem,
          title: prepared.project.title!,
        },
      });

      state.projectIdByKey.set(cacheKey, created.id);
      await recordAuditEvent(tx, {
        action: "import_create",
        actor: auditActor,
        entityId: created.id,
        entityType: "project",
        metadata: {
          changes: buildAuditChanges(
            getCreatedProjectFields(created),
            buildProjectAuditSnapshot(null),
            buildProjectAuditSnapshot(created),
          ),
          dueDate: toIsoDate(created.dueDate),
          importId: job.id,
          notes: created.notes,
          ownerUserId: created.ownerUserId,
          priority: created.priority,
          rowNumber,
          sourceExternalId: created.sourceExternalId,
          title: created.title,
        },
      });

      return {
        changedFields: getCreatedProjectFields(created),
        id: created.id,
        outcome: "created",
        ownerUserId: created.ownerUserId,
        priority: created.priority,
        sourceExternalId: created.sourceExternalId,
        title: created.title,
      };
    }

    if (projectOverlapAction === "ignore") {
      state.projectIdByKey.set(cacheKey, existing.id);
      return {
        changedFields: [],
        id: existing.id,
        outcome: "skipped",
        ownerUserId: existing.ownerUserId,
        priority: existing.priority,
        sourceExternalId: existing.sourceExternalId,
        title: existing.title,
      };
    }

    const changedFields: string[] = [];
    const nextDueDate = toDate(prepared.project.dueDate);

    if (existing.title !== prepared.project.title) {
      changedFields.push("title");
    }

    if (existing.notes !== prepared.project.notes) {
      changedFields.push("notes");
    }

    if (existing.ownerUserId !== prepared.project.ownerUserId) {
      changedFields.push("ownerUserId");
    }

    if (existing.priority !== prepared.project.priority) {
      changedFields.push("priority");
    }

    if (toIsoDate(existing.dueDate) !== toIsoDate(nextDueDate)) {
      changedFields.push("dueDate");
    }

    if (nextSourceExternalId && existing.sourceExternalId !== nextSourceExternalId) {
      changedFields.push("sourceExternalId");
    }

    if (changedFields.length === 0) {
      state.projectIdByKey.set(cacheKey, existing.id);
      return {
        changedFields,
        id: existing.id,
        outcome: "skipped",
        ownerUserId: existing.ownerUserId,
        priority: existing.priority,
        sourceExternalId: existing.sourceExternalId,
        title: existing.title,
      };
    }

    const updated = await tx.project.update({
      where: { id: existing.id },
      data: {
        dueDate: nextDueDate,
        notes: prepared.project.notes,
        ownerUserId: prepared.project.ownerUserId,
        priority: prepared.project.priority,
        sourceExternalId: nextSourceExternalId ?? existing.sourceExternalId,
        sourceSystem: job.sourceSystem,
        title: prepared.project.title!,
      },
    });

    state.projectIdByKey.set(cacheKey, updated.id);
    await recordAuditEvent(tx, {
      action: "import_update",
      actor: auditActor,
      entityId: updated.id,
      entityType: "project",
      metadata: {
        changedFields,
        changes: buildAuditChanges(
          changedFields,
          buildProjectAuditSnapshot(existing),
          buildProjectAuditSnapshot(updated),
        ),
        dueDate: toIsoDate(updated.dueDate),
        importId: job.id,
        notes: updated.notes,
        ownerUserId: updated.ownerUserId,
        priority: updated.priority,
        rowNumber,
        sourceExternalId: updated.sourceExternalId,
        title: updated.title,
      },
    });

    return {
      changedFields,
      id: updated.id,
      outcome: "updated",
      ownerUserId: updated.ownerUserId,
      priority: updated.priority,
      sourceExternalId: updated.sourceExternalId,
      title: updated.title,
    };
  }

  private async upsertTask(
    tx: Prisma.TransactionClient,
    job: Pick<ImportJobRecord, "createdByUserId" | "id" | "sourceSystem">,
    auditActor: ImportAuditActor,
    prepared: ReturnType<typeof prepareLoopImportRow>,
    project: ProjectMutationResult,
    taskOverlapAction: "add" | "ignore" | "update",
    rowNumber: number,
    state: WorkerState,
  ): Promise<TaskMutationResult> {
    const cacheKey = buildPreparedLoopImportTaskKey(project.id, prepared);
    const cachedId = state.taskIdByKey.get(cacheKey);
    const isCachedTask = cachedId !== undefined;
    const existing = cachedId
      ? await tx.task.findUnique({
          where: { id: cachedId },
        })
      : await findExistingTask(tx, project.id, job.sourceSystem, prepared);
    const nextSourceExternalId =
      taskOverlapAction === "add" && !isCachedTask && existing
        ? null
        : prepared.task.externalId;

    if (!existing || (!isCachedTask && taskOverlapAction === "add")) {
      const created = await tx.task.create({
        data: {
          assigneeUserId: prepared.task.assigneeUserId,
          completedAt: prepared.task.status === "done" ? new Date() : null,
          dueDate: toDate(prepared.task.dueDate),
          notes: prepared.task.notes,
          priority: prepared.task.priority,
          projectId: project.id,
          sortOrder: await nextSortOrder(tx, state, project.id),
          sourceExternalId: nextSourceExternalId,
          sourceSystem: job.sourceSystem,
          status: prepared.task.status,
          title: prepared.task.title!,
        },
      });

      state.taskIdByKey.set(cacheKey, created.id);
      await recordAuditEvent(tx, {
        action: "import_create",
        actor: auditActor,
        entityId: created.id,
        entityType: "task",
        metadata: {
          assigneeUserId: created.assigneeUserId,
          changes: buildAuditChanges(
            getCreatedTaskFields(created),
            buildTaskAuditSnapshot(null),
            buildTaskAuditSnapshot(created),
          ),
          dueDate: toIsoDate(created.dueDate),
          importId: job.id,
          notes: created.notes,
          priority: created.priority,
          projectId: created.projectId,
          rowNumber,
          sourceExternalId: created.sourceExternalId,
          status: created.status,
          title: created.title,
        },
      });

      return {
        changedFields: getCreatedTaskFields(created),
        id: created.id,
        outcome: "created",
        previousProjectId: null,
        projectId: created.projectId,
        sourceExternalId: created.sourceExternalId,
        status: created.status,
        title: created.title,
      };
    }

    if (taskOverlapAction === "ignore") {
      state.taskIdByKey.set(cacheKey, existing.id);
      return {
        changedFields: [],
        id: existing.id,
        outcome: "skipped",
        previousProjectId: null,
        projectId: existing.projectId,
        sourceExternalId: existing.sourceExternalId,
        status: existing.status,
        title: existing.title,
      };
    }

    const changedFields: string[] = [];
    const nextDueDate = toDate(prepared.task.dueDate);
    const nextCompletedAt =
      prepared.task.status === "done"
        ? (existing.completedAt ?? new Date())
        : null;
    const nextProjectId =
      existing.projectId === project.id ? existing.projectId : project.id;

    if (existing.title !== prepared.task.title) {
      changedFields.push("title");
    }

    if (existing.notes !== prepared.task.notes) {
      changedFields.push("notes");
    }

    if (existing.assigneeUserId !== prepared.task.assigneeUserId) {
      changedFields.push("assigneeUserId");
    }

    if (existing.priority !== prepared.task.priority) {
      changedFields.push("priority");
    }

    if (existing.status !== prepared.task.status) {
      changedFields.push("status");
    }

    if (existing.projectId !== nextProjectId) {
      changedFields.push("projectId");
    }

    if (toIsoDate(existing.dueDate) !== toIsoDate(nextDueDate)) {
      changedFields.push("dueDate");
    }

    if (toIsoDate(existing.completedAt) !== toIsoDate(nextCompletedAt)) {
      changedFields.push("completedAt");
    }

    if (nextSourceExternalId && existing.sourceExternalId !== nextSourceExternalId) {
      changedFields.push("sourceExternalId");
    }

    if (changedFields.length === 0) {
      state.taskIdByKey.set(cacheKey, existing.id);
      return {
        changedFields,
        id: existing.id,
        outcome: "skipped",
        previousProjectId: null,
        projectId: existing.projectId,
        sourceExternalId: existing.sourceExternalId,
        status: existing.status,
        title: existing.title,
      };
    }

    const updated = await tx.task.update({
      where: { id: existing.id },
      data: {
        assigneeUserId: prepared.task.assigneeUserId,
        completedAt: nextCompletedAt,
        dueDate: nextDueDate,
        notes: prepared.task.notes,
        priority: prepared.task.priority,
        projectId: nextProjectId,
        sortOrder:
          existing.projectId === nextProjectId
            ? existing.sortOrder
            : await nextSortOrder(tx, state, nextProjectId),
        sourceExternalId: nextSourceExternalId ?? existing.sourceExternalId,
        sourceSystem: job.sourceSystem,
        status: prepared.task.status,
        title: prepared.task.title!,
      },
    });

    state.taskIdByKey.set(cacheKey, updated.id);
    await recordAuditEvent(tx, {
      action: "import_update",
      actor: auditActor,
      entityId: updated.id,
      entityType: "task",
      metadata: {
        assigneeUserId: updated.assigneeUserId,
        changedFields,
        changes: buildAuditChanges(
          changedFields,
          buildTaskAuditSnapshot(existing),
          buildTaskAuditSnapshot(updated),
        ),
        dueDate: toIsoDate(updated.dueDate),
        importId: job.id,
        notes: updated.notes,
        priority: updated.priority,
        projectId: updated.projectId,
        rowNumber,
        sourceExternalId: updated.sourceExternalId,
        status: updated.status,
        title: updated.title,
      },
    });

    return {
      changedFields,
      id: updated.id,
      outcome: "updated",
      previousProjectId:
        existing.projectId === updated.projectId ? null : existing.projectId,
      projectId: updated.projectId,
      sourceExternalId: updated.sourceExternalId,
      status: updated.status,
      title: updated.title,
    };
  }

  private async recalculateProjects(projectIds: string[]) {
    for (const projectId of projectIds) {
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: {
            where: { archivedAt: null },
            select: {
              dueDate: true,
              status: true,
            },
          },
        },
      });

      if (!project) {
        continue;
      }

      let taskTodoCount = 0;
      let taskInProgressCount = 0;
      let taskBlockedCount = 0;
      let taskOnHoldCount = 0;
      let taskDoneCount = 0;
      let taskCanceledCount = 0;
      let taskOverdueCount = 0;

      for (const task of project.tasks) {
        switch (task.status) {
          case "todo":
            taskTodoCount += 1;
            break;
          case "in_progress":
            taskInProgressCount += 1;
            break;
          case "blocked":
            taskBlockedCount += 1;
            break;
          case "on_hold":
            taskOnHoldCount += 1;
            break;
          case "done":
            taskDoneCount += 1;
            break;
          case "canceled":
            taskCanceledCount += 1;
            break;
        }

        if (
          task.dueDate &&
          task.status !== "done" &&
          task.status !== "canceled" &&
          task.status !== "on_hold" &&
          task.dueDate.getTime() < Date.now()
        ) {
          taskOverdueCount += 1;
        }
      }

      const taskTotalCount =
        taskTodoCount +
        taskInProgressCount +
        taskBlockedCount +
        taskOnHoldCount +
        taskDoneCount +
        taskCanceledCount;
      const nonCanceledTaskCount =
        taskTodoCount +
        taskInProgressCount +
        taskBlockedCount +
        taskOnHoldCount +
        taskDoneCount;
      const actionableTaskCount =
        taskTodoCount +
        taskInProgressCount +
        taskBlockedCount +
        taskOnHoldCount;
      const derivedStatus =
        taskTotalCount === 0
          ? "not_started"
          : nonCanceledTaskCount > 0 &&
              taskDoneCount === nonCanceledTaskCount
            ? "done"
            : actionableTaskCount > 0 &&
                taskBlockedCount === actionableTaskCount
              ? "blocked"
              : actionableTaskCount > 0 &&
                taskOnHoldCount === actionableTaskCount
                ? "on_hold"
                : actionableTaskCount > 0 &&
                    taskTodoCount === nonCanceledTaskCount
                  ? "not_started"
                  : actionableTaskCount > 0
                ? "in_progress"
                : "not_started";

      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          derivedStatus,
          displayStatus: project.manualStatus ?? derivedStatus,
          taskBlockedCount,
          taskCanceledCount,
          taskDoneCount,
          taskInProgressCount,
          taskOnHoldCount,
          taskOverdueCount,
          taskTodoCount,
          taskTotalCount,
        },
      });
    }
  }

  private async markRowFailed(rowId: string, errors: string[]) {
    try {
      await this.prisma.importRow.update({
        where: { id: rowId },
        data: {
          message: "Row failed validation",
          projectOutcome: "failed",
          rowOutcome: "failed",
          taskOutcome: "failed",
          validationErrors: errors as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      if (!isImportCleanupRaceError(error)) {
        throw error;
      }
    }
    this.observability.recordRowFailure();
  }

  private async failJob(jobId: string, error: unknown) {
    const message = toErrorMessage(error);

    try {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          completedAt: new Date(),
          lastError: message,
          status: "failed",
        },
      });
    } catch (updateError) {
      if (!isImportCleanupRaceError(updateError)) {
        throw updateError;
      }

      this.observability.logger.info("worker.import.removed", {
        importId: jobId,
        jobType: "commit",
      });
      return;
    }

    this.observability.logger.error("worker.import.failed", {
      error: error instanceof Error ? error : message,
      importId: jobId,
    });
  }

  private async getImportUsers(): Promise<LoopImportUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { name: "asc" },
      select: {
        email: true,
        id: true,
        name: true,
      },
    });

    return users.map((user) => ({
      email: user.email,
      id: user.id,
      name: user.name,
    }));
  }
}

function parseImportContent(content: string) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length < 2) {
    throw new Error("Expected a header row and at least one data row");
  }

  const delimiter = detectDelimiter(lines[0] ?? "");
  const rows = parse(content, {
    bom: true,
    columns: false,
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];

  if (rows.length < 2) {
    throw new Error("Expected a header row and at least one data row");
  }

  const [rawHeaderRow, ...dataRows] = rows;

  if (!rawHeaderRow) {
    throw new Error("Expected a header row and at least one data row");
  }

  const headers = rawHeaderRow.map((value) => String(value ?? "").trim());

  if (headers.some((header) => header.length === 0)) {
    throw new Error("Header row contains blank column names");
  }

  if (new Set(headers).size !== headers.length) {
    throw new Error("Header row contains duplicate column names");
  }

  return {
    headers,
    rows: dataRows.map((values) =>
      Object.fromEntries(
        headers.map((header, index) => [header, normalizeCell(values[index])]),
      ),
    ),
  };
}

function detectDelimiter(headerLine: string) {
  const candidates = [",", ";", "\t"] as const;

  return candidates.reduce(
    (best, candidate) =>
      countDelimiter(headerLine, candidate) > countDelimiter(headerLine, best)
        ? candidate
        : best,
    candidates[0],
  );
}

function countDelimiter(value: string, delimiter: string) {
  return value.split(delimiter).length - 1;
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const nextValue = String(value).trim();
  return nextValue.length > 0 ? nextValue : null;
}

function readLoopImportMapping(
  value: Prisma.JsonValue | null,
): LoopImportMapping {
  const result = loopImportMappingSchema.safeParse(
    normalizeLegacyLoopImportMapping(value),
  );
  return result.success ? stripUndefinedMappings(result.data) : {};
}

function parseRawRow(value: Prisma.JsonValue): Record<string, unknown> {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  return value as Record<string, unknown>;
}

async function findExistingProject(
  tx: Prisma.TransactionClient,
  sourceSystem: string,
  prepared: ReturnType<typeof prepareLoopImportRow>,
) {
  if (prepared.project.externalId) {
    return tx.project.findUnique({
      where: {
        sourceSystem_sourceExternalId: {
          sourceExternalId: prepared.project.externalId,
          sourceSystem,
        },
      },
    });
  }

  const matches = await tx.project.findMany({
    where: {
      archivedAt: null,
      dueDate: toDate(prepared.project.dueDate),
      ownerUserId: prepared.project.ownerUserId,
      sourceExternalId: null,
      sourceSystem,
      title: prepared.project.title!,
    },
  });

  if (matches.length > 1) {
    throw new Error(
      `Multiple projects match "${prepared.project.title ?? "project"}" without a source id`,
    );
  }

  return matches[0] ?? null;
}

async function findExistingTask(
  tx: Prisma.TransactionClient,
  projectId: string,
  sourceSystem: string,
  prepared: ReturnType<typeof prepareLoopImportRow>,
) {
  if (prepared.task.externalId) {
    return tx.task.findUnique({
      where: {
        sourceSystem_sourceExternalId: {
          sourceExternalId: prepared.task.externalId,
          sourceSystem,
        },
      },
    });
  }

  const matches = await tx.task.findMany({
    where: {
      archivedAt: null,
      assigneeUserId: prepared.task.assigneeUserId,
      dueDate: toDate(prepared.task.dueDate),
      projectId,
      sourceExternalId: null,
      sourceSystem,
      title: prepared.task.title!,
    },
  });

  if (matches.length > 1) {
    throw new Error(
      `Multiple tasks match "${prepared.task.title ?? "task"}" without a source id`,
    );
  }

  return matches[0] ?? null;
}

async function nextSortOrder(
  tx: Prisma.TransactionClient,
  state: WorkerState,
  projectId: string,
) {
  const cachedValue = state.nextSortOrderByProjectId.get(projectId);

  if (cachedValue !== undefined) {
    state.nextSortOrderByProjectId.set(projectId, cachedValue + 1);
    return cachedValue;
  }

  const highest = await tx.task.findFirst({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const nextValue = (highest?.sortOrder ?? -1) + 1;

  state.nextSortOrderByProjectId.set(projectId, nextValue + 1);
  return nextValue;
}

async function recordAuditEvent(
  tx: Prisma.TransactionClient,
  {
    action,
    actor,
    entityId,
    entityType,
    metadata,
  }: {
    action: string;
    actor: ImportAuditActor;
    entityId: string;
    entityType: "project" | "task";
    metadata: Record<string, unknown>;
  },
) {
  await tx.auditEvent.create({
    data: {
      action,
      actorEmail: actor.email,
      actorName: actor.name,
      actorRole: actor.role,
      actorUserId: actor.id,
      entityId,
      entityType,
      metadata: metadata as Prisma.InputJsonValue,
    },
  });
}

function getCreatedProjectFields(project: {
  dueDate: Date | null;
  notes: string | null;
  ownerUserId: string | null;
  priority: string;
  sourceExternalId: string | null;
  title: string;
}) {
  return [
    "title",
    "notes",
    "ownerUserId",
    "priority",
    "dueDate",
    "sourceExternalId",
  ].filter((field) => {
    switch (field) {
      case "notes":
        return project.notes !== null;
      case "ownerUserId":
        return project.ownerUserId !== null;
      case "dueDate":
        return project.dueDate !== null;
      case "sourceExternalId":
        return project.sourceExternalId !== null;
      default:
        return true;
    }
  });
}

function getCreatedTaskFields(task: {
  assigneeUserId: string | null;
  completedAt: Date | null;
  dueDate: Date | null;
  notes: string | null;
  priority: string;
  projectId: string;
  sourceExternalId: string | null;
  status: string;
  title: string;
}) {
  return [
    "title",
    "notes",
    "assigneeUserId",
    "priority",
    "status",
    "projectId",
    "dueDate",
    "completedAt",
    "sourceExternalId",
  ].filter((field) => {
    switch (field) {
      case "notes":
        return task.notes !== null;
      case "assigneeUserId":
        return task.assigneeUserId !== null;
      case "dueDate":
        return task.dueDate !== null;
      case "completedAt":
        return task.completedAt !== null;
      case "sourceExternalId":
        return task.sourceExternalId !== null;
      default:
        return true;
    }
  });
}

function buildProjectAuditSnapshot(
  project:
    | {
        dueDate: Date | null;
        notes: string | null;
        ownerUserId: string | null;
        priority: string;
        sourceExternalId: string | null;
        title: string;
      }
    | null,
) {
  return {
    dueDate: toIsoDate(project?.dueDate ?? null),
    notes: project?.notes ?? null,
    ownerUserId: project?.ownerUserId ?? null,
    priority: project?.priority ?? null,
    sourceExternalId: project?.sourceExternalId ?? null,
    title: project?.title ?? null,
  };
}

function buildTaskAuditSnapshot(
  task:
    | {
        assigneeUserId: string | null;
        completedAt: Date | null;
        dueDate: Date | null;
        notes: string | null;
        priority: string;
        projectId: string;
        sourceExternalId: string | null;
        status: string;
        title: string;
      }
    | null,
) {
  return {
    assigneeUserId: task?.assigneeUserId ?? null,
    completedAt: toIsoDate(task?.completedAt ?? null),
    dueDate: toIsoDate(task?.dueDate ?? null),
    notes: task?.notes ?? null,
    priority: task?.priority ?? null,
    projectId: task?.projectId ?? null,
    sourceExternalId: task?.sourceExternalId ?? null,
    status: task?.status ?? null,
    title: task?.title ?? null,
  };
}

function deriveRowOutcome(
  projectOutcome: "created" | "skipped" | "updated",
  taskOutcome: "created" | "skipped" | "updated",
) {
  if (projectOutcome === "created" || taskOutcome === "created") {
    return "created";
  }

  if (projectOutcome === "updated" || taskOutcome === "updated") {
    return "updated";
  }

  return "skipped";
}

function buildOutcomeMessage(
  projectOutcome: "created" | "skipped" | "updated",
  taskOutcome: "created" | "skipped" | "updated",
) {
  return `Project ${projectOutcome}, task ${taskOutcome}`;
}

function toDate(value: string | null) {
  return value ? new Date(value) : null;
}

function toIsoDate(value: Date | null) {
  return value?.toISOString() ?? null;
}

function toErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unknown import worker failure";
}

function stripUndefinedMappings(
  mapping: Record<string, string | null | undefined>,
) {
  return Object.fromEntries(
    Object.entries(mapping).filter(([, value]) => value !== undefined),
  ) as LoopImportMapping;
}

function normalizeLegacyLoopImportMapping(value: Prisma.JsonValue | null) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    return {};
  }

  const mapping = { ...(value as Record<string, unknown>) };

  if (
    mapping["taskNotes"] === undefined &&
    typeof mapping["taskDescription"] === "string"
  ) {
    mapping["taskNotes"] = mapping["taskDescription"];
  }

  return mapping;
}

async function summarizeRowOutcomes(prisma: PrismaClient, importId: string) {
  const rows = await prisma.importRow.findMany({
    where: { importId },
    select: {
      projectId: true,
      projectOutcome: true,
      rowOutcome: true,
      taskId: true,
      taskOutcome: true,
    },
  });

  const summary = {
    createdProjectCount: 0,
    createdRowCount: 0,
    createdTaskCount: 0,
    failedRowCount: 0,
    skippedRowCount: 0,
    updatedProjectCount: 0,
    updatedRowCount: 0,
    updatedTaskCount: 0,
  };
  const createdProjectIds = new Set<string>();
  const updatedProjectIds = new Set<string>();
  const createdTaskIds = new Set<string>();
  const updatedTaskIds = new Set<string>();

  for (const row of rows) {
    switch (row.rowOutcome) {
      case "created":
        summary.createdRowCount += 1;
        break;
      case "updated":
        summary.updatedRowCount += 1;
        break;
      case "skipped":
        summary.skippedRowCount += 1;
        break;
      case "failed":
        summary.failedRowCount += 1;
        break;
    }

    if (row.projectOutcome === "created" && row.projectId) {
      createdProjectIds.add(row.projectId);
    } else if (row.projectOutcome === "updated" && row.projectId) {
      updatedProjectIds.add(row.projectId);
    }

    if (row.taskOutcome === "created" && row.taskId) {
      createdTaskIds.add(row.taskId);
    } else if (row.taskOutcome === "updated" && row.taskId) {
      updatedTaskIds.add(row.taskId);
    }
  }

  summary.createdProjectCount = createdProjectIds.size;
  summary.updatedProjectCount = updatedProjectIds.size;
  summary.createdTaskCount = createdTaskIds.size;
  summary.updatedTaskCount = updatedTaskIds.size;

  return summary;
}
