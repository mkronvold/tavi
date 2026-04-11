-- Re-scope saved views to the workspace's project-status filter.
ALTER TABLE "SavedView" ADD COLUMN "statusFilter_new" "ProjectStatus";

UPDATE "SavedView"
SET "statusFilter_new" = CASE "statusFilter"::text
  WHEN 'in_progress' THEN 'in_progress'::"ProjectStatus"
  WHEN 'blocked' THEN 'blocked'::"ProjectStatus"
  WHEN 'done' THEN 'done'::"ProjectStatus"
  ELSE NULL
END;

ALTER TABLE "SavedView" DROP COLUMN "statusFilter";
ALTER TABLE "SavedView" RENAME COLUMN "statusFilter_new" TO "statusFilter";
