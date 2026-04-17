CREATE TYPE "PersonalTodoStatus" AS ENUM ('todo', 'done');

ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'personal_todo_due_7_days';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'personal_todo_due_3_days';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'personal_todo_due_tomorrow';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'personal_todo_due_today';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'personal_todo_overdue';

CREATE TABLE "PersonalTodo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "notes" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" "PersonalTodoStatus" NOT NULL DEFAULT 'todo',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalTodo_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PersonalTodo"
ADD CONSTRAINT "PersonalTodo_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "PersonalTodo_userId_sortOrder_idx" ON "PersonalTodo"("userId", "sortOrder");
CREATE INDEX "PersonalTodo_userId_dueDate_idx" ON "PersonalTodo"("userId", "dueDate");
CREATE INDEX "PersonalTodo_userId_status_idx" ON "PersonalTodo"("userId", "status");
