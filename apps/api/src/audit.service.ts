import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type {
  AuditChangesQuery,
  AuditEmailsQuery,
  AuditEntityType,
  EmailAuditStep,
  AuditLoginsQuery,
  AuditLogRetentionPolicy,
  AuditLogRetentionWindow,
  EmailAuditEvent,
  PurgeAuditLogsInput,
  SetAuditLogRetentionInput,
} from '@tavi/schemas';
import { AppLogger } from './app-logger';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';

const LOGIN_AUDIT_ACTIONS = ['login', 'logout'] as const;
const EMAIL_AUDIT_ACTION_PREFIX = 'email_';
const AUDIT_LOG_RETENTION_ID = 'global';
const AUTOMATIC_AUDIT_PURGE_INTERVAL_MS = 60 * 60 * 1000;

type LocalizedAuditDateRangeQuery = {
  fromDateTime?: string;
  toDateTime?: string;
};

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private automaticPurgeTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    void this.runAutomaticAuditPurge();
    this.automaticPurgeTimer = setInterval(() => {
      void this.runAutomaticAuditPurge();
    }, AUTOMATIC_AUDIT_PURGE_INTERVAL_MS);
    this.automaticPurgeTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.automaticPurgeTimer) {
      clearInterval(this.automaticPurgeTimer);
      this.automaticPurgeTimer = null;
    }
  }

  async listAuditHistory(
    entityType: AuditEntityType,
    entityId: string,
    limit: number,
    actor: SessionUser,
  ) {
    await this.assertCanViewAuditHistory(entityType, entityId, actor);

    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityType,
        entityId,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return events.map(serializeAuditEvent);
  }

  async listAuditChanges(
    query: AuditChangesQuery & LocalizedAuditDateRangeQuery,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);

    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityType: {
          in: ['project', 'task'],
        },
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...buildCreatedAtFilter(query),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return events
      .filter((event) => matchesAuditSearch(event, query.search))
      .map(serializeAuditEvent);
  }

  async listAuditLogins(
    query: AuditLoginsQuery & LocalizedAuditDateRangeQuery,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);

    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityType: 'auth',
        action: {
          in: [...LOGIN_AUDIT_ACTIONS],
        },
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...buildCreatedAtFilter(query),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return events
      .filter((event) => matchesAuditSearch(event, query.search))
      .map(serializeAuditEvent);
  }

  async listAuditEmails(
    query: AuditEmailsQuery & LocalizedAuditDateRangeQuery,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);

    const auditEventTake = Math.min(query.limit * 12, 5_000);
    const [auditEvents, notificationEvents] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where: {
          action: {
            startsWith: EMAIL_AUDIT_ACTION_PREFIX,
          },
          ...buildCreatedAtFilter(query),
        },
        orderBy: { createdAt: 'desc' },
        take: auditEventTake,
      }),
      this.prisma.notificationEvent.findMany({
        where: {
          ...(query.status ? { status: query.status } : {}),
          ...(query.userId ? { recipientUserId: query.userId } : {}),
          ...buildCreatedAtFilter(query),
        },
        include: {
          deliveryAttempts: {
            orderBy: { createdAt: 'asc' },
          },
          recipient: {
            select: {
              email: true,
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
      }),
    ]);

    const auditThreads = groupEmailAuditThreads(auditEvents);
    const notificationIds = new Set(
      notificationEvents.map((event) => event.id),
    );
    const notificationThreads = notificationEvents.map((event) =>
      mergeNotificationAuditThread(event, auditThreads.get(event.id)),
    );
    const directThreads = [...auditThreads.entries()]
      .filter(([threadId, thread]) => {
        if (thread.source === 'notification' && notificationIds.has(threadId)) {
          return false;
        }

        return true;
      })
      .map(([, thread]) => finalizeEmailAuditThread(thread));

    return [...notificationThreads, ...directThreads]
      .filter((event) =>
        query.userId ? event.recipient.id === query.userId : true,
      )
      .filter((event) => (query.status ? event.status === query.status : true))
      .filter((event) => matchesEmailAuditSearch(event, query.search))
      .sort(
        (left, right) =>
          getEmailAuditSortTime(right) - getEmailAuditSortTime(left),
      )
      .slice(0, query.limit);
  }

  async getAuditLogRetentionPolicy(
    actor: SessionUser,
  ): Promise<AuditLogRetentionPolicy> {
    this.authService.requireAdminAccess(actor);

    const policy = await this.readAuditLogRetentionPolicy();
    return {
      olderThan: policy?.olderThan ?? null,
    };
  }

  async setAuditLogRetentionPolicy(
    input: SetAuditLogRetentionInput,
    actor: SessionUser,
  ): Promise<AuditLogRetentionPolicy> {
    this.authService.requireAdminAccess(actor);

    const policy = await this.prisma.auditLogRetention.upsert({
      where: { id: AUDIT_LOG_RETENTION_ID },
      update: { olderThan: input.olderThan },
      create: {
        id: AUDIT_LOG_RETENTION_ID,
        olderThan: input.olderThan,
      },
    });

    return {
      olderThan: policy.olderThan,
    };
  }

  async purgeAuditLogs(input: PurgeAuditLogsInput, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);
    return this.purgeAuditLogsOlderThan(input.olderThan);
  }

  private async assertCanViewAuditHistory(
    entityType: AuditEntityType,
    entityId: string,
    actor: SessionUser,
  ) {
    if (entityType === 'auth') {
      if (entityId !== actor.id) {
        throw new ForbiddenException('You can only view your own auth history');
      }

      return;
    }

    if (entityType === 'saved_view') {
      const savedView = await this.prisma.savedView.findFirst({
        where: {
          id: entityId,
          userId: actor.id,
        },
        select: { id: true },
      });

      if (!savedView) {
        throw new NotFoundException('Saved view not found');
      }

      return;
    }

    if (entityType === 'project') {
      const project = await this.prisma.project.findFirst({
        where: {
          id: entityId,
          archivedAt: null,
        },
        select: { id: true },
      });

      if (!project) {
        throw new NotFoundException('Project not found');
      }

      return;
    }

    const task = await this.prisma.task.findFirst({
      where: {
        id: entityId,
        archivedAt: null,
      },
      select: { id: true },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }
  }

  private async runAutomaticAuditPurge() {
    let olderThan: AuditLogRetentionWindow | null = null;

    try {
      const policy = await this.readAuditLogRetentionPolicy();

      if (!policy) {
        return;
      }

      olderThan = policy.olderThan;
      const result = await this.purgeAuditLogsOlderThan(policy.olderThan);

      if (result.deletedCount > 0) {
        this.logger.log('Purged expired audit events', {
          deletedCount: result.deletedCount,
          olderThan: policy.olderThan,
        });
      }
    } catch (error) {
      this.logger.error(
        'Unable to automatically purge audit events',
        error,
        olderThan ? { olderThan } : undefined,
      );
    }
  }

  private async readAuditLogRetentionPolicy() {
    return this.prisma.auditLogRetention.findUnique({
      where: { id: AUDIT_LOG_RETENTION_ID },
      select: { olderThan: true },
    });
  }

  private async purgeAuditLogsOlderThan(olderThan: AuditLogRetentionWindow) {
    const result = await this.prisma.auditEvent.deleteMany({
      where: {
        createdAt: {
          lt: buildAuditRetentionCutoff(new Date(), olderThan),
        },
      },
    });

    return {
      deletedCount: result.count,
    };
  }
}

