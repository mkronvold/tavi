ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'on_hold';
ALTER TYPE "ProjectStatus" ADD VALUE IF NOT EXISTS 'on_hold';

CREATE TYPE "NotificationKind" AS ENUM (
  'task_assigned',
  'task_unassigned',
  'task_due_date_added',
  'task_due_date_changed',
  'task_blocked',
  'task_unblocked',
  'task_on_hold',
  'task_resumed',
  'task_reopened',
  'task_completed',
  'task_moved',
  'project_owner_assigned',
  'project_owner_changed',
  'project_owner_removed',
  'project_blocked',
  'project_on_hold',
  'project_resumed',
  'task_due_7_days',
  'task_due_3_days',
  'task_due_tomorrow',
  'task_due_today',
  'task_overdue',
  'daily_task_summary',
  'daily_project_summary'
);

CREATE TYPE "NotificationStatus" AS ENUM (
  'queued',
  'processing',
  'sent',
  'skipped',
  'failed'
);

ALTER TABLE "Project"
ADD COLUMN "taskOnHoldCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "NotificationEvent" (
  "id" TEXT NOT NULL,
  "recipientUserId" TEXT,
  "kind" "NotificationKind" NOT NULL,
  "dedupeKey" TEXT,
  "payload" JSONB NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'queued',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NotificationEvent_dedupeKey_key"
ON "NotificationEvent"("dedupeKey");

CREATE INDEX "NotificationEvent_status_nextAttemptAt_createdAt_idx"
ON "NotificationEvent"("status", "nextAttemptAt", "createdAt");

CREATE INDEX "NotificationEvent_recipientUserId_createdAt_idx"
ON "NotificationEvent"("recipientUserId", "createdAt");

CREATE INDEX "NotificationEvent_kind_createdAt_idx"
ON "NotificationEvent"("kind", "createdAt");

CREATE INDEX "NotificationDeliveryAttempt_notificationId_createdAt_idx"
ON "NotificationDeliveryAttempt"("notificationId", "createdAt");

ALTER TABLE "NotificationEvent"
ADD CONSTRAINT "NotificationEvent_recipientUserId_fkey"
FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationDeliveryAttempt"
ADD CONSTRAINT "NotificationDeliveryAttempt_notificationId_fkey"
FOREIGN KEY ("notificationId") REFERENCES "NotificationEvent"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
