CREATE TABLE "ProjectViewState" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProjectViewState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectViewState_userId_projectId_key" ON "ProjectViewState"("userId", "projectId");
CREATE INDEX "ProjectViewState_projectId_idx" ON "ProjectViewState"("projectId");

ALTER TABLE "ProjectViewState"
  ADD CONSTRAINT "ProjectViewState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectViewState"
  ADD CONSTRAINT "ProjectViewState_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ProjectViewState" (
  "id",
  "userId",
  "projectId",
  "viewedAt",
  "createdAt",
  "updatedAt"
)
SELECT
  'project_view_' || md5("User"."id" || ':' || "Project"."id"),
  "User"."id",
  "Project"."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
CROSS JOIN "Project";
