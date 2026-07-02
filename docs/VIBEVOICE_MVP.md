# VibeVoice MVP Build Directive

## Project Name

**VibeVoice**

## Goal

VibeVoice is a minimal personal desktop voice-input layer for sending spoken prompts directly into AI agents, editors, terminals, browsers, chat apps, and any currently focused text input.

The project should turn the current working local `whisper.cpp` setup into a smooth desktop application that feels like a native voice command harness:

```text
Press hotkey → speak → release/stop → local Whisper transcription → text appears where the cursor is
```

The target user is the developer building this tool for personal use. This is not a generic SaaS product. This is a fast, practical, local-first productivity tool for voice-driven coding, prompting, documentation, commits, issue writing, and agent interaction.

## Problem We Are Solving

Typing long prompts into AI agents is slow, especially when thinking out loud is faster than writing.

The user already has a local `whisper.cpp` transcription workflow working through the `vp` script. The problem is that it is still script-driven and not integrated deeply enough into the desktop workflow.

The MVP must solve this:

```text
I should be able to speak naturally and have the cleaned transcript inserted directly into whatever editor, terminal, browser, or agent input is currently focused.
```

The experience should feel like a system-wide voice keyboard for AI work.

## Product Style

VibeVoice should be:

* Minimal
* Fast
* Local-first
* Private
* Developer-focused
* Low resource
* Non-intrusive
* Keyboard-driven
* Clear about state
* Useful immediately

The product should not feel like a heavy AI suite, note-taking platform, meeting recorder, or bloated assistant.

It should feel like:

```text
A tiny floating voice input utility for developers using local Whisper.
```

## Current System Baseline

The current working system is the only transcription foundation for the MVP.

Current confirmed setup:

```text
whisper.cpp
ggml-base.en.bin
CPU-only local transcription
vp script
microphone recording
local WAV file
local transcription
clipboard copy
```

The MVP must build around this existing setup.

The MVP must not introduce additional model systems, cloud transcription, model switching, or experimental inference backends.

The current model and engine are enough.

## Core Technical Assumption

The app should default to automatic engine resolution, not a single hardcoded path.

The desktop app should detect explicit settings, environment-configured roots, the user app-data engine directory, and the legacy `~/tools/whisper.cpp` path.

If they exist:

```text
Use them directly.
```

If they do not exist:

```text
Show a safe one-click local install flow.
```

The one-click install must use safe, transparent, non-breaking scripts. It must not overwrite user files, remove packages, mutate unrelated shell config, or make broad system changes.

## What This Project Is

VibeVoice is:

* A local desktop voice input harness
* A wrapper around the existing `whisper.cpp` setup
* A system-wide voice-to-text utility
* A voice prompt tool for AI agents
* A focused personal productivity app
* A minimal desktop app with hotkeys, state indicator, transcript handling, and paste behavior

## What This Project Is Not

VibeVoice is not:

* A SaaS app
* A cloud transcription service
* A meeting recorder
* A podcast transcription tool
* A dictation platform with every possible feature
* A model playground
* A Whisper model manager as the main product
* An audio editor
* A voice assistant
* A chatbot
* A note-taking app
* A replacement for OpenAI Whisper, whisper.cpp, or other transcription engines
* A multi-user product
* A subscription product
* A heavy Electron-style app
* A research project
* A place to experiment with many models

Do not build bloat.

Do not add features that distract from the core workflow:

```text
Speak → transcribe locally → paste into active text field.
```

## MVP Scope

The MVP is one coherent end-to-end desktop app.

It must include the following features.

---

# 1. Desktop App Shell

Build a minimal desktop app.

Recommended stack:

```text
Tauri v2
Rust backend
React/Vite frontend
SQLite for local history
whisper.cpp as external local binary
```

The app should be lightweight and startup quickly.

The app should support Linux and Windows for the MVP. macOS can be considered later.

## Desktop App Layout

The desktop app should have a simple layout with only the important sections.

### Main Screen

The main screen should show:

```text
VibeVoice status
Whisper engine status
Current model path
Current hotkey
Recording mode
Last transcript
Primary action button
```

Main states:

```text
Ready
Recording
Processing
Inserted
Error
```

The main action button should change based on state:

