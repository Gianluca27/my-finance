-- Multi-moneda fase A (spec 19): moneda por cuenta, moneda base por usuario y
-- monto de destino en transferencias (para registrar el TC implícito).

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'ARS';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "baseCurrency" TEXT NOT NULL DEFAULT 'ARS';

-- AlterTable: backfill trivial — todas las transferencias existentes son entre
-- cuentas de la misma moneda (ARS), así que amountTo = amount.
ALTER TABLE "Transfer" ADD COLUMN     "amountTo" DECIMAL(12,2);
UPDATE "Transfer" SET "amountTo" = "amount";
ALTER TABLE "Transfer" ALTER COLUMN "amountTo" SET NOT NULL;
