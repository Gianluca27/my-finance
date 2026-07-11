-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "rollover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rolloverStartMonth" TIMESTAMP(3);
