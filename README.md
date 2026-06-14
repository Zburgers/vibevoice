# VibeVoice

Local-first desktop voice input for developers. VibeVoice records from your microphone, runs `whisper.cpp` locally, cleans the transcript, and copies or pastes it into the focused app.

## Current App Shape

- Normal desktop app window for settings, diagnostics, dictionary rules, and history
- Separate always-on-top floating pill window for quick recording
- Pill shows recording state and live mic activity
- Whisper engine paths default to `auto`
- Windows and Linux setup scripts install or reuse `whisper.cpp`

## Quick Start

Windows:

```powershell
cd app
npm install
npm run tauri dev
```

Linux:

```bash
cd app
npm install
npm run tauri dev
```

If diagnostics show Whisper missing, press `Setup` in the app.

## Setup Scripts

Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

Linux:

```bash
bash scripts/install-engine.sh
```

See [docs/INSTALL.md](docs/INSTALL.md) for full build and installer details.
