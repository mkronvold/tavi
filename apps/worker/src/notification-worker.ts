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
const DEFAULT_DAILY_DIGEST_TIME = "11:00";
const MAX_ATTEMPTS = 5;
const RETRY_MINUTES = [1, 2, 5, 13, 34];
const EMAIL_AUDIT_SYSTEM_ACTOR = {
  actorEmail: "system@tavi.local",
  actorName: "Tavi System",
  actorRole: "admin" as const,
  actorUserId: null,
};

type ScheduledNotificationKind =
  | "daily_non_admin_digest"
  | "daily_project_summary"
  | "daily_task_summary"
  | "personal_todo_due_3_days"
  | "personal_todo_due_7_days"
  | "personal_todo_due_today"
  | "personal_todo_due_tomorrow"
  | "personal_todo_overdue"
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
  dailyDigestEnabled: boolean;
  email: string;
  id: string;
  name: string;
  personalTodoRemindersEnabled: boolean;
};

export class NotificationWorker {
  private readonly idleDelayMs: number;
  private readonly scheduleIntervalMs: number;
  private readonly workDelayMs: number;
  private readonly fromAddress: string;
  private readonly homeUrl: string;
  private readonly transporter: Transporter | null;
  private readonly configured: boolean;
  private readonly smtpHostLabel: string | null;
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
      this.smtpHostLabel = `${host}:${port.toString()}`;

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
      this.smtpHostLabel = null;
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
              dailyDigestEnabled: true,
              email: true,
              id: true,
              name: true,
              personalTodoRemindersEnabled: true,
            },
          },
        },
      });

      if (!event) {
        this.observability.finishJob("notification", "completed", startedAt);
        return true;
      }

      const skipReason = await this.getSkipReason(event.kind, event.recipient);

      if (skipReason) {
        await this.completeEvent(event, "skipped", { reason: skipReason });
        this.observability.finishJob("notification", "completed", startedAt);
        return true;
      }

      const email = buildNotificationEmail({
        homeUrl: this.homeUrl,
        kind: event.kind,
        payload: toRecord(event.payload),
        recipientName: event.recipient!.name,
      });

      await this.recordNotificationAuditStep({
        attemptNumber: event.attemptCount,
        detail: `Sending ${email.subject} to ${event.recipient!.email} via ${this.smtpHostLabel ?? "unknown host"}`,
        event,
        status: "processing",
        subject: email.subject,
        title: `Sending ${event.kind.replace(/_/g, " ")}`,
      });

      const sendResult = await this.transporter!.sendMail({
        from: this.fromAddress,
        html: email.html,
        subject: email.subject,
        to: event.recipient!.email,
      });

      await this.completeEvent(event, "sent", {
        response:
          typeof sendResult.response === "string" ? sendResult.response : null,
        subject: email.subject,
      });
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
      const [dueReminderCount, dailyDigestCount] = await Promise.all([
        this.queueDueDateNotifications(new Date(now)),
        this.queueDailyNonAdminDigests(new Date(now)),
      ]);

      const queuedCount = dueReminderCount + dailyDigestCount;

      if (queuedCount > 0) {
        this.observability.logger.info("worker.notifications.scheduled", {
          dailyDigestCount,
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
    event: {
      attemptCount: number;
      id: string;
      kind: string;
      payload: unknown;
      recipient: NotificationRecipient | null;
      recipientUserId: string | null;
    },
    status: "sent" | "skipped",
    details: {
      reason?: string;
      response?: string | null;
      subject?: string;
    } = {},
  ) {
    await this.prisma.$transaction([
      this.prisma.notificationEvent.update({
        where: { id: event.id },
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
          notificationId: event.id,
          status,
        },
      }),
    ]);

    await this.recordNotificationAuditStep({
      attemptNumber: event.attemptCount,
      detail:
        status === "sent"
          ? `Host accepted delivery for ${event.recipient?.email ?? "unknown recipient"}`
          : details.reason ?? "Notification was skipped",
      event,
      response: details.response ?? null,
      status,
      ...(details.subject !== undefined ? { subject: details.subject } : {}),
      title:
        status === "sent"
          ? `Host accepted ${event.kind.replace(/_/g, " ")}`
          : `Skipped ${event.kind.replace(/_/g, " ")}`,
    });
  }

  private async failEvent(eventId: string, error: unknown) {
    const current = await this.prisma.notificationEvent.findUnique({
      where: { id: eventId },
      select: {
        attemptCount: true,
      },
    });
    const message = error instanceof Error ? error.message : String(error);

    const event = await this.prisma.notificationEvent.findUnique({
      where: { id: eventId },
      include: {
        recipient: {
          select: {
            dailyDigestEnabled: true,
            email: true,
            id: true,
            name: true,
            personalTodoRemindersEnabled: true,
          },
        },
      },
    });

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

      if (event) {
        await this.recordNotificationAuditStep({
          attemptNumber: current?.attemptCount ?? null,
          detail: message,
          event,
          response: readTransportResponse(error),
          status: "failed",
          title: `Host rejected ${event.kind.replace(/_/g, " ")}`,
        });
      }
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

    if (event) {
      await this.recordNotificationAuditStep({
        attemptNumber: current.attemptCount,
        detail: message,
        event,
        nextAttemptAt,
        response: readTransportResponse(error),
        status: "failed",
        title: `Attempt ${current.attemptCount.toString()} failed`,
      });
      await this.recordNotificationAuditStep({
        attemptNumber: current.attemptCount,
        detail: `Retry scheduled for ${nextAttemptAt.toISOString()}`,
        event,
        nextAttemptAt,
        status: "queued",
        title: "Retry scheduled",
      });
    }
  }

  private async recordNotificationAuditStep({
    attemptNumber,
    detail,
    event,
    nextAttemptAt,
    response,
    status,
    subject,
    title,
  }: {
    attemptNumber: number | null;
    detail: string | null;
    event: {
      id: string;
      kind: string;
      payload: unknown;
      recipient: NotificationRecipient | null;
      recipientUserId: string | null;
    };
    nextAttemptAt?: Date;
    response?: string | null;
    status: "failed" | "processing" | "queued" | "sent" | "skipped";
    subject?: string;
    title: string;
  }) {
    const payload = toRecord(event.payload);
    const entityType = readNotificationEntityType(event.kind, payload);
    const entityId = readNotificationEntityId(payload);

    await this.prisma.auditEvent.create({
      data: {
        ...EMAIL_AUDIT_SYSTEM_ACTOR,
        action: `email_notification_${status}`,
        entityId: entityId ?? event.id,
        entityType,
        metadata: {
          ...payload,
          attemptNumber,
          detail,
          emailKind: event.kind,
          host: this.smtpHostLabel,
          nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
          notificationAuditId: event.id,
          notificationEventId: event.id,
          recipientEmail: event.recipient?.email ?? null,
          recipientName: event.recipient?.name ?? null,
          recipientUserId: event.recipientUserId,
          response: response ?? null,
          source: "notification",
          status,
          stepTitle: title,
          subject: subject ?? null,
        } satisfies Prisma.InputJsonValue,
      },
    });
  }

  private async getSkipReason(
    kind: string,
    recipient: NotificationRecipient | null,
  ) {
    if (isLegacyDailySummaryKind(kind)) {
      return "legacy_daily_summary_disabled";
    }

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

    if (kind === "daily_non_admin_digest" && !recipient.dailyDigestEnabled) {
      return "daily_digest_disabled";
    }

    if (recipient.dailyDigestEnabled && shouldBatchIntoDailyDigest(kind)) {
      return "batched_into_digest";
    }

    if (
      isPersonalTodoReminderKind(kind) &&
      !recipient.personalTodoRemindersEnabled
    ) {
      return "personal_todo_reminders_disabled";
    }

    return null;
  }

  private async queueDueDateNotifications(now: Date) {
    const dayKey = formatUtcDate(now);
    const [tasks, personalTodos] = await Promise.all([
      this.prisma.task.findMany({
        where: {
          assignee: {
            is: {
              dailyDigestEnabled: false,
            },
          },
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
      }),
      this.prisma.personalTodo.findMany({
        where: {
          dueDate: {
            not: null,
          },
          status: "todo",
          user: {
            is: {
              personalTodoRemindersEnabled: true,
            },
          },
        },
        select: {
          dueDate: true,
          id: true,
          title: true,
          userId: true,
        },
      }),
    ]);

    const taskEvents = tasks
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
    const personalTodoEvents = personalTodos
      .map((todo) => {
        const kind = getPersonalTodoDueReminderKind(todo.dueDate!, now);

        if (!kind) {
          return null;
        }

        return {
          dedupeKey: `${kind}:${todo.id}:${todo.userId}:${dayKey}`,
          kind,
          payload: {
            dueDate: todo.dueDate!.toISOString(),
            taskTitle: todo.title,
          },
          recipientUserId: todo.userId,
        };
      })
      .filter((event): event is NonNullable<typeof event> => event !== null);
    const events = [...taskEvents, ...personalTodoEvents];

    return this.queueEvents(events);
  }

  private async queueDailyNonAdminDigests(now: Date) {
    const digestUsers = await this.prisma.user.findMany({
      where: {
        dailyDigestEnabled: true,
      },
      select: {
        dailyDigestTime: true,
        id: true,
      },
    });

    if (digestUsers.length === 0) {
      return 0;
    }

    const recipientIdsByDigestTime = new Map<string, string[]>();

    for (const user of digestUsers) {
      const digestTime = user.dailyDigestTime ?? DEFAULT_DAILY_DIGEST_TIME;
      const current = recipientIdsByDigestTime.get(digestTime) ?? [];
      current.push(user.id);
      recipientIdsByDigestTime.set(digestTime, current);
    }

    let queuedCount = 0;

    for (const [digestTime, recipientUserIds] of recipientIdsByDigestTime) {
      const digestWindow = getDigestWindow(now, digestTime);

      if (!digestWindow) {
        continue;
      }

      const [notifications, tasks, projects] = await Promise.all([
        this.prisma.notificationEvent.findMany({
          where: {
            createdAt: {
              gt: digestWindow.windowStart,
              lte: digestWindow.windowEnd,
            },
            kind: {
              notIn: [
                "daily_non_admin_digest",
                "daily_project_summary",
                "daily_task_summary",
              ],
            },
            recipientUserId: {
              in: recipientUserIds,
            },
            status: {
              not: "failed",
            },
          },
          orderBy: [{ createdAt: "asc" }],
          select: {
            createdAt: true,
            kind: true,
            payload: true,
            recipientUserId: true,
          },
        }),
        this.prisma.task.findMany({
          where: {
            archivedAt: null,
            assigneeUserId: {
              in: recipientUserIds,
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
        }),
        this.prisma.project.findMany({
          where: {
            archivedAt: null,
            ownerUserId: {
              in: recipientUserIds,
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
        }),
      ]);

      const notificationsByRecipient = new Map<string, typeof notifications>();

      for (const notification of notifications) {
        if (!notification.recipientUserId) {
          continue;
        }

        const current =
          notificationsByRecipient.get(notification.recipientUserId) ?? [];
        current.push(notification);
        notificationsByRecipient.set(notification.recipientUserId, current);
      }

      const tasksByAssignee = new Map<string, typeof tasks>();

      for (const task of tasks) {
        if (!task.assigneeUserId) {
          continue;
        }

        const current = tasksByAssignee.get(task.assigneeUserId) ?? [];
        current.push(task);
        tasksByAssignee.set(task.assigneeUserId, current);
      }

      const projectsByOwner = new Map<string, typeof projects>();

      for (const project of projects) {
        if (!project.ownerUserId) {
          continue;
        }

        const current = projectsByOwner.get(project.ownerUserId) ?? [];
        current.push(project);
        projectsByOwner.set(project.ownerUserId, current);
      }

      const events = recipientUserIds.flatMap((recipientUserId) => {
        const digestNotifications =
          notificationsByRecipient.get(recipientUserId) ?? [];
        const taskSummaryItems = tasksByAssignee.get(recipientUserId) ?? [];
        const projectSummaryItems = projectsByOwner.get(recipientUserId) ?? [];

        if (
          digestNotifications.length === 0 &&
          taskSummaryItems.length === 0 &&
          projectSummaryItems.length === 0
        ) {
          return [];
        }

        return [
          {
            dedupeKey: `daily_non_admin_digest:${recipientUserId}:${digestWindow.summaryDate}`,
            kind: "daily_non_admin_digest" as const,
            payload: {
              itemCount: digestNotifications.length,
              items: digestNotifications.map((notification) => ({
                createdAt: notification.createdAt.toISOString(),
                kind: notification.kind,
                payload: toRecord(notification.payload),
              })),
              projectSummary:
                projectSummaryItems.length > 0
                  ? summarizeOwnedProjects(projectSummaryItems)
                  : null,
              summaryDate: digestWindow.summaryDate,
              taskSummary:
                taskSummaryItems.length > 0
                  ? summarizeAssignedTasks(taskSummaryItems, now)
                  : null,
              windowEnd: digestWindow.windowEnd.toISOString(),
              windowStart: digestWindow.windowStart.toISOString(),
            },
            recipientUserId,
          },
        ];
      });

      queuedCount += await this.queueEvents(events);
    }

    return queuedCount;
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
  const content = buildNotificationContent(input.kind, input.payload);

  return toEmail(input, content.subject, content.bodyHtml);
}

function buildNotificationContent(kind: string, payload: Record<string, unknown>) {
  const taskTitle = escapeHtml(readString(payload.taskTitle) ?? "Untitled task");
  const projectTitle = escapeHtml(
    readString(payload.projectTitle) ?? "Unassigned",
  );
  const actorName = escapeHtml(readString(payload.actorName) ?? "Someone");
  const dueDate = formatDate(readString(payload.dueDate));

  switch (kind) {
    case "task_assigned":
      return {
        bodyHtml: `${actorName} assigned you <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.${dueDate ? `<p style="margin:12px 0 0;">Due date: <strong style="color:#e2e8f0;">${dueDate}</strong></p>` : ""}`,
        subject: `New task assigned: ${taskTitle}`,
      };
    case "task_unassigned":
      return {
        bodyHtml: `${actorName} removed you from <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.`,
        subject: `Task unassigned: ${taskTitle}`,
      };
    case "task_updated":
      return {
        bodyHtml: buildChangeUpdateBody({
          actorName,
          entityTitle: taskTitle,
          fromLines: readStringArray(payload.fromLines),
          projectTitle,
          toLines: readStringArray(payload.toLines),
        }),
        subject: `Task updated: ${taskTitle}`,
      };
    case "task_due_date_added":
      return {
        bodyHtml: `${actorName} added a due date to <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.<p style="margin:12px 0 0;">Due date: <strong style="color:#e2e8f0;">${dueDate ?? "-"}</strong></p>`,
        subject: `Due date added: ${taskTitle}`,
      };
    case "task_due_date_changed":
      return {
        bodyHtml: `${actorName} changed the due date for <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.<p style="margin:12px 0 0;">New due date: <strong style="color:#e2e8f0;">${dueDate ?? "-"}</strong></p>`,
        subject: `Due date changed: ${taskTitle}`,
      };
    case "task_blocked":
      return {
        bodyHtml: `${actorName} marked <strong>${taskTitle}</strong> as blocked in <strong>${projectTitle}</strong>.`,
        subject: `Task blocked: ${taskTitle}`,
      };
    case "task_unblocked":
      return {
        bodyHtml: `${actorName} moved <strong>${taskTitle}</strong> out of blocked status in <strong>${projectTitle}</strong>.`,
        subject: `Task unblocked: ${taskTitle}`,
      };
    case "task_on_hold":
      return {
        bodyHtml: `${actorName} put <strong>${taskTitle}</strong> on hold in <strong>${projectTitle}</strong>.`,
        subject: `Task on hold: ${taskTitle}`,
      };
    case "task_resumed":
      return {
        bodyHtml: `${actorName} took <strong>${taskTitle}</strong> off hold in <strong>${projectTitle}</strong>.`,
        subject: `Task resumed: ${taskTitle}`,
      };
    case "task_reopened":
      return {
        bodyHtml: `${actorName} reopened <strong>${taskTitle}</strong> in <strong>${projectTitle}</strong>.`,
        subject: `Task reopened: ${taskTitle}`,
      };
    case "task_completed":
      return {
        bodyHtml: `${actorName} marked <strong>${taskTitle}</strong> done in <strong>${projectTitle}</strong>.`,
        subject: `Task completed: ${taskTitle}`,
      };
    case "task_moved":
      return {
        bodyHtml: `${actorName} moved <strong>${taskTitle}</strong> to <strong>${projectTitle}</strong>.`,
        subject: `Task moved: ${taskTitle}`,
      };
    case "project_owner_assigned":
      return {
        bodyHtml: `${actorName} assigned you as the owner of <strong>${projectTitle}</strong>.`,
        subject: `You now own: ${projectTitle}`,
      };
    case "project_owner_changed":
      return {
        bodyHtml: `${actorName} assigned you as the new owner of <strong>${projectTitle}</strong>.`,
        subject: `Project owner changed: ${projectTitle}`,
      };
    case "project_owner_removed":
      return {
        bodyHtml: `${actorName} removed you as the owner of <strong>${projectTitle}</strong>.`,
        subject: `Owner removed: ${projectTitle}`,
      };
    case "project_updated":
      return {
        bodyHtml: buildChangeUpdateBody({
          actorName,
          entityTitle: projectTitle,
          fromLines: readStringArray(payload.fromLines),
          toLines: readStringArray(payload.toLines),
        }),
        subject: `Project updated: ${projectTitle}`,
      };
    case "project_blocked":
      return {
        bodyHtml: `${actorName} marked <strong>${projectTitle}</strong> as blocked.`,
        subject: `Project blocked: ${projectTitle}`,
      };
    case "project_on_hold":
      return {
        bodyHtml: `${actorName} put <strong>${projectTitle}</strong> on hold.`,
        subject: `Project on hold: ${projectTitle}`,
      };
    case "project_resumed":
      return {
        bodyHtml: `${actorName} took <strong>${projectTitle}</strong> off hold.`,
        subject: `Project resumed: ${projectTitle}`,
      };
    case "task_due_7_days":
    case "task_due_3_days":
    case "task_due_tomorrow":
    case "task_due_today":
    case "task_overdue":
      return {
        bodyHtml: `<strong>${taskTitle}</strong> in <strong>${projectTitle}</strong> is ${dueReminderBody(kind, dueDate)}.`,
        subject: `${dueReminderSubject(kind)}: ${taskTitle}`,
      };
    case "personal_todo_due_7_days":
    case "personal_todo_due_3_days":
    case "personal_todo_due_tomorrow":
    case "personal_todo_due_today":
    case "personal_todo_overdue":
      return {
        bodyHtml: `<strong>${taskTitle}</strong> is ${dueReminderBody(toTaskDueReminderKind(kind), dueDate)}.`,
        subject: `${dueReminderSubject(toTaskDueReminderKind(kind))}: ${taskTitle}`,
      };
    case "daily_non_admin_digest":
      return {
        bodyHtml: buildDailyNonAdminDigestBody(payload),
        subject: buildDailyNonAdminDigestSubject(payload),
      };
    case "daily_task_summary":
      return {
        bodyHtml: buildDailyTaskSummaryBody(payload),
        subject: "Daily task summary",
      };
    case "daily_project_summary":
      return {
        bodyHtml: buildDailyProjectSummaryBody(payload),
        subject: "Daily project summary",
      };
    default:
      return {
        bodyHtml: "You have a new notification in Tavi.",
        subject: "Tavi notification",
      };
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

function buildDailyNonAdminDigestSubject(payload: Record<string, unknown>) {
  const itemCount = readNumber(payload.itemCount);

  return itemCount > 0 ? `Daily digest (${itemCount} updates)` : "Daily digest";
}

function buildDailyNonAdminDigestBody(payload: Record<string, unknown>) {
  const itemCount = readNumber(payload.itemCount);
  const items = readRecordArray(payload.items);
  const taskSummary = toNullableRecord(payload.taskSummary);
  const projectSummary = toNullableRecord(payload.projectSummary);
  const sections = [
    `Here is your daily digest.

<p style="margin:16px 0 0;">
  Updates since your last digest: <strong style="color:#e2e8f0;">${itemCount}</strong>
</p>`,
  ];

  if (taskSummary) {
    sections.push(
      buildDigestSection("Assigned tasks", buildDailyTaskSummaryBody(taskSummary)),
    );
  }

  if (projectSummary) {
    sections.push(
      buildDigestSection(
        "Projects you own",
        buildDailyProjectSummaryBody(projectSummary),
      ),
    );
  }

  if (items.length > 0) {
    sections.push(buildDigestNotificationList(items));
  }

  return sections.join("\n\n");
}

function buildDigestSection(title: string, bodyHtml: string) {
  return `<div style="margin:20px 0 0;">
  <div style="margin:0 0 8px;color:#94a3b8;font-size:13px;font-weight:600;">${escapeHtml(title)}</div>
  ${bodyHtml}
</div>`;
}

function buildDigestNotificationList(items: Array<Record<string, unknown>>) {
  return buildDigestSection(
    "Recent updates",
    items.map((item) => buildDigestNotificationCard(item)).join(""),
  );
}

function buildDigestNotificationCard(item: Record<string, unknown>) {
  const kind = readString(item.kind) ?? "notification";
  const createdAt = formatDigestTimestamp(readString(item.createdAt));
  const content = buildNotificationContent(kind, toRecord(item.payload));

  return `<div style="margin:12px 0 0;padding:14px 16px;background-color:#111827;border:1px solid #334155;border-radius:10px;">
  <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;">
    <strong style="color:#e2e8f0;">${escapeHtml(content.subject)}</strong>
    ${
      createdAt
        ? `<span style="color:#94a3b8;font-size:12px;white-space:nowrap;">${escapeHtml(createdAt)}</span>`
        : ""
    }
  </div>
  <div style="margin:10px 0 0;">${content.bodyHtml}</div>
</div>`;
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

function getPersonalTodoDueReminderKind(
  dueDate: Date | null,
  now: Date,
): Exclude<
  ScheduledNotificationKind,
  | "daily_non_admin_digest"
  | "daily_project_summary"
  | "daily_task_summary"
  | "task_due_3_days"
  | "task_due_7_days"
  | "task_due_today"
  | "task_due_tomorrow"
  | "task_overdue"
> | null {
  const kind = getDueReminderKind(dueDate, now);

  switch (kind) {
    case "task_due_7_days":
      return "personal_todo_due_7_days";
    case "task_due_3_days":
      return "personal_todo_due_3_days";
    case "task_due_tomorrow":
      return "personal_todo_due_tomorrow";
    case "task_due_today":
      return "personal_todo_due_today";
    case "task_overdue":
      return "personal_todo_overdue";
    default:
      return null;
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

function formatDigestTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  return new Date(value).toLocaleString();
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

const DAILY_DIGEST_BATCH_KINDS = new Set([
  "daily_project_summary",
  "daily_task_summary",
  "project_blocked",
  "project_on_hold",
  "project_owner_assigned",
  "project_owner_changed",
  "project_owner_removed",
  "project_resumed",
  "project_updated",
  "task_assigned",
  "task_blocked",
  "task_completed",
  "task_due_3_days",
  "task_due_7_days",
  "task_due_date_added",
  "task_due_date_changed",
  "task_due_today",
  "task_due_tomorrow",
  "task_moved",
  "task_on_hold",
  "task_overdue",
  "task_reopened",
  "task_resumed",
  "task_unassigned",
  "task_unblocked",
  "task_updated",
]);

function shouldBatchIntoDailyDigest(kind: string) {
  return DAILY_DIGEST_BATCH_KINDS.has(kind);
}

function isLegacyDailySummaryKind(kind: string) {
  return kind === "daily_task_summary" || kind === "daily_project_summary";
}

function isPersonalTodoReminderKind(kind: string) {
  return kind.startsWith("personal_todo_due_") || kind === "personal_todo_overdue";
}

function toTaskDueReminderKind(kind: string) {
  switch (kind) {
    case "personal_todo_due_7_days":
      return "task_due_7_days";
    case "personal_todo_due_3_days":
      return "task_due_3_days";
    case "personal_todo_due_tomorrow":
      return "task_due_tomorrow";
    case "personal_todo_due_today":
      return "task_due_today";
    case "personal_todo_overdue":
      return "task_overdue";
    default:
      return kind;
  }
}

function getDigestWindow(now: Date, digestTime: string) {
  const [hours, minutes] = digestTime.split(":").map((value) => Number(value));
  const windowEnd = new Date(now);

  windowEnd.setUTCHours(hours ?? 0, minutes ?? 0, 0, 0);

  if (now < windowEnd) {
    return null;
  }

  const windowStart = new Date(windowEnd);
  windowStart.setUTCDate(windowStart.getUTCDate() - 1);

  return {
    summaryDate: formatUtcDate(windowEnd),
    windowEnd,
    windowStart,
  };
}

function toNullableRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toRecord(value: unknown) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNotificationEntityType(
  kind: string,
  payload: Record<string, unknown>,
) {
  if (kind.startsWith("project_") || readString(payload.projectId)) {
    return "project" as const;
  }

  if (
    kind.startsWith("task_") ||
    kind.startsWith("personal_todo_") ||
    readString(payload.taskId)
  ) {
    return "task" as const;
  }

  return "auth" as const;
}

function readNotificationEntityId(payload: Record<string, unknown>) {
  return readString(payload.projectId) ?? readString(payload.taskId) ?? null;
}

function readTransportResponse(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "response" in error &&
    typeof error.response === "string"
  ) {
    return error.response;
  }

  return null;
}
