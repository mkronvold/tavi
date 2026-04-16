ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'daily_non_admin_digest';

ALTER TABLE "User"
ADD COLUMN "dailyDigestEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "EmailSettings"
ADD COLUMN "dailyDigestTime" TEXT NOT NULL DEFAULT '09:00';
