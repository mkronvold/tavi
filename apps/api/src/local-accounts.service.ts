import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ClearAllLocalAccountsInput,
  CreateLocalAccountInput,
  DeleteLocalAccountInput,
  ExportLocalAccountsResponse,
  ImportLocalAccountsInput,
  ImportLocalAccountsResponse,
  LocalAccount,
  LocalAccountExport,
  ResetDefaultLocalAccountsResponse,
  SetLocalAccountPasswordInput,
  SetOwnPasswordInput,
  UpdateLocalAccountInput,
  UpdateOwnProfileInput,
} from '@tavi/schemas';
import { Role } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import {
  DEFAULT_LOCAL_USERS,
  GUEST_LOCAL_USER_EMAIL,
} from './default-local-users';
import { EmailService } from './email.service';
import { PrismaService } from './prisma.service';

type LocalAccountRecord = {
  createdAt: Date;
  email: string;
  id: string;
  name: string;
  passwordHash: string;
  roleAssignment: {
    role: Role;
  } | null;
  updatedAt: Date;
};

type LocalAccountDeleteRecord = LocalAccountRecord & {
  _count: {
    assignedTasks: number;
    ownedProjects: number;
  };
};

@Injectable()
export class LocalAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly emailService: EmailService,
  ) {}

  async listAccounts(actor: SessionUser): Promise<LocalAccount[]> {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    const users = await this.prisma.user.findMany({
      include: {
        roleAssignment: true,
        _count: {
          select: {
            assignedTasks: true,
            ownedProjects: true,
          },
        },
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });

    return users.map((user) => this.toLocalAccount(user));
  }

  async exportAccounts(
    actor: SessionUser,
  ): Promise<ExportLocalAccountsResponse> {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    const users = await this.prisma.user.findMany({
      include: { roleAssignment: true },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
    });

    return {
      accounts: users.map((user) => this.toLocalAccountExport(user)),
    };
  }

  async importAccounts(
    input: ImportLocalAccountsInput,
    actor: SessionUser,
  ): Promise<ImportLocalAccountsResponse> {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    return this.prisma.$transaction(async (tx) => {
      const existingUsers = await tx.user.findMany({
        where: {
          email: {
            in: input.accounts.map((account) => account.email),
          },
        },
        include: { roleAssignment: true },
      });
      const existingUsersByEmail = new Map(
        existingUsers.map((user) => [user.email, user]),
      );
      const currentAdminCount = await tx.roleAssignment.count({
        where: { role: Role.admin },
      });

      this.assertImportPasswordsForNewAccounts(input, existingUsersByEmail);
      this.assertImportKeepsAdminAccount(
        input,
        existingUsersByEmail,
        currentAdminCount,
      );

      const accounts: LocalAccount[] = [];
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const importedAccount of input.accounts) {
        const existing = existingUsersByEmail.get(importedAccount.email);

        if (!existing) {
          const passwordHash =
            importedAccount.passwordHash ??
            (await this.authService.hashPassword(importedAccount.password!));
          const createdUser = await tx.user.create({
            data: {
              email: importedAccount.email,
              name: importedAccount.name,
              passwordHash,
              roleAssignment: {
                create: {
                  role: importedAccount.role,
                },
              },
            },
            include: { roleAssignment: true },
          });

          await this.authService.recordAudit(
            actor,
            'auth',
            createdUser.id,
            'account_import',
            {
              email: createdUser.email,
              name: createdUser.name,
              outcome: 'created',
              role: createdUser.roleAssignment?.role ?? Role.viewer,
            },
            tx,
          );

          accounts.push(this.toLocalAccount(createdUser));
          existingUsersByEmail.set(createdUser.email, createdUser);
          created += 1;
          continue;
        }

        const nextPassword = importedAccount.password;
        const currentRole = existing.roleAssignment?.role ?? Role.viewer;
        const roleChanged =
          !existing.roleAssignment || importedAccount.role !== currentRole;
        const nameChanged = importedAccount.name !== existing.name;
        const passwordProvided =
          nextPassword !== undefined && nextPassword !== '';
        const passwordHashProvided =
          importedAccount.passwordHash !== undefined &&
          importedAccount.passwordHash !== '';
        const changedFields = [
          ...(nameChanged ? ['name'] : []),
          ...(roleChanged ? ['role'] : []),
          ...(passwordProvided || passwordHashProvided ? ['password'] : []),
        ];

        if (changedFields.length === 0) {
          accounts.push(this.toLocalAccount(existing));
          unchanged += 1;
          continue;
        }

        const passwordHash =
          importedAccount.passwordHash ??
          (nextPassword !== undefined && nextPassword !== ''
            ? await this.authService.hashPassword(nextPassword)
            : undefined);

        const updatedUser = await tx.user.update({
          where: { id: existing.id },
          data: {
            ...(nameChanged ? { name: importedAccount.name } : {}),
            ...(passwordHash
              ? {
                  passwordHash,
                  passwordResetOtpHash: null,
                  passwordResetOtpExpiresAt: null,
                }
              : {}),
            ...(roleChanged
              ? {
                  roleAssignment: {
                    upsert: {
                      create: {
                        role: importedAccount.role,
                      },
                      update: {
                        role: importedAccount.role,
                      },
                    },
                  },
                }
              : {}),
          },
          include: { roleAssignment: true },
        });

        await this.authService.recordAudit(
          actor,
          'auth',
          updatedUser.id,
          'account_import',
          {
            changedFields,
            email: updatedUser.email,
            name: updatedUser.name,
            outcome: 'updated',
            previousName: existing.name,
            previousRole: currentRole,
            role: updatedUser.roleAssignment?.role ?? Role.viewer,
          },
          tx,
        );

        accounts.push(this.toLocalAccount(updatedUser));
        existingUsersByEmail.set(updatedUser.email, updatedUser);
        updated += 1;
      }

      return {
        accounts,
        summary: {
          processed: input.accounts.length,
          created,
          updated,
          unchanged,
        },
      };
    });
  }

  async resetDefaultAccounts(
    actor: SessionUser,
  ): Promise<ResetDefaultLocalAccountsResponse> {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    const passwordHashes = new Map<string, string>();

    await Promise.all(
      DEFAULT_LOCAL_USERS.map(async (defaultUser) => {
        passwordHashes.set(
          defaultUser.email,
          await this.authService.hashPassword(defaultUser.password),
        );
      }),
    );

    return this.prisma.$transaction(async (tx) => {
      const existingUsers = await tx.user.findMany({
        where: {
          email: {
            in: DEFAULT_LOCAL_USERS.map((user) => user.email),
          },
        },
        include: { roleAssignment: true },
      });
      const existingUsersByEmail = new Map(
        existingUsers.map((user) => [user.email, user]),
      );
      const accounts: LocalAccount[] = [];

      for (const defaultUser of DEFAULT_LOCAL_USERS) {
        const existing = existingUsersByEmail.get(defaultUser.email);
        const passwordHash = passwordHashes.get(defaultUser.email);

        if (!passwordHash) {
          throw new BadRequestException(
            'Default account password was not prepared',
          );
        }

        if (!existing) {
          const createdUser = await tx.user.create({
            data: {
              email: defaultUser.email,
              name: defaultUser.name,
              passwordHash,
              roleAssignment: {
                create: {
                  role: defaultUser.role,
                },
              },
            },
            include: { roleAssignment: true },
          });

          await this.authService.recordAudit(
            actor,
            'auth',
            createdUser.id,
            'account_reset_defaults',
            {
              email: createdUser.email,
              name: createdUser.name,
              outcome: 'created',
              role: createdUser.roleAssignment?.role ?? Role.viewer,
            },
            tx,
          );

          accounts.push(this.toLocalAccount(createdUser));
          continue;
        }

        const updatedUser = await tx.user.update({
          where: { id: existing.id },
          data: {
            name: defaultUser.name,
            passwordHash,
            passwordResetOtpHash: null,
            passwordResetOtpExpiresAt: null,
            roleAssignment: {
              upsert: {
                create: {
                  role: defaultUser.role,
                },
                update: {
                  role: defaultUser.role,
                },
              },
            },
          },
          include: { roleAssignment: true },
        });

        await this.authService.recordAudit(
          actor,
          'auth',
          updatedUser.id,
          'account_reset_defaults',
          {
            email: updatedUser.email,
            name: updatedUser.name,
            outcome: 'updated',
            role: updatedUser.roleAssignment?.role ?? Role.viewer,
          },
          tx,
        );

        accounts.push(this.toLocalAccount(updatedUser));
      }

      return { accounts };
    });
  }

  async createAccount(
    input: CreateLocalAccountInput,
    actor: SessionUser,
  ): Promise<LocalAccount> {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    await this.assertEmailAvailable(input.email);

    const passwordHash = await this.authService.hashPassword(input.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          roleAssignment: {
            create: {
              role: input.role,
            },
          },
        },
        include: { roleAssignment: true },
      });

      await this.authService.recordAudit(
        actor,
        'auth',
        user.id,
        'account_create',
        {
          email: user.email,
          name: user.name,
          role: user.roleAssignment?.role ?? Role.viewer,
        },
        tx,
      );

      return user;
    });

    if (input.sendEmail) {
      await this.emailService.sendPasswordEmail(
        { email: created.email, name: created.name },
        input.password,
        {
          actor,
          entityId: created.id,
        },
      );
    }

    return this.toLocalAccount(created);
  }

  async updateAccount(
    userId: string,
    input: UpdateLocalAccountInput,
    actor: SessionUser,
  ): Promise<{ account: LocalAccount; notificationEmailSent: boolean }> {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    const existing = await this.findAccountOrThrow(userId);
    const currentRole = existing.roleAssignment?.role ?? Role.viewer;
    const nextEmail = input.email ?? existing.email;
    const nextName = input.name ?? existing.name;
    const nextRole = input.role ?? currentRole;
    const changedFields: string[] = [];

    if (nextEmail !== existing.email) {
      await this.assertEmailAvailable(nextEmail, userId);
      changedFields.push('email');
    }

    if (nextName !== existing.name) {
      changedFields.push('name');
    }

    if (nextRole !== currentRole) {
      changedFields.push('role');
    }

    if (currentRole === Role.admin && nextRole !== Role.admin) {
      await this.assertAdminRoleCanBeRemoved(userId);
    }

    if (changedFields.length === 0) {
      return {
        account: this.toLocalAccount(existing),
        notificationEmailSent: false,
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: {
          email: nextEmail,
          name: nextName,
          roleAssignment: {
            upsert: {
              create: {
                role: nextRole,
              },
              update: {
                role: nextRole,
              },
            },
          },
        },
        include: { roleAssignment: true },
      });

      await this.authService.recordAudit(
        actor,
        'auth',
        userId,
        'account_update',
        {
          changedFields,
          email: user.email,
          name: user.name,
          previousEmail: existing.email,
          previousName: existing.name,
          previousRole: currentRole,
          role: user.roleAssignment?.role ?? Role.viewer,
        },
        tx,
      );

      return user;
    });

    const notificationEmailSent =
      await this.emailService.sendAccountUpdateEmail(
        { email: updated.email, name: updated.name },
        changedFields,
        {
          actor,
          entityId: updated.id,
        },
      );

    return {
      account: this.toLocalAccount(updated),
      notificationEmailSent,
    };
  }

  async updateOwnProfile(
    input: UpdateOwnProfileInput,
    actor: SessionUser,
  ): Promise<{ account: LocalAccount; notificationEmailSent: boolean }> {
    this.authService.requireLocalAuthMode();
    this.authService.requireNonGuestAccess(
      actor,
      'Guest access cannot update the guest profile',
    );

    const existing = await this.findAccountOrThrow(actor.id);
    const nextEmail = input.email ?? existing.email;
    const nextName = input.name ?? existing.name;
    const changedFields: string[] = [];

    if (nextEmail !== existing.email) {
      await this.assertEmailAvailable(nextEmail, actor.id);
      changedFields.push('email');
    }

    if (nextName !== existing.name) {
      changedFields.push('name');
    }

    if (input.password !== undefined) {
      await this.authService.reauthenticateCurrentUser(
        actor.id,
        input.currentPassword!,
      );
      changedFields.push('password');
    }

    if (changedFields.length === 0) {
      return {
        account: this.toLocalAccount(existing),
        notificationEmailSent: false,
      };
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      let user = existing;

      if (nextEmail !== existing.email || nextName !== existing.name) {
        user = await tx.user.update({
          where: { id: actor.id },
          data: {
            email: nextEmail,
            name: nextName,
          },
          include: { roleAssignment: true },
        });
      }

      if (input.password !== undefined) {
        const passwordHash = await this.authService.hashPassword(
          input.password,
        );

        user = await tx.user.update({
          where: { id: actor.id },
          data: {
            passwordHash,
            passwordResetOtpHash: null,
            passwordResetOtpExpiresAt: null,
          },
          include: { roleAssignment: true },
        });
      }

      await this.authService.recordAudit(
        actor,
        'auth',
        actor.id,
        'account_update',
        {
          changedFields,
          email: user.email,
          name: user.name,
          previousEmail: existing.email,
          previousName: existing.name,
          role: user.roleAssignment?.role ?? Role.viewer,
          previousRole: existing.roleAssignment?.role ?? Role.viewer,
          scope: 'self',
        },
        tx,
      );

      return user;
    });

    return {
      account: this.toLocalAccount(updated),
      notificationEmailSent: false,
    };
  }

  async deleteAccount(
    userId: string,
    input: DeleteLocalAccountInput,
    actor: SessionUser,
  ) {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    const existing = await this.findDeleteRecordOrThrow(userId);
    const currentRole = existing.roleAssignment?.role ?? Role.viewer;

    if (currentRole === Role.admin) {
      await this.assertAdminRoleCanBeRemoved(userId);
    }

    if (input.nextProjectOwnerUserId) {
      await this.assertDeleteProjectOwnerTarget(
        userId,
        input.nextProjectOwnerUserId,
      );
    }

    if (input.nextTaskAssigneeUserId) {
      await this.assertDeleteTaskAssigneeTarget(
        userId,
        input.nextTaskAssigneeUserId,
      );
    }

    this.assertNoDeleteDependencies(existing, input);

    await this.prisma.$transaction(async (tx) => {
      if (existing._count.ownedProjects > 0) {
        await tx.project.updateMany({
          where: { ownerUserId: userId },
          data: {
            ownerUserId: input.nextProjectOwnerUserId ?? null,
          },
        });
      }

      if (existing._count.assignedTasks > 0) {
        await tx.task.updateMany({
          where: { assigneeUserId: userId },
          data: {
            assigneeUserId: input.nextTaskAssigneeUserId ?? null,
          },
        });
      }

      await this.authService.recordAudit(
        actor,
        'auth',
        userId,
        'account_delete',
        {
          email: existing.email,
          name: existing.name,
          role: currentRole,
          ...(existing._count.ownedProjects > 0
            ? {
                ownedProjectCount: existing._count.ownedProjects,
                nextProjectOwnerUserId: input.nextProjectOwnerUserId ?? null,
              }
            : {}),
          ...(existing._count.assignedTasks > 0
            ? {
                assignedTaskCount: existing._count.assignedTasks,
                nextTaskAssigneeUserId: input.nextTaskAssigneeUserId ?? null,
              }
            : {}),
        },
        tx,
      );

      await tx.user.delete({
        where: { id: userId },
      });
    });

    return { id: userId };
  }

  async clearAllAccounts(
    input: ClearAllLocalAccountsInput,
    actor: SessionUser,
  ) {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );
    await this.authService.reauthenticateCurrentUser(
      actor.id,
      input.currentPassword,
    );

    return this.prisma.$transaction(async (tx) => {
      const accountsToDelete = await tx.user.findMany({
        where: {
          id: { not: actor.id },
          email: { not: GUEST_LOCAL_USER_EMAIL },
        },
        include: {
          roleAssignment: true,
          _count: {
            select: {
              assignedTasks: true,
              ownedProjects: true,
            },
          },
        },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
      });

      for (const account of accountsToDelete) {
        if (account._count.ownedProjects > 0) {
          await tx.project.updateMany({
            where: { ownerUserId: account.id },
            data: { ownerUserId: null },
          });
        }

        if (account._count.assignedTasks > 0) {
          await tx.task.updateMany({
            where: { assigneeUserId: account.id },
            data: { assigneeUserId: null },
          });
        }

        await this.authService.recordAudit(
          actor,
          'auth',
          account.id,
          'account_delete',
          {
            email: account.email,
            name: account.name,
            role: account.roleAssignment?.role ?? Role.viewer,
            scope: 'clear_all',
            ...(account._count.ownedProjects > 0
              ? {
                  ownedProjectCount: account._count.ownedProjects,
                  nextProjectOwnerUserId: null,
                }
              : {}),
            ...(account._count.assignedTasks > 0
              ? {
                  assignedTaskCount: account._count.assignedTasks,
                  nextTaskAssigneeUserId: null,
                }
              : {}),
          },
          tx,
        );

        await tx.user.delete({
          where: { id: account.id },
        });
      }

      return {
        deletedCount: accountsToDelete.length,
      };
    });
  }

  async setAccountPassword(
    userId: string,
    input: SetLocalAccountPasswordInput,
    actor: SessionUser,
  ) {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    await this.updatePassword(userId, input.password, actor, 'password_set', {
      scope: 'admin',
    });

    if (input.sendEmail) {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, name: true },
      });

      await this.emailService.sendPasswordEmail(
        { email: user.email, name: user.name },
        input.password,
        {
          actor,
          entityId: userId,
        },
      );
    }
  }

  async setOwnPassword(input: SetOwnPasswordInput, actor: SessionUser) {
    this.authService.requireLocalAuthMode();
    this.authService.requireNonGuestAccess(
      actor,
      'Guest access cannot update the guest password',
    );
    await this.authService.reauthenticateCurrentUser(
      actor.id,
      input.currentPassword,
    );
    await this.updatePassword(
      actor.id,
      input.password,
      actor,
      'password_change',
      {
        scope: 'self',
      },
    );
  }

  private assertImportPasswordsForNewAccounts(
    input: ImportLocalAccountsInput,
    existingUsersByEmail: Map<string, LocalAccountRecord>,
  ) {
    for (const account of input.accounts) {
      if (existingUsersByEmail.has(account.email)) {
        continue;
      }

      const passwordMissing =
        account.password === undefined || account.password === '';
      const passwordHashMissing =
        account.passwordHash === undefined || account.passwordHash === '';

      if (passwordMissing && passwordHashMissing) {
        throw new BadRequestException(
          `Password or password hash is required to create account ${account.email}`,
        );
      }
    }
  }

  private assertImportKeepsAdminAccount(
    input: ImportLocalAccountsInput,
    existingUsersByEmail: Map<string, LocalAccountRecord>,
    currentAdminCount: number,
  ) {
    let projectedAdminCount = currentAdminCount;

    for (const account of input.accounts) {
      const existing = existingUsersByEmail.get(account.email);
      const currentRole = existing?.roleAssignment?.role ?? Role.viewer;

      if (!existing) {
        if (account.role === Role.admin) {
          projectedAdminCount += 1;
        }
        continue;
      }

      if (currentRole === Role.admin && account.role !== Role.admin) {
        projectedAdminCount -= 1;
      }

      if (currentRole !== Role.admin && account.role === Role.admin) {
        projectedAdminCount += 1;
      }
    }

    if (projectedAdminCount < 1) {
      throw new BadRequestException('At least one admin account must remain');
    }
  }

  private async assertAdminRoleCanBeRemoved(userId: string) {
    const adminCount = await this.prisma.roleAssignment.count({
      where: { role: Role.admin },
    });

    if (adminCount <= 1) {
      throw new BadRequestException('At least one admin account must remain');
    }

    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roleAssignment: true },
    });

    if (!account) {
      throw new NotFoundException('Local account not found');
    }
  }

  private assertNoDeleteDependencies(
    account: LocalAccountDeleteRecord,
    input: DeleteLocalAccountInput,
  ) {
    const blockers: string[] = [];

    if (
      account._count.ownedProjects > 0 &&
      input.nextProjectOwnerUserId === undefined
    ) {
      blockers.push('owned projects');
    }

    if (
      account._count.assignedTasks > 0 &&
      input.nextTaskAssigneeUserId === undefined
    ) {
      blockers.push('assigned tasks');
    }

    if (blockers.length > 0) {
      throw new BadRequestException(
        `Reassign or remove related data before deleting this account: ${blockers.join(', ')}`,
      );
    }
  }

  private async assertDeleteProjectOwnerTarget(
    deletedUserId: string,
    nextProjectOwnerUserId: string,
  ) {
    if (nextProjectOwnerUserId === deletedUserId) {
      throw new BadRequestException(
        'Choose another local account or set projects to None before deleting this account',
      );
    }

    await this.findAccountOrThrow(nextProjectOwnerUserId);
  }

  private async assertDeleteTaskAssigneeTarget(
    deletedUserId: string,
    nextTaskAssigneeUserId: string,
  ) {
    if (nextTaskAssigneeUserId === deletedUserId) {
      throw new BadRequestException(
        'Choose another local account or set tasks to None before deleting this account',
      );
    }

    await this.findAccountOrThrow(nextTaskAssigneeUserId);
  }

  private async assertEmailAvailable(email: string, excludeUserId?: string) {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing && existing.id !== excludeUserId) {
      throw new ConflictException('An account with this email already exists');
    }
  }

  private async findAccountOrThrow(
    userId: string,
  ): Promise<LocalAccountRecord> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roleAssignment: true },
    });

    if (!account) {
      throw new NotFoundException('Local account not found');
    }

    return account;
  }

  private async findDeleteRecordOrThrow(
    userId: string,
  ): Promise<LocalAccountDeleteRecord> {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roleAssignment: true,
        _count: {
          select: {
            assignedTasks: true,
            ownedProjects: true,
          },
        },
      },
    });

    if (!account) {
      throw new NotFoundException('Local account not found');
    }

    return account;
  }

  private async updatePassword(
    userId: string,
    password: string,
    actor: SessionUser,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    const existing = await this.findAccountOrThrow(userId);
    const passwordMatches = await this.authService.verifyPassword(
      password,
      existing.passwordHash,
    );

    if (passwordMatches) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const passwordHash = await this.authService.hashPassword(password);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordResetOtpHash: null,
          passwordResetOtpExpiresAt: null,
        },
      });

      await this.authService.recordAudit(
        actor,
        'auth',
        userId,
        action,
        metadata,
        tx,
      );
    });
  }

  private toLocalAccount(account: {
    createdAt: Date;
    email: string;
    id: string;
    name: string;
    _count?: {
      assignedTasks: number;
      ownedProjects: number;
    };
    roleAssignment: {
      role: Role;
    } | null;
    updatedAt: Date;
  }): LocalAccount {
    return {
      id: account.id,
      email: account.email,
      name: account.name,
      role: account.roleAssignment?.role ?? Role.viewer,
      ...(account._count
        ? {
            assignedTaskCount: account._count.assignedTasks,
            ownedProjectCount: account._count.ownedProjects,
          }
        : {}),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private toLocalAccountExport(account: {
    email: string;
    name: string;
    passwordHash: string;
    roleAssignment: {
      role: Role;
    } | null;
  }): LocalAccountExport {
    return {
      email: account.email,
      name: account.name,
      passwordHash: account.passwordHash,
      role: account.roleAssignment?.role ?? Role.viewer,
    };
  }
}
