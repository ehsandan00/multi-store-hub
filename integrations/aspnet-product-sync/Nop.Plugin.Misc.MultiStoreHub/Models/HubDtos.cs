using Newtonsoft.Json;

namespace Nop.Plugin.Misc.MultiStoreHub.Models;

public sealed record ProductLookupRequest(
    [property: JsonProperty("sourceProductIds")] int[]? SourceProductIds,
    [property: JsonProperty("sourceCombinationIds")] int[]? SourceCombinationIds,
    [property: JsonProperty("skus")] string[]? Skus);

public sealed record PriceStockPatchRequest(
    [property: JsonProperty("idempotencyKey")] string? IdempotencyKey,
    [property: JsonProperty("items")] PriceStockPatchItem[]? Items);

public sealed record PriceStockPatchItem(
    [property: JsonProperty("sourceProductId")] int? SourceProductId,
    [property: JsonProperty("sourceCombinationId")] int? SourceCombinationId,
    [property: JsonProperty("sku")] string? Sku,
    [property: JsonProperty("price")] string? Price,
    [property: JsonProperty("stockQuantity")] int StockQuantity);

public sealed record RemoteProduct(
    [property: JsonProperty("id")] int Id,
    [property: JsonProperty("sku")] string? Sku,
    [property: JsonProperty("name")] string? Name,
    [property: JsonProperty("price")] string Price,
    [property: JsonProperty("stockQuantity")] int StockQuantity,
    [property: JsonProperty("kind")] string Kind,
    [property: JsonProperty("parentProductId")] int? ParentProductId);

public sealed record ProductLookupResponse(
    [property: JsonProperty("items")] IReadOnlyList<RemoteProduct> Items,
    [property: JsonProperty("unresolvedSourceProductIds")] IReadOnlyList<int> UnresolvedSourceProductIds,
    [property: JsonProperty("unresolvedSourceCombinationIds")] IReadOnlyList<int> UnresolvedSourceCombinationIds,
    [property: JsonProperty("unresolvedSkus")] IReadOnlyList<string> UnresolvedSkus,
    [property: JsonProperty("duplicateSkus")] IReadOnlyList<string> DuplicateSkus);

public sealed record PriceStockPatchResult(
    [property: JsonProperty("sourceProductId")] int? SourceProductId,
    [property: JsonProperty("sourceCombinationId")] int? SourceCombinationId,
    [property: JsonProperty("sku")] string? Sku,
    [property: JsonProperty("status")] string Status,
    [property: JsonProperty("remote")] RemoteProduct? Remote = null,
    [property: JsonProperty("message")] string? Message = null);

public sealed record PriceStockPatchResponse(
    [property: JsonProperty("results")] IReadOnlyList<PriceStockPatchResult> Results);
