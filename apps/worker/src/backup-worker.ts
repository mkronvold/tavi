import { promises as fs } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { appVersion } from "@tavi/config";
import { PrismaClient } from "@prisma/client";
import type { WorkerObservability } from "./worker-observability.js";

const BACKUP_FORMAT = "tavi-backup-v1";
const BACKUP_SETTINGS_ID = "global";
const DEFAULT_IDLE_DELAY_MS = 30_000;
const DEFAULT_SCHEDULE_INTERVAL_MS = 60_000;

type BackupWorkerOptions = {
  idleDelayMs?: number;
  scheduleIntervalMs?: number;
};

function getDefaultBackupDirectory() {
  const cwd = process.cwd();
  const leaf = path.basename(cwd);

  if (leaf === "api" || leaf === "worker") {
    return path.resolve(cwd, "../../backups");
  }

  return path.resolve(cwd, "backups");
}

function getConfiguredBackupDirectories() {
  const candidates: string[] = [];
  const configured = process.env.BACKUP_DIRECTORY?.trim();
  const hostConfigured = process.env.BACKUP_HOST_DIRECTORY?.trim();

  if (configured) {
    candidates.push(path.resolve(configured));
  }

  if (hostConfigured) {
    candidates.push(path.resolve(hostConfigured));
  }

  candidates.push(getDefaultBackupDirectory());

  return [...new Set(candidates)];
}

