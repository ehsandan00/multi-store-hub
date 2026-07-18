using System.Globalization;
using LinqToDB;
using Nop.Core.Domain.Catalog;
using Nop.Data;
using Nop.Plugin.Misc.MultiStoreHub.Models;
using Nop.Services.Catalog;
using Nop.Services.Logging;

namespace Nop.Plugin.Misc.MultiStoreHub.Services;

public sealed class HubProductSyncService : IHubProductSyncService
{
    private readonly IProductService _productService;
    private readonly IProductAttributeService _productAttributeService;
    private readonly IRepository<Product> _productRepository;
    private readonly IRepository<ProductAttributeCombination> _combinationRepository;
    private readonly ILogger _logger;

    public HubProductSyncService(
        IProductService productService,
        IProductAttributeService productAttributeService,
        IRepository<Product> productRepository,
        IRepository<ProductAttributeCombination> combinationRepository,
        ILogger logger)
    {
        _productService = productService;
        _productAttributeService = productAttributeService;
        _productRepository = productRepository;
        _combinationRepository = combinationRepository;
        _logger = logger;
    }

    public async Task<ProductLookupResponse> LookupAsync(ProductLookupRequest request)
    {
        var requestedIds = (request.SourceProductIds ?? [])
            .Where(id => id > 0)
            .Distinct()
            .ToArray();
        var requestedSkus = NormalizeSkus(request.Skus);
        var productsById = new Dictionary<int, Product>();
        var requestedCombinationIds = (request.SourceCombinationIds ?? [])
            .Where(id => id > 0)
            .Distinct()
            .ToArray();
        var combinationsById = new Dictionary<int, ProductAttributeCombination>();

        foreach (var id in requestedIds)
        {
            var product = await _productService.GetProductByIdAsync(id);
            if (product is not null)
                productsById[id] = product;
        }
        foreach (var id in requestedCombinationIds)
        {
            var combination = await _productAttributeService
                .GetProductAttributeCombinationByIdAsync(id);
            if (combination is not null)
                combinationsById[id] = combination;
        }

        var skuMatches = await FindSkuMatchesAsync(requestedSkus);
        var items = new List<RemoteProduct>();
        var added = new HashSet<string>(StringComparer.Ordinal);

        foreach (var product in productsById.Values)
            AddOnce(items, added, ToRemote(product));
        foreach (var combination in combinationsById.Values)
            AddOnce(items, added, await ToRemoteAsync(combination));

        var unresolvedSkus = new List<string>();
        var duplicateSkus = new List<string>();
        foreach (var sku in requestedSkus)
        {
            var matches = skuMatches.GetValueOrDefault(sku) ?? [];
            if (matches.Count == 0)
                unresolvedSkus.Add(sku);
            else if (matches.Count > 1)
                duplicateSkus.Add(sku);
            else
                AddOnce(items, added, matches[0]);
        }

        return new ProductLookupResponse(
            items,
            requestedIds.Where(id => !productsById.ContainsKey(id)).ToArray(),
            requestedCombinationIds.Where(id => !combinationsById.ContainsKey(id)).ToArray(),
            unresolvedSkus,
            duplicateSkus);
    }

    public async Task<PriceStockPatchResponse> PatchAsync(PriceStockPatchRequest request)
    {
        var results = new List<PriceStockPatchResult>();
        foreach (var item in request.Items ?? [])
            results.Add(await PatchItemAsync(item));

        return new PriceStockPatchResponse(results);
    }