function buildAuditRetentionCutoff(
  reference: Date,
  olderThan: AuditLogRetentionWindow,
) {
  if (olderThan === 'one_day') {
    return subtractUtcDays(reference, 1);
  }

  if (olderThan === 'one_week') {
    return subtractUtcDays(reference, 7);
  }

  if (olderThan === 'one_month') {
    return subtractUtcMonths(reference, 1);
  }

  if (olderThan === 'three_months') {
    return subtractUtcMonths(reference, 3);
  }

  if (olderThan === 'six_months') {
    return subtractUtcMonths(reference, 6);
  }

  return subtractUtcMonths(reference, 12);
}

function subtractUtcDays(reference: Date, days: number) {
  const next = new Date(reference);
  next.setUTCDate(next.getUTCDate() - days);
  return next;
}

function subtractUtcMonths(reference: Date, months: number) {
  const totalMonths = reference.getUTCFullYear() * 12 + reference.getUTCMonth();
  const nextTotalMonths = totalMonths - months;
  const nextYear = Math.floor(nextTotalMonths / 12);
  const nextMonth = nextTotalMonths % 12;
  const nextDay = Math.min(
    reference.getUTCDate(),
    getUtcDaysInMonth(nextYear, nextMonth),
  );

  return new Date(
    Date.UTC(
      nextYear,
      nextMonth,
      nextDay,
      reference.getUTCHours(),
      reference.getUTCMinutes(),
      reference.getUTCSeconds(),
      reference.getUTCMilliseconds(),
    ),
  );
}

function getUtcDaysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function buildCreatedAtFilter(query: {
  fromDate?: string;
  fromDateTime?: string;
  toDate?: string;
  toDateTime?: string;
}) {
  const createdAt: {
    gte?: Date;
    lte?: Date;
  } = {};

  if (query.fromDateTime) {
    createdAt.gte = new Date(query.fromDateTime);
  } else if (query.fromDate) {
    createdAt.gte = new Date(`${query.fromDate}T00:00:00.000Z`);
  }

  if (query.toDateTime) {
    createdAt.lte = new Date(query.toDateTime);
  } else if (query.toDate) {
    createdAt.lte = new Date(`${query.toDate}T23:59:59.999Z`);
  }

  return Object.keys(createdAt).length > 0 ? { createdAt } : {};
}

function matchesAuditSearch(
  event: {
    action: string;
    actorEmail: string;
    actorName: string;
    entityId: string;
    entityType: AuditEntityType;
    metadata: unknown;
  },
  search: string,
) {
  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    event.action,
    event.actorEmail,
    event.actorName,
    event.entityId,
    event.entityType,
    safeJsonStringify(event.metadata),
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}

function serializeAuditEvent(event: {
  action: string;
  actorEmail: string;
  actorName: string;
  actorRole: SessionUser['role'] | null;
  actorUserId: string | null;
  createdAt: Date;
  entityId: string;
  entityType: AuditEntityType;
  id: string;
  metadata: unknown;
}) {
  return {
    id: event.id,
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    metadata: event.metadata,
    createdAt: event.createdAt,
    actor: {
      id: event.actorUserId,
      email: event.actorEmail,
      name: event.actorName,
      role: event.actorRole ?? 'viewer',
    },
  };
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function matchesEmailAuditSearch(event: EmailAuditEvent, search: string) {
  const normalizedSearch = search.trim().toLowerCase();

  if (!normalizedSearch) {
    return true;
  }

  return [
    event.action,
    event.source,
    event.status,
    event.kind ?? '',
    event.error ?? '',
    event.entityId ?? '',
    event.entityType ?? '',
    event.actor?.email ?? '',
    event.actor?.name ?? '',
    event.recipient.email,
    event.recipient.name ?? '',
    event.subject ?? '',
    event.response ?? '',
    safeJsonStringify(event.steps),
    safeJsonStringify(event.metadata),
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}

type EmailAuditStepEvent = {
  action: string;
  actorEmail: string;
  actorName: string;
  actorRole: SessionUser['role'] | null;
  actorUserId: string | null;
  createdAt: Date;
  entityId: string;
  entityType: AuditEntityType;
  id: string;
  metadata: unknown;
};

type NotificationAuditRecord = {
  attemptCount: number;
  createdAt: Date;
  deliveryAttempts: Array<{
    createdAt: Date;
    error: string | null;
    id: string;
    status: 'failed' | 'processing' | 'queued' | 'sent' | 'skipped';
  }>;
  failedAt: Date | null;
  id: string;
  kind: string;
  lastError: string | null;
  nextAttemptAt: Date;
  payload: unknown;
  recipient: {
    email: string;
    id: string;
    name: string;
  } | null;
  recipientUserId: string | null;
  sentAt: Date | null;
  skippedAt: Date | null;
  status: 'failed' | 'processing' | 'queued' | 'sent' | 'skipped';
};

type MutableEmailAuditThread = {
  action: string;
  actor: EmailAuditEvent['actor'];
  attemptCount: number;
  createdAt: string;
  entityId: string | null;
  entityType: AuditEntityType | null;
  error: string | null;
  failedAt: string | null;
  id: string;
  kind: string | null;
  metadata: Record<string, unknown> | null;
  nextAttemptAt: string | null;
  recipient: EmailAuditEvent['recipient'];
  response: string | null;
  sentAt: string | null;
  skippedAt: string | null;
  source: EmailAuditEvent['source'];
  status: EmailAuditEvent['status'];
  steps: EmailAuditStep[];
  subject: string | null;
};

function groupEmailAuditThreads(events: EmailAuditStepEvent[]) {
  const threads = new Map<string, MutableEmailAuditThread>();

  for (const event of events) {
    const metadata = toMetadataRecord(event.metadata);
    const threadId =
      readMetadataString(metadata?.notificationAuditId) ?? event.id;
    const status = readEmailAuditStatus(event.action, metadata);
    const step = buildEmailAuditStepFromAuditEvent(event, metadata, status);
    const recipientEmail =
      readMetadataString(metadata?.recipientEmail) ?? event.actorEmail;
    const recipientName =
      readMetadataNullableString(metadata?.recipientName) ?? event.actorName;
    const recipientId =
      readMetadataNullableString(metadata?.recipientUserId) ?? event.entityId;
    const source = readEmailAuditSource(event.action, metadata);
    const subject = readMetadataString(metadata?.subject);
    const response = readMetadataNullableString(metadata?.response);
    const nextAttemptAt = readMetadataNullableString(metadata?.nextAttemptAt);
    const error =
      readMetadataNullableString(metadata?.error) ??
      (status === 'failed' ? step.detail : null);
    const actor = isSystemAuditActor(event)
      ? null
      : {
          id: event.actorUserId,
          email: event.actorEmail,
          name: event.actorName,
          role: event.actorRole ?? 'viewer',
        };

    const existing = threads.get(threadId);

    if (!existing) {
      threads.set(threadId, {
        id: threadId,
        action: event.action,
        actor,
        attemptCount: step.attemptNumber ?? 1,
        createdAt: event.createdAt.toISOString(),
        entityId:
          readMetadataNullableString(metadata?.notificationEntityId) ??
          event.entityId,
        entityType:
          readMetadataEntityType(metadata?.notificationEntityType) ??
          event.entityType,
        error,
        failedAt: status === 'failed' ? event.createdAt.toISOString() : null,
        kind: readMetadataString(metadata?.emailKind),
        metadata,
        nextAttemptAt,
        recipient: {
          id: recipientId,
          email: recipientEmail,
          name: recipientName,
        },
        response,
        sentAt: status === 'sent' ? event.createdAt.toISOString() : null,
        skippedAt: status === 'skipped' ? event.createdAt.toISOString() : null,
        source,
        status,
        steps: [step],
        subject,
      });
      continue;
    }

    existing.action = existing.action || event.action;
    existing.actor = existing.actor ?? actor;
    existing.attemptCount = Math.max(
      existing.attemptCount,
      step.attemptNumber ?? existing.attemptCount,
    );
    existing.entityId =
      existing.entityId ??
      readMetadataNullableString(metadata?.notificationEntityId) ??
      event.entityId;
    existing.entityType =
      existing.entityType ??
      readMetadataEntityType(metadata?.notificationEntityType) ??
      event.entityType;
    existing.error = error ?? existing.error;
    existing.failedAt =
      status === 'failed' ? event.createdAt.toISOString() : existing.failedAt;
    existing.kind = existing.kind ?? readMetadataString(metadata?.emailKind);
    existing.metadata = existing.metadata ?? metadata;
    existing.nextAttemptAt = nextAttemptAt ?? existing.nextAttemptAt;
    existing.recipient = {
      id: existing.recipient.id ?? recipientId,
      email: existing.recipient.email || recipientEmail,
      name: existing.recipient.name ?? recipientName,
    };
    existing.response = response ?? existing.response;
    existing.sentAt =
      status === 'sent' ? event.createdAt.toISOString() : existing.sentAt;
    existing.skippedAt =
      status === 'skipped' ? event.createdAt.toISOString() : existing.skippedAt;
    existing.source = existing.source ?? source;
    existing.status = status;
    existing.subject = existing.subject ?? subject;
    existing.steps.push(step);
  }

  return threads;
}

function mergeNotificationAuditThread(
  event: NotificationAuditRecord,
  thread: MutableEmailAuditThread | undefined,
): EmailAuditEvent {
  const metadata = toMetadataRecord(event.payload);
  const mergedThread =
    thread ??
    createNotificationAuditThread({
      ...event,
      payload: metadata,
    });

  if (!hasQueuedStep(mergedThread.steps)) {
    mergedThread.steps.unshift({
      attemptNumber: null,
      createdAt: event.createdAt.toISOString(),
      detail: `Queued ${event.kind.replace(/_/g, ' ')} for delivery`,
      host: null,
      id: `${event.id}-queued`,
      nextAttemptAt:
        event.status === 'queued' ? event.nextAttemptAt.toISOString() : null,
      response: null,
      status: 'queued',
      title: 'Queued for delivery',
    });
  }

  mergedThread.attemptCount = Math.max(
    mergedThread.attemptCount,
    event.attemptCount,
  );
  mergedThread.entityId =
    mergedThread.entityId ?? readNotificationEntityId(metadata);
  mergedThread.entityType =
    mergedThread.entityType ?? readNotificationEntityType(event.kind, metadata);
  mergedThread.error = mergedThread.error ?? event.lastError;
  mergedThread.failedAt =
    mergedThread.failedAt ?? event.failedAt?.toISOString() ?? null;
  mergedThread.kind = mergedThread.kind ?? event.kind;
  mergedThread.metadata = mergedThread.metadata ?? metadata;
  mergedThread.nextAttemptAt =
    event.status === 'queued' ? event.nextAttemptAt.toISOString() : null;
  mergedThread.recipient = {
    id: mergedThread.recipient.id ?? event.recipientUserId,
    email:
      mergedThread.recipient.email ||
      event.recipient?.email ||
      'Unknown recipient',
    name: mergedThread.recipient.name ?? event.recipient?.name ?? null,
  };
  mergedThread.sentAt =
    mergedThread.sentAt ?? event.sentAt?.toISOString() ?? null;
  mergedThread.skippedAt =
    mergedThread.skippedAt ?? event.skippedAt?.toISOString() ?? null;
  mergedThread.source = 'notification';
  mergedThread.status = event.status;

  if (!thread) {
    mergedThread.steps = buildSyntheticNotificationSteps(event);
  }

  return finalizeEmailAuditThread(mergedThread);
}

function createNotificationAuditThread(
  event: Omit<NotificationAuditRecord, 'payload'> & {
    payload: Record<string, unknown> | null;
  },
): MutableEmailAuditThread {
  return {
    id: event.id,
    action: event.kind,
    actor: null,
    attemptCount: event.attemptCount,
    createdAt: event.createdAt.toISOString(),
    entityId: readNotificationEntityId(event.payload),
    entityType: readNotificationEntityType(event.kind, event.payload),
    error: event.lastError,
    failedAt: event.failedAt?.toISOString() ?? null,
    kind: event.kind,
    metadata: event.payload,
    nextAttemptAt:
      event.status === 'queued' ? event.nextAttemptAt.toISOString() : null,
    recipient: {
      id: event.recipientUserId,
      email: event.recipient?.email ?? 'Unknown recipient',
      name: event.recipient?.name ?? null,
    },
    response: null,
    sentAt: event.sentAt?.toISOString() ?? null,
    skippedAt: event.skippedAt?.toISOString() ?? null,
    source: 'notification',
    status: event.status,
    steps: [],
    subject: readMetadataString(event.payload?.subject),
  };
}

function buildSyntheticNotificationSteps(
  event: NotificationAuditRecord,
): EmailAuditStep[] {
  const steps: EmailAuditStep[] = [
    {
      attemptNumber: null,
      createdAt: event.createdAt.toISOString(),
      detail: `Queued ${event.kind.replace(/_/g, ' ')} for delivery`,
      host: null,
      id: `${event.id}-queued`,
      nextAttemptAt:
        event.status === 'queued' ? event.nextAttemptAt.toISOString() : null,
      response: null,
      status: 'queued',
      title: 'Queued for delivery',
    },
  ];

  event.deliveryAttempts.forEach((attempt, index) => {
    steps.push({
      attemptNumber: index + 1,
      createdAt: attempt.createdAt.toISOString(),
      detail: attempt.error,
      host: null,
      id: attempt.id,
      nextAttemptAt: null,
      response: null,
      status: attempt.status,
      title: buildSyntheticAttemptTitle(attempt.status, index + 1),
    });
  });

  if (
    event.status === 'queued' &&
    event.lastError &&
    event.deliveryAttempts.length > 0
  ) {
    steps.push({
      attemptNumber: event.deliveryAttempts.length,
      createdAt:
        event.deliveryAttempts.at(-1)?.createdAt.toISOString() ??
        event.createdAt.toISOString(),
      detail: `Retry scheduled for ${event.nextAttemptAt.toISOString()}`,
      host: null,
      id: `${event.id}-retry`,
      nextAttemptAt: event.nextAttemptAt.toISOString(),
      response: null,
      status: 'queued',
      title: 'Retry scheduled',
    });
  }

  return steps;
}

function buildEmailAuditStepFromAuditEvent(
  event: EmailAuditStepEvent,
  metadata: Record<string, unknown> | null,
  status: EmailAuditEvent['status'],
): EmailAuditStep {
  return {
    attemptNumber: readMetadataNumber(metadata?.attemptNumber),
    createdAt: event.createdAt.toISOString(),
    detail:
      readMetadataNullableString(metadata?.detail) ??
      readMetadataNullableString(metadata?.error),
    host: readMetadataNullableString(metadata?.host),
    id: event.id,
    nextAttemptAt: readMetadataNullableString(metadata?.nextAttemptAt),
    response: readMetadataNullableString(metadata?.response),
    status,
    title:
      readMetadataString(metadata?.stepTitle) ??
      buildLegacyStepTitle(event.action),
  };
}

function finalizeEmailAuditThread(
  thread: MutableEmailAuditThread,
): EmailAuditEvent {
  const steps = [...thread.steps].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  );
  const latestStep = steps.at(-1);
  const earliestStep = steps.at(0);

  return {
    id: thread.id,
    action: thread.action,
    actor: thread.actor,
    attemptCount: thread.attemptCount,
    createdAt: earliestStep?.createdAt ?? thread.createdAt,
    entityId: thread.entityId,
    entityType: thread.entityType,
    error: thread.error,
    failedAt: thread.failedAt,
    kind: thread.kind,
    metadata: thread.metadata,
    nextAttemptAt: latestStep?.nextAttemptAt ?? thread.nextAttemptAt ?? null,
    recipient: thread.recipient,
    response: latestStep?.response ?? thread.response,
    sentAt: thread.sentAt,
    skippedAt: thread.skippedAt,
    source: thread.source,
    status: latestStep?.status ?? thread.status,
    steps,
    subject: thread.subject,
  };
}

function getEmailAuditSortTime(event: EmailAuditEvent) {
  return new Date(event.steps.at(-1)?.createdAt ?? event.createdAt).getTime();
}

function readEmailAuditStatus(
  action: string,
  metadata?: Record<string, unknown> | null,
): EmailAuditEvent['status'] {
  const metadataStatus = readMetadataString(metadata?.status);

  if (
    metadataStatus === 'failed' ||
    metadataStatus === 'processing' ||
    metadataStatus === 'queued' ||
    metadataStatus === 'sent' ||
    metadataStatus === 'skipped'
  ) {
    return metadataStatus;
  }

  if (action.endsWith('_failed')) {
    return 'failed';
  }

  if (action.endsWith('_processing')) {
    return 'processing';
  }

  if (action.endsWith('_queued')) {
    return 'queued';
  }

  if (action.endsWith('_skipped')) {
    return 'skipped';
  }

  return 'sent';
}

function readEmailAuditSource(
  action: string,
  metadata?: Record<string, unknown> | null,
): EmailAuditEvent['source'] {
  const metadataSource = readMetadataString(metadata?.source);

  if (
    metadataSource === 'account_update' ||
    metadataSource === 'notification' ||
    metadataSource === 'password_email' ||
    metadataSource === 'password_reset' ||
    metadataSource === 'test_email'
  ) {
    return metadataSource;
  }

  if (action.includes('test_email')) {
    return 'test_email';
  }

  if (action.includes('account_update')) {
    return 'account_update';
  }

  if (action.includes('password_email')) {
    return 'password_email';
  }

  if (action.includes('password_reset')) {
    return 'password_reset';
  }

  return 'notification';
}

function readNotificationEntityType(
  kind: string,
  payload: Record<string, unknown> | null,
): AuditEntityType | null {
  const metadata = payload;

  if (kind.startsWith('project_') || readMetadataString(metadata?.projectId)) {
    return 'project';
  }

  if (
    kind.startsWith('task_') ||
    kind.startsWith('personal_todo_') ||
    readMetadataString(metadata?.taskId)
  ) {
    return 'task';
  }

  return 'auth';
}

function readNotificationEntityId(payload: Record<string, unknown> | null) {
  const metadata = payload;
  return (
    readMetadataString(metadata?.notificationEntityId) ??
    readMetadataString(metadata?.projectId) ??
    readMetadataString(metadata?.taskId) ??
    null
  );
}

function toMetadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readMetadataString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readMetadataNullableString(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  return value === null ? null : null;
}

function readMetadataNumber(value: unknown) {
  return typeof value === 'number' ? value : null;
}

function readMetadataEntityType(value: unknown): AuditEntityType | null {
  return value === 'auth' ||
    value === 'project' ||
    value === 'saved_view' ||
    value === 'task'
    ? value
    : null;
}

function hasQueuedStep(steps: EmailAuditStep[]) {
  return steps.some((step) => step.status === 'queued');
}

function buildSyntheticAttemptTitle(
  status: EmailAuditStep['status'],
  attemptNumber: number,
) {
  if (status === 'failed') {
    return `Attempt ${attemptNumber.toString()} failed`;
  }

  if (status === 'sent') {
    return `Attempt ${attemptNumber.toString()} sent`;
  }

  if (status === 'skipped') {
    return 'Notification skipped';
  }

  return `Attempt ${attemptNumber.toString()} ${status}`;
}

function buildLegacyStepTitle(action: string) {
  if (action.endsWith('_processing')) {
    return 'Sending notification';
  }

  if (action.endsWith('_queued')) {
    return 'Queued for delivery';
  }

  if (action.endsWith('_skipped')) {
    return 'Notification skipped';
  }

  if (action.endsWith('_failed')) {
    return 'Delivery failed';
  }

  return 'Host accepted notification';
}

function isSystemAuditActor(event: EmailAuditStepEvent) {
  return event.actorUserId === null && event.actorEmail === 'system@tavi.local';
}
