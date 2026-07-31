# VibeVoice Issues and Optimizations

This document outlines discrepancies between the planned architecture (as defined in `VIBEVOICE_MVP.md` and `ARCHITECTURE.md`) and the actual implementation, as well as high-confidence architectural optimizations for the codebase.

## 1. Plan and Document Drift

### A. Recording Mode (Toggle vs. Push-to-Talk)
* **Documentation**: The MVP states that "Recording modes" should be supported, explicitly mentioning "Toggle mode" and potentially "Push-to-talk". The Settings struct includes a `recording_mode` field (defaulting to `"toggle"`).
* **Implementation**: The global hotkey handler (`register_hotkey_handler`) only checks for `ShortcutState::Pressed` and unconditionally toggles the recording state. The `recording_mode` setting is completely ignored by the backend logic, meaning push-to-talk is not functionally supported despite being in the settings model.

### B. Undocumented `export_history` Feature
* **Documentation**: `VIBEVOICE_MVP.md` restricts history requirements strictly to: "View recent transcripts, Copy transcript, Re-insert transcript, Delete transcript."
* **Implementation**: The backend implements a full `export_history` function allowing exports to JSON and Markdown. This is technically feature creep outside the defined MVP scope.

### C. Output Mode Simplification
* **Documentation**: MVP specifies configuring "Output mode".
* **Implementation**: This is handled via two boolean toggles (`auto_paste` and `clipboard_fallback`) rather than an explicit "mode" enum, which is a slight deviation in data modeling but achieves the same functional goal.

### D. Always-on-top Configuration
* **Documentation**: The MVP states the pill widget is "Always-on-top".
* **Implementation**: The `Settings` struct includes a `pill_always_on_top` toggle, making this configurable rather than a hardcoded window property. This is a positive deviation but is not reflected in the MVP settings requirements.

## 2. Architectural Issues & Optimizations (0.9+ Confidence)

### A. Accumulation of Temporary Audio Files (Storage Optimization)
* **Issue**: `prepare_recording_session` creates recording files in `std::env::temp_dir().join("vibevoice")` (e.g., `recording-<uuid>.wav`). While `cleanup_recording_artifacts` is called on successful stop, if the app crashes during recording or is forcefully closed, the WAV files are left behind.
* **Optimization**: Implement a startup cleanup routine that clears the `vibevoice` temporary directory when the app initializes, or use `tempfile` crate to rely on OS-level file handle cleanup.

### B. Blocking Polling in `spawn_meter_emitter` (Performance/Resource)
* **Issue**: `spawn_meter_emitter` spawns an OS thread (`std::thread::spawn`) that loops with `thread::sleep(Duration::from_millis(180))` to emit microphone levels.
* **Optimization**: Instead of consuming a full OS thread for a simple periodic check, this should use Tauri's async runtime (`tauri::async_runtime::spawn`) with `tokio::time::sleep`. This is much more lightweight and integrates cleanly with the rest of Tauri's async ecosystem.

### C. Blocking Process Execution (Performance)
* **Issue**: The `paste_from_clipboard` function uses `std::process::Command` to execute paste simulation (e.g., `powershell`, `wtype`, `xdotool`), which blocks the thread. Currently, it is correctly wrapped in `async_runtime::spawn_blocking`, but if the target paste tool hangs, it will hold a blocking thread from the runtime pool.
* **Optimization**: Refactor to use `tokio::process::Command` for spawned external processes (including `whisper-cli` and setup scripts) so they can be awaited without consuming blocking threads, allowing for timeout wrappers to prevent hanging.

### D. Redundant AppHandle Cloning
* **Issue**: In `start_recording` and `stop_recording`, `AppHandle` is cloned multiple times and moved into blocking threads.
* **Optimization**: Since `AppHandle` is cheap to clone, it's not a memory issue, but the code could be simplified by passing standard references to inner functional components rather than relying on state extraction inside spawned closures where possible.