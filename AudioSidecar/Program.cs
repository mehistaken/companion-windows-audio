using AudioSidecar;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

// Handle install / uninstall before the host is built — these need admin rights
// and exit immediately after.
if (args.Contains("--install"))
{
    ServiceManager.Install(args);
    return;
}
if (args.Contains("--uninstall"))
{
    ServiceManager.Uninstall();
    return;
}

int port = ParsePort(args);

var builder = Host.CreateApplicationBuilder(args);

// Switches between WindowsServiceLifetime (when running under SCM) and
// ConsoleLifetime (when run directly in a terminal) automatically.
builder.Services.AddWindowsService(options =>
    options.ServiceName = ServiceManager.ServiceName);

builder.Services.AddSingleton(new SidecarOptions(port));
builder.Services.AddSingleton<AudioController>();
builder.Services.AddHostedService<AudioWorker>();

builder.Logging.AddConsole();

await builder.Build().RunAsync();

static int ParsePort(string[] args)
{
    for (int i = 0; i < args.Length - 1; i++)
        if (args[i] == "--port" && int.TryParse(args[i + 1], out var p))
            return p;
    return 37891;
}
