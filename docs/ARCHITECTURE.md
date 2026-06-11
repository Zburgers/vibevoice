# VibeVoice Architecture

VibeVoice is a local-first voice input layer for a developer workstation.

## Core Assumptions

The MVP is built around the existing local Whisper setup:

```text
Binary: ~/tools/whisper.cpp/build/bin/whisper-cli
Model:  ~/tools/whisper.cpp/models/ggml-base.en.bin
```

If both exist, the app should use them directly. If either is missing, the user should be guided through the safe Fedora setup flow.

## Main Pipeline

The MVP pipeline is intentionally small:

```text
hotkey -> record mic audio -> write temporary WAV -> run whisper-cli -> clean transcript -> insert or copy text
```

Temporary audio belongs in `/tmp/vibevoice` and should be discarded after use when possible.

## Support Scripts

`scripts/check-system.sh`

- Reports the local state in a machine-readable-ish `key=value` format
- Marks `whisper-cli`, the model, and `arecord` as critical
- Exits nonzero only when a critical piece is missing

`scripts/install-fedora.sh`

- Fedora-first bootstrap path
- Uses `sudo` only for explicit `dnf install`
- Reuses existing `whisper.cpp` files when they are already present
- Does not mutate unrelated config files or delete user data

## Dictionary

`config/default-dictionary.json` provides a small developer-oriented replacement list for transcript cleanup.
The MVP should keep this local and editable, not tied to a cloud service or model manager.
