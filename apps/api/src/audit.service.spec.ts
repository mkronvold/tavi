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
