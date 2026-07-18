-- CreateTable
CREATE TABLE "ProductExpiryBatch" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductExpiryBatch_pkey" PRIMARY KEY ("id")
);

-- Migrate existing single expiry dates into batches
INSERT INTO "ProductExpiryBatch" ("id", "productId", "expiryDate", "quantity", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", "expiryDate", "totalStock", NOW(), NOW()
FROM "Product"
WHERE "expiryDate" IS NOT NULL;

-- CreateIndex
CREATE INDEX "ProductExpiryBatch_productId_idx" ON "ProductExpiryBatch"("productId");
CREATE INDEX "ProductExpiryBatch_expiryDate_idx" ON "ProductExpiryBatch"("expiryDate");
CREATE INDEX "Product_barcode_idx" ON "Product"("barcode");

-- AddForeignKey
ALTER TABLE "ProductExpiryBatch" ADD CONSTRAINT "ProductExpiryBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
