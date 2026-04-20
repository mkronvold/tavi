import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AppLogger } from './app-logger';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';

describe('AuditService', () => {
  const actor: SessionUser = {
    id: 'user-1',
    email: 'editor@tavi.local',
    name: 'Tavi Editor',
    role: 'editor',
  };

  const createService = () => {
    const auditEventDeleteManyMock = jest.fn();
    const auditEventFindManyMock = jest.fn();
    const auditLogRetentionFindUniqueMock = jest.fn();
    const auditLogRetentionUpsertMock = jest.fn();
    const loggerErrorMock = jest.fn();
    const loggerLogMock = jest.fn();
    const notificationEventFindManyMock = jest.fn();
    const projectFindFirstMock = jest.fn();
    const savedViewFindFirstMock = jest.fn();
    const taskFindFirstMock = jest.fn();
    const requireAdminAccessMock = jest.fn();
    const prisma = {
      auditEvent: {
        deleteMany: auditEventDeleteManyMock,
        findMany: auditEventFindManyMock,
      },
      auditLogRetention: {
        findUnique: auditLogRetentionFindUniqueMock,
        upsert: auditLogRetentionUpsertMock,
      },
      notificationEvent: {
        findMany: notificationEventFindManyMock,
      },
      project: {
        findFirst: projectFindFirstMock,
      },
      savedView: {
        findFirst: savedViewFindFirstMock,
      },
      task: {
        findFirst: taskFindFirstMock,
      },
    } as unknown as PrismaService;
    const authService = {
      requireAdminAccess: requireAdminAccessMock,
    } as unknown as AuthService;
    const logger = {
      error: loggerErrorMock,
      log: loggerLogMock,
    } as unknown as AppLogger;

    return {
      service: new AuditService(prisma, authService, logger),
      mocks: {
        auditEventDeleteManyMock,
        auditEventFindManyMock,
        auditLogRetentionFindUniqueMock,
        auditLogRetentionUpsertMock,
        loggerErrorMock,
        loggerLogMock,
        notificationEventFindManyMock,
        projectFindFirstMock,
        requireAdminAccessMock,
        savedViewFindFirstMock,
        taskFindFirstMock,
      },
    };
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns audit history with actor context for workspace entities', async () => {
    const { service, mocks } = createService();

    mocks.taskFindFirstMock.mockResolvedValue({ id: 'task-1' });
    mocks.auditEventFindManyMock.mockResolvedValue([
      {
        id: 'event-1',
        entityType: 'task',
        entityId: 'task-1',
        action: 'bulk_update',
        metadata: {
          changedFields: ['status', 'priority'],
          selectionSize: 2,
          status: 'done',
        },
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorName: actor.name,
        actorRole: actor.role,
      },
    ]);

    const result = await service.listAuditHistory('task', 'task-1', 10, actor);

    expect(mocks.auditEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entityType: 'task',
          entityId: 'task-1',
        },
        take: 10,
      }),
    );
    expect(result).toEqual([
      {
        id: 'event-1',
        entityType: 'task',
        entityId: 'task-1',
        action: 'bulk_update',
        metadata: {
          changedFields: ['status', 'priority'],
          selectionSize: 2,
          status: 'done',
        },
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
        actor: {
          id: actor.id,
          email: actor.email,
          name: actor.name,
          role: actor.role,
        },
      },
    ]);
  });

  it('restricts auth history to the current user', async () => {
    const { service } = createService();

    await expect(
      service.listAuditHistory('auth', 'user-2', 10, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('defaults missing actor role assignments to viewer', async () => {
    const { service, mocks } = createService();

    mocks.taskFindFirstMock.mockResolvedValue({ id: 'task-1' });
    mocks.auditEventFindManyMock.mockResolvedValue([
      {
        id: 'event-1',
        entityType: 'task',
        entityId: 'task-1',
        action: 'update',
        metadata: null,
        createdAt: new Date('2026-02-01T12:00:00.000Z'),
        actorUserId: 'user-2',
        actorEmail: 'viewer@tavi.local',
        actorName: 'Tavi Viewer',
        actorRole: null,
      },
    ]);

    const result = await service.listAuditHistory('task', 'task-1', 10, actor);

    expect(result[0]?.actor.role).toBe('viewer');
  });

  it('requires saved-view audit history to belong to the current user', async () => {
    const { service, mocks } = createService();

    mocks.savedViewFindFirstMock.mockResolvedValue(null);

    await expect(
      service.listAuditHistory('saved_view', 'view-1', 10, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires project audit history targets to exist', async () => {
    const { service, mocks } = createService();

    mocks.projectFindFirstMock.mockResolvedValue(null);

    await expect(
      service.listAuditHistory('project', 'project-1', 10, actor),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(mocks.auditEventFindManyMock).not.toHaveBeenCalled();
  });

  it('lists admin audit changes with filters and actor snapshots', async () => {
    const { service, mocks } = createService();

    mocks.auditEventFindManyMock.mockResolvedValue([
      {
        id: 'event-9',
        entityType: 'task',
        entityId: 'task-1',
        action: 'update',
        metadata: {
          title: 'Kickoff',
          changes: [
            {
              field: 'status',
              from: 'todo',
              to: 'in_progress',
            },
          ],
        },
        createdAt: new Date('2026-02-02T09:30:00.000Z'),
        actorUserId: 'user-2',
        actorEmail: 'viewer@tavi.local',
        actorName: 'Tavi Viewer',
        actorRole: 'viewer',
      },
    ]);

    const result = await service.listAuditChanges(
      {
        limit: 25,
        search: 'kickoff',
        action: 'update',
        actorUserId: 'user-2',
        fromDate: '2026-02-01',
        toDate: '2026-02-02',
      },
      actor,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.auditEventFindManyMock).toHaveBeenCalledWith({
      where: {
        entityType: {
          in: ['project', 'task'],
        },
        action: 'update',
        actorUserId: 'user-2',
        createdAt: {
          gte: new Date('2026-02-01T00:00:00.000Z'),
          lte: new Date('2026-02-02T23:59:59.999Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    expect(result).toEqual([
      {
        id: 'event-9',
        entityType: 'task',
        entityId: 'task-1',
        action: 'update',
        metadata: {
          title: 'Kickoff',
          changes: [
            {
              field: 'status',
              from: 'todo',
              to: 'in_progress',
            },
          ],
        },
        createdAt: new Date('2026-02-02T09:30:00.000Z'),
        actor: {
          id: 'user-2',
          email: 'viewer@tavi.local',
          name: 'Tavi Viewer',
          role: 'viewer',
        },
      },
    ]);
  });

  it('uses explicit localized audit date-time boundaries when provided', async () => {
    const { service, mocks } = createService();

    mocks.auditEventFindManyMock.mockResolvedValue([]);

    await service.listAuditChanges(
      {
        limit: 25,
        search: '',
        action: undefined,
        actorUserId: undefined,
        fromDate: '2026-02-01',
        fromDateTime: '2026-02-01T06:00:00.000Z',
        toDate: '2026-02-02',
        toDateTime: '2026-02-03T05:59:59.999Z',
      },
      actor,
    );

    expect(mocks.auditEventFindManyMock).toHaveBeenCalledWith({
      where: {
        entityType: {
          in: ['project', 'task'],
        },
        createdAt: {
          gte: new Date('2026-02-01T06:00:00.000Z'),
          lte: new Date('2026-02-03T05:59:59.999Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  });

  it('lists admin audit logins using login and logout events only', async () => {
    const { service, mocks } = createService();

    mocks.auditEventFindManyMock.mockResolvedValue([
      {
        id: 'event-login-1',
        entityType: 'auth',
        entityId: actor.id,
        action: 'login',
        metadata: null,
        createdAt: new Date('2026-02-03T08:00:00.000Z'),
        actorUserId: actor.id,
        actorEmail: actor.email,
        actorName: actor.name,
        actorRole: actor.role,
      },
    ]);

    const result = await service.listAuditLogins(
      {
        limit: 10,
        search: '',
        actorUserId: actor.id,
        fromDate: '2026-02-03',
      },
      actor,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.auditEventFindManyMock).toHaveBeenCalledWith({
      where: {
        entityType: 'auth',
        action: {
          in: ['login', 'logout'],
        },
        actorUserId: actor.id,
        createdAt: {
          gte: new Date('2026-02-03T00:00:00.000Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(result[0]?.actor).toEqual({
      id: actor.id,
      email: actor.email,
      name: actor.name,
      role: actor.role,
    });
  });

  it('lists admin email audit entries from notifications and password resets', async () => {
    const { service, mocks } = createService();

    mocks.auditEventFindManyMock.mockResolvedValue([
      {
        id: 'event-reset-1',
        entityType: 'auth',
        entityId: 'user-2',
        action: 'email_password_reset_failed',
        metadata: {
          detail: 'SMTP timeout',
          emailKind: 'password_reset',
          error: 'SMTP timeout',
          host: '10.120.64.99:25',
          recipientEmail: 'viewer@tavi.local',
          recipientName: 'Tavi Viewer',
          recipientUserId: 'user-2',
          response: '554 5.7.1 blocked',
          source: 'password_reset',
          status: 'failed',
          stepTitle: 'Host rejected password reset',
          subject: 'Your Tavi one-time password',
        },
        createdAt: new Date('2026-02-04T09:15:00.000Z'),
        actorUserId: 'user-2',
        actorEmail: 'viewer@tavi.local',
        actorName: 'Tavi Viewer',
        actorRole: 'viewer',
      },
    ]);
    mocks.notificationEventFindManyMock.mockResolvedValue([
      {
        id: 'notification-1',
        recipientUserId: 'user-3',
        recipient: {
          id: 'user-3',
          email: 'owner@tavi.local',
          name: 'Tavi Owner',
        },
        kind: 'task_updated',
        payload: {
          projectId: 'project-1',
          title: 'Kickoff',
        },
        status: 'sent',
        attemptCount: 2,
        deliveryAttempts: [],
        lastError: null,
        nextAttemptAt: new Date('2026-02-04T10:01:00.000Z'),
        sentAt: new Date('2026-02-04T10:00:00.000Z'),
        skippedAt: null,
        failedAt: null,
        createdAt: new Date('2026-02-04T09:45:00.000Z'),
      },
    ]);

    const result = await service.listAuditEmails(
      {
        limit: 25,
        search: 'viewer',
        status: undefined,
        fromDate: '2026-02-04',
        toDate: '2026-02-04',
        userId: undefined,
      },
      actor,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.auditEventFindManyMock).toHaveBeenCalledWith({
      where: {
        action: {
          startsWith: 'email_',
        },
        createdAt: {
          gte: new Date('2026-02-04T00:00:00.000Z'),
          lte: new Date('2026-02-04T23:59:59.999Z'),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    expect(mocks.notificationEventFindManyMock).toHaveBeenCalledWith({
      where: {
        createdAt: {
          gte: new Date('2026-02-04T00:00:00.000Z'),
          lte: new Date('2026-02-04T23:59:59.999Z'),
        },
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
      take: 25,
    });
    expect(result).toEqual([
      {
        id: 'event-reset-1',
        action: 'email_password_reset_failed',
        actor: {
          id: 'user-2',
          email: 'viewer@tavi.local',
          name: 'Tavi Viewer',
          role: 'viewer',
        },
        attemptCount: 1,
        createdAt: '2026-02-04T09:15:00.000Z',
        entityId: 'user-2',
        entityType: 'auth',
        error: 'SMTP timeout',
        failedAt: '2026-02-04T09:15:00.000Z',
        kind: 'password_reset',
        metadata: {
          detail: 'SMTP timeout',
          emailKind: 'password_reset',
          error: 'SMTP timeout',
          host: '10.120.64.99:25',
          recipientEmail: 'viewer@tavi.local',
          recipientName: 'Tavi Viewer',
          recipientUserId: 'user-2',
          response: '554 5.7.1 blocked',
          source: 'password_reset',
          status: 'failed',
          stepTitle: 'Host rejected password reset',
          subject: 'Your Tavi one-time password',
        },
        nextAttemptAt: null,
        recipient: {
          id: 'user-2',
          email: 'viewer@tavi.local',
          name: 'Tavi Viewer',
        },
        response: '554 5.7.1 blocked',
        sentAt: null,
        skippedAt: null,
        source: 'password_reset',
        status: 'failed',
        steps: [
          {
            attemptNumber: null,
            createdAt: '2026-02-04T09:15:00.000Z',
            detail: 'SMTP timeout',
            host: '10.120.64.99:25',
            id: 'event-reset-1',
            nextAttemptAt: null,
            response: '554 5.7.1 blocked',
            status: 'failed',
            title: 'Host rejected password reset',
          },
        ],
        subject: 'Your Tavi one-time password',
      },
    ]);
  });

  it('returns the configured audit log retention policy for admins', async () => {
    const { service, mocks } = createService();

    mocks.auditLogRetentionFindUniqueMock.mockResolvedValue({
      olderThan: 'six_months',
    });

    const result = await service.getAuditLogRetentionPolicy(actor);

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.auditLogRetentionFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'global' },
      select: { olderThan: true },
    });
    expect(result).toEqual({
      olderThan: 'six_months',
    });
  });

  it('stores automatic audit log retention for admins', async () => {
    const { service, mocks } = createService();

    mocks.auditLogRetentionUpsertMock.mockResolvedValue({
      olderThan: 'one_year',
    });

    const result = await service.setAuditLogRetentionPolicy(
      {
        olderThan: 'one_year',
      },
      actor,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.auditLogRetentionUpsertMock).toHaveBeenCalledWith({
      where: { id: 'global' },
      update: { olderThan: 'one_year' },
      create: {
        id: 'global',
        olderThan: 'one_year',
      },
    });
    expect(result).toEqual({
      olderThan: 'one_year',
    });
  });

  it('purges audit logs older than the selected retention window', async () => {
    const { service, mocks } = createService();

    jest
      .useFakeTimers()
      .setSystemTime(new Date('2026-04-13T19:45:43.595Z').getTime());
    mocks.auditEventDeleteManyMock.mockResolvedValue({ count: 4 });

    const result = await service.purgeAuditLogs(
      {
        olderThan: 'one_month',
      },
      actor,
    );

    expect(mocks.requireAdminAccessMock).toHaveBeenCalledWith(actor);
    expect(mocks.auditEventDeleteManyMock).toHaveBeenCalledWith({
      where: {
        createdAt: {
          lt: new Date('2026-03-13T19:45:43.595Z'),
        },
      },
    });
    expect(result).toEqual({
      deletedCount: 4,
    });
  });
});
