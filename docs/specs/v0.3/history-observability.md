# History and Local Observability Specification

**Status:** Proposed
**Phase:** P1-P3

## Purpose

History remains a local dictation debugger, not a notes product. Observability helps users understand output quality, latency, context use, engine health, and insertion failures without cloud telemetry.

## Current state

History is disabled by default, stored as JSON, capped at 100 entries by default and 1,000 maximum, atomically replaced, backed up, and recovered. Each record already distinguishes raw and final transcript text and records duration, insertion status, and error.

This is adequate for current scale. SQLite is not a P0 or P1 requirement.

## Record evolution

When history is enabled, a versioned dictation record may contain:

```rust
struct DictationRecord {
    schema_version: u32,
    id: DictationId,
    created_at: DateTime<Utc>,
    raw_transcript: String,
    final_transcript: String,
    context_pack: ContextPackIdentity,
    target: Option<TargetApplicationReceipt>,
    engine: EngineIdentity,
    stage_timings: Vec<StageTiming>,
    processing_receipt: ProcessingReceipt,
    insertion_result: InsertionResult,
    error: Option<ErrorCategory>,
}
```

Context values are excluded by default. Receipts store source categories, counts, policy decisions, and revisions rather than clipboard, selected text, window-title content, or the complete project vocabulary.

Legacy `history.json` is treated as schema version `0` when the top level is the existing array of `HistoryItem` values. Migration first preserves the current file and backup, parses and validates every record, writes the new envelope atomically, reloads it, and only then rotates the backup. If validation or reload fails, the version-0 file remains authoritative and the app reports a migration error without truncating history.

## P1 actions

- Copy raw transcript
- Copy final transcript
- Inspect transformation receipt
- Add an eligible correction to the global dictionary
- Delete one record
- Clear all history
- Copy a redacted diagnostics report

## P3 actions

- Re-run deterministic processing without rerunning transcription
- Select another compatible Context Pack
- Search processing metadata when storage supports it
- Export a reproducible redacted diagnostic record

Reprocessing creates a new derived result or revision and never destroys the original raw transcript.

## Diagnostics report

Issue [#8](https://github.com/Zburgers/vibevoice/issues/8) is the first observability slice. The copyable report includes:

- App version and platform
- Engine and model presence
- Redacted resolved paths
- Recorder and input device status
- Clipboard and paste adapter status
- Updater status
- Last categorized error

It excludes transcript text, history content, project vocabulary, clipboard content, selected text, and raw home-directory paths.

Updater state currently lives in the main React process. The P1 report command accepts only a typed, sanitized updater-status enum from the authorized main window, combines it with backend diagnostics, and formats the final report in Rust. It does not accept arbitrary updater text from the renderer.

## Local quality dashboard

The dashboard may summarize the latest 30 completed dictations:

```text
Median recording startup time
Median transcription duration
Median processing duration
Median insertion duration
Insertion success rate
Corrected developer-term count
Errors by category
Engine health
```

All aggregation is local and computed from records the user has chosen to retain. The dashboard is empty and explanatory when history is disabled.

## Retention and deletion

- History remains opt-in.
- Audio stays temporary by default and is not attached to records.
- Existing entry-count and optional age retention rules still apply.
- Clearing history removes records and derived indexes.
- Clearing all VibeVoice data also clears project caches and local metrics.
- Backup recovery must not resurrect intentionally cleared data.

## SQLite migration trigger

Consider SQLite only when at least one shipped requirement cannot be met cleanly by bounded JSON, such as:

- Full-text search at retained scale
- Efficient reprocessing relations
- Queryable per-stage metadata
- Thousands of records

A migration proposal must include rollback, backup, privacy, and corruption recovery. Architectural preference alone is insufficient.

## Acceptance criteria

- History-disabled workflows persist no dictation records or dashboard metrics.
- Diagnostics copy contains no transcript or context content.
- Raw output remains immutable during reprocessing.
- Every retained record identifies pack, engine, timing, and insertion outcome revisions.
- Clearing data removes records, indexes, caches, and aggregates as documented.
- No network telemetry is introduced.
