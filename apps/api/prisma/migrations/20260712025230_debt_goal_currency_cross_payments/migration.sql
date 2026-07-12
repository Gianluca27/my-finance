-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "entityAmount" DECIMAL(12,2);
