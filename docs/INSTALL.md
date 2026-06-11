# VibeVoice Install

VibeVoice is wired around a local Fedora setup and the existing `whisper.cpp` paths:

```text
~/tools/whisper.cpp/build/bin/whisper-cli
~/tools/whisper.cpp/models/ggml-base.en.bin
```

## Quick Check

Run the system check first:

```bash
bash scripts/check-system.sh
```

It prints a key-value status summary and exits nonzero only when a critical piece is missing.

## Fedora Setup

Use the installer on Fedora:

```bash
bash scripts/install-fedora.sh
```

What it does:

1. Installs missing Fedora dependencies with `sudo dnf install -y ...`
2. Reuses an existing `~/tools/whisper.cpp` checkout when present
3. Downloads `ggml-base.en.bin` if it is missing
4. Builds `whisper-cli` if it is missing
5. Creates `/tmp/vibevoice` for temporary audio files

The installer does not remove unrelated files or edit shell startup files.

## Existing `vp` Flow

The `vp` script remains a local proof-of-concept for:

```text
record -> transcribe -> print -> clipboard copy
```

The MVP app should treat that setup as the baseline rather than replacing it with a new model path or cloud service.
