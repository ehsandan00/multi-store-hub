-- CreateEnum
CREATE TYPE "LogisticsOrderStatus" AS ENUM ('SENT', 'NEED_PRODUCT', 'CANCELED');

-- CreateTable
CREATE TABLE "LogisticsOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "receiverName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "status" "LogisticsOrderStatus" NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LogisticsOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsOrderItem" (
    "id" TEXT NOT NULL,
    "logisticsOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "productName" TEXT NOT NULL,
    "skuMaster" TEXT NOT NULL,

    CONSTRAINT "LogisticsOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsOrder_orderNumber_key" ON "LogisticsOrder"("orderNumber");

-- CreateIndex
CREATE INDEX "LogisticsOrder_status_idx" ON "LogisticsOrder"("status");

-- CreateIndex
CREATE INDEX "LogisticsOrder_createdAt_idx" ON "LogisticsOrder"("createdAt");

-- CreateIndex
CREATE INDEX "LogisticsOrder_receiverName_idx" ON "LogisticsOrder"("receiverName");

-- CreateIndex
CREATE INDEX "LogisticsOrder_phone_idx" ON "LogisticsOrder"("phone");

-- CreateIndex
CREATE INDEX "LogisticsOrder_city_idx" ON "LogisticsOrder"("city");

-- CreateIndex
CREATE INDEX "LogisticsOrder_createdByUserId_idx" ON "LogisticsOrder"("createdByUserId");

-- CreateIndex
CREATE INDEX "LogisticsOrderItem_logisticsOrderId_idx" ON "LogisticsOrderItem"("logisticsOrderId");

-- CreateIndex
CREATE INDEX "LogisticsOrderItem_productId_idx" ON "LogisticsOrderItem"("productId");

-- AddForeignKey
ALTER TABLE "LogisticsOrder" ADD CONSTRAINT "LogisticsOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsOrderItem" ADD CONSTRAINT "LogisticsOrderItem_logisticsOrderId_fkey" FOREIGN KEY ("logisticsOrderId") REFERENCES "LogisticsOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogisticsOrderItem" ADD CONSTRAINT "LogisticsOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
