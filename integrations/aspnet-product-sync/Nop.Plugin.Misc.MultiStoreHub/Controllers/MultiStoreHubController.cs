using Microsoft.AspNetCore.Mvc;
using Nop.Plugin.Misc.MultiStoreHub.Models;
using Nop.Plugin.Misc.MultiStoreHub.Security;
using Nop.Plugin.Misc.MultiStoreHub.Services;
using Nop.Web.Framework.Controllers;

namespace Nop.Plugin.Misc.MultiStoreHub.Controllers;

[ApiController]
[Route("api/multi-store-hub/v1")]
[ServiceFilter(typeof(HubHmacAuthorizationFilter))]
public sealed class MultiStoreHubController : BasePluginController
{
    private const int MaximumBatchSize = 100;
    private readonly IHubProductSyncService _syncService;

    public MultiStoreHubController(IHubProductSyncService syncService)
    {
        _syncService = syncService;
    }

    [HttpGet("health")]
    public IActionResult Health()
    {
        return Ok(new
        {
            ok = true,
            platform = "nopCommerce",
            pluginVersion = "1.0.0"
        });
    }

    [HttpPost("products/lookup")]
    public async Task<IActionResult> Lookup([FromBody] ProductLookupRequest request)
    {
        if ((request.SourceProductIds?.Length ?? 0) > MaximumBatchSize ||
            (request.SourceCombinationIds?.Length ?? 0) > MaximumBatchSize ||
            (request.Skus?.Length ?? 0) > MaximumBatchSize)
            return BadRequest(new { error = $"Each lookup array is limited to {MaximumBatchSize} values." });

        return Ok(await _syncService.LookupAsync(request));
    }

    [HttpPatch("products/price-stock")]
    public async Task<IActionResult> PatchPriceStock([FromBody] PriceStockPatchRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.IdempotencyKey))
            return BadRequest(new { error = "idempotencyKey is required." });
        if (request.Items is null)
            return BadRequest(new { error = "items is required." });
        if (request.Items.Length > MaximumBatchSize)
            return BadRequest(new { error = $"items is limited to {MaximumBatchSize} values." });

        return Ok(await _syncService.PatchAsync(request));
    }
}
