ALTER TYPE "TaskStatus" RENAME TO "TaskStatus_old";

CREATE TYPE "TaskStatus" AS ENUM (
  'not_started',
  'in_progress',
  'demo',
  'review',
  'done',
  'blocked',
  'on_hold',
  'canceled'
);

ALTER TABLE "Task"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TaskStatus"
  USING (
    CASE "status"::text
      WHEN 'todo' THEN 'not_started'
      ELSE "status"::text
    END
  )::"TaskStatus",
  ALTER COLUMN "status" SET DEFAULT 'not_started';

DROP TYPE "TaskStatus_old";

ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";

CREATE TYPE "ProjectStatus" AS ENUM (
  'not_started',
  'in_progress',
  'demo',
  'review',
  'done',
  'blocked',
  'on_hold',
  'canceled'
);

ALTER TABLE "Project"
  ALTER COLUMN "derivedStatus" DROP DEFAULT,
  ALTER COLUMN "displayStatus" DROP DEFAULT,
  ALTER COLUMN "derivedStatus" TYPE "ProjectStatus" USING ("derivedStatus"::text::"ProjectStatus"),
  ALTER COLUMN "displayStatus" TYPE "ProjectStatus" USING ("displayStatus"::text::"ProjectStatus"),
  ALTER COLUMN "manualStatus" TYPE "ProjectStatus" USING ("manualStatus"::text::"ProjectStatus"),
  ALTER COLUMN "derivedStatus" SET DEFAULT 'not_started',
  ALTER COLUMN "displayStatus" SET DEFAULT 'not_started';

ALTER TABLE "SavedView"
  ALTER COLUMN "statusFilter" TYPE "ProjectStatus" USING ("statusFilter"::text::"ProjectStatus");

DROP TYPE "ProjectStatus_old";
