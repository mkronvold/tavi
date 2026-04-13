ALTER TABLE "Project"
ALTER COLUMN "ownerUserId" DROP NOT NULL;

ALTER TABLE "Project"
DROP CONSTRAINT "Project_ownerUserId_fkey";

ALTER TABLE "Project"
ADD CONSTRAINT "Project_ownerUserId_fkey"
FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
ADD COLUMN "actorEmail" TEXT,
ADD COLUMN "actorName" TEXT,
ADD COLUMN "actorRole" "Role";

UPDATE "AuditEvent" AS "event"
SET
  "actorEmail" = "user"."email",
  "actorName" = "user"."name",
  "actorRole" = "roleAssignment"."role"
FROM "User" AS "user"
LEFT JOIN "RoleAssignment" AS "roleAssignment"
  ON "roleAssignment"."userId" = "user"."id"
WHERE "event"."actorUserId" = "user"."id";

ALTER TABLE "AuditEvent"
ALTER COLUMN "actorEmail" SET NOT NULL,
ALTER COLUMN "actorName" SET NOT NULL,
ALTER COLUMN "actorUserId" DROP NOT NULL;

ALTER TABLE "AuditEvent"
DROP CONSTRAINT "AuditEvent_actorUserId_fkey";

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_actorUserId_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "AuditEvent_entityType_createdAt_idx"
ON "AuditEvent"("entityType", "createdAt");

CREATE INDEX "AuditEvent_action_createdAt_idx"
ON "AuditEvent"("action", "createdAt");
