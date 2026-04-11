import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { SessionUser } from './auth.types';
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
    const auditEventFindManyMock = jest.fn();
    const projectFindFirstMock = jest.fn();
    const savedViewFindFirstMock = jest.fn();
    const taskFindFirstMock = jest.fn();
    const prisma = {
      auditEvent: {
        findMany: auditEventFindManyMock,
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

    return {
      service: new AuditService(prisma),
      mocks: {
        auditEventFindManyMock,
        projectFindFirstMock,
        savedViewFindFirstMock,
        taskFindFirstMock,
      },
    };
  };

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
        actor: {
          id: actor.id,
          email: actor.email,
          name: actor.name,
          roleAssignment: {
            role: actor.role,
          },
        },
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
        actor: {
          id: 'user-2',
          email: 'viewer@tavi.local',
          name: 'Tavi Viewer',
          roleAssignment: null,
        },
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
});
