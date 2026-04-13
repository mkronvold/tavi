-- Backfill summary text into notes before removing the column
UPDATE "Project"
SET "notes" = CASE
  WHEN NULLIF(BTRIM("summary"), '') IS NULL THEN "notes"
  WHEN NULLIF(BTRIM("notes"), '') IS NULL THEN NULLIF(BTRIM("summary"), '')
  WHEN NULLIF(BTRIM("notes"), '') = NULLIF(BTRIM("summary"), '') THEN NULLIF(BTRIM("notes"), '')
  ELSE CONCAT(NULLIF(BTRIM("notes"), ''), E'\n\nSummary: ', NULLIF(BTRIM("summary"), ''))
END
WHERE "summary" IS NOT NULL;

-- Remove the replaced column
ALTER TABLE "Project"
DROP COLUMN "summary";
