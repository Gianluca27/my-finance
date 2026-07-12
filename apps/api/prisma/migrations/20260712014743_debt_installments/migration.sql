-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "firstDueDate" TIMESTAMP(3),
ADD COLUMN     "installmentAmount" DECIMAL(12,2),
ADD COLUMN     "installmentCount" INTEGER;
