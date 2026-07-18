using System.Security.Cryptography;
using System.Text;

namespace Nop.Plugin.Misc.MultiStoreHub.Security;

public static class HubHmac
{
    public static string ComputeBodyHash(ReadOnlySpan<byte> rawBody)
    {
        return Convert.ToHexString(SHA256.HashData(rawBody)).ToLowerInvariant();
    }

    public static string ComputeSignature(
        string secret,
        string timestamp,
        string nonce,
        string method,
        string path,
        ReadOnlySpan<byte> rawBody)
    {
        var canonical = string.Join(
            '\n',
            timestamp,
            nonce,
            method.ToUpperInvariant(),
            path,
            ComputeBodyHash(rawBody));

        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(canonical)))
            .ToLowerInvariant();
    }

    public static bool FixedTimeEquals(string expectedLowerHex, string supplied)
    {
        if (supplied.Length != expectedLowerHex.Length ||
            !string.Equals(supplied, supplied.ToLowerInvariant(), StringComparison.Ordinal))
            return false;

        return CryptographicOperations.FixedTimeEquals(
            Encoding.ASCII.GetBytes(expectedLowerHex),
            Encoding.ASCII.GetBytes(supplied));
    }
}
