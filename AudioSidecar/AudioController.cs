using System.Collections.Concurrent;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace AudioSidecar;

/// <summary>
/// Enumerates and controls Windows WASAPI render endpoints.
/// Must be created on a COM-initialized thread (STA recommended).
/// </summary>
public sealed class AudioController : IMMNotificationClient, IDisposable
{
    // device id → current state
    private readonly ConcurrentDictionary<string, DeviceInfo> _devices = new();

    // device id → NAudio MMDevice (kept alive so we can control volume)
    private readonly ConcurrentDictionary<string, MMDevice> _mmDevices = new();

    // per-device debounce timers for volume notifications (30 ms)
    private readonly ConcurrentDictionary<string, Timer> _debounceTimers = new();

    private readonly MMDeviceEnumerator _enumerator;
    private bool _disposed;

    public event Action<IEnumerable<DeviceInfo>>? DeviceListChanged;
    public event Action<string, int, bool>? VolumeChanged; // id, volume, muted

    public AudioController()
    {
        _enumerator = new MMDeviceEnumerator();
        _enumerator.RegisterEndpointNotificationCallback(this);
        Enumerate();
    }

    public IReadOnlyCollection<DeviceInfo> GetDevices() =>
        _devices.Values.ToArray();

    // ─── Commands ────────────────────────────────────────────────────────────

    public void SetVolume(string id, int volume)
    {
        if (!_mmDevices.TryGetValue(id, out var device))
        {
            Console.Error.WriteLine($"[ctrl] Device not found: {id}");
            return;
        }
        try
        {
            float scalar = Math.Clamp(volume, 0, 100) / 100f;
            device.AudioEndpointVolume.MasterVolumeLevelScalar = scalar;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ctrl] SetVolume error for {id}: {ex.Message}");
        }
    }

    public void SetMute(string id, bool muted)
    {
        if (!_mmDevices.TryGetValue(id, out var device))
        {
            Console.Error.WriteLine($"[ctrl] Device not found: {id}");
            return;
        }
        try
        {
            device.AudioEndpointVolume.Mute = muted;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ctrl] SetMute error for {id}: {ex.Message}");
        }
    }

    public void ToggleMute(string id)
    {
        if (!_mmDevices.TryGetValue(id, out var device))
        {
            Console.Error.WriteLine($"[ctrl] Device not found: {id}");
            return;
        }
        try
        {
            device.AudioEndpointVolume.Mute = !device.AudioEndpointVolume.Mute;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ctrl] ToggleMute error for {id}: {ex.Message}");
        }
    }

    public void SetDefault(string id)
    {
        if (!_mmDevices.TryGetValue(id, out var device))
        {
            Console.Error.WriteLine($"[ctrl] Device not found: {id}");
            return;
        }
        try
        {
            PolicyConfig.SetDefaultEndpoint(device.ID, Role.Multimedia);
            PolicyConfig.SetDefaultEndpoint(device.ID, Role.Communications);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[ctrl] SetDefault error for {id}: {ex.Message}");
        }
    }

    // ─── Enumeration ─────────────────────────────────────────────────────────

    private void Enumerate()
    {
        // Tear down existing subscriptions
        foreach (var (id, dev) in _mmDevices)
        {
            try { dev.AudioEndpointVolume.OnVolumeNotification -= OnVolumeNotification; }
            catch { /* ignore */ }
        }

        // Clear debounce timers
        foreach (var timer in _debounceTimers.Values)
            timer.Dispose();
        _debounceTimers.Clear();
        _mmDevices.Clear();
        _devices.Clear();

        MMDevice? defaultDevice = null;
        try { defaultDevice = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia); }
        catch { /* no default */ }

        var collection = _enumerator.EnumerateAudioEndPoints(DataFlow.Render, DeviceState.Active);
        foreach (var dev in collection)
        {
            try
            {
                var id = Slugify.From(dev.FriendlyName);
                var vol = (int)Math.Round(dev.AudioEndpointVolume.MasterVolumeLevelScalar * 100);
                var muted = dev.AudioEndpointVolume.Mute;
                var isDefault = defaultDevice != null && dev.ID == defaultDevice.ID;

                var info = new DeviceInfo(id, dev.FriendlyName, vol, muted, isDefault);
                _devices[id] = info;
                _mmDevices[id] = dev;

                dev.AudioEndpointVolume.OnVolumeNotification += OnVolumeNotification;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[ctrl] Error enumerating device: {ex.Message}");
            }
        }

        DeviceListChanged?.Invoke(_devices.Values);
    }

    // ─── Volume notification (fires on WASAPI thread) ─────────────────────────

    private void OnVolumeNotification(AudioVolumeNotificationData data)
    {
        // Find which device this notification belongs to by matching NAudio's volume object
        foreach (var (id, dev) in _mmDevices)
        {
            try
            {
                // Update state immediately in the dictionary
                var vol = (int)Math.Round(data.MasterVolume * 100);
                var muted = data.Muted;

                if (!_devices.TryGetValue(id, out var current)) continue;

                // Quick check: does this match the device's current WASAPI volume?
                var devVol = (int)Math.Round(dev.AudioEndpointVolume.MasterVolumeLevelScalar * 100);
                var devMuted = dev.AudioEndpointVolume.Mute;

                if (devVol == current.Volume && devMuted == current.Muted) continue;

                _devices[id] = current with { Volume = devVol, Muted = devMuted };

                // Debounce: cancel existing timer and restart
                if (_debounceTimers.TryGetValue(id, out var existing))
                    existing.Dispose();

                var capturedId = id;
                var capturedVol = devVol;
                var capturedMuted = devMuted;

                _debounceTimers[capturedId] = new Timer(state =>
                {
                    if (_debounceTimers.TryRemove(capturedId, out var t)) t.Dispose();
                    VolumeChanged?.Invoke(capturedId, capturedVol, capturedMuted);
                }, null, 30, Timeout.Infinite);
            }
            catch { /* ignore per-device errors */ }
        }
    }

    // ─── IMMNotificationClient ────────────────────────────────────────────────

    void IMMNotificationClient.OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
    {
        if (flow != DataFlow.Render || role != Role.Multimedia) return;
        // Re-enumerate so isDefault flags are updated
        Task.Run(Enumerate);
    }

    void IMMNotificationClient.OnDeviceAdded(string pwstrDeviceId)
    {
        Task.Run(Enumerate);
    }

    void IMMNotificationClient.OnDeviceRemoved(string pwstrDeviceId)
    {
        Task.Run(Enumerate);
    }

    void IMMNotificationClient.OnDeviceStateChanged(string deviceId, DeviceState newState)
    {
        Task.Run(Enumerate);
    }

    void IMMNotificationClient.OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key) { }

    // ─── IDisposable ──────────────────────────────────────────────────────────

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        foreach (var timer in _debounceTimers.Values)
            timer.Dispose();

        try { _enumerator.UnregisterEndpointNotificationCallback(this); }
        catch { /* ignore */ }

        _enumerator.Dispose();
    }
}
