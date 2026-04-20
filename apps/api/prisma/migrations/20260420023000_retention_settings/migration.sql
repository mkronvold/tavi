CREATE TABLE "RetentionSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "backupRetention" TEXT NOT NULL DEFAULT 'six_months',
    "loginRetention" TEXT NOT NULL DEFAULT 'twelve_months',
    "changeRetention" TEXT NOT NULL DEFAULT 'twelve_months',
    "notificationRetention" TEXT NOT NULL DEFAULT 'one_month',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetentionSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "RetentionSettings" (
    "id",
    "backupRetention",
    "loginRetention",
    "changeRetention",
    "notificationRetention"
)
SELECT
    'global',
    'six_months',
    CASE "olderThan"
        WHEN 'three_months' THEN 'three_months'
        WHEN 'six_months' THEN 'six_months'
        WHEN 'one_year' THEN 'twelve_months'
        ELSE 'three_months'
    END,
    CASE "olderThan"
        WHEN 'three_months' THEN 'three_months'
        WHEN 'six_months' THEN 'six_months'
        WHEN 'one_year' THEN 'twelve_months'
        ELSE 'three_months'
    END,
    'one_month'
FROM "AuditLogRetention"
WHERE "id" = 'global'
ON CONFLICT ("id") DO NOTHING;