async function resolveBackupDirectory() {
  let lastError: unknown;

  for (const directory of getConfiguredBackupDirectories()) {
    try {
      await fs.mkdir(directory, { recursive: true });
      return directory;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Backup directory is not accessible");
}

function buildBackupFileName(now: Date) {
  const compact = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `tavi-backup-${compact}.json`;
}

function buildScheduledRunAt(now: Date, scheduleTime: string) {
  const [hoursText, minutesText] = scheduleTime.split(":");
  const scheduledRunAt = new Date(now);

  scheduledRunAt.setHours(Number(hoursText), Number(minutesText), 0, 0);
  return scheduledRunAt;
}

function toIsoOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

export class BackupWorker {
  private readonly idleDelayMs: number;
  private readonly scheduleIntervalMs: number;
  private lastScheduleCheckAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly observability: WorkerObservability,
    options: BackupWorkerOptions = {},
  ) {
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
    this.scheduleIntervalMs =
      options.scheduleIntervalMs ?? DEFAULT_SCHEDULE_INTERVAL_MS;
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      const handledWork = await this.runScheduledBackup();

      await delay(handledWork ? 500 : this.idleDelayMs, undefined, {
        signal,
      }).catch(() => undefined);
    }
  }

  private async runScheduledBackup() {
    const now = Date.now();

    if (now - this.lastScheduleCheckAt < this.scheduleIntervalMs) {
      return false;
    }

    this.lastScheduleCheckAt = now;
    const currentTime = new Date(now);
    const settings = await this.prisma.backupSettings.findUnique({
      where: { id: BACKUP_SETTINGS_ID },
      select: {
        enabled: true,
        lastScheduledRunAt: true,
        scheduleTime: true,
      },
    });

    if (!settings?.enabled) {
      return false;
    }

    const scheduledRunAt = buildScheduledRunAt(
      currentTime,
      settings.scheduleTime,
    );

    if (currentTime < scheduledRunAt) {
      return false;
    }

    const claim = await this.prisma.backupSettings.updateMany({
      where: {
        enabled: true,
        id: BACKUP_SETTINGS_ID,
        OR: [
          { lastScheduledRunAt: null },
          { lastScheduledRunAt: { lt: scheduledRunAt } },
        ],
        scheduleTime: settings.scheduleTime,
      },
      data: {
        lastScheduledRunAt: scheduledRunAt,
      },
    });

    if (claim.count !== 1) {
      return false;
    }

    const startedAt = this.observability.startJob("backup");

    try {
      const backupDirectory = await this.writeBackupFile(currentTime);
      await this.prisma.backupSettings.update({
        where: { id: BACKUP_SETTINGS_ID },
        data: {
          lastError: null,
          lastSuccessAt: currentTime,
        },
      });
      this.observability.logger.info("worker.backups.created", {
        backupDirectory,
        scheduleTime: settings.scheduleTime,
        scheduledRunAt: scheduledRunAt.toISOString(),
      });
      this.observability.finishJob("backup", "completed", startedAt);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.backupSettings.update({
        where: { id: BACKUP_SETTINGS_ID },
        data: {
          lastError: message,
          lastFailureAt: currentTime,
        },
      });
      this.observability.logger.error("worker.backups.failed", {
        error: message,
        scheduleTime: settings.scheduleTime,
        scheduledRunAt: scheduledRunAt.toISOString(),
      });
      this.observability.finishJob("backup", "failed", startedAt);
      return false;
    }
  }

  private async writeBackupFile(now: Date) {
    const directory = await resolveBackupDirectory();

    const [
      users,
      roleAssignments,
      projects,
      tasks,
      savedViews,
      importJobs,
      importRows,
      auditEvents,
      auditLogRetention,
      emailSettings,
      backupSettings,
      notificationEvents,
      notificationDeliveryAttempts,
    ] = await Promise.all([
      this.prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.roleAssignment.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.project.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.task.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.savedView.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.importJob.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.importRow.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.auditEvent.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.auditLogRetention.findUnique({
        where: { id: "global" },
      }),
      this.prisma.emailSettings.findUnique({ where: { id: "global" } }),
      this.prisma.backupSettings.findUnique({
        where: { id: BACKUP_SETTINGS_ID },
      }),
      this.prisma.notificationEvent.findMany({ orderBy: { createdAt: "asc" } }),
      this.prisma.notificationDeliveryAttempt.findMany({
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const snapshot = {
      appVersion,
      createdAt: now.toISOString(),
      data: {
        auditEvents: auditEvents.map((event) => ({
          action: event.action,
          actorEmail: event.actorEmail,
          actorName: event.actorName,
          actorRole: event.actorRole,
          actorUserId: event.actorUserId,
          createdAt: event.createdAt.toISOString(),
          entityId: event.entityId,
          entityType: event.entityType,
          id: event.id,
          metadata: event.metadata,
        })),
        auditLogRetention: auditLogRetention
          ? {
              createdAt: auditLogRetention.createdAt.toISOString(),
              id: auditLogRetention.id,
              olderThan: auditLogRetention.olderThan,
              updatedAt: auditLogRetention.updatedAt.toISOString(),
            }
          : null,
        backupSettings: backupSettings
          ? {
              createdAt: backupSettings.createdAt.toISOString(),
              enabled: backupSettings.enabled,
              id: backupSettings.id,
              lastError: backupSettings.lastError,
              lastFailureAt: toIsoOrNull(backupSettings.lastFailureAt),
              lastScheduledRunAt: toIsoOrNull(
                backupSettings.lastScheduledRunAt,
              ),
              lastSuccessAt: toIsoOrNull(backupSettings.lastSuccessAt),
              scheduleTime: backupSettings.scheduleTime,
              updatedAt: backupSettings.updatedAt.toISOString(),
            }
          : null,
        emailSettings: emailSettings
          ? {
              createdAt: emailSettings.createdAt.toISOString(),
              dailyDigestTime: emailSettings.dailyDigestTime,
              enabled: emailSettings.enabled,
              id: emailSettings.id,
              updatedAt: emailSettings.updatedAt.toISOString(),
            }
          : null,
        importJobs: importJobs.map((job) => ({
          completedAt: toIsoOrNull(job.completedAt),
          createdAt: job.createdAt.toISOString(),
          createdByUserId: job.createdByUserId,
          createdProjectCount: job.createdProjectCount,
          createdRowCount: job.createdRowCount,
          createdTaskCount: job.createdTaskCount,
          failedRowCount: job.failedRowCount,
          fileName: job.fileName,
          headers: job.headers,
          id: job.id,
          lastError: job.lastError,
          mapping: job.mapping,
          skippedRowCount: job.skippedRowCount,
          sourceContent: job.sourceContent,
          sourceSystem: job.sourceSystem,
          status: job.status,
          suggestedMapping: job.suggestedMapping,
          totalRowCount: job.totalRowCount,
          updatedAt: job.updatedAt.toISOString(),
          updatedProjectCount: job.updatedProjectCount,
          updatedRowCount: job.updatedRowCount,
          updatedTaskCount: job.updatedTaskCount,
        })),
        importRows: importRows.map((row) => ({
          createdAt: row.createdAt.toISOString(),
          id: row.id,
          importId: row.importId,
          message: row.message,
          projectId: row.projectId,
          projectOutcome: row.projectOutcome,
          projectOverlapAction: row.projectOverlapAction,
          rawData: row.rawData,
          rowNumber: row.rowNumber,
          rowOutcome: row.rowOutcome,
          taskId: row.taskId,
          taskOutcome: row.taskOutcome,
          taskOverlapAction: row.taskOverlapAction,
          updatedAt: row.updatedAt.toISOString(),
          validationErrors: row.validationErrors,
        })),
        notificationDeliveryAttempts: notificationDeliveryAttempts.map(
          (attempt) => ({
            createdAt: attempt.createdAt.toISOString(),
            error: attempt.error,
            id: attempt.id,
            notificationId: attempt.notificationId,
            status: attempt.status,
          }),
        ),
        notificationEvents: notificationEvents.map((event) => ({
          attemptCount: event.attemptCount,
          createdAt: event.createdAt.toISOString(),
          dedupeKey: event.dedupeKey,
          failedAt: toIsoOrNull(event.failedAt),
          id: event.id,
          kind: event.kind,
          lastError: event.lastError,
          nextAttemptAt: event.nextAttemptAt.toISOString(),
          payload: event.payload,
          recipientUserId: event.recipientUserId,
          sentAt: toIsoOrNull(event.sentAt),
          skippedAt: toIsoOrNull(event.skippedAt),
          status: event.status,
          updatedAt: event.updatedAt.toISOString(),
        })),
        projects: projects.map((project) => ({
          archivedAt: toIsoOrNull(project.archivedAt),
          createdAt: project.createdAt.toISOString(),
          derivedStatus: project.derivedStatus,
          displayStatus: project.displayStatus,
          dueDate: toIsoOrNull(project.dueDate),
          id: project.id,
          manualStatus: project.manualStatus,
          notes: project.notes,
          ownerUserId: project.ownerUserId,
          priority: project.priority,
          references: project.references,
          sourceExternalId: project.sourceExternalId,
          sourceSystem: project.sourceSystem,
          taskBlockedCount: project.taskBlockedCount,
          taskCanceledCount: project.taskCanceledCount,
          taskDoneCount: project.taskDoneCount,
          taskInProgressCount: project.taskInProgressCount,
          taskOnHoldCount: project.taskOnHoldCount,
          taskOverdueCount: project.taskOverdueCount,
          taskTodoCount: project.taskTodoCount,
          taskTotalCount: project.taskTotalCount,
          title: project.title,
          updatedAt: project.updatedAt.toISOString(),
        })),
        roleAssignments: roleAssignments.map((assignment) => ({
          createdAt: assignment.createdAt.toISOString(),
          id: assignment.id,
          role: assignment.role,
          updatedAt: assignment.updatedAt.toISOString(),
          userId: assignment.userId,
        })),
        savedViews: savedViews.map((savedView) => ({
          createdAt: savedView.createdAt.toISOString(),
          filtersJson: savedView.filtersJson,
          groupBy: savedView.groupBy,
          id: savedView.id,
          name: savedView.name,
          search: savedView.search,
          statusFilter: savedView.statusFilter,
          updatedAt: savedView.updatedAt.toISOString(),
          userId: savedView.userId,
        })),
        tasks: tasks.map((task) => ({
          archivedAt: toIsoOrNull(task.archivedAt),
          assigneeUserId: task.assigneeUserId,
          completedAt: toIsoOrNull(task.completedAt),
          createdAt: task.createdAt.toISOString(),
          dueDate: toIsoOrNull(task.dueDate),
          id: task.id,
          notes: task.notes,
          priority: task.priority,
          projectId: task.projectId,
          sortOrder: task.sortOrder,
          sourceExternalId: task.sourceExternalId,
          sourceSystem: task.sourceSystem,
          status: task.status,
          title: task.title,
          updatedAt: task.updatedAt.toISOString(),
        })),
        users: users.map((user) => ({
          createdAt: user.createdAt.toISOString(),
          dailyDigestEnabled: user.dailyDigestEnabled,
          email: user.email,
          id: user.id,
          name: user.name,
          passwordHash: user.passwordHash,
          personalTodoRemindersEnabled: user.personalTodoRemindersEnabled,
          updatedAt: user.updatedAt.toISOString(),
        })),
      },
      format: BACKUP_FORMAT,
      trigger: "scheduled",
    };
    const fileName = buildBackupFileName(now);
    const tempPath = path.join(directory, `${fileName}.tmp-${process.pid}`);
    const finalPath = path.join(directory, fileName);

    await fs.writeFile(
      tempPath,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      "utf8",
    );
    await fs.rename(tempPath, finalPath);
    return directory;
  }
}
