-- CreateEnum
CREATE TYPE "ImportOverlapAction" AS ENUM ('update', 'add', 'ignore');

-- AlterTable
ALTER TABLE "ImportRow"
ADD COLUMN "projectOverlapAction" "ImportOverlapAction" NOT NULL DEFAULT 'update',
ADD COLUMN "taskOverlapAction" "ImportOverlapAction" NOT NULL DEFAULT 'update';
