import { setTimeout as delay } from "node:timers/promises";
import { buildEmailHtml, escapeHtml, parseSmtpUrl } from "@tavi/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { createTransport, type Transporter } from "nodemailer";
import type { WorkerObservability } from "./worker-observability.js";

const DEFAULT_IDLE_DELAY_MS = 5_000;
const DEFAULT_WORK_DELAY_MS = 500;
const DEFAULT_SCHEDULE_INTERVAL_MS = 60_000;
const DEFAULT_SMTP_URL = "smtp://10.120.64.99:25";
const DEFAULT_SMTP_FROM = "noreply@tavi.local";
const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 2, 5, 13, 34];

type ScheduledNotificationKind =
  | "daily_project_summary"
  | "daily_task_summary"
  | "task_due_3_days"
  | "task_due_7_days"
  | "task_due_today"
  | "task_due_tomorrow"
  | "task_overdue";

type NotificationWorkerOptions = {
  idleDelayMs?: number;
  scheduleIntervalMs?: number;
  workDelayMs?: number;
};

type NotificationRecipient = {
  email: string;
  id: string;
  name: string;
};

export class NotificationWorker {
  private readonly idleDelayMs: number;
  private readonly scheduleIntervalMs: number;
  private readonly workDelayMs: number;
  private readonly fromAddress: string;
  private readonly homeUrl: string;
  private readonly transporter: Transporter | null;
  private readonly configured: boolean;
  private lastScheduleCheckAt = 0;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly observability: WorkerObservability,
    options: NotificationWorkerOptions = {},
  ) {
    this.idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
    this.scheduleIntervalMs =
      options.scheduleIntervalMs ?? DEFAULT_SCHEDULE_INTERVAL_MS;
    this.workDelayMs = options.workDelayMs ?? DEFAULT_WORK_DELAY_MS;
    this.fromAddress = process.env.SMTP_FROM ?? DEFAULT_SMTP_FROM;
    this.homeUrl = process.env.TAVI_HOME_URL ?? "http://localhost:5173";

    try {
      const smtpUrl = process.env.SMTP_URL ?? DEFAULT_SMTP_URL;
      const smtpUser = process.env.SMTP_USER || undefined;
      const smtpPass = process.env.SMTP_PASS || undefined;
      const { host, port, secure } = parseSmtpUrl(smtpUrl);

      this.transporter = createTransport({
        host,
        port,
        secure,
        auth:
          smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined,
        tls: secure ? undefined : { rejectUnauthorized: false },
      });
      this.configured = true;
      this.observability.logger.info("worker.notifications.transport_ready", {
        host,
        port,
        secure,
      });
    } catch (error) {
      this.transporter = null;
      this.configured = false;
      this.observability.logger.warn("worker.notifications.transport_unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      const handledNotification = await this.processNextNotification();
      const scheduledWork = await this.runScheduledWork();
      const handledWork = handledNotification || scheduledWork;

      await delay(handledWork ? this.workDelayMs : this.idleDelayMs, undefined, {
        signal,
      }).catch(() => undefined);
    }
  }

  private async processNextNotification() {
    const eventId = await this.claimNextNotification();

    if (!eventId) {
      return false;
    }

    const startedAt = this.observability.startJob("notification");

    try {
      const event = await this.prisma.notificationEvent.findUnique({
        where: { id: eventId },
        include: {
          recipient: {
            select: {
              email: true,
              id: true,
              name: true,
            },
          },
        },
      });

      if (!event) {
        this.observability.finishJob("notification", "completed", startedAt);
        return true;
      }

      const skipReason = await this.getSkipReason(event.recipient);

      if (skipReason) {
        await this.completeEvent(event.id, "skipped", { reason: skipReason });
        this.observability.finishJob("notification", "completed", startedAt);
        return true;
      }

      const email = buildNotificationEmail({
        homeUrl: this.homeUrl,
        kind: event.kind,
        payload: toRecord(event.payload),
        recipientName: event.recipient!.name,
      });

      await this.transporter!.sendMail({
        from: this.fromAddress,
        html: email.html,
        subject: email.subject,
        to: event.recipient!.email,
      });

      await this.completeEvent(event.id, "sent");
      this.observability.logger.info("worker.notifications.sent", {
        eventId: event.id,
        kind: event.kind,
        recipientUserId: event.recipientUserId,
      });
      this.observability.finishJob("notification", "completed", startedAt);
    } catch (error) {
      await this.failEvent(eventId, error);
      this.observability.finishJob("notification", "failed", startedAt);
    }

    return true;
  }

  private async runScheduledWork() {
    const now = Date.now();

    if (now - this.lastScheduleCheckAt < this.scheduleIntervalMs) {
      return false;
    }

    this.lastScheduleCheckAt = now;
    const startedAt = this.observability.startJob("digest");

    try {
      const [dueReminderCount, dailyTaskSummaryCount, dailyProjectSummaryCount] =
        await Promise.all([
          this.queueDueDateNotifications(new Date(now)),
          this.queueDailyTaskSummaries(new Date(now)),
          this.queueDailyProjectSummaries(new Date(now)),
        ]);

      const queuedCount =
        dueReminderCount + dailyTaskSummaryCount + dailyProjectSummaryCount;

      if (queuedCount > 0) {
        this.observability.logger.info("worker.notifications.scheduled", {
          dailyProjectSummaryCount,
          dailyTaskSummaryCount,
          dueReminderCount,
          queuedCount,
        });
      }

      this.observability.finishJob("digest", "completed", startedAt);
      return queuedCount > 0;
    } catch (error) {
      this.observability.logger.error("worker.notifications.schedule_failed", {
        error,
      });
      this.observability.finishJob("digest", "failed", startedAt);
      return false;
    }
  }

  private async claimNextNotification() {
    const now = new Date();
    const candidate = await this.prisma.notificationEvent.findFirst({
      where: {
        nextAttemptAt: {
          lte: now,
        },
        status: "queued",
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

    if (!candidate) {
      return null;
    }

    const claimed = await this.prisma.notificationEvent.updateMany({
      where: {
        id: candidate.id,
        nextAttemptAt: {
          lte: now,
        },
        status: "queued",
      },
      data: {
        attemptCount: {
          increment: 1,
        },
        status: "processing",
      },
    });

    return claimed.count === 1 ? candidate.id : null;
  }

  private async completeEvent(
    eventId: string,
    status: "sent" | "skipped",
    details: {
      reason?: string;
    } = {},
  ) {
    await this.prisma.$transaction([
      this.prisma.notificationEvent.update({
        where: { id: eventId },
        data: {
          failedAt: null,
          lastError: details.reason ?? null,
          nextAttemptAt: new Date(),
          sentAt: status === "sent" ? new Date() : null,
          skippedAt: status === "skipped" ? new Date() : null,
          status,
        },
      }),
      this.prisma.notificationDeliveryAttempt.create({
        data: {
          error: details.reason ?? null,
          notificationId: eventId,
          status,
        },
      }),
    ]);
  }

  private async failEvent(eventId: string, error: unknown) {
    const current = await this.prisma.notificationEvent.findUnique({
      where: { id: eventId },
      select: {
        attemptCount: true,
      },
    });
    const message = error instanceof Error ? error.message : String(error);

    if (!current || current.attemptCount >= MAX_ATTEMPTS) {
      await this.prisma.$transaction([
        this.prisma.notificationEvent.update({
          where: { id: eventId },
          data: {
            failedAt: new Date(),
            lastError: message,
            status: "failed",
          },
        }),
        this.prisma.notificationDeliveryAttempt.create({
          data: {
            error: message,
            notificationId: eventId,
            status: "failed",
          },
        }),
      ]);

      this.observability.logger.error("worker.notifications.failed", {
        error: message,
        eventId,
      });
      return;
    }

    const retryMinutes =
      RETRY_MINUTES[
        Math.min(current.attemptCount - 1, RETRY_MINUTES.length - 1)
      ] ?? 34;
    const nextAttemptAt = new Date(Date.now() + retryMinutes * 60_000);

    await this.prisma.$transaction([
      this.prisma.notificationEvent.update({
        where: { id: eventId },
        data: {
          lastError: message,
          nextAttemptAt,
          status: "queued",
        },
      }),
      this.prisma.notificationDeliveryAttempt.create({
        data: {
          error: message,
          notificationId: eventId,
          status: "failed",
        },
      }),
    ]);

    this.observability.logger.warn("worker.notifications.retry_scheduled", {
      error: message,
      eventId,
      nextAttemptAt,
    });
  }

  private async getSkipReason(recipient: NotificationRecipient | null) {
    if (!recipient) {
      return "recipient_missing";
    }

    if (!this.configured || !this.transporter) {
      return "smtp_not_configured";
    }

    const settings = await this.prisma.emailSettings.findUnique({
      where: { id: "global" },
      select: { enabled: true },
    });

    if (settings?.enabled === false) {
      return "email_disabled";
    }

    return null;
  }

  private async queueDueDateNotifications(now: Date) {
    const dayKey = formatUtcDate(now);
    const tasks = await this.prisma.task.findMany({
      where: {
        archivedAt: null,
        assigneeUserId: {
          not: null,
        },
        dueDate: {
          not: null,
        },
        status: {
          notIn: ["canceled", "done", "on_hold"],
        },
      },
      select: {
        assigneeUserId: true,
        dueDate: true,
        id: true,
        title: true,
        project: {
          select: {
            title: true,
          },
        },
      },
    });

    const events = tasks
      .map((task) => {
        const kind = getDueReminderKind(task.dueDate!, now);

        if (!kind || !task.assigneeUserId) {
          return null;
        }

        return {
          dedupeKey: `${kind}:${task.id}:${task.assigneeUserId}:${dayKey}`,
          kind,
          payload: {
            dueDate: task.dueDate!.toISOString(),
            projectTitle: task.project?.title ?? null,
            taskId: task.id,
            taskTitle: task.title,
          },
          recipientUserId: task.assigneeUserId,
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null);

    return this.queueEvents(events);
  }

  private async queueDailyTaskSummaries(now: Date) {
    const summaryDate = formatUtcDate(now);
    const tasks = await this.prisma.task.findMany({
      where: {
        archivedAt: null,
        assigneeUserId: {
          not: null,
        },
        status: {
          notIn: ["canceled", "done"],
        },
      },
      select: {
        assigneeUserId: true,
        dueDate: true,
        id: true,
        project: {
          select: {
            title: true,
          },
        },
        status: true,
        title: true,
      },
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    });

    const tasksByAssignee = new Map<string, typeof tasks>();

    for (const task of tasks) {
      if (!task.assigneeUserId) {
        continue;
      }

      const current = tasksByAssignee.get(task.assigneeUserId) ?? [];
      current.push(task);
      tasksByAssignee.set(task.assigneeUserId, current);
    }

    const events = [...tasksByAssignee.entries()].map(([recipientUserId, items]) => {
      const summary = summarizeAssignedTasks(items, now);

      return {
        dedupeKey: `daily_task_summary:${recipientUserId}:${summaryDate}`,
        kind: "daily_task_summary" as const,
        payload: {
          ...summary,
          summaryDate,
        },
        recipientUserId,
      };
    });

    return this.queueEvents(events);
  }

  private async queueDailyProjectSummaries(now: Date) {
    const summaryDate = formatUtcDate(now);
    const projects = await this.prisma.project.findMany({
      where: {
        archivedAt: null,
        ownerUserId: {
          not: null,
        },
        OR: [
          {
            displayStatus: {
              not: "done",
            },
          },
          {
            taskOverdueCount: {
              gt: 0,
            },
          },
        ],
      },
      select: {
        displayStatus: true,
        dueDate: true,
        id: true,
        ownerUserId: true,
        taskBlockedCount: true,
        taskDoneCount: true,
        taskOnHoldCount: true,
        taskOverdueCount: true,
        taskTotalCount: true,
        title: true,
      },
      orderBy: [{ updatedAt: "desc" }],
    });

    const projectsByOwner = new Map<string, typeof projects>();

    for (const project of projects) {
      if (!project.ownerUserId) {
        continue;
      }

      const current = projectsByOwner.get(project.ownerUserId) ?? [];
      current.push(project);
      projectsByOwner.set(project.ownerUserId, current);
    }

    const events = [...projectsByOwner.entries()].map(([recipientUserId, items]) => {
      const summary = summarizeOwnedProjects(items);

      return {
        dedupeKey: `daily_project_summary:${recipientUserId}:${summaryDate}`,
        kind: "daily_project_summary" as const,
        payload: {
          ...summary,
          summaryDate,
        },
        recipientUserId,
      };
    });

    return this.queueEvents(events);
  }

  private async queueEvents(
    events: Array<{
      dedupeKey: string;
      kind: ScheduledNotificationKind;
      payload: Record<string, unknown>;
      recipientUserId: string;
    }>,
  ) {
    if (events.length === 0) {
      return 0;
    }

    const result = await this.prisma.notificationEvent.createMany({
      data: events.map((event) => ({
        dedupeKey: event.dedupeKey,
        kind: event.kind,
        payload: event.payload as Prisma.InputJsonValue,
        recipientUserId: event.recipientUserId,
      })),
      skipDuplicates: true,
    });

    return result.count;
  }
}

function buildNotificationEmail(input: {
  homeUrl: string;
  kind: string;
  payload: Record<string, unknown>;
  recipientName: string;
}) {
  const { kind, payload } = input;
  const taskTitle = escapeHtml(readString(payload.taskTitle) ?? "Untitled task");
  const projectTitle = escapeHtml(readString(payload.projectTitle) ?? "Unassigned");
  const actorName = escapeHtml(readString(payload.actorName) ?? "Someone");
  const dueDate = formatDate(readString(payload.dueDate));

  switch (kind) {
    case "task_assigned":
      return toEmail(
        input,
        `New task assigned: ${taskTitle}`,
        `${actorName} assigned you <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.${dueDate ? `<p style="margin:12px 0 0;">Due date: <strong style="color:#e2e8f0;">${dueDate}</strong></p>` : ""}`,
      );
    case "task_unassigned":
      return toEmail(
        input,
        `Task unassigned: ${taskTitle}`,
        `${actorName} removed you from <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.`,
      );
    case "task_updated":
      return toEmail(
        input,
        `Task updated: ${taskTitle}`,
        buildChangeUpdateBody({
          actorName,
          entityTitle: taskTitle,
          fromLines: readStringArray(payload.fromLines),
          projectTitle,
          toLines: readStringArray(payload.toLines),
        }),
      );
    case "task_due_date_added":
      return toEmail(
        input,
        `Due date added: ${taskTitle}`,
        `${actorName} added a due date to <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.<p style="margin:12px 0 0;">Due date: <strong style="color:#e2e8f0;">${dueDate ?? "-"}</strong></p>`,
      );
    case "task_due_date_changed":
      return toEmail(
        input,
        `Due date changed: ${taskTitle}`,
        `${actorName} changed the due date for <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.<p style="margin:12px 0 0;">New due date: <strong style="color:#e2e8f0;">${dueDate ?? "-"}</strong></p>`,
      );
    case "task_blocked":
      return toEmail(
        input,
        `Task blocked: ${taskTitle}`,
        `${actorName} marked <strong>${taskTitle}</strong> as blocked in <strong>${projectTitle}</strong>.`,
      );
    case "task_unblocked":
      return toEmail(
        input,
        `Task unblocked: ${taskTitle}`,
        `${actorName} moved <strong>${taskTitle}</strong> out of blocked status in <strong>${projectTitle}</strong>.`,
      );
    case "task_on_hold":
      return toEmail(
        input,
        `Task on hold: ${taskTitle}`,
        `${actorName} put <strong>${taskTitle}</strong> on hold in <strong>${projectTitle}</strong>.`,
      );
    case "task_resumed":
      return toEmail(
        input,
        `Task resumed: ${taskTitle}`,
        `${actorName} took <strong>${taskTitle}</strong> off hold in <strong>${projectTitle}</strong>.`,
      );
    case "task_reopened":
      return toEmail(
        input,
        `Task reopened: ${taskTitle}`,
        `${actorName} reopened <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.`,
      );
    case "task_completed":
      return toEmail(
        input,
        `Task completed: ${taskTitle}`,
        `${actorName} marked <strong>${taskTitle}</strong> done in <strong>${projectTitle}</strong>.`,
      );
    case "task_moved":
      return toEmail(
        input,
        `Task moved: ${taskTitle}`,
        `${actorName} moved <strong>${taskTitle}</strong> to <strong>${projectTitle}</strong>.`,
      );
    case "project_owner_assigned":
      return toEmail(
        input,
        `You now own: ${projectTitle}`,
        `${actorName} assigned you as the owner of <strong>${projectTitle}</strong>.`,
      );
    case "project_owner_changed":
      return toEmail(
        input,
        `Project owner changed: ${projectTitle}`,
        `${actorName} assigned you as the new owner of <strong>${projectTitle}</strong>.`,
      );
    case "project_owner_removed":
      return toEmail(
        input,
        `Owner removed: ${projectTitle}`,
        `${actorName} removed you as the owner of <strong>${projectTitle}</strong>.`,
      );
    case "project_updated":
      return toEmail(
        input,
        `Project updated: ${projectTitle}`,
        buildChangeUpdateBody({
          actorName,
          entityTitle: projectTitle,
          fromLines: readStringArray(payload.fromLines),
          toLines: readStringArray(payload.toLines),
        }),
      );
    case "project_blocked":
      return toEmail(
        input,
        `Project blocked: ${projectTitle}`,
        `${actorName} marked <strong>${projectTitle}</strong> as blocked.`,
      );
    case "project_on_hold":
      return toEmail(
        input,
        `Project on hold: ${projectTitle}`,
        `${actorName} put <strong>${projectTitle}</strong> on hold.`,
      );
    case "project_resumed":
      return toEmail(
        input,
        `Project resumed: ${projectTitle}`,
        `${actorName} took <strong>${projectTitle}</strong> off hold.`,
      );
    case "task_due_7_days":
    case "task_due_3_days":
    case "task_due_tomorrow":
    case "task_due_today":
    case "task_overdue":
      return toEmail(
        input,
        `${dueReminderSubject(kind)}: ${taskTitle}`,
        `<strong>${taskTitle}</strong> in <strong>${projectTitle}</strong> is ${dueReminderBody(kind, dueDate)}.`,
      );
    case "daily_task_summary":
      return toEmail(
        input,
        "Daily task summary",
        buildDailyTaskSummaryBody(payload),
      );
    case "daily_project_summary":
      return toEmail(
        input,
        "Daily project summary",
        buildDailyProjectSummaryBody(payload),
      );
    default:
      return toEmail(
        input,
        "Tavi notification",
        "You have a new notification in Tavi.",
      );
  }
}

function buildDailyTaskSummaryBody(payload: Record<string, unknown>) {
  const totalOpenCount = readNumber(payload.totalOpenCount);
  const overdueCount = readNumber(payload.overdueCount);
  const dueTodayCount = readNumber(payload.dueTodayCount);
  const blockedCount = readNumber(payload.blockedCount);
  const onHoldCount = readNumber(payload.onHoldCount);
  const items = readRecordArray(payload.items);

  return `Here is your current task summary.

<p style="margin:16px 0 0;">
  Open tasks: <strong style="color:#e2e8f0;">${totalOpenCount}</strong><br />
  Overdue: <strong style="color:#e2e8f0;">${overdueCount}</strong><br />
  Due today: <strong style="color:#e2e8f0;">${dueTodayCount}</strong><br />
  Blocked: <strong style="color:#e2e8f0;">${blockedCount}</strong><br />
  On hold: <strong style="color:#e2e8f0;">${onHoldCount}</strong>
</p>

${buildTaskList(items)}`;
}

function buildDailyProjectSummaryBody(payload: Record<string, unknown>) {
  const activeProjectCount = readNumber(payload.activeProjectCount);
  const blockedProjectCount = readNumber(payload.blockedProjectCount);
  const onHoldProjectCount = readNumber(payload.onHoldProjectCount);
  const overdueTaskCount = readNumber(payload.overdueTaskCount);
  const items = readRecordArray(payload.items);

  return `Here is your current project-owner summary.

<p style="margin:16px 0 0;">
  Active projects: <strong style="color:#e2e8f0;">${activeProjectCount}</strong><br />
  Blocked projects: <strong style="color:#e2e8f0;">${blockedProjectCount}</strong><br />
  On-hold projects: <strong style="color:#e2e8f0;">${onHoldProjectCount}</strong><br />
  Overdue tasks across owned projects: <strong style="color:#e2e8f0;">${overdueTaskCount}</strong>
</p>

${buildProjectList(items)}`;
}

function buildTaskList(items: Array<Record<string, unknown>>) {
  if (items.length === 0) {
    return "";
  }

  return `<ul style="margin:16px 0 0;padding-left:20px;">${items
    .map((item) => {
      const title = escapeHtml(readString(item.taskTitle) ?? "Untitled task");
      const projectTitle = escapeHtml(
        readString(item.projectTitle) ?? "Unassigned",
      );
      const status = escapeHtml(formatStatus(readString(item.status)));
      const dueDate = formatDate(readString(item.dueDate));

      return `<li style="margin:0 0 8px;"><strong style="color:#e2e8f0;">${title}</strong> - ${projectTitle} (${status}${dueDate ? `, due ${dueDate}` : ""})</li>`;
    })
    .join("")}</ul>`;
}

function buildProjectList(items: Array<Record<string, unknown>>) {
  if (items.length === 0) {
    return "";
  }

  return `<ul style="margin:16px 0 0;padding-left:20px;">${items
    .map((item) => {
      const title = escapeHtml(readString(item.projectTitle) ?? "Untitled project");
      const status = escapeHtml(formatStatus(readString(item.status)));
      const overdueTaskCount = readNumber(item.taskOverdueCount);
      const blockedTaskCount = readNumber(item.taskBlockedCount);

      return `<li style="margin:0 0 8px;"><strong style="color:#e2e8f0;">${title}</strong> - ${status} (${blockedTaskCount} blocked, ${overdueTaskCount} overdue)</li>`;
    })
    .join("")}</ul>`;
}

function toEmail(
  input: {
    homeUrl: string;
    recipientName: string;
  },
  subject: string,
  bodyHtml: string,
) {
  return {
    html: buildEmailHtml(input.homeUrl, input.recipientName, bodyHtml),
    subject,
  };
}

function buildChangeUpdateBody(input: {
  actorName: string;
  entityTitle: string;
  fromLines: string[];
  projectTitle?: string;
  toLines: string[];
}) {
  const projectContext = input.projectTitle
    ? ` in <strong>${input.projectTitle}</strong>`
    : '';

  return `${input.actorName} updated <strong>${input.entityTitle}</strong>${projectContext}.

${buildChangeFence('From', input.fromLines)}
${buildChangeFence('To', input.toLines)}`;
}

function buildChangeFence(label: 'From' | 'To', lines: string[]) {
  const content =
    lines.length > 0
      ? lines.map((line) => escapeHtml(line)).join('\n')
      : 'No changed values';

  return `<div style="margin:16px 0 0;">
  <div style="margin:0 0 6px;color:#94a3b8;font-size:13px;font-weight:600;">${label}:</div>
  <pre style="margin:0;padding:14px 16px;background-color:#111827;border:1px solid #334155;border-radius:10px;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;">${content}</pre>
</div>`;
}

function summarizeAssignedTasks(
  tasks: Array<{
    dueDate: Date | null;
    id: string;
    project: {
      title: string;
    } | null;
    status: string;
    title: string;
  }>,
  now: Date,
) {
  const items = tasks.slice(0, 8).map((task) => ({
    dueDate: task.dueDate?.toISOString() ?? null,
    projectTitle: task.project?.title ?? null,
    status: task.status,
    taskId: task.id,
    taskTitle: task.title,
  }));

  return {
    blockedCount: tasks.filter((task) => task.status === "blocked").length,
    dueTodayCount: tasks.filter((task) => getDueReminderKind(task.dueDate, now) === "task_due_today").length,
    items,
    onHoldCount: tasks.filter((task) => task.status === "on_hold").length,
    overdueCount: tasks.filter((task) => getDueReminderKind(task.dueDate, now) === "task_overdue").length,
    totalOpenCount: tasks.length,
  };
}

function summarizeOwnedProjects(
  projects: Array<{
    displayStatus: string;
    dueDate: Date | null;
    id: string;
    taskBlockedCount: number;
    taskDoneCount: number;
    taskOnHoldCount: number;
    taskOverdueCount: number;
    taskTotalCount: number;
    title: string;
  }>,
) {
  return {
    activeProjectCount: projects.length,
    blockedProjectCount: projects.filter(
      (project) => project.displayStatus === "blocked",
    ).length,
    items: projects.slice(0, 8).map((project) => ({
      dueDate: project.dueDate?.toISOString() ?? null,
      projectId: project.id,
      projectTitle: project.title,
      status: project.displayStatus,
      taskBlockedCount: project.taskBlockedCount,
      taskDoneCount: project.taskDoneCount,
      taskOnHoldCount: project.taskOnHoldCount,
      taskOverdueCount: project.taskOverdueCount,
      taskTotalCount: project.taskTotalCount,
    })),
    onHoldProjectCount: projects.filter(
      (project) => project.displayStatus === "on_hold",
    ).length,
    overdueTaskCount: projects.reduce(
      (total, project) => total + project.taskOverdueCount,
      0,
    ),
  };
}

function getDueReminderKind(
  dueDate: Date | null,
  now: Date,
): Exclude<ScheduledNotificationKind, "daily_project_summary" | "daily_task_summary"> | null {
  if (!dueDate) {
    return null;
  }

  const difference = dayDifferenceUtc(now, dueDate);

  switch (difference) {
    case 7:
      return "task_due_7_days";
    case 3:
      return "task_due_3_days";
    case 1:
      return "task_due_tomorrow";
    case 0:
      return "task_due_today";
    default:
      return difference < 0 ? "task_overdue" : null;
  }
}

function dayDifferenceUtc(left: Date, right: Date) {
  const leftStart = Date.UTC(
    left.getUTCFullYear(),
    left.getUTCMonth(),
    left.getUTCDate(),
  );
  const rightStart = Date.UTC(
    right.getUTCFullYear(),
    right.getUTCMonth(),
    right.getUTCDate(),
  );

  return Math.round((rightStart - leftStart) / 86_400_000);
}

function formatUtcDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dueReminderSubject(kind: string) {
  switch (kind) {
    case "task_due_7_days":
      return "Due in 7 days";
    case "task_due_3_days":
      return "Due in 3 days";
    case "task_due_tomorrow":
      return "Due tomorrow";
    case "task_due_today":
      return "Due today";
    default:
      return "Task overdue";
  }
}

function dueReminderBody(kind: string, dueDate: string | null) {
  switch (kind) {
    case "task_due_7_days":
      return `due in 7 days (${dueDate ?? "-"})`;
    case "task_due_3_days":
      return `due in 3 days (${dueDate ?? "-"})`;
    case "task_due_tomorrow":
      return `due tomorrow (${dueDate ?? "-"})`;
    case "task_due_today":
      return `due today (${dueDate ?? "-"})`;
    default:
      return `overdue${dueDate ? ` since ${dueDate}` : ""}`;
  }
}

function formatDate(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleDateString();
}

function formatStatus(value: string | null) {
  return value ? value.replace(/_/g, " ") : "unknown";
}

function readNumber(value: unknown) {
  return typeof value === "number" ? value : 0;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readRecordArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function toRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
