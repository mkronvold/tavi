import { Injectable, NotFoundException } from '@nestjs/common';
import { Role, type Prisma } from '@prisma/client';
import type { ResetWorkspaceExamplesInput } from '@tavi/schemas';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import {
  DEFAULT_LOCAL_USER_EMAILS,
  DEFAULT_LOCAL_USERS,
} from './default-local-users';
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
const LOCAL_AUTH_MODE = 'local';

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
      select: {
        id: true,
        tasks: {
          where: { archivedAt: null },
          select: { id: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const viewedAt = new Date();

    await this.prisma.$transaction(
      project.tasks.map((task) =>
        this.prisma.taskViewState.upsert({
          create: {
            taskId: task.id,
            userId: currentUser.id,
            updatedAt: viewedAt,
          },
          update: {
            updatedAt: viewedAt,
          },
          where: {
            userId_taskId: {
              taskId: task.id,
              userId: currentUser.id,
            },
          },
        }),
      ),
    );

    return {
      projectId,
      viewedAt: viewedAt.toISOString(),
      viewedTaskCount: project.tasks.length,
    };
  }

  async markAllProjectsViewed(currentUser: SessionUser) {
    this.authService.requireNonGuestAccess(currentUser);

    const tasks = await this.prisma.task.findMany({
      where: {
        archivedAt: null,
        project: { archivedAt: null },
      },
      select: { id: true, projectId: true },
    });
    const viewedAt = new Date();

    await this.prisma.$transaction(
      tasks.map((task) =>
        this.prisma.taskViewState.upsert({
          create: {
            taskId: task.id,
            userId: currentUser.id,
            updatedAt: viewedAt,
          },
          update: {
            updatedAt: viewedAt,
          },
          where: {
            userId_taskId: {
              taskId: task.id,
              userId: currentUser.id,
            },
          },
        }),
      ),
    );

    return {
      viewedAt: viewedAt.toISOString(),
      viewedProjectCount: new Set(tasks.map((task) => task.projectId)).size,
      viewedTaskCount: tasks.length,
    };
  }

  private async buildProjectViewChangeState(
    currentUser: SessionUser,
    projects: Array<{
      id: string;
      tasks: Array<{ id: string }>;
    }>,
  ) {
    const taskProjectIdByTaskId = new Map(
      projects.flatMap((project) =>
        project.tasks.map((task) => [task.id, project.id] as const),
      ),
    );
    const taskIds = [...taskProjectIdByTaskId.keys()];

    if (taskIds.length === 0) {
      return new Map<string, ProjectViewChangeState>(
        projects.map((project) => [
          project.id,
          {
            hasUnviewedChanges: false,
            lastViewedAt: null,
            taskIdsWithUnviewedChanges: new Set<string>(),
          },
        ]),
      );
    }

    const viewStates = await this.prisma.taskViewState.findMany({
      where: {
        taskId: { in: taskIds },
        userId: currentUser.id,
      },
      select: {
        taskId: true,
        updatedAt: true,
      },
    });
    const viewedAtByTaskId = new Map(
      viewStates.map(
        (viewState) => [viewState.taskId, viewState.updatedAt] as const,
      ),
    );
    const viewStateByProjectId = new Map<string, ProjectViewChangeState>(
      projects.map((project) => {
        const taskIdsWithUnviewedChanges = new Set(
          project.tasks
            .filter((task) => !viewedAtByTaskId.has(task.id))
            .map((task) => task.id),
        );
        const viewedTaskDates = project.tasks.flatMap((task) => {
          const viewedAt = viewedAtByTaskId.get(task.id);
          return viewedAt ? [viewedAt] : [];
        });
        const lastViewedAt =
          viewedTaskDates.length === project.tasks.length &&
          viewedTaskDates.length > 0
            ? viewedTaskDates.reduce((earliest, viewedAt) =>
                viewedAt < earliest ? viewedAt : earliest,
              )
            : null;

        return [
          project.id,
          {
            hasUnviewedChanges: taskIdsWithUnviewedChanges.size > 0,
            lastViewedAt,
            taskIdsWithUnviewedChanges,
          },
        ];
      }),
    );

    return viewStateByProjectId;
  }

  async resetWorkspaceExamples(
    input: ResetWorkspaceExamplesInput,
    actor: SessionUser,
  ) {
    this.authService.requireAdminAccess(actor);
    await this.authService.reauthenticateCurrentUser(actor.id, input.password);

    const shouldSeedExamples = input.seedExamples !== false;

    return this.prisma.$transaction(async (tx) => {
      const exampleProjects = shouldSeedExamples
        ? buildWorkspaceResetExamples(
            await this.resolveWorkspaceResetParticipants(actor, tx),
          )
        : [];
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

  private async resolveWorkspaceResetParticipants(
    actor: SessionUser,
    tx: Prisma.TransactionClient,
  ) {
    const defaultUsers = await tx.user.findMany({
      where: {
        email: { in: DEFAULT_LOCAL_USER_EMAILS },
      },
      select: {
        email: true,
        id: true,
        name: true,
      },
    });
    const defaultUsersByEmail = new Map(
      defaultUsers.map((user) => [user.email, user] as const),
    );

    if (
      defaultUsers.length < DEFAULT_LOCAL_USERS.length &&
      this.isLocalAuthModeEnabled()
    ) {
      for (const defaultUser of DEFAULT_LOCAL_USERS) {
        if (defaultUsersByEmail.has(defaultUser.email)) {
          continue;
        }

        const createdUser = await tx.user.create({
          data: {
            email: defaultUser.email,
            name: defaultUser.name,
            passwordHash: await this.authService.hashPassword(
              defaultUser.password,
            ),
            roleAssignment: {
              create: {
                role: defaultUser.role,
              },
            },
          },
          select: {
            email: true,
            id: true,
            name: true,
          },
        });

        defaultUsersByEmail.set(defaultUser.email, createdUser);
        await this.authService.recordAudit(
          actor,
          'auth',
          createdUser.id,
          'account_reset_defaults',
          {
            email: createdUser.email,
            name: createdUser.name,
            outcome: 'created',
            role: defaultUser.role,
            source: 'workspace_reset_examples',
          },
          tx,
        );
      }
    }

    const orderedDefaultUsers = DEFAULT_LOCAL_USERS.flatMap((defaultUser) => {
      const user = defaultUsersByEmail.get(defaultUser.email);
      return user ? [user] : [];
    });

    if (orderedDefaultUsers.length === DEFAULT_LOCAL_USERS.length) {
      return orderedDefaultUsers;
    }

    const users = await tx.user.findMany({
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      select: {
        email: true,
        id: true,
        name: true,
        roleAssignment: {
          select: {
            role: true,
          },
        },
      },
    });
    const orderedRoleUsers = [Role.admin, Role.editor, Role.viewer].flatMap(
      (role) => {
        const user = users.find(
          (candidate) => candidate.roleAssignment?.role === role,
        );
        return user ? [user] : [];
      },
    );
    const participants =
      orderedRoleUsers.length > 0
        ? orderedRoleUsers
        : users.length > 0
          ? users
          : [
              {
                id: actor.id,
                email: actor.email,
                name: actor.name,
              },
            ];

    return participants.map(({ email, id, name }) => ({ email, id, name }));
  }

  private isLocalAuthModeEnabled() {
    return (process.env.AUTH_MODE ?? LOCAL_AUTH_MODE) === LOCAL_AUTH_MODE;
  }
}
