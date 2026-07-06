-- CreateEnum
CREATE TYPE "InvestmentType" AS ENUM ('ACCION', 'CEDEAR', 'CRIPTO', 'FCI', 'PLAZO_FIJO', 'BONO', 'OTRO');

-- CreateEnum
CREATE TYPE "InvestmentOperationType" AS ENUM ('COMPRA', 'VENTA');

-- CreateTable
CREATE TABLE "Investment" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "InvestmentType" NOT NULL,
    "symbol" TEXT,
    "currency" TEXT,
    "currentPrice" DECIMAL(18,8),
    "priceUpdatedAt" TIMESTAMP(3),
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "icon" TEXT,
    "archivedAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Investment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentOperation" (
    "id" TEXT NOT NULL,
    "type" "InvestmentOperationType" NOT NULL,
    "quantity" DECIMAL(24,8) NOT NULL,
    "unitPrice" DECIMAL(18,8) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "investmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvestmentOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentPriceSnapshot" (
    "id" TEXT NOT NULL,
    "price" DECIMAL(18,8) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "investmentId" TEXT NOT NULL,

    CONSTRAINT "InvestmentPriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "rate" DECIMAL(18,6) NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Investment_userId_idx" ON "Investment"("userId");

-- CreateIndex
CREATE INDEX "InvestmentOperation_investmentId_date_idx" ON "InvestmentOperation"("investmentId", "date");

-- CreateIndex
CREATE INDEX "InvestmentOperation_userId_idx" ON "InvestmentOperation"("userId");

-- CreateIndex
CREATE INDEX "InvestmentPriceSnapshot_investmentId_date_idx" ON "InvestmentPriceSnapshot"("investmentId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_userId_currency_key" ON "ExchangeRate"("userId", "currency");

-- AddForeignKey
ALTER TABLE "Investment" ADD CONSTRAINT "Investment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentOperation" ADD CONSTRAINT "InvestmentOperation_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentOperation" ADD CONSTRAINT "InvestmentOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentPriceSnapshot" ADD CONSTRAINT "InvestmentPriceSnapshot_investmentId_fkey" FOREIGN KEY ("investmentId") REFERENCES "Investment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
