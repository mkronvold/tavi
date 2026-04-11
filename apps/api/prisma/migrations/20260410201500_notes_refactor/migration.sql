-- AlterTable
ALTER TABLE "Project"
ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "Task"
ADD COLUMN "notes" TEXT;

-- Backfill project notes from manual override reasons
UPDATE "Project"
SET "notes" = NULLIF(BTRIM("manualStatusReason"), '')
WHERE "manualStatusReason" IS NOT NULL;

-- Backfill task notes from descriptions and blocked reasons
UPDATE "Task"
SET "notes" = CASE
  WHEN NULLIF(BTRIM("description"), '') IS NOT NULL
    AND NULLIF(BTRIM("blockedReason"), '') IS NOT NULL
    THEN CONCAT(
      NULLIF(BTRIM("description"), ''),
      E'\n\nBlocked: ',
      NULLIF(BTRIM("blockedReason"), '')
    )
  WHEN NULLIF(BTRIM("description"), '') IS NOT NULL
    THEN NULLIF(BTRIM("description"), '')
  WHEN NULLIF(BTRIM("blockedReason"), '') IS NOT NULL
    THEN CONCAT('Blocked: ', NULLIF(BTRIM("blockedReason"), ''))
  ELSE NULL
END
WHERE "description" IS NOT NULL
   OR "blockedReason" IS NOT NULL;

-- Remove replaced columns
ALTER TABLE "Project"
DROP COLUMN "manualStatusReason";

ALTER TABLE "Task"
DROP COLUMN "description",
DROP COLUMN "blockedReason";
