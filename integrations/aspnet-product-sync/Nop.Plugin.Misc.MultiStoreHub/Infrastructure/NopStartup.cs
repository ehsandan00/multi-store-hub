using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Nop.Core.Infrastructure;
using Nop.Plugin.Misc.MultiStoreHub.Security;
using Nop.Plugin.Misc.MultiStoreHub.Services;

namespace Nop.Plugin.Misc.MultiStoreHub.Infrastructure;

public sealed class NopStartup : INopStartup
{
    public void ConfigureServices(IServiceCollection services, IConfiguration configuration)
    {
        services.AddMemoryCache();
        services.AddScoped<HubHmacAuthorizationFilter>();
        services.AddScoped<IHubProductSyncService, HubProductSyncService>();
    }

    public void Configure(IApplicationBuilder application)
    {
    }

    public int Order => 3000;
}
