using Nop.Core.Configuration;

namespace Nop.Plugin.Misc.MultiStoreHub;

public sealed class MultiStoreHubSettings : ISettings
{
    public string ApiKey { get; set; } = string.Empty;

    public string ApiSecret { get; set; } = string.Empty;
}