```text
Start Recording
Stop Recording
Processing...
Retry
```

### Settings Screen

Settings should include:

```text
Whisper binary path
Model path
Recording mode
Hotkey
Output mode
Clipboard fallback toggle
Auto-paste toggle
Dictionary cleanup toggle
Start on login toggle
```

The settings page must stay minimal.

No advanced model switching in MVP.

No model marketplace.

No cloud configuration.

### History Screen

The history screen should show recent transcripts.

Each transcript item should include:

```text
Timestamp
Transcript text
Duration if available
Copy button
Re-insert button
Delete button
```

History should be local-only.

### Dictionary Screen

The dictionary screen should allow custom replacements.

Examples:

```text
next js -> Next.js
typescript -> TypeScript
tailwind -> Tailwind
postgres -> PostgreSQL
super base -> Supabase
open router -> OpenRouter
github actions -> GitHub Actions
```

Each dictionary rule should have:

```text
Spoken phrase
Replacement phrase
Enabled/disabled
```

The MVP can ship with a small default developer dictionary.

---

# 2. Floating Hover Widget

The floating widget is a core MVP feature, not optional polish.

The widget must always make the current voice state obvious.

The user should never wonder:

```text
Is it recording?
Is it idle?
Is it processing?
Did it paste?
Did it fail?
```

## Widget Requirements

The floating widget should be:

* Small
* Always-on-top
* Minimal
* Non-intrusive
* Easy to visually read
* Clearly stateful
* Moveable if possible
* Clickable for basic action if possible

## Widget States

The widget must clearly display these states:

### Idle / Ready

Meaning:

```text
VibeVoice is ready.
Not recording.
```

Suggested visual:

```text
Small neutral pill
Mic icon
Text: Ready
```

### Recording

Meaning:

```text
Microphone is actively recording.
```

Suggested visual:

```text
Clearly active/red/pulsing state
Mic icon
Text: Recording
Timer
```

This must be impossible to miss.

Recording state must be visually distinct from every other state.

### Processing

Meaning:

```text
Recording stopped.
Whisper is transcribing.
```

Suggested visual:

```text
Spinner or animated dots
Text: Transcribing
```

### Inserted / Copied

Meaning:

```text
Transcript was inserted into focused app or copied to clipboard.
```

Suggested visual:

```text
Checkmark
Text: Inserted
or
Text: Copied
```

This state can auto-dismiss back to Ready.

### Error

Meaning:

```text
Something failed.
```

Suggested visual:

```text
Warning icon
Text: Error
Click to view details
```

Error examples:

```text
Mic unavailable
Whisper binary missing
Model missing
Transcription failed
Clipboard unavailable
Auto-paste failed
```

## Widget Behavior

The widget should appear when the app is running.

It should not steal focus while the user is typing or using an editor.

The widget should not block the paste target.

The widget should be useful enough that the user can rely on it as the single source of truth for recording state.

---

# 3. Global Hotkey Recording

The MVP must support a global hotkey.

The app should allow the user to configure the hotkey, but it can ship with a sensible default.

Example default:

```text
Ctrl + Alt + Space
```

## Recording Modes

The MVP should support:

```text
Toggle mode
```

Toggle mode behavior:

```text
Press hotkey once → start recording
Press hotkey again → stop recording and transcribe
```

Push-to-talk can be added if it is straightforward, but toggle mode is enough for the MVP as long as it is smooth and reliable.

If both are implemented, support:

```text
Hold hotkey → record
Release hotkey → stop and transcribe
```

## Required Behavior

The hotkey must work while the user is in:

```text
VS Code
Terminal
Browser
ChatGPT
Codex
OpenCode
GitHub text fields
Slack/Discord style inputs
Any focused text input
```

The app should preserve the previously focused window/input as much as possible.

---

# 4. Recording Pipeline

The recording pipeline should be simple and reliable.

Current shell behavior can be used as historical reference:

```text
arecord → WAV file → whisper-cli → transcript txt
```

For MVP, recording should use the Rust audio path so Windows and Linux share the same capture behavior.

The generated audio should be compatible with whisper.cpp.

Target format:

```text
16 kHz
mono
16-bit WAV
```

Temporary files should be stored safely.

