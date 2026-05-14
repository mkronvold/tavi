import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import {
  DEFAULT_LOCAL_USERS,
  DEFAULT_LOCAL_USER_PASSWORD,
} from '../src/default-local-users';
import { createPrismaClientOptions } from '../src/prisma-client';

const prisma = new PrismaClient(createPrismaClientOptions());

async function main() {
  const passwordHash = await bcrypt.hash(DEFAULT_LOCAL_USER_PASSWORD, 10);

  for (const user of DEFAULT_LOCAL_USERS) {
    const created = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        passwordHash,
      },
      create: {
        email: user.email,
        name: user.name,
        passwordHash,
      },
    });

    await prisma.roleAssignment.upsert({
      where: { userId: created.id },
      update: { role: user.role },
      create: {
        userId: created.id,
        role: user.role,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
