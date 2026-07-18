# Multi-Store Hub nopCommerce product-sync plugin

Source package for a nopCommerce 4.70-style plugin targeting .NET 8. It adds an
HMAC-authenticated API that looks up existing products and updates price/stock.
It never creates products and does not use direct SQL.

## Build and install

1. Install the .NET 8 SDK.
2. Build against the exact nopCommerce source tree used by the store:

   ```powershell
   dotnet build .\Nop.Plugin.Misc.MultiStoreHub\Nop.Plugin.Misc.MultiStoreHub.csproj `
     -p:NopCommerceRoot=C:\source\nopCommerce
   ```

   Build output is written to
   `src\Presentation\Nop.Web\Plugins\Misc.MultiStoreHub` in that nopCommerce
   tree.
3. Restart the nopCommerce application.
4. In Administration, open **Configuration > Local plugins**, reload the
   plugin list, and install **Multi-Store Hub Product Sync**.
5. In **Configuration > Settings > All settings**, set these nopCommerce
   settings:
   - `multistorehubsettings.apikey`
   - `multistorehubsettings.apisecret`
6. Restart the application after changing credentials, then configure the Hub
   site with the same key and secret.

Use high-entropy, independently generated values. Do not put credentials in
source control, logs, URLs, request bodies, screenshots, or this README.

## API contract

All routes have the prefix `/api/multi-store-hub/v1`:

- `GET /health`
- `POST /products/lookup`
  - body:
    `{"sourceProductIds":[1],"sourceCombinationIds":[2],"skus":["SKU-1"]}`
- `PATCH /products/price-stock`
  - body:
    `{"idempotencyKey":"unique-retry-key","items":[{"sourceProductId":1,"sourceCombinationId":null,"sku":"SKU-1","price":"12.50","stockQuantity":4}]}`

The patch response contains one result per input item with status `updated`,
`not_found`, `ambiguous`, or `error`. A positive `sourceProductId` is matched
against `Product.Id` first. If it is absent or not found, the plugin requires
`sourceCombinationId` is matched against `ProductAttributeCombination.Id`.
If neither source ID resolves, the plugin requires the supplied SKU to have
exactly one case-insensitive match across `Product`
and `ProductAttributeCombination`. Attribute combinations update
`OverriddenPrice` and `StockQuantity`; products update `Price` and
`StockQuantity`.

Each request must have:

- `x-hub-key`
- `x-hub-timestamp` (Unix seconds)
- `x-hub-nonce`
- `x-hub-signature`

The signature is lowercase hexadecimal:

```text
HMAC-SHA256(
  secret,
  timestamp + "\n" + nonce + "\n" + METHOD + "\n" + PATH + "\n" +
  sha256Hex(rawBody)
)
```

`METHOD` is uppercase, `PATH` includes the API prefix but no query string, and
an absent GET body hashes as zero bytes. The raw bytes sent on the wire must be
hashed; reformatting JSON changes the signature. Requests outside a five-minute
clock window and replayed nonces are rejected. Keep server clocks synchronized.

Nonce replay state is process-local. A multi-node deployment should use session
affinity or replace the memory cache with a shared atomic nonce store.

## Compatibility caveats

This project is written for the nopCommerce 4.70 service and plugin APIs on
.NET 8, and for the customized schema described by the Hub integration:
`Product(Id, Sku, Price, StockQuantity)` and
`ProductAttributeCombination(Id, ProductId, Sku, OverriddenPrice,
StockQuantity)`.

nopCommerce plugin APIs and domain models can differ between patch releases or
custom forks. Build against the deployed source tree and review any compiler
errors around `IProductService`, `IProductAttributeService`, `INopStartup`, and
the domain entities before installation. Do not install this binary on a
different nopCommerce version without rebuilding and testing it.

The SKU candidate search uses nopCommerce repositories (LINQ-to-DB), while all
mutations use nopCommerce catalog services so normal cache/event behavior is
preserved. The restored database should have indexes on SKU columns for
production lookup performance.

## Tests

The HMAC helper tests are independent of nopCommerce:

```powershell
dotnet test .\Nop.Plugin.Misc.MultiStoreHub.Tests\Nop.Plugin.Misc.MultiStoreHub.Tests.csproj
```

They include a fixed canonical-signature vector, raw-body sensitivity, and the
lowercase signature requirement.
