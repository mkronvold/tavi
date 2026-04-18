import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { upsertInitialLocalAdmin } from '../src/seed-local-admin';

const prisma = new PrismaClient();

async function main() {
  const password = process.env.TAVI_INITIAL_ADMIN_PASSWORD;

  if (!password) {
    throw new Error('TAVI_INITIAL_ADMIN_PASSWORD is required');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await upsertInitialLocalAdmin(prisma, passwordHash);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
