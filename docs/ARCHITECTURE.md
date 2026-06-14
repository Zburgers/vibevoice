# VibeVoice Architecture

VibeVoice is a local-first voice input layer for a developer workstation.

## Windows

The Tauri app has two windows:

- `main`: normal desktop app for settings, diagnostics, dictionary, and history
- `pill`: transparent, undecorated, always-on-top floating widget for recording controls

Only the `pill` window should be always-on-top.

## Pipeline

```text
hotkey or pill -> CPAL mic capture -> local WAV -> whisper-cli -> cleanup -> clipboard/paste -> history
```

Recording uses Rust CPAL and writes WAV files with `hound`, so capture is not tied to Linux `arecord`.

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
