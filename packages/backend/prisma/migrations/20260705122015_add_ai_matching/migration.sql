-- CreateEnum
CREATE TYPE "MatchingJobStatus" AS ENUM ('PREVIEW', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "SiteProductMapping" ADD COLUMN     "matchAiReasoning" TEXT;

-- CreateTable
CREATE TABLE "MatchingJob" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "status" "MatchingJobStatus" NOT NULL DEFAULT 'PREVIEW',
    "fileName" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "suggestedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "aiReviewCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "report" JSONB,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MatchingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MatchingJob_siteId_idx" ON "MatchingJob"("siteId");

-- CreateIndex
CREATE INDEX "MatchingJob_status_idx" ON "MatchingJob"("status");

-- CreateIndex
CREATE INDEX "MatchingJob_createdAt_idx" ON "MatchingJob"("createdAt");

-- AddForeignKey
ALTER TABLE "MatchingJob" ADD CONSTRAINT "MatchingJob_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "SiteConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchingJob" ADD CONSTRAINT "MatchingJob_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
