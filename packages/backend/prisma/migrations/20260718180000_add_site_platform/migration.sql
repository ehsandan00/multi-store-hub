CREATE TYPE "SitePlatform" AS ENUM ('WOOCOMMERCE', 'NOPCOMMERCE_ASPNET');

ALTER TABLE "SiteConfig"
ADD COLUMN "platform" "SitePlatform" NOT NULL DEFAULT 'WOOCOMMERCE';

CREATE INDEX "SiteConfig_platform_idx" ON "SiteConfig"("platform");
