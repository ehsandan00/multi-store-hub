using Nop.Plugin.Misc.MultiStoreHub.Models;

namespace Nop.Plugin.Misc.MultiStoreHub.Services;

public interface IHubProductSyncService
{
    Task<ProductLookupResponse> LookupAsync(ProductLookupRequest request);

    Task<PriceStockPatchResponse> PatchAsync(PriceStockPatchRequest request);
}
