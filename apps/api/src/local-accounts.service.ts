import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateLocalAccountInput,
  ExportLocalAccountsResponse,
  ImportLocalAccountsInput,
  ImportLocalAccountsResponse,
  LocalAccount,
  LocalAccountExport,
  ResetDefaultLocalAccountsResponse,
  SetLocalAccountPasswordInput,
  SetOwnPasswordInput,
  UpdateLocalAccountInput,
} from '@tavi/schemas';
import { Role } from '@prisma/client';
import type { SessionUser } from './auth.types';
import { AuthService } from './auth.service';
import { DEFAULT_LOCAL_USERS } from './default-local-users';
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
  ) {}

  async listAccounts(actor: SessionUser): Promise<LocalAccount[]> {
    this.authService.requireLocalAuthMode();
    this.authService.requireAdminAccess(
      actor,
      'Only admins can manage local accounts',
    );

    const users = await this.prisma.user.findMany({
      include: { roleAssignment: true },
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
          const passwordHash = await this.authService.hashPassword(
            importedAccount.password!,
          );
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
            actor.id,
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
        const changedFields = [
          ...(nameChanged ? ['name'] : []),
          ...(roleChanged ? ['role'] : []),
          ...(passwordProvided ? ['password'] : []),
        ];

        if (changedFields.length === 0) {
          accounts.push(this.toLocalAccount(existing));
          unchanged += 1;
          continue;
        }

        let passwordHash: string | undefined;

        if (nextPassword !== undefined && nextPassword !== '') {
          passwordHash = await this.authService.hashPassword(nextPassword);
        }

        const updatedUser = await tx.user.update({
          where: { id: existing.id },
          data: {
            ...(nameChanged ? { name: importedAccount.name } : {}),
            ...(passwordHash ? { passwordHash } : {}),
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
          actor.id,
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
            actor.id,
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
          actor.id,
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
        actor.id,
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

    return this.toLocalAccount(created);
  }

  async updateAccount(
    userId: string,
    input: UpdateLocalAccountInput,
    actor: SessionUser,
  ): Promise<LocalAccount> {
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
      return this.toLocalAccount(existing);
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
        actor.id,
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

    return this.toLocalAccount(updated);
  }

  async deleteAccount(userId: string, actor: SessionUser) {
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

    this.assertNoDeleteDependencies(existing);

    await this.prisma.$transaction(async (tx) => {
      await this.authService.recordAudit(
        actor.id,
        'auth',
        userId,
        'account_delete',
        {
          email: existing.email,
          name: existing.name,
          role: currentRole,
        },
        tx,
      );

      await tx.user.delete({
        where: { id: userId },
      });
    });

    return { id: userId };
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
  }

  async setOwnPassword(input: SetOwnPasswordInput, actor: SessionUser) {
    this.authService.requireLocalAuthMode();
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

      if (account.password === undefined || account.password === '') {
        throw new BadRequestException(
          `Password is required to create account ${account.email}`,
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

  private assertNoDeleteDependencies(account: LocalAccountDeleteRecord) {
    const blockers: string[] = [];

    if (account._count.ownedProjects > 0) {
      blockers.push('owned projects');
    }

    if (account._count.assignedTasks > 0) {
      blockers.push('assigned tasks');
    }

    if (blockers.length > 0) {
      throw new BadRequestException(
        `Reassign or remove related data before deleting this account: ${blockers.join(', ')}`,
      );
    }
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
        },
      });

      await this.authService.recordAudit(
        actor.id,
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
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private toLocalAccountExport(account: {
    email: string;
    name: string;
    roleAssignment: {
      role: Role;
    } | null;
  }): LocalAccountExport {
    return {
      email: account.email,
      name: account.name,
      role: account.roleAssignment?.role ?? Role.viewer,
    };
  }
}
