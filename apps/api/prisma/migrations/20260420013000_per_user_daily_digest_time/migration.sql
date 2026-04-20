ALTER TABLE "User"
ADD COLUMN "dailyDigestTime" TEXT NOT NULL DEFAULT '11:00';

UPDATE "User"
SET "dailyDigestTime" = COALESCE(
  (
    SELECT "dailyDigestTime"
    FROM "EmailSettings"
    WHERE "id" = 'global'
    LIMIT 1
  ),
  '11:00'
);

ALTER TABLE "EmailSettings"
DROP COLUMN "dailyDigestTime";
