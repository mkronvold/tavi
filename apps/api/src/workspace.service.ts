import { Injectable } from '@nestjs/common';
import type { ResetWorkspaceExamplesInput } from '@tavi/schemas';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PrismaService } from './prisma.service';
import { ProjectsService } from './projects.service';
import { SavedViewsService } from './saved-views.service';
import { buildWorkspaceResetExamples } from './workspace-reset-examples';

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
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
      currentUser: {
        id: currentUser.id,
        email: currentUser.email,
        name: currentUser.name,
        role: currentUser.role,
      },
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.roleAssignment?.role ?? 'viewer',
      })),
      projects: projects.map((project) => ({
        id: project.id,
        title: project.title,
        notes: project.notes,
        references: project.references,
        ownerUserId: project.ownerUserId,
        ownerName: project.owner?.name ?? null,
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
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        tasks: project.tasks.map((task) => ({
          id: task.id,
          projectId: task.projectId,
          title: task.title,
          notes: task.notes,
          assigneeUserId: task.assigneeUserId,
          assigneeName: task.assignee?.name ?? null,
          dueDate: task.dueDate,
          priority: task.priority,
          status: task.status,
          sortOrder: task.sortOrder,
          completedAt: task.completedAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })),
      })),
      savedViews,
    };
  }

  async resetWorkspaceExamples(
    input: ResetWorkspaceExamplesInput,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);
    await this.authService.reauthenticateCurrentUser(actor.id, input.password);

    const users = await this.prisma.user.findMany({
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    const participants =
      users.length > 0
        ? users
        : [
            {
              id: actor.id,
              email: actor.email,
              name: actor.name,
            },
          ];
    const exampleProjects = buildWorkspaceResetExamples(participants);

    return this.prisma.$transaction(async (tx) => {
      const [deletedProjectCount, deletedTaskCount] = await Promise.all([
        tx.project.count(),
        tx.task.count(),
      ]);

      await tx.project.deleteMany({});

      let createdTaskCount = 0;

      for (const projectSeed of exampleProjects) {
        const project = await tx.project.create({
          data: {
            title: projectSeed.title,
            notes: projectSeed.notes,
            references: projectSeed.references,
            ownerUserId: projectSeed.ownerUserId,
            dueDate: projectSeed.dueDate,
            priority: projectSeed.priority,
            manualStatus: projectSeed.manualStatus,
            derivedStatus: 'not_started',
            displayStatus: projectSeed.manualStatus ?? 'not_started',
          },
        });

        for (const [index, taskSeed] of projectSeed.tasks.entries()) {
          await tx.task.create({
            data: {
              projectId: project.id,
              title: taskSeed.title,
              notes: taskSeed.notes,
              assigneeUserId: taskSeed.assigneeUserId,
              dueDate: taskSeed.dueDate,
              priority: taskSeed.priority,
              status: taskSeed.status,
              sortOrder: index + 1,
              completedAt: taskSeed.status === 'done' ? new Date() : null,
            },
          });
        }

        createdTaskCount += projectSeed.tasks.length;
        await this.projectsService.recalculateProject(project.id, tx);
      }

      await this.authService.recordAudit(
        actor,
        'auth',
        actor.id,
        'workspace_reset_examples',
        {
          createdProjectCount: exampleProjects.length,
          createdTaskCount,
          deletedProjectCount,
          deletedTaskCount,
        },
        tx,
      );

      return {
        createdProjectCount: exampleProjects.length,
        createdTaskCount,
        deletedProjectCount,
        deletedTaskCount,
      };
    });
  }
}
