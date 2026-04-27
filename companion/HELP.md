# Windows Audio Control

Control Windows audio device volumes and mute states from Companion — including virtual devices like **SteelSeries Sonar**, **Voicemeeter**, and **NVIDIA RTX Voice**.

---

## How it works

The module communicates with a small background process called **AudioSidecar** (`AudioSidecar.exe`) that runs on the same Windows machine as Companion. The sidecar uses the Windows WASAPI audio API to read and control audio endpoints, then exposes them to the module over a local TCP connection on `127.0.0.1`.

Because Companion's module sandbox does not allow spawning child processes, the sidecar must be installed separately as a **Windows Service** that starts automatically at boot.

---

## First-time setup

### 1. Install the AudioSidecar service

Open **PowerShell as Administrator** and run:

```powershell
.\install-service.ps1
```

This registers `AudioSidecar` as a Windows Service set to start automatically, then starts it immediately. You only need to do this once. The service will restart on its own after every reboot.

To verify the service is running:

```powershell
sc query AudioSidecar
```

To uninstall:

```powershell
.\uninstall-service.ps1
```

### 2. Add the connection in Companion

- Open the Companion web interface
- Go to **Connections** → **Add connection**
- Search for **Windows Audio Control**
- Click **Add**

The module will connect to the sidecar automatically. Once connected the status indicator turns green and device variables become available.

---

## Connection settings

| Setting | Default | Description |
|---|---|---|
| **Sidecar Port** | `37891` | Local TCP port the sidecar listens on. Only change this if something else is using port 37891, and re-run `install-service.ps1 -Port <new>` to match. |
| **Reconnect retry ms** | `2000` | How often the module retries if the connection drops. |

---

## Actions

### Set Volume
Sets a device's volume to an exact level.

| Option | Description |
|---|---|
| Device | The playback device to control |
| Volume (0–100) | Target volume level |

### Adjust Volume
Increments or decrements volume by a delta. Designed for use with rotary encoders — bind one instance with a positive delta to the encoder's clockwise direction and one with a negative delta to counter-clockwise.

| Option | Default | Description |
|---|---|---|
| Device | — | The playback device to control |
| Base delta per tick | `1` | How many volume units to move per encoder tick |
| Speed multipliers, slow → fast | `1,2,4` | Comma-separated list of multipliers applied to the base delta based on how fast the dial is being turned. The first value applies when turning slowly, the last when spinning fast. More values = finer acceleration curve. Set to `1` to disable acceleration. |

**Example:** with base delta `1` and multipliers `1,2,4`, a slow turn moves 1 unit per tick, a fast spin moves 4 units per tick.

### Set Mute
Mutes, unmutes, or toggles a device.

| Option | Description |
|---|---|
| Device | The playback device to control |
| State | `Mute`, `Unmute`, or `Toggle` |

### Set Default Device
Makes a device the Windows default playback device.

> **Note:** This may require Companion to be running with administrator privileges on some Windows configurations.

---

## Feedbacks

All feedbacks are **boolean** — they change button appearance when their condition is true.

| Feedback | Default style | Triggers when… |
|---|---|---|
| **Device is Muted** | Red background | The device is muted |
| **Volume Above Threshold** | Green background | Device volume ≥ threshold |
| **Volume Below Threshold** | Orange background | Device volume ≤ threshold |
| **Is Default Device** | Blue background | The device is the current Windows default playback device |

---

## Variables

Variables update in real time as volume changes. Use them in button labels to display live volume levels.

### Per-device variables

For each connected device:

| Variable | Example | Value |
|---|---|---|
| `$(windows-audio:volume_<id>)` | `$(windows-audio:volume_steelseries-sonar-game)` | `72` |
| `$(windows-audio:muted_<id>)` | `$(windows-audio:muted_steelseries-sonar-game)` | `true` or `false` |

### Global variables

| Variable | Value |
|---|---|
| `$(windows-audio:sidecar_connected)` | `true` or `false` |
| `$(windows-audio:device_count)` | Number of active playback devices |

### Finding device IDs

Device IDs are generated from the device's friendly name by converting to lowercase and replacing non-alphanumeric characters with hyphens:

| Friendly name | ID |
|---|---|
| SteelSeries Sonar - Game | `steelseries-sonar-game` |
| Speakers (Realtek Audio) | `speakers-realtek-audio` |
| NVIDIA RTX Voice | `nvidia-rtx-voice` |

To see all current IDs and values, go to **Connections → Windows Audio Control → Variables** in the Companion web interface.

**Example button label showing live volume:**
```
Game\n$(windows-audio:volume_steelseries-sonar-game)%
```

---

## Presets

Ready-made button presets are generated automatically for each connected device, organised by device name:

- **Vol Up** — Adjust Volume +1 with acceleration
- **Vol Down** — Adjust Volume −1 with acceleration
- **Toggle Mute** — Turns red when the device is muted

Find them under **Buttons → Presets → Windows Audio Control**.

---

## Troubleshooting

**Status shows "Connection Failure"**
The sidecar service is not running. Check it with `sc query AudioSidecar` in PowerShell. If it shows `STOPPED`, start it with `sc start AudioSidecar` or re-run `install-service.ps1`.

**No devices appear**
The sidecar only lists active render (playback) endpoints. Make sure at least one playback device is enabled in Windows Sound settings. Devices set to "Disabled" or "Not plugged in" are not shown.

**Volume changes work but display doesn't update**
Check that you are using the correct variable name. Variable IDs are based on the device's Windows friendly name at the time the sidecar started. If you renamed a device in Windows, restart the sidecar service: `sc stop AudioSidecar && sc start AudioSidecar`.

**"Set Default Device" does nothing**
This uses an undocumented Windows API (`IPolicyConfig`) that is present on all versions of Windows since Vista. If it has no effect, try running Companion as Administrator.

**The sidecar service fails to start**
Open Event Viewer → Windows Logs → Application and look for entries from `AudioSidecar`. Common causes: port 37891 already in use (change the port in both the service and the Companion connection settings), or a missing Visual C++ runtime (the published exe is self-contained and should not require this).

---

## Security

`AudioSidecar.exe` is a self-contained .NET 8 application that:
- Listens **only** on `127.0.0.1` (localhost) — it is not accessible from the network
- Has no network access beyond that single local port
- Makes no registry changes beyond what the Windows Service Control Manager records during install
- Source code is available at: *(link to your repository)*

**VirusTotal scan:** [Results](https://www.virustotal.com/gui/file/9ba2364b60fd3df08571a1a90281eb04c238b6fca9a2432e0a289b312d395ac0)

---

## Building from source

Requirements: [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0), [Node.js 20+](https://nodejs.org), [Yarn 4](https://yarnpkg.com)

```powershell
# Build the sidecar
cd AudioSidecar
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o ../resources/

# Build the Companion module
cd ..
yarn install
yarn build

# Install the service (PowerShell as Administrator)
.\install-service.ps1
```
