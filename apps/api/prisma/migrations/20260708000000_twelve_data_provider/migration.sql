-- AlterEnum
ALTER TYPE "InvestmentType" ADD VALUE 'ETF';

-- AlterTable
ALTER TABLE "Investment" ADD COLUMN "providerSymbol" TEXT,
ADD COLUMN "providerExchange" TEXT;
