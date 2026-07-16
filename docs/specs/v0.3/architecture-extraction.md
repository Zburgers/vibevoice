# Architecture Extraction Specification

**Status:** Proposed
**Phase:** P0
**Purpose:** Reduce Rust backend coupling without changing product behavior

## Current state

`app/src-tauri/src/lib.rs` currently owns runtime state, audio capture, engine discovery, transcription, processing, JSON storage, insertion, diagnostics, hotkeys, tray behavior, windows, and embedded tests. `finish_recording` coordinates capture shutdown through final state mutation in one function.

The React frontend already has separate view components. This specification targets the Rust backend rather than describing the entire application as a monolith.

## Goals

- Make pipeline stages independently testable.
- Keep current Tauri command names and serialized payloads stable during extraction.
- Preserve engine discovery, recording, history, insertion, and UI behavior.
- Prepare internal boundaries for Context Packs without implementing them in the refactor.
- Keep pull requests small enough to verify behavior after each extraction.

## Target structure

```text
app/src-tauri/src/
├── audio/
│   ├── mod.rs
│   ├── capture.rs
│   └── level.rs
├── transcription/
│   ├── mod.rs
│   ├── engine.rs
│   └── whisper_cli.rs
├── pipeline/
│   ├── mod.rs
│   ├── request.rs
│   └── runner.rs
├── processing/
│   ├── mod.rs
│   ├── cleanup.rs
│   ├── dictionary.rs
│   └── formatting.rs
├── context/
│   ├── mod.rs
│   ├── target.rs
│   └── privacy.rs
├── insertion/
│   ├── mod.rs
│   ├── clipboard.rs
│   └── platform.rs
├── storage/
│   ├── mod.rs
│   ├── settings.rs
│   ├── history.rs
│   └── migrations.rs
├── diagnostics/
├── commands/
├── lib.rs
└── main.rs
```

`lib.rs` should retain application composition, plugin registration, managed state, and command registration rather than domain implementation.

## Internal contracts

```rust
trait TranscriptionEngine {
    fn transcribe(
        &self,
        request: &TranscriptionRequest,
    ) -> Result<RawTranscript, TranscriptionError>;
}

trait TranscriptProcessor {
    fn process(
        &self,
        document: TranscriptDocument,
        context: &ProcessingContext,
    ) -> Result<ProcessedTranscript, ProcessingError>;
}

trait Inserter {
    fn insert(
        &self,
        plan: &OutputPlan,
    ) -> Result<InsertionResult, InsertionError>;
}
```

Only `WhisperCliEngine` is required initially. These are internal seams, not a public plugin SDK.

## Extraction order

1. Move settings and history storage without changing formats.
2. Move cleanup and dictionary functions with characterization tests.
3. Move clipboard and platform paste behavior.
4. Move engine discovery and `whisper-cli` execution.
5. Move platform audio capture.
6. Introduce a pipeline runner using the extracted modules.
7. Split runtime, settings, history, diagnostics, and meter event payloads.

Each step must preserve a green build and focused tests. Context Pack behavior must land later.

## State and event contract

Replace the broad refresh event incrementally with typed events:

```text
vibevoice-runtime-state-changed
vibevoice-history-changed
vibevoice-settings-changed
vibevoice-context-packs-changed
vibevoice-diagnostics-changed
vibevoice-meter-changed
```

Meter handling is already granular and should remain so. Migrate listeners with a temporary dual-emission or dual-listener period so existing windows do not miss events between pull requests. Remove `vibevoice-state-changed` only after both renderers use the typed events. The main change is preventing normal runtime transitions from reloading history, settings, dictionary, and diagnostics unnecessarily.

## Non-goals

- New Context Pack behavior
- Repository scanning
- New engines or providers
- SQLite migration
- UI redesign
- Public extension API

## Acceptance criteria

- Existing Tauri commands and payloads remain compatible during P0.
- Existing settings and history files load unchanged.
- Current recording and insertion behavior is preserved.
- `lib.rs` becomes composition-focused.
- Pipeline stages have focused unit tests.
- Runtime-only events do not reload history or diagnostics.
- No Context Pack feature logic is bundled into the extraction pull requests.

## Verification

```bash
npm --prefix app run build
cargo fmt --manifest-path app/src-tauri/Cargo.toml --check
cargo check --manifest-path app/src-tauri/Cargo.toml --no-default-features
cargo test --manifest-path app/src-tauri/Cargo.toml --no-default-features
```
