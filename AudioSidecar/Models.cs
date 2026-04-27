using System.Text.RegularExpressions;

namespace AudioSidecar;

public record DeviceInfo(string Id, string Name, int Volume, bool Muted, bool IsDefault);

public record SidecarOptions(int Port);

public static class Slugify
{
    private static readonly Regex NonAlphaNum = new(@"[^a-z0-9]+", RegexOptions.Compiled);

    public static string From(string name)
    {
        var lower = name.ToLowerInvariant();
        var dashed = NonAlphaNum.Replace(lower, "-");
        return dashed.Trim('-');
    }
}
