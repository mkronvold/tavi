CREATE TABLE "BackupSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleTime" TEXT NOT NULL DEFAULT '02:00',
    "lastScheduledRunAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupSettings_pkey" PRIMARY KEY ("id")
);
