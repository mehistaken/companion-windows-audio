using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace AudioSidecar;

/// <summary>
/// TCP server that accepts multiple simultaneous clients on 127.0.0.1:<port>.
/// Sends newline-delimited JSON to clients and receives command JSON from them.
/// </summary>
public sealed class AudioServer : IDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    private readonly int _port;
    private readonly AudioController _controller;
    private readonly TcpListener _listener;
    private readonly ConcurrentDictionary<int, TcpClient> _clients = new();
    // client id → requested meter interval (ms). Metering only runs while this is non-empty.
    private readonly ConcurrentDictionary<int, int> _meterSubs = new();
    private readonly object _broadcastLock = new();
    private int _nextClientId;
    private bool _disposed;

    public AudioServer(int port, AudioController controller)
    {
        _port = port;
        _controller = controller;
        _listener = new TcpListener(IPAddress.Loopback, port);

        _controller.DeviceListChanged += OnDeviceListChanged;
        _controller.VolumeChanged += OnVolumeChanged;
    }

    public void Start(CancellationToken ct)
    {
        _listener.Start();
        Console.WriteLine($"[server] Listening on 127.0.0.1:{_port}");

        Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var client = await _listener.AcceptTcpClientAsync(ct);
                    var id = Interlocked.Increment(ref _nextClientId);
                    _clients[id] = client;
                    Console.WriteLine($"[server] Client {id} connected");
                    _ = HandleClientAsync(id, client, ct);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[server] Accept error: {ex.Message}");
                }
            }
        }, ct);

        Task.Run(() => MeterLoopAsync(ct), ct);
    }

    // ─── Metering ─────────────────────────────────────────────────────────────

    private async Task MeterLoopAsync(CancellationToken ct)
    {
        var sw = new System.Diagnostics.Stopwatch();
        while (!ct.IsCancellationRequested)
        {
            int wait;
            if (_meterSubs.IsEmpty)
            {
                wait = 200; // idle: just check for subscribers occasionally
            }
            else
            {
                var interval = _meterSubs.Values.Min();
                sw.Restart();
                try
                {
                    var levels = _controller.GetPeaks().ToDictionary(
                        kv => kv.Key,
                        kv => new[] { MathF.Round(kv.Value[0], 3), MathF.Round(kv.Value[1], 3) });
                    var json = JsonSerializer.Serialize(new { type = "levels", levels }, JsonOpts);
                    BroadcastLine(json, _meterSubs.Keys.ToHashSet());
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[server] Meter error: {ex.Message}");
                }
                wait = Math.Max(1, interval - (int)sw.ElapsedMilliseconds);
            }

            try { await Task.Delay(wait, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private async Task HandleClientAsync(int id, TcpClient client, CancellationToken ct)
    {
        await using var stream = client.GetStream();

        // Send snapshot immediately on connect
        await SendSnapshotAsync(stream, ct);

        var buffer = new byte[4096];
        var lineBuffer = new StringBuilder();

        try
        {
            while (!ct.IsCancellationRequested && client.Connected)
            {
                int bytesRead;
                try
                {
                    bytesRead = await stream.ReadAsync(buffer, ct);
                }
                catch { break; }

                if (bytesRead == 0) break;

                lineBuffer.Append(Encoding.UTF8.GetString(buffer, 0, bytesRead));
                var accumulated = lineBuffer.ToString();

                int newlinePos;
                while ((newlinePos = accumulated.IndexOf('\n')) >= 0)
                {
                    var line = accumulated[..newlinePos].Trim();
                    accumulated = accumulated[(newlinePos + 1)..];
                    if (line.Length > 0)
                        await ProcessCommandAsync(id, stream, line, ct);
                }

                lineBuffer.Clear();
                lineBuffer.Append(accumulated);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[server] Client {id} error: {ex.Message}");
        }
        finally
        {
            _clients.TryRemove(id, out _);
            _meterSubs.TryRemove(id, out _);
            client.Dispose();
            Console.WriteLine($"[server] Client {id} disconnected");
        }
    }

    private async Task ProcessCommandAsync(int clientId, NetworkStream stream, string line, CancellationToken ct)
    {
        JsonDocument doc;
        try { doc = JsonDocument.Parse(line); }
        catch
        {
            await SendErrorAsync(stream, "Invalid JSON", ct);
            return;
        }

        using (doc)
        {
            if (!doc.RootElement.TryGetProperty("cmd", out var cmdProp))
            {
                await SendErrorAsync(stream, "Missing 'cmd' field", ct);
                return;
            }

            var cmd = cmdProp.GetString() ?? "";
            switch (cmd)
            {
                case "list_devices":
                    await SendSnapshotAsync(stream, ct);
                    break;

                case "set_volume":
                    if (TryGetId(doc, out var id) && doc.RootElement.TryGetProperty("volume", out var volProp))
                        _controller.SetVolume(id, volProp.GetInt32());
                    else
                        await SendErrorAsync(stream, "set_volume requires 'id' and 'volume'", ct);
                    break;

                case "set_mute":
                    if (TryGetId(doc, out id) && doc.RootElement.TryGetProperty("muted", out var mutedProp))
                        _controller.SetMute(id, mutedProp.GetBoolean());
                    else
                        await SendErrorAsync(stream, "set_mute requires 'id' and 'muted'", ct);
                    break;

                case "toggle_mute":
                    if (TryGetId(doc, out id))
                        _controller.ToggleMute(id);
                    else
                        await SendErrorAsync(stream, "toggle_mute requires 'id'", ct);
                    break;

                case "set_default":
                    if (TryGetId(doc, out id))
                        _controller.SetDefault(id);
                    else
                        await SendErrorAsync(stream, "set_default requires 'id'", ct);
                    break;

                case "meter":
                {
                    var enabled = doc.RootElement.TryGetProperty("enabled", out var enProp) && enProp.GetBoolean();
                    if (enabled)
                    {
                        var interval = doc.RootElement.TryGetProperty("interval", out var intProp)
                            ? intProp.GetInt32() : 66;
                        _meterSubs[clientId] = Math.Clamp(interval, 30, 1000);
                    }
                    else
                    {
                        _meterSubs.TryRemove(clientId, out _);
                    }
                    break;
                }

                default:
                    await SendErrorAsync(stream, $"Unknown command: {cmd}", ct);
                    break;
            }
        }
    }

    private static bool TryGetId(JsonDocument doc, out string id)
    {
        if (doc.RootElement.TryGetProperty("id", out var idProp))
        {
            id = idProp.GetString() ?? "";
            return id.Length > 0;
        }
        id = "";
        return false;
    }

    // ─── Snapshot ─────────────────────────────────────────────────────────────

    private async Task SendSnapshotAsync(NetworkStream stream, CancellationToken ct)
    {
        var devices = _controller.GetDevices().Select(ToJson).ToArray();
        var msg = new { type = "snapshot", devices };
        await WriteLineAsync(stream, JsonSerializer.Serialize(msg, JsonOpts), ct);
    }

    // ─── Event → broadcast ────────────────────────────────────────────────────

    private void OnDeviceListChanged(IEnumerable<DeviceInfo> devices)
    {
        var arr = devices.Select(ToJson).ToArray();
        var json = JsonSerializer.Serialize(new { type = "snapshot", devices = arr }, JsonOpts);
        BroadcastLine(json);
    }

    private void OnVolumeChanged(string id, int volume, bool muted)
    {
        var json = JsonSerializer.Serialize(
            new { type = "volume_changed", id, volume, muted },
            JsonOpts);
        BroadcastLine(json);
    }

    private void BroadcastLine(string json, ISet<int>? onlyClients = null)
    {
        var data = Encoding.UTF8.GetBytes(json + "\n");
        List<int> toRemove = [];

        lock (_broadcastLock)
        {
            foreach (var (id, client) in _clients)
            {
                if (onlyClients != null && !onlyClients.Contains(id)) continue;
                try
                {
                    if (!client.Connected) { toRemove.Add(id); continue; }
                    client.GetStream().Write(data, 0, data.Length);
                }
                catch
                {
                    toRemove.Add(id);
                }
            }
        }

        foreach (var id in toRemove)
        {
            if (_clients.TryRemove(id, out var c)) c.Dispose();
        }
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    private static async Task WriteLineAsync(NetworkStream stream, string json, CancellationToken ct)
    {
        var data = Encoding.UTF8.GetBytes(json + "\n");
        await stream.WriteAsync(data, ct);
    }

    private static async Task SendErrorAsync(NetworkStream stream, string message, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(new { type = "error", message }, JsonOpts);
        await WriteLineAsync(stream, json, ct);
    }

    private static object ToJson(DeviceInfo d) =>
        new { id = d.Id, name = d.Name, volume = d.Volume, muted = d.Muted, isDefault = d.IsDefault };

    // ─── IDisposable ──────────────────────────────────────────────────────────

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _listener.Stop();
        foreach (var c in _clients.Values) c.Dispose();
    }
}
