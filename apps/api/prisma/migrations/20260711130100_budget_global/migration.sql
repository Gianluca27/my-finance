-- Presupuesto global (techo total del mes): categoryId pasa a ser opcional.
-- AlterTable
ALTER TABLE "Budget" ALTER COLUMN "categoryId" DROP NOT NULL;

-- El @@unique([userId, categoryId]) de Postgres trata cada NULL como distinto, así
-- que admitiría varios presupuestos globales por usuario. Un índice único parcial
-- garantiza uno solo (Prisma no expresa índices parciales en el schema: va como SQL).
-- CreateIndex
CREATE UNIQUE INDEX "Budget_userId_global_key" ON "Budget"("userId") WHERE "categoryId" IS NULL;
