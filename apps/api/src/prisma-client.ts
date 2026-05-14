import { PrismaPg } from '@prisma/adapter-pg';

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to connect to PostgreSQL.');
  }

  return databaseUrl;
}

export function createPrismaClientOptions() {
  return {
    adapter: new PrismaPg({ connectionString: getDatabaseUrl() }),
  };
}
