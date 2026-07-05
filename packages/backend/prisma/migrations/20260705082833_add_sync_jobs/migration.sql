-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('PUSH', 'PULL');

-- AlterTable
ALTER TABLE "SiteConfig" ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "syncIntervalMs" INTEGER NOT NULL DEFAULT 600000;

-- CreateTable
CREATE TABLE "SyncJob" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "direction" "SyncDirection" NOT NULL DEFAULT 'PUSH',
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "scope" TEXT NOT NULL DEFAULT 'ALL',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "pushedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "payload" JSONB,
    "report" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncJob_siteId_idx" ON "SyncJob"("siteId");

-- CreateIndex
CREATE INDEX "SyncJob_status_idx" ON "SyncJob"("status");

-- CreateIndex
CREATE INDEX "SyncJob_createdAt_idx" ON "SyncJob"("createdAt");

-- CreateIndex
CREATE INDEX "SyncJob_createdByUserId_idx" ON "SyncJob"("createdByUserId");

-- CreateIndex
CREATE INDEX "SiteConfig_syncEnabled_idx" ON "SiteConfig"("syncEnabled");

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SiteConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
