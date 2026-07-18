# ASP.NET catalog discovery

The source backup was restored into an isolated SQL Server container. It is a
customized nopCommerce-style database:

- database compatibility level: SQL Server 2016 (`130`);
- live store URL in the backup: `https://mooykamand.ir/`;
- 1,714 products, 1,649 product attribute combinations, 379 categories;
- product price and inventory: `dbo.Product.Price` and
  `dbo.Product.StockQuantity`;
- variation price and inventory:
  `dbo.ProductAttributeCombination.OverriddenPrice` and
  `dbo.ProductAttributeCombination.StockQuantity`;
- stable identifiers: `Product.Id` / `ProductAttributeCombination.Id`;
- fallback identifiers: `Sku` on both tables;
- categories: `dbo.Category` plus `dbo.Product_Category_Mapping`.

The database contains substantial custom fields and no reliable application
version marker. The integration plugin therefore targets the modern
nopCommerce 4.70/.NET 8 service surface and must be compiled against the exact
live site's source before installation. The Hub-side API contract is versioned
and independent of those internal service APIs.

Run `scripts/inspect-aspnet-backup.sh` to repeat schema discovery. Run
`scripts/export-aspnet-catalog.sh` to create product-only TSV files under
`discovery/artifacts/`. That directory is ignored by git. Customer and order
tables are intentionally never exported.

## Initial mapping

Use `Product.Id` as `SiteProductMapping.siteProductId`. Match Hub products to
the exported catalog by unique non-empty SKU. Products with blank or duplicate
SKUs must be reviewed in the Hub matching workflow before synchronization.
Use `combination:<id>` for manually reviewed product attribute combinations;
the namespace prevents collisions between Product and combination integer IDs.