Suggested path:

```text
system temp directory / vibevoice
```

The app should clean up temporary files when safe.

Do not store raw audio permanently in MVP unless explicitly needed for debugging.

---

# 5. Local Whisper.cpp Transcription

The MVP must use a local whisper.cpp installation resolved by the app.

The app should call the local binary and parse the output transcript.

Use the current model only.

Do not add model selection to MVP.

Do not download additional models unless the required default model is missing and the user explicitly starts the one-click install.

## Transcription Requirements

The transcription should:

* Run locally
* Work offline
* Use CPU
* Avoid cloud services
* Return clean plain text
* Avoid timestamps in final inserted text
* Fail gracefully with clear errors

The final transcript should be cleaned before insertion.

---

# 6. Safe One-Click Install Flow

If `whisper.cpp` or the model is missing, the app should show a clear setup screen.

The setup screen should say what is missing:

```text
whisper.cpp binary missing
model missing
dependencies missing
```

The app may offer a one-click install.

The install script must be safe.

## Install Script Rules

The install script must:

* Be readable
* Be idempotent
* Not delete unrelated files
* Not overwrite existing user data
* Create only expected directories
* Use the user app-data engine directory by default
* Keep `~/tools/whisper.cpp` as a compatibility fallback
* Detect existing installs
* Download only the required model
* Build whisper.cpp if needed
* Show clear logs
* Fail safely
* Tell the user what command failed

The install script must not:

* Modify unrelated shell configuration
* Remove packages
* Change global system settings
* Run hidden commands
* Require sudo except for explicit dependency installation
* Install random extra packages
* Download multiple models
* Change the user’s existing Python Whisper install

## Linux and Windows Target Install

Fedora and Windows install should be first-class.

Expected dependencies:

```bash
sudo dnf install -y git cmake gcc gcc-c++ make ffmpeg alsa-utils alsa-lib-devel pkgconf-pkg-config wl-clipboard xclip xsel wtype xdotool
```

Expected setup paths:

```bash
~/.local/share/vibevoice/engines/whisper.cpp
%LOCALAPPDATA%\VibeVoice\engines\whisper.cpp
```

Expected model:

```bash
ggml-base.en.bin
```

---

# 7. Output Insertion

The most important MVP behavior is output insertion.

After transcription, the app should insert the text into the currently focused input.

Primary behavior:

```text
Auto-paste into focused text field
```

Fallback behavior:

```text
Copy transcript to clipboard
```

The user should be able to configure:

```text
Auto-paste enabled/disabled
Clipboard copy enabled/disabled
```

Default should be:

```text
Auto-paste enabled
Clipboard fallback enabled
```

## Output Rules

After transcription:

1. Clean transcript.
2. Apply dictionary replacements.
3. Copy text to clipboard.
4. Restore/focus target app if needed.
5. Simulate paste into focused input.
6. Show widget success state.

If paste fails:

1. Keep transcript in clipboard.
2. Show widget state as `Copied`.
3. Show a non-intrusive error or warning.
4. Do not lose the transcript.

## Critical Requirement

The transcript must never disappear.

If insertion fails, the user should still be able to paste manually.

---

# 8. Transcript Cleanup

The MVP should include basic cleanup before insertion.

Cleanup should:

* Trim whitespace
* Remove timestamp artifacts
* Normalize repeated spaces
* Remove empty output
* Preserve punctuation from Whisper
* Avoid over-processing

Do not use an LLM for cleanup in MVP.

Do not rewrite the user’s prompt.

Do not summarize.

Do not “improve” the transcript beyond deterministic cleanup and dictionary replacement.

The tool should capture what the user said, not reinterpret it.

---

# 9. Developer Dictionary

The MVP should include a simple local dictionary replacement engine.

Purpose:

```text
Fix common transcription mistakes for developer terms.
```

This is high-impact for AI prompting and coding.

Examples:

```text
next js -> Next.js
react js -> React.js
typescript -> TypeScript
java script -> JavaScript
node js -> Node.js
super base -> Supabase
post gres -> PostgreSQL
postgress -> PostgreSQL
github -> GitHub
github actions -> GitHub Actions
open ai -> OpenAI
open router -> OpenRouter
tail wind -> Tailwind
docker compose -> Docker Compose
fast api -> FastAPI
```

