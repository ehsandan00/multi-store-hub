using System.Text;
using Nop.Plugin.Misc.MultiStoreHub.Security;
using Xunit;

namespace Nop.Plugin.Misc.MultiStoreHub.Tests;

public sealed class HubHmacTests
{
    [Fact]
    public void ComputeSignature_MatchesCanonicalContractVector()
    {
        var signature = HubHmac.ComputeSignature(
            "test-secret",
            "1700000000",
            "nonce-123",
            "GET",
            "/api/multi-store-hub/v1/health",
            ReadOnlySpan<byte>.Empty);

        Assert.Equal(
            "84ecaa59fa2338fd284f97514a228879aa3501ee744bb7a496d9d1d57349d546",
            signature);
    }

    [Fact]
    public void ComputeSignature_UsesRawBodyBytes()
    {
        var compact = HubHmac.ComputeSignature(
            "secret", "1700000000", "nonce", "POST", "/path",
            Encoding.UTF8.GetBytes("{\"a\":1}"));
        var spaced = HubHmac.ComputeSignature(
            "secret", "1700000000", "nonce", "POST", "/path",
            Encoding.UTF8.GetBytes("{ \"a\": 1 }"));

        Assert.NotEqual(compact, spaced);
    }

    [Fact]
    public void FixedTimeEquals_RejectsUppercaseHex()
    {
        const string expected = "abcdef";

        Assert.True(HubHmac.FixedTimeEquals(expected, expected));
        Assert.False(HubHmac.FixedTimeEquals(expected, "ABCDEF"));
        Assert.False(HubHmac.FixedTimeEquals(expected, "abcdee"));
    }
}
