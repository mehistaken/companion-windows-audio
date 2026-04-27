using System.Diagnostics;
using System.Security.Principal;

namespace AudioSidecar;

public static class ServiceManager
{
    public const string ServiceName = "AudioSidecar";
    private const string DisplayName = "Windows Audio Sidecar";
    private const string Description = "Controls Windows audio endpoints for Bitfocus Companion";

    public static void Install(string[] args)
    {
        RequireAdmin("install");

        var exePath = Environment.ProcessPath
            ?? throw new InvalidOperationException("Cannot determine exe path");

        int port = 37891;
        for (int i = 0; i < args.Length - 1; i++)
            if (args[i] == "--port" && int.TryParse(args[i + 1], out var p))
                port = p;

        // Uninstall first if already present so re-runs are idempotent
        Sc($"stop {ServiceName}");
        Sc($"delete {ServiceName}");

        // sc.exe requires a space after each = in binPath / start / DisplayName
        var binPath = $"{exePath} --port {port}";
        Sc($"create {ServiceName} binPath= \"{binPath}\" start= auto DisplayName= \"{DisplayName}\"");
        Sc($"description {ServiceName} \"{Description}\"");

        Console.WriteLine($"Starting {ServiceName}...");
        Sc($"start {ServiceName}");
        Console.WriteLine($"{ServiceName} installed and started. It will restart automatically on boot.");
    }

    public static void Uninstall()
    {
        RequireAdmin("uninstall");

        Console.WriteLine($"Stopping {ServiceName}...");
        Sc($"stop {ServiceName}");
        Sc($"delete {ServiceName}");
        Console.WriteLine($"{ServiceName} removed.");
    }

    private static void Sc(string arguments)
    {
        using var p = Process.Start(new ProcessStartInfo("sc.exe", arguments)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
        })!;
        p.WaitForExit();
    }

    private static void RequireAdmin(string action)
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
        {
            Console.Error.WriteLine($"Error: --{action} must be run as Administrator.");
            Console.Error.WriteLine("Right-click your terminal and choose 'Run as administrator', then try again.");
            Environment.Exit(1);
        }
    }
}
