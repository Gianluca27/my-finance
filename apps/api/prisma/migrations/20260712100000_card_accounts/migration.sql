-- Tarjetas de crédito fase 1 (spec 20): límite, día de cierre y día de vencimiento
-- por cuenta CARD, más los gates de recordatorio/alerta. Todo opcional: las cuentas
-- existentes quedan con NULL y conservan el comportamiento previo.

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "creditLimit" DECIMAL(12,2);
ALTER TABLE "Account" ADD COLUMN     "closingDay" INTEGER;
ALTER TABLE "Account" ADD COLUMN     "paymentDay" INTEGER;
ALTER TABLE "Account" ADD COLUMN     "cardLastRemindedFor" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN     "cardLastAlertCycle" TEXT;
