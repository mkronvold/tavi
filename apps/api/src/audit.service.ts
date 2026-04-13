import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type {
  AuditChangesQuery,
  AuditEntityType,
  AuditLoginsQuery,
  AuditLogRetentionPolicy,
  AuditLogRetentionWindow,
  PurgeAuditLogsInput,
  SetAuditLogRetentionInput,
} from '@tavi/schemas';
import { AppLogger } from './app-logger';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';

const LOGIN_AUDIT_ACTIONS = ['login', 'logout'] as const;
const AUDIT_LOG_RETENTION_ID = 'global';
const AUTOMATIC_AUDIT_PURGE_INTERVAL_MS = 60 * 60 * 1000;

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

  async listAuditChanges(query: AuditChangesQuery, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityType: {
          in: ['project', 'task'],
        },
        ...(query.action ? { action: query.action } : {}),
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...buildCreatedAtFilter(query.fromDate, query.toDate),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return events
      .filter((event) => matchesAuditSearch(event, query.search))
      .map(serializeAuditEvent);
  }

  async listAuditLogins(query: AuditLoginsQuery, actor: SessionUser) {
    this.authService.requireAdminAccess(actor);

    const events = await this.prisma.auditEvent.findMany({
      where: {
        entityType: 'auth',
        action: {
          in: [...LOGIN_AUDIT_ACTIONS],
        },
        ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
        ...buildCreatedAtFilter(query.fromDate, query.toDate),
      },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });

    return events
      .filter((event) => matchesAuditSearch(event, query.search))
      .map(serializeAuditEvent);
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

function buildCreatedAtFilter(fromDate?: string, toDate?: string) {
  const createdAt: {
    gte?: Date;
    lte?: Date;
  } = {};

  if (fromDate) {
    createdAt.gte = new Date(`${fromDate}T00:00:00.000Z`);
  }

  if (toDate) {
    createdAt.lte = new Date(`${toDate}T23:59:59.999Z`);
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
