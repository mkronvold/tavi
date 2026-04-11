import { Injectable } from '@nestjs/common';
import type { SessionUser } from './auth.types';
import { PrismaService } from './prisma.service';
import { SavedViewsService } from './saved-views.service';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly savedViewsService: SavedViewsService,
  ) {}

  async getWorkspace(currentUser: SessionUser) {
    const [users, projects, savedViews] = await Promise.all([
      this.prisma.user.findMany({
        include: { roleAssignment: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.project.findMany({
        where: { archivedAt: null },
        include: {
          owner: {
            include: { roleAssignment: true },
          },
          tasks: {
            where: { archivedAt: null },
            include: {
              assignee: {
                include: { roleAssignment: true },
              },
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
        orderBy: [{ displayStatus: 'asc' }, { updatedAt: 'desc' }],
      }),
      this.savedViewsService.listSavedViews(currentUser),
    ]);

    return {
      currentUser,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.roleAssignment?.role ?? 'viewer',
      })),
      projects: projects.map((project) => ({
        id: project.id,
        title: project.title,
        summary: project.summary,
        notes: project.notes,
        trackerLink: project.trackerLink,
        ownerUserId: project.ownerUserId,
        ownerName: project.owner.name,
        dueDate: project.dueDate,
        priority: project.priority,
        derivedStatus: project.derivedStatus,
        displayStatus: project.displayStatus,
        manualStatus: project.manualStatus,
        taskTotalCount: project.taskTotalCount,
        taskTodoCount: project.taskTodoCount,
        taskInProgressCount: project.taskInProgressCount,
        taskBlockedCount: project.taskBlockedCount,
        taskDoneCount: project.taskDoneCount,
        taskCanceledCount: project.taskCanceledCount,
        taskOverdueCount: project.taskOverdueCount,
        tasks: project.tasks.map((task) => ({
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          notes: task.notes,
          assigneeUserId: task.assigneeUserId,
          assigneeName: task.assignee.name,
          dueDate: task.dueDate,
          priority: task.priority,
          status: task.status,
          sortOrder: task.sortOrder,
          completedAt: task.completedAt,
        })),
      })),
      savedViews,
    };
  }
}
