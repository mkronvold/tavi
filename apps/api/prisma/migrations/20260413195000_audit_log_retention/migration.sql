-- CreateEnum
CREATE TYPE "AuditLogRetentionWindow" AS ENUM (
  'one_day',
  'one_week',
  'one_month',
  'three_months',
  'six_months',
  'one_year'
);

-- CreateTable
CREATE TABLE "AuditLogRetention" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "olderThan" "AuditLogRetentionWindow" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AuditLogRetention_pkey" PRIMARY KEY ("id")
);
