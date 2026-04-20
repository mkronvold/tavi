-- CreateEnum
CREATE TYPE "PersonalTodoRetentionPolicy" AS ENUM (
  'never',
  'one_month',
  'three_months',
  'six_months',
  'twelve_months',
  'delete_when_done'
);

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "personalTodoRetention" "PersonalTodoRetentionPolicy" NOT NULL DEFAULT 'never';
