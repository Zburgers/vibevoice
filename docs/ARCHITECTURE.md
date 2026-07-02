# VibeVoice Architecture

VibeVoice is a local-first voice input layer for a developer workstation.

## Windows

The Tauri app has two windows:

- `main`: normal desktop app for settings, diagnostics, dictionary, and history
- `pill`: transparent, undecorated, always-on-top floating widget for recording controls

Only the `pill` window should be always-on-top.

## Pipeline

```text
hotkey or pill -> platform mic capture -> local WAV -> background whisper-cli -> cleanup -> clipboard/paste -> history event
```

Recording uses Rust CPAL and `hound` on Windows/macOS. Linux uses runtime recorder binaries (`pw-record`, `arecord`, or `ffmpeg`) so the app can build without ALSA development headers. Stopping a recording moves the app into `Processing` and schedules transcription plus output insertion on a background worker; UI windows refresh from the `vibevoice-state-changed` event instead of polling continuously.

Clipboard writes go through Tauri's clipboard manager plugin. Paste simulation remains platform-specific because desktop environments expose it through different native tools, but paste execution runs off the UI command path so a slow paste helper cannot block the frontend.

## Engine Resolution

Settings default to `auto`. The backend resolves `whisper-cli` and `ggml-base.en.bin` from:

- Existing explicit settings paths
- `VIBEVOICE_ENGINE_DIR`, `WHISPER_ROOT`, or `WHISPER_CPP_ROOT`
- User app-data engine directory
- Legacy `~/tools/whisper.cpp`

The installer writes to the user app-data engine directory by default:

- Windows: `%LOCALAPPDATA%\VibeVoice\engines\whisper.cpp`
- Linux: `~/.local/share/vibevoice/engines/whisper.cpp`

## Support Scripts

- `scripts/install-windows.ps1`
- `scripts/install-engine.sh`
- `scripts/install-fedora.sh` compatibility wrapper
- `scripts/check-windows.ps1`
- `scripts/check-system.sh`

Setup scripts are packaged as Tauri resources so app-triggered setup works after bundling.

## Dictionary

`config/default-dictionary.json` provides local developer-oriented replacements for transcript cleanup. Dictionary rules remain local JSON data.
