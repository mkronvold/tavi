import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuditEntityType } from '@tavi/schemas';
import type { SessionUser } from './auth.types';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

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
      include: {
        actor: {
          include: {
            roleAssignment: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return events.map((event) => ({
      id: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      action: event.action,
      metadata: event.metadata,
      createdAt: event.createdAt,
      actor: {
        id: event.actor.id,
        email: event.actor.email,
        name: event.actor.name,
        role: event.actor.roleAssignment?.role ?? 'viewer',
      },
    }));
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
}
