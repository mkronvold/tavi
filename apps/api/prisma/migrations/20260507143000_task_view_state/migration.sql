CREATE TABLE "TaskViewState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TaskViewState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskViewState_userId_taskId_key" ON "TaskViewState"("userId", "taskId");
CREATE INDEX "TaskViewState_taskId_idx" ON "TaskViewState"("taskId");

ALTER TABLE "TaskViewState"
  ADD CONSTRAINT "TaskViewState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TaskViewState"
  ADD CONSTRAINT "TaskViewState_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "TaskViewState" (
  "id",
  "userId",
  "taskId",
  "createdAt",
  "updatedAt"
)
SELECT
  'task_view_' || md5("User"."id" || ':' || "Task"."id"),
  "User"."id",
  "Task"."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
CROSS JOIN "Task"
INNER JOIN "Project" ON "Project"."id" = "Task"."projectId"
WHERE "Task"."archivedAt" IS NULL
  AND "Project"."archivedAt" IS NULL;
