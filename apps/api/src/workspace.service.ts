import { Injectable, NotFoundException } from '@nestjs/common';
import type { ResetWorkspaceExamplesInput } from '@tavi/schemas';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { PersonalTodosService } from './personal-todos.service';
import { PrismaService } from './prisma.service';
import { ProjectsService } from './projects.service';
import { SavedViewsService } from './saved-views.service';
import { parseStoredWorkspaceUserConfig } from './user-config';
import { buildWorkspaceResetExamples } from './workspace-reset-examples';

type ProjectViewChangeState = {
  hasUnviewedChanges: boolean;
  lastViewedAt: Date | null;
  taskIdsWithUnviewedChanges: Set<string>;
};

const NEVER_VIEWED_AT = new Date(0);

@Injectable()
export class WorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly savedViewsService: SavedViewsService,
    private readonly personalTodosService: PersonalTodosService,
  ) {}

  async getWorkspace(currentUser: SessionUser) {
    const isGuestUser = this.authService.isGuestUser(currentUser);

    if (!isGuestUser) {
      await this.personalTodosService.pruneCompletedPersonalTodosForUser(
        currentUser.id,
      );
    }

    const [
      users,
      projects,
      savedViews,
      emailSettings,
      personalTodos,
      userConfig,
    ] = await Promise.all([
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
      isGuestUser
        ? Promise.resolve([])
        : this.savedViewsService.listSavedViews(currentUser),
      this.prisma.emailSettings.findUnique({
        where: { id: 'global' },
        select: { dragHandlesEnabled: true },
      }),
      isGuestUser
        ? Promise.resolve([])
        : this.prisma.personalTodo.findMany({
            where: {
              userId: currentUser.id,
            },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          }),
      this.prisma.user.findUnique({
        where: { id: currentUser.id },
        select: { userConfigJson: true },
      }),
    ]);
    const projectViewStateByProjectId = isGuestUser
      ? new Map<string, ProjectViewChangeState>()
      : await this.buildProjectViewChangeState(currentUser, projects);

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
      projects: projects.map((project) => {
        const viewState = projectViewStateByProjectId.get(project.id);

        return {
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
          hasUnviewedChanges: viewState?.hasUnviewedChanges ?? false,
          lastViewedAt: viewState?.lastViewedAt ?? null,
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
            hasUnviewedChanges:
              viewState?.taskIdsWithUnviewedChanges.has(task.id) ?? false,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          })),
        };
      }),
      savedViews,
      userConfig: parseStoredWorkspaceUserConfig(userConfig?.userConfigJson),
      personalTodos: personalTodos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        notes: todo.notes,
        dueDate: todo.dueDate,
        status: todo.status,
        sortOrder: todo.sortOrder,
        completedAt: todo.completedAt,
        createdAt: todo.createdAt,
        updatedAt: todo.updatedAt,
      })),
      workspaceSettings: {
        dragHandlesEnabled: emailSettings?.dragHandlesEnabled ?? true,
      },
    };
  }

  async markProjectViewed(projectId: string, currentUser: SessionUser) {
    this.authService.requireNonGuestAccess(currentUser);

    const project = await this.prisma.project.findFirst({
      where: {
        archivedAt: null,
        id: projectId,
      },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const viewedAt = new Date();

    await this.prisma.projectViewState.upsert({
      create: {
        projectId,
        userId: currentUser.id,
        viewedAt,
      },
      update: {
        viewedAt,
      },
      where: {
        userId_projectId: {
          projectId,
          userId: currentUser.id,
        },
      },
    });

    return {
      projectId,
      viewedAt: viewedAt.toISOString(),
    };
  }

  async markAllProjectsViewed(currentUser: SessionUser) {
    this.authService.requireNonGuestAccess(currentUser);

    const projects = await this.prisma.project.findMany({
      where: { archivedAt: null },
      select: { id: true },
    });
    const viewedAt = new Date();

    await this.prisma.$transaction(
      projects.map((project) =>
        this.prisma.projectViewState.upsert({
          create: {
            projectId: project.id,
            userId: currentUser.id,
            viewedAt,
          },
          update: {
            viewedAt,
          },
          where: {
            userId_projectId: {
              projectId: project.id,
              userId: currentUser.id,
            },
          },
        }),
      ),
    );

    return {
      viewedAt: viewedAt.toISOString(),
      viewedProjectCount: projects.length,
    };
  }

  private async buildProjectViewChangeState(
    currentUser: SessionUser,
    projects: Array<{
      id: string;
      tasks: Array<{ id: string }>;
    }>,
  ) {
    const projectIds = projects.map((project) => project.id);

    if (projectIds.length === 0) {
      return new Map<string, ProjectViewChangeState>();
    }

    const taskProjectIdByTaskId = new Map(
      projects.flatMap((project) =>
        project.tasks.map((task) => [task.id, project.id] as const),
      ),
    );
    const taskIds = [...taskProjectIdByTaskId.keys()];
    const viewStates = await this.prisma.projectViewState.findMany({
      where: {
        projectId: { in: projectIds },
        userId: currentUser.id,
      },
    });
    const viewedAtByProjectId = new Map(
      viewStates.map(
        (viewState) => [viewState.projectId, viewState.viewedAt] as const,
      ),
    );
    const allProjectsHaveViewState = viewStates.length === projectIds.length;
    const earliestViewedAt = allProjectsHaveViewState
      ? viewStates.reduce<Date | null>(
          (earliest, viewState) =>
            earliest === null || viewState.viewedAt < earliest
              ? viewState.viewedAt
              : earliest,
          null,
        )
      : null;
    const auditEvents = await this.prisma.auditEvent.findMany({
      where: {
        AND: [
          {
            OR: [
              { entityId: { in: projectIds }, entityType: 'project' },
              { entityId: { in: taskIds }, entityType: 'task' },
            ],
          },
          {
            OR: [
              { actorUserId: null },
              { actorUserId: { not: currentUser.id } },
            ],
          },
          ...(earliestViewedAt
            ? [{ createdAt: { gt: earliestViewedAt } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        entityId: true,
        entityType: true,
      },
    });
    const viewStateByProjectId = new Map<string, ProjectViewChangeState>(
      projects.map((project) => [
        project.id,
        {
          hasUnviewedChanges: false,
          lastViewedAt: viewedAtByProjectId.get(project.id) ?? null,
          taskIdsWithUnviewedChanges: new Set<string>(),
        },
      ]),
    );

    for (const event of auditEvents) {
      const projectId =
        event.entityType === 'project'
          ? event.entityId
          : taskProjectIdByTaskId.get(event.entityId);

      if (!projectId) {
        continue;
      }

      const state = viewStateByProjectId.get(projectId);
      const viewedAt = viewedAtByProjectId.get(projectId) ?? NEVER_VIEWED_AT;

      if (!state || event.createdAt <= viewedAt) {
        continue;
      }

      state.hasUnviewedChanges = true;

      if (event.entityType === 'task') {
        state.taskIdsWithUnviewedChanges.add(event.entityId);
      }
    }

    return viewStateByProjectId;
  }

  async resetWorkspaceExamples(
    input: ResetWorkspaceExamplesInput,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);
    await this.authService.reauthenticateCurrentUser(actor.id, input.password);

    const shouldSeedExamples = input.seedExamples !== false;
    let exampleProjects = [] as ReturnType<typeof buildWorkspaceResetExamples>;

    if (shouldSeedExamples) {
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

      exampleProjects = buildWorkspaceResetExamples(participants);
    }

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
        shouldSeedExamples
          ? 'workspace_reset_examples'
          : 'workspace_clear_projects_tasks',
        {
          seedExamples: shouldSeedExamples,
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
