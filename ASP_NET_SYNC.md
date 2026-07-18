# ASP.NET / nopCommerce price and stock synchronization

This integration sends absolute price and stock values from Multi-Store Hub to
an existing ASP.NET/nopCommerce catalog. It does not create products and does
not pull orders.

## Safety model

- The ASP.NET API must be served over HTTPS.
- Every request is authenticated with an API key plus HMAC-SHA256 signature.
- The signature covers timestamp, one-time nonce, HTTP method, path, and body.
- Requests older than five minutes and repeated nonces are rejected.
- Products are matched by saved source product ID first, then by a unique SKU.
- Missing or duplicate matches are reported; they are never guessed.
- Run a dry-run before every first production synchronization.

## Backup discovery result

The supplied SQL Server backup was restored in an isolated container. The
catalog is a heavily customized nopCommerce-style schema:

- `dbo.Product`: 1,714 rows; `Price` and `StockQuantity`.
- `dbo.ProductAttributeCombination`: 1,649 rows; `OverriddenPrice` and
  `StockQuantity`.
- `dbo.Category`: 379 rows.

The source store URL is `https://mooykamand.ir/`. Stable mapping identifiers
are the integer IDs from `Product` and `ProductAttributeCombination`; SKU is
the fallback.

Generated product-only discovery files are written under
`integrations/aspnet-product-sync/discovery/artifacts/` and are ignored by git.
No customer or order data is exported.

## Install the ASP.NET plugin

1. Confirm the live site's nopCommerce and .NET version.
2. Copy `integrations/aspnet-product-sync/Nop.Plugin.Misc.MultiStoreHub` into
   the matching nopCommerce source tree under `src/Plugins/`.
3. Adjust project references/target framework if the live site is not
   nopCommerce 4.70 / .NET 8.
4. Build and deploy the plugin through the normal nopCommerce plugin process.
5. Configure a random API key and a random secret of at least 32 bytes.
6. Restrict the endpoint to the Hub server IP when possible.

Generate credentials:

```bash
openssl rand -hex 24   # API key
openssl rand -hex 48   # signing secret
```

## Configure the Hub

In **Sites → Add site**:

- Platform: `ASP.NET / nopCommerce`
- Base URL: the HTTPS store URL
- API key: the plugin API key
- API secret: the plugin signing secret
- Network route: normally `DIRECT`

Use **Test connection**. A successful response confirms plugin version and
signature validation.

## Export and import initial mappings

Run from WSL:

```bash
bash /mnt/c/Users/User/Projects/multi-store-hub/scripts/export-aspnet-catalog.sh
```

This creates `products.tsv`. In the Hub Sync page, use **Import ASP.NET
mappings** on the ASP.NET site card and select that file. The importer uses the
first two TSV columns (`Product.Id`, `Sku`) and:

- maps unique SKUs to Hub products;
- stores `Product.Id` as `SiteProductMapping.siteProductId`;
- skips blank, missing, and duplicate SKUs.

Resolve skipped products through the existing Matching screen before syncing.
Attribute combinations commonly have blank SKUs in this backup. Their manual
mapping value is `combination:<ProductAttributeCombination.Id>` (for example,
`combination:6711`). The Hub sends this as `sourceCombinationId`, so it cannot
collide with a `Product.Id` having the same integer value.

## First synchronization

1. Click **Preview price and stock**.
2. Review matched, unresolved, and duplicate counts.
3. Test 1–5 selected products first if mappings need verification.
4. Click **Send price and stock**.
5. Review Sync history and per-product failures.
6. Enable scheduled push only after the controlled run is correct.

## API contract

Prefix: `/api/multi-store-hub/v1`

- `GET /health`
- `POST /products/lookup`
- `PATCH /products/price-stock`

The update endpoint accepts batches of at most 100. Repeating an update is
safe because price and stock are absolute values and the request includes an
idempotency key.

## Rollback

- Disable scheduled push in Hub immediately.
- Disable/uninstall the ASP.NET plugin to stop writes.
- Correct Hub values or restore affected product values from the pre-sync
  export.
- Mapping rows can be corrected without deleting Hub or remote products.
