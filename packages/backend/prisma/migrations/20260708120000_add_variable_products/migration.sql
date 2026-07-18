-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('SIMPLE', 'VARIABLE', 'VARIATION');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "productType" "ProductType" NOT NULL DEFAULT 'SIMPLE';
ALTER TABLE "Product" ADD COLUMN "parentId" TEXT;
ALTER TABLE "Product" ADD COLUMN "variationAttributes" JSONB;

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN "mappingRows" JSONB;

-- CreateIndex
CREATE INDEX "Product_parentId_idx" ON "Product"("parentId");
CREATE INDEX "Product_productType_idx" ON "Product"("productType");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