Dictionary must be local.

Dictionary must be editable from the desktop app.

Dictionary rules should be applied before insertion.

---

# 10. Local Transcript History

The MVP should save transcript history locally.

Use SQLite or a simple JSONL file.

SQLite is preferred if the Tauri app is already using Rust backend storage.

Each history record should include:

```text
id
created_at
raw_transcript
final_transcript
duration_ms if available
insert_status
error if any
```

History must not require cloud sync.

History should be searchable later, but search is non-blocking for MVP.

MVP history only needs:

```text
View recent transcripts
Copy transcript
Re-insert transcript
Delete transcript
```

---

# 11. Error Handling

Error handling must be clear and practical.

The user should always know what broke and how to fix it.

Required error cases:

```text
Whisper binary missing
Model file missing
Microphone unavailable
Recording failed
Transcription failed
Clipboard command missing
Paste simulation failed
Hotkey registration failed
Permission issue
```

Each error should show:

```text
What failed
Likely reason
Suggested fix
```

Example:

```text
Model missing:
~/tools/whisper.cpp/models/ggml-base.en.bin was not found.
Run setup from the app or install whisper.cpp manually.
```

---

# 12. Minimal UI Requirements

The UI should be functional and direct.

Do not overdesign.

Do not add dashboards, onboarding flows, accounts, pricing screens, templates, prompt libraries, or AI chat features.

## Required UI Sections

```text
Main
Settings
History
Dictionary
Setup / Diagnostics
```

## Main UI Must Show

```text
Status
Current hotkey
Current output mode
Last transcript
Start/Stop recording button
Open settings button
```

## Settings UI Must Show

```text
Whisper binary path
Model path
Hotkey
Recording mode
Auto-paste toggle
Clipboard fallback toggle
Start on login toggle
```

## Diagnostics UI Must Show

```text
Whisper binary found/missing
Model found/missing
Mic available/unavailable
Clipboard tool available/unavailable
Paste tool available/unavailable
Last error
Run setup button
```

---

# 13. Performance Requirements

The app should remain lightweight.

Expected behavior:

```text
Idle: near-zero CPU usage
Recording: low CPU usage
Transcribing: CPU spike allowed
After transcription: return to idle
```

The app must not keep heavy processing active in the background.

No unnecessary watchers.

No cloud polling.

No background model loading unless needed.

No hidden services beyond the desktop app/daemon.

---

# 14. Privacy Requirements

The MVP should be local-first.

Default behavior:

```text
Audio stays local
Transcript stays local
No cloud APIs
No analytics
No telemetry
No external sync
```

If any future cloud feature is added, it must be opt-in and clearly marked. That is outside MVP.

---

# 15. Repo Structure

Recommended structure:

```text
vibevoice/
  README.md
  docs/
    VIBEVOICE_MVP.md
    INSTALL.md
    ARCHITECTURE.md
  scripts/
    install-fedora.sh
    check-system.sh
  app/
    src/
    src-tauri/
  cli/
    vp
    vp-text
  config/
    default-dictionary.json
  tests/
```

If starting from the current simple repo, preserve the current `vp` script and build around it.

Do not delete the working script unless it has been replaced with an equal or better working flow.

---

# 16. Required Deliverables

The MVP is complete only when all of the following work end-to-end:

## Engine Detection

```text
App detects whisper.cpp binary
App detects ggml-base.en.bin model
App shows clear status
```

## Setup Flow

```text
If missing, app offers safe one-click install
Install script works on Fedora
Install script does not break existing setup
```

## Recording

```text
User can start recording from app
User can start recording from global hotkey
Widget clearly shows recording state
User can stop recording
```

## Transcription

```text
Audio is saved locally
whisper.cpp runs locally
Transcript is generated
Transcript is cleaned
Dictionary replacements are applied
```

## Output

```text
Transcript copies to clipboard
Transcript auto-pastes into focused app when enabled
If auto-paste fails, clipboard fallback works
Widget shows success/failure state
```

## History

```text
Transcript is saved locally
User can view recent transcripts
User can copy old transcript
User can delete transcript
```

## Floating Widget

