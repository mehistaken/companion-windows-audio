using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace AudioSidecar;

public sealed class AudioWorker : BackgroundService
{
    private readonly AudioController _controller;
    private readonly SidecarOptions _options;
    private readonly ILogger<AudioWorker> _logger;

    public AudioWorker(AudioController controller, SidecarOptions options, ILogger<AudioWorker> logger)
    {
        _controller = controller;
        _options = options;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var server = new AudioServer(_options.Port, _controller);
        server.Start(ct);
        _logger.LogInformation("AudioSidecar listening on 127.0.0.1:{Port}", _options.Port);
        await Task.Delay(Timeout.Infinite, ct);
    }

    public override void Dispose()
    {
        _controller.Dispose();
        base.Dispose();
    }
}
