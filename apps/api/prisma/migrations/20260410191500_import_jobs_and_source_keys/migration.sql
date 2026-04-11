-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('queued_parse', 'parsing', 'awaiting_review', 'queued_commit', 'committing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "ImportRowOutcome" AS ENUM ('pending', 'created', 'updated', 'skipped', 'failed');

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'loop',
    "fileName" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'queued_parse',
    "sourceContent" TEXT NOT NULL,
    "headers" JSONB,
    "mapping" JSONB,
    "suggestedMapping" JSONB,
    "totalRowCount" INTEGER NOT NULL DEFAULT 0,
    "createdRowCount" INTEGER NOT NULL DEFAULT 0,
    "updatedRowCount" INTEGER NOT NULL DEFAULT 0,
    "skippedRowCount" INTEGER NOT NULL DEFAULT 0,
    "failedRowCount" INTEGER NOT NULL DEFAULT 0,
    "createdProjectCount" INTEGER NOT NULL DEFAULT 0,
    "updatedProjectCount" INTEGER NOT NULL DEFAULT 0,
    "createdTaskCount" INTEGER NOT NULL DEFAULT 0,
    "updatedTaskCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "importId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "rowOutcome" "ImportRowOutcome" NOT NULL DEFAULT 'pending',
    "projectOutcome" "ImportRowOutcome" NOT NULL DEFAULT 'pending',
    "taskOutcome" "ImportRowOutcome" NOT NULL DEFAULT 'pending',
    "projectId" TEXT,
    "taskId" TEXT,
    "message" TEXT,
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_sourceSystem_sourceExternalId_key" ON "Project"("sourceSystem", "sourceExternalId");

-- CreateIndex
CREATE UNIQUE INDEX "Task_sourceSystem_sourceExternalId_key" ON "Task"("sourceSystem", "sourceExternalId");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_createdByUserId_createdAt_idx" ON "ImportJob"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRow_importId_rowOutcome_idx" ON "ImportRow"("importId", "rowOutcome");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_importId_rowNumber_key" ON "ImportRow"("importId", "rowNumber");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_importId_fkey" FOREIGN KEY ("importId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
