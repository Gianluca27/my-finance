-- CreateEnum
CREATE TYPE "DigestFrequency" AS ENUM ('NONE', 'WEEKLY', 'MONTHLY', 'BOTH');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "digestFrequency" "DigestFrequency" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "lastMonthlyDigestFor" TIMESTAMP(3),
ADD COLUMN     "lastWeeklyDigestFor" TIMESTAMP(3);
