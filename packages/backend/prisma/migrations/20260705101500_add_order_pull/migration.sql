-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "remoteCustomerId" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billingEmail" TEXT,
ADD COLUMN     "billingName" TEXT,
ADD COLUMN     "billingPhone" TEXT,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "dateCreated" TIMESTAMP(3),
ADD COLUMN     "dateModified" TIMESTAMP(3),
ADD COLUMN     "discountTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "remoteOrderId" INTEGER,
ADD COLUMN     "shippingTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "lineName" TEXT,
ADD COLUMN     "remoteLineId" TEXT,
ADD COLUMN     "siteSku" TEXT;

-- AlterTable
ALTER TABLE "SiteConfig" ADD COLUMN     "lastOrderPullAt" TIMESTAMP(3),
ADD COLUMN     "orderPullEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Customer_email_idx" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_siteId_remoteCustomerId_key" ON "Customer"("siteId", "remoteCustomerId");

-- CreateIndex
CREATE INDEX "Order_dateCreated_idx" ON "Order"("dateCreated");

-- CreateIndex
CREATE UNIQUE INDEX "Order_siteId_remoteOrderId_key" ON "Order"("siteId", "remoteOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_siteSku_idx" ON "OrderItem"("siteSku");

-- CreateIndex
CREATE INDEX "SiteConfig_orderPullEnabled_idx" ON "SiteConfig"("orderPullEnabled");
