import { Role } from '@prisma/client';
import { DEFAULT_LOCAL_ADMIN } from './default-local-users';

type SeedAdminUserRecord = {
  id: string;
};

type SeedLocalAdminDb = {
  user: {
    upsert(args: {
      where: { email: string };
      update: {
        name: string;
        passwordHash: string;
      };
      create: {
        email: string;
        name: string;
        passwordHash: string;
      };
    }): Promise<SeedAdminUserRecord>;
  };
  roleAssignment: {
    upsert(args: {
      where: { userId: string };
      update: { role: Role };
      create: {
        userId: string;
        role: Role;
      };
    }): Promise<unknown>;
  };
};

export async function upsertInitialLocalAdmin(
  db: SeedLocalAdminDb,
  passwordHash: string,
) {
  const adminUser = await db.user.upsert({
    where: { email: DEFAULT_LOCAL_ADMIN.email },
    update: {
      name: DEFAULT_LOCAL_ADMIN.name,
      passwordHash,
    },
    create: {
      email: DEFAULT_LOCAL_ADMIN.email,
      name: DEFAULT_LOCAL_ADMIN.name,
      passwordHash,
    },
  });

  await db.roleAssignment.upsert({
    where: { userId: adminUser.id },
    update: { role: DEFAULT_LOCAL_ADMIN.role },
    create: {
      userId: adminUser.id,
      role: DEFAULT_LOCAL_ADMIN.role,
    },
  });

  return adminUser;
}
