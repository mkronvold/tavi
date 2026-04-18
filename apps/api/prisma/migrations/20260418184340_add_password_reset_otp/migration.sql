-- AlterTable
ALTER TABLE "NotificationEvent" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordResetOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "passwordResetOtpHash" TEXT;
