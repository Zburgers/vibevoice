# VibeVoice Install

VibeVoice now resolves the local Whisper engine automatically. Settings default to `auto`; explicit paths are still supported for custom installs.

## Engine Resolution

The app checks these locations before reporting Whisper as missing:

1. Explicit settings paths, when they exist
2. `VIBEVOICE_ENGINE_DIR`, `WHISPER_ROOT`, or `WHISPER_CPP_ROOT`
3. The user app-data engine directory
   - Windows: `%LOCALAPPDATA%\VibeVoice\engines\whisper.cpp`
   - Linux: `$XDG_DATA_HOME/vibevoice/engines/whisper.cpp` or `~/.local/share/vibevoice/engines/whisper.cpp`
4. Legacy `~/tools/whisper.cpp`

The model is `ggml-base.en.bin`.

## Windows Setup

From PowerShell:

```powershell
cd app
npm install
npm run tauri dev
```

Inside the app, press `Setup`, or run the installer directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

The Windows installer:

- Installs Git, CMake, FFmpeg, and Visual Studio Build Tools with `winget` when missing
- Clones `whisper.cpp` into `%LOCALAPPDATA%\VibeVoice\engines\whisper.cpp`
- Downloads `ggml-base.en.bin`
- Builds `whisper-cli.exe`
- Creates `%TEMP%\vibevoice`

Run a Windows readiness check:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-windows.ps1
```

## Linux Setup

```bash
bash scripts/install-engine.sh
```

The Linux installer supports Fedora first and also handles Debian/Ubuntu package names. It installs a compiler toolchain, CMake, FFmpeg, ALSA development headers for the Rust audio backend, and clipboard helpers.

Run a Linux readiness check:

```bash
bash scripts/check-system.sh
```

## Build Installers

Windows:

```powershell
cd app
npm install
npm run tauri build -- --bundles nsis,msi
```

Linux:

```bash
cd app
npm install
npm run tauri build
```

Linux developers need ALSA development headers before Rust can compile CPAL:

```bash
sudo dnf install -y alsa-lib-devel pkgconf-pkg-config
```

or:

```bash
sudo apt-get install -y libasound2-dev pkg-config
```