```text
Widget appears while app is running
Widget shows Ready
Widget shows Recording clearly
Widget shows Transcribing
Widget shows Inserted/Copied
Widget shows Error
Widget does not steal focus
```

---

# 17. Non-Blocking Work

The following work is useful but should not block the MVP.

Do not prioritize these until the end-to-end loop works.

```text
Push-to-talk mode if toggle mode is already stable
Searchable history
Stats dashboard
Audio waveform visualization
Sound effects
Model switching
Model download manager beyond required base.en install
Cloud transcription
Cross-platform packaging
Fancy themes
Prompt templates
LLM cleanup
Multi-language mode
Mobile app
Account system
Sync
Team features
```

---

# 18. Build Priorities

Build in this order:

1. Preserve and clean current `vp` functionality.
2. Add reliable engine/model detection.
3. Add safe Fedora install/check scripts.
4. Build minimal Tauri desktop shell.
5. Add recording start/stop from app.
6. Add local whisper.cpp transcription call.
7. Add transcript cleanup.
8. Add clipboard copy.
9. Add auto-paste into focused app.
10. Add global hotkey.
11. Add floating widget with clear states.
12. Add local history.
13. Add dictionary replacements.
14. Add diagnostics and clear errors.
15. Polish only after the full loop works.

The first end-to-end win should be:

```text
Open editor → press hotkey → speak → stop → transcript appears in editor
```

Everything else supports that.

---

# 19. Acceptance Criteria

The MVP is accepted when the following demo works on Fedora and Windows:

1. Start VibeVoice desktop app.
2. App detects existing `whisper.cpp` and `ggml-base.en.bin`.
3. Floating widget shows `Ready`.
4. Open VS Code or terminal.
5. Place cursor in a text input.
6. Press global hotkey.
7. Floating widget clearly shows `Recording`.
8. Speak a prompt.
9. Press hotkey again to stop.
10. Floating widget shows `Transcribing`.
11. Transcript is generated locally using whisper.cpp.
12. Transcript is cleaned and dictionary rules are applied.
13. Transcript is copied to clipboard.
14. Transcript is pasted into the focused input.
15. Floating widget shows `Inserted`.
16. Transcript appears in local history.
17. If paste fails, transcript remains available in clipboard and history.

---

# 20. Agent / Orchestrator Instructions

Any orchestrator or subagent working on this project must follow these rules.

## General Rules

* Keep the MVP minimal.
* Do not add unrelated features.
* Do not introduce cloud transcription.
* Do not add new models.
* Do not switch away from `whisper.cpp`.
* Do not break the current working `vp` script.
* Do not remove working functionality without replacing it.
* Prioritize end-to-end usability over architectural perfection.
* Prefer small, reviewable commits.
* Keep scripts safe and idempotent.
* Keep Fedora as the primary target.
* Document every important command and setup step.

## Engineering Rules

* Add clear error handling.
* Add diagnostics before clever features.
* Do not hide failures.
* Do not silently swallow transcription errors.
* Do not lose transcripts.
* Clipboard fallback is mandatory.
* Widget state clarity is mandatory.
* Global hotkey behavior must not steal focus.
* Auto-paste must fail gracefully.
* No telemetry.
* No analytics.
* No external API calls in MVP.

## Source Control Rule

Every orchestrator and every subagent must commit their own work to source control.

Each meaningful task must end with:

```bash
git status
git add <relevant-files>
git commit -m "<clear message>"
```

Before finishing, each orchestrator/subagent must report:

```text
Files changed
Commands run
Tests/checks run
Commit hash
Known remaining issues
```

No agent should leave uncommitted work unless explicitly blocked, and if blocked, it must clearly report the uncommitted files and reason.

---

# 21. Final MVP Summary

VibeVoice MVP is a minimal personal desktop voice layer.

It should take the working local `whisper.cpp` setup and wrap it in a smooth desktop experience:

```text
global hotkey
clear floating recording widget
local recording
local whisper.cpp transcription
dictionary cleanup
clipboard fallback
auto-paste into focused app
local history
safe setup diagnostics
```

The product exists to make AI agent prompting faster and more natural.

The core promise is:

```text
Speak anywhere. VibeVoice types it there.
```