    private async Task<PriceStockPatchResult> PatchItemAsync(PriceStockPatchItem item)
    {
        try
        {
            if (!decimal.TryParse(
                    item.Price,
                    NumberStyles.Number,
                    CultureInfo.InvariantCulture,
                    out var price) ||
                price < 0)
            {
                return Result(item, "error", message: "price must be a non-negative invariant decimal string.");
            }

            if (item.SourceProductId is > 0)
            {
                var product = await _productService.GetProductByIdAsync(item.SourceProductId.Value);
                if (product is not null)
                {
                    product.Price = price;
                    product.StockQuantity = item.StockQuantity;
                    await _productService.UpdateProductAsync(product);
                    return Result(item, "updated", ToRemote(product));
                }
            }
            if (item.SourceCombinationId is > 0)
            {
                var combination = await _productAttributeService
                    .GetProductAttributeCombinationByIdAsync(item.SourceCombinationId.Value);
                if (combination is not null)
                {
                    combination.OverriddenPrice = price;
                    combination.StockQuantity = item.StockQuantity;
                    await _productAttributeService
                        .UpdateProductAttributeCombinationAsync(combination);
                    return Result(item, "updated", await ToRemoteAsync(combination));
                }
            }

            var normalizedSku = NormalizeSku(item.Sku);
            if (normalizedSku is null)
                return Result(
                    item,
                    "not_found",
                    message: "No product or combination matched its source ID and no SKU was supplied.");

            var matches = await FindSkuMatchesAsync([normalizedSku]);
            var skuMatches = matches.GetValueOrDefault(normalizedSku) ?? [];
            if (skuMatches.Count == 0)
                return Result(item, "not_found");
            if (skuMatches.Count > 1)
                return Result(item, "ambiguous", message: "SKU is not unique across products and attribute combinations.");

            var match = skuMatches[0];
            if (match.Kind == "PRODUCT")
            {
                var product = await _productService.GetProductByIdAsync(match.Id);
                if (product is null)
                    return Result(item, "not_found");

                product.Price = price;
                product.StockQuantity = item.StockQuantity;
                await _productService.UpdateProductAsync(product);
                return Result(item, "updated", ToRemote(product));
            }

            var combination = await _productAttributeService
                .GetProductAttributeCombinationByIdAsync(match.Id);
            if (combination is null)
                return Result(item, "not_found");

            combination.OverriddenPrice = price;
            combination.StockQuantity = item.StockQuantity;
            await _productAttributeService.UpdateProductAttributeCombinationAsync(combination);
            return Result(item, "updated", await ToRemoteAsync(combination));
        }
        catch (Exception exception)
        {
            await _logger.ErrorAsync("Multi-Store Hub failed to update a price/stock item.", exception);
            return Result(item, "error", message: "The item could not be updated.");
        }
    }

    private async Task<Dictionary<string, List<RemoteProduct>>> FindSkuMatchesAsync(
        IReadOnlyCollection<string> normalizedSkus)
    {
        var result = new Dictionary<string, List<RemoteProduct>>(StringComparer.OrdinalIgnoreCase);
        if (normalizedSkus.Count == 0)
            return result;

        var keys = normalizedSkus.Select(sku => sku.ToUpperInvariant()).Distinct().ToArray();
        var products = await _productRepository.Table
            .Where(product => product.Sku != null && keys.Contains(product.Sku.ToUpper()))
            .ToListAsync();
        var combinations = await _combinationRepository.Table
            .Where(combination => combination.Sku != null && keys.Contains(combination.Sku.ToUpper()))
            .ToListAsync();

        foreach (var product in products)
            AddMatch(result, product.Sku, ToRemote(product));
        foreach (var combination in combinations)
            AddMatch(result, combination.Sku, await ToRemoteAsync(combination));

        return result;
    }

    private async Task<RemoteProduct> ToRemoteAsync(ProductAttributeCombination combination)
    {
        var parent = await _productService.GetProductByIdAsync(combination.ProductId);
        return new RemoteProduct(
            combination.Id,
            combination.Sku,
            parent?.Name,
            (combination.OverriddenPrice ?? parent?.Price ?? 0m).ToString(CultureInfo.InvariantCulture),
            combination.StockQuantity,
            "COMBINATION",
            combination.ProductId);
    }

    private static RemoteProduct ToRemote(Product product)
    {
        return new RemoteProduct(
            product.Id,
            product.Sku,
            product.Name,
            product.Price.ToString(CultureInfo.InvariantCulture),
            product.StockQuantity,
            "PRODUCT",
            null);
    }

    private static void AddMatch(
        IDictionary<string, List<RemoteProduct>> matches,
        string? sku,
        RemoteProduct remote)
    {
        var normalized = NormalizeSku(sku);
        if (normalized is null)
            return;

        if (!matches.TryGetValue(normalized, out var values))
        {
            values = [];
            matches[normalized] = values;
        }

        values.Add(remote);
    }

    private static void AddOnce(
        ICollection<RemoteProduct> items,
        ISet<string> added,
        RemoteProduct remote)
    {
        if (added.Add($"{remote.Kind}:{remote.Id}"))
            items.Add(remote);
    }

    private static string[] NormalizeSkus(IEnumerable<string>? skus)
    {
        return (skus ?? [])
            .Select(NormalizeSku)
            .Where(sku => sku is not null)
            .Select(sku => sku!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string? NormalizeSku(string? sku)
    {
        return string.IsNullOrWhiteSpace(sku) ? null : sku.Trim();
    }

    private static PriceStockPatchResult Result(
        PriceStockPatchItem item,
        string status,
        RemoteProduct? remote = null,
        string? message = null)
    {
        return new PriceStockPatchResult(
            item.SourceProductId,
            item.SourceCombinationId,
            item.Sku,
            status,
            remote,
            message);
    }
}
