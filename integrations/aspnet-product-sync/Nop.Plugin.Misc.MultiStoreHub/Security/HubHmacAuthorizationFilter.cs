using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.Caching.Memory;
using Nop.Services.Configuration;

namespace Nop.Plugin.Misc.MultiStoreHub.Security;

public sealed class HubHmacAuthorizationFilter : IAsyncResourceFilter
{
    private static readonly object NonceLock = new();
    private static readonly TimeSpan AllowedClockSkew = TimeSpan.FromMinutes(5);
    private const int MaximumBodyBytes = 1024 * 1024;

    private readonly ISettingService _settingService;
    private readonly IMemoryCache _cache;

    public HubHmacAuthorizationFilter(ISettingService settingService, IMemoryCache cache)
    {
        _settingService = settingService;
        _cache = cache;
    }

    public async Task OnResourceExecutionAsync(
        ResourceExecutingContext context,
        ResourceExecutionDelegate next)
    {
        var request = context.HttpContext.Request;
        var settings = await _settingService.LoadSettingAsync<MultiStoreHubSettings>();
        if (string.IsNullOrWhiteSpace(settings.ApiKey) ||
            string.IsNullOrWhiteSpace(settings.ApiSecret))
        {
            Reject(context, 503, "Multi-Store Hub credentials are not configured.");
            return;
        }

        var key = request.Headers["x-hub-key"].ToString();
        var timestamp = request.Headers["x-hub-timestamp"].ToString();
        var nonce = request.Headers["x-hub-nonce"].ToString();
        var signature = request.Headers["x-hub-signature"].ToString();

        if (string.IsNullOrWhiteSpace(key) ||
            string.IsNullOrWhiteSpace(timestamp) ||
            string.IsNullOrWhiteSpace(nonce) ||
            string.IsNullOrWhiteSpace(signature))
        {
            Reject(context, 401, "Missing HMAC authentication headers.");
            return;
        }

        if (!long.TryParse(timestamp, NumberStyles.None, CultureInfo.InvariantCulture, out var unixSeconds))
        {
            Reject(context, 401, "Invalid HMAC timestamp.");
            return;
        }

        DateTimeOffset requestTime;
        try
        {
            requestTime = DateTimeOffset.FromUnixTimeSeconds(unixSeconds);
        }
        catch (ArgumentOutOfRangeException)
        {
            Reject(context, 401, "Invalid HMAC timestamp.");
            return;
        }

        if ((DateTimeOffset.UtcNow - requestTime).Duration() > AllowedClockSkew)
        {
            Reject(context, 401, "HMAC timestamp is outside the allowed five-minute window.");
            return;
        }

        if (!FixedTimeTextEquals(settings.ApiKey, key))
        {
            Reject(context, 401, "Invalid HMAC credentials.");
            return;
        }

        request.EnableBuffering();
        byte[] rawBody;
        try
        {
            using var stream = new MemoryStream();
            await request.Body.CopyToAsync(stream, context.HttpContext.RequestAborted);
            if (stream.Length > MaximumBodyBytes)
            {
                Reject(context, 413, "Request body is too large.");
                return;
            }

            rawBody = stream.ToArray();
            request.Body.Position = 0;
        }
        catch
        {
            request.Body.Position = 0;
            throw;
        }

        var expected = HubHmac.ComputeSignature(
            settings.ApiSecret,
            timestamp,
            nonce,
            request.Method,
            request.Path.Value ?? string.Empty,
            rawBody);

        if (!HubHmac.FixedTimeEquals(expected, signature))
        {
            Reject(context, 401, "Invalid HMAC signature.");
            return;
        }

        var nonceCacheKey = $"multi-store-hub:hmac:{key}:{nonce}";
        lock (NonceLock)
        {
            if (_cache.TryGetValue(nonceCacheKey, out _))
            {
                Reject(context, 401, "HMAC nonce has already been used.");
                return;
            }

            _cache.Set(nonceCacheKey, true, requestTime.Add(AllowedClockSkew));
        }

        await next();
    }

    private static bool FixedTimeTextEquals(string expected, string supplied)
    {
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
        return expectedBytes.Length == suppliedBytes.Length &&
               System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
                   expectedBytes,
                   suppliedBytes);
    }

    private static void Reject(ResourceExecutingContext context, int statusCode, string message)
    {
        context.Result = new JsonResult(new { error = message }) { StatusCode = statusCode };
    }
}
