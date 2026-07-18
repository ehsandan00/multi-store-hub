-- AlterTable
ALTER TABLE "LogisticsOrder" ADD COLUMN     "employeeId" TEXT;

-- CreateIndex
CREATE INDEX "LogisticsOrder_employeeId_idx" ON "LogisticsOrder"("employeeId");

-- AddForeignKey
ALTER TABLE "LogisticsOrder" ADD CONSTRAINT "LogisticsOrder_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
