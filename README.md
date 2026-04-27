# Windows Audio Control — Bitfocus Companion Module

Control Windows audio device volumes and mute states from [Bitfocus Companion](https://bitfocus.io/companion), including virtual devices like **SteelSeries Sonar**, **Voicemeeter**, and **NVIDIA RTX Voice**.

For full documentation see [HELP.md](./companion/HELP.md).

---

## How it works

The module communicates with a small background process called **AudioSidecar** (`AudioSidecar.exe`) over a local TCP connection. The sidecar uses the Windows WASAPI audio API to read and control audio endpoints and must be installed separately as a Windows Service.

---

## Quick start

### 1. Download and install the module

Download the latest `companion-windows-audio-x.x.x.tgz` from the [Releases page](https://github.com/mehistaken/companion-windows-audio/releases).

In Companion go to **Connections → Add connection → (import icon) → Import from file** and select the `.tgz`.

### 2. Install the AudioSidecar service

From the directory where Companion extracted the module, open **PowerShell as Administrator** and run:

```powershell
.\install-service.ps1
```

The service starts automatically and restarts on every reboot. To uninstall:

```powershell
.\uninstall-service.ps1
```

### 3. Add the connection in Companion

- Go to **Connections → Add connection**
- Search for **Windows Audio Control**
- Click **Add**

Once connected the status indicator turns green and device variables become available.

---

## Features

- **Set Volume** — set a device to an exact volume level
- **Adjust Volume** — increment/decrement with velocity-based acceleration for rotary encoders
- **Set Mute** — mute, unmute, or toggle
- **Set Default Device** — change the Windows default playback device
- **Feedbacks** — button colour changes for muted state, volume thresholds, and default device
- **Variables** — live per-device volume and mute values for use in button labels
- **Presets** — ready-made Vol Up / Vol Down / Toggle Mute buttons generated per device

---

## Building from source

Requirements: [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0), [Node.js 22+](https://nodejs.org), [Yarn 4](https://yarnpkg.com)

```powershell
# Build the sidecar
cd AudioSidecar
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o ../resources/

# Build and package the Companion module
cd ..
yarn install
yarn package
```

---

## License

MIT
