using Nop.Services.Configuration;
using Nop.Services.Plugins;

namespace Nop.Plugin.Misc.MultiStoreHub;

public sealed class MultiStoreHubPlugin : BasePlugin
{
    private readonly ISettingService _settingService;

    public MultiStoreHubPlugin(ISettingService settingService)
    {
        _settingService = settingService;
    }

    public override async Task InstallAsync()
    {
        await _settingService.SaveSettingAsync(new MultiStoreHubSettings());
        await base.InstallAsync();
    }

    public override async Task UninstallAsync()
    {
        await _settingService.DeleteSettingAsync<MultiStoreHubSettings>();
        await base.UninstallAsync();
    }
}
