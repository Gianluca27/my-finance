-- AlterTable
ALTER TABLE "Investment" ADD COLUMN "providerSource" TEXT,
ADD COLUMN "providerMarket" TEXT,
ADD COLUMN "priceFactor" INTEGER NOT NULL DEFAULT 1;

-- Los activos ya vinculados son todos de Twelve Data (único proveedor hasta ahora).
UPDATE "Investment" SET "providerSource" = 'TWELVE_DATA' WHERE "providerSymbol" IS NOT NULL;
