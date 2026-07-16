# Safe Insertion Specification

**Status:** Proposed
**Phase:** P0-P2

## Current state

VibeVoice currently writes the transcript to the clipboard and invokes a platform paste helper. It cannot read and restore the previous clipboard value. It does not capture the target at recording start, detect a changed target, or apply a terminal policy.

The current paste paths use PowerShell on Windows and Linux-oriented `wtype`, `xdotool`, or `ydotool` elsewhere. macOS is packaged but has no dedicated paste implementation. That gap must be represented explicitly in the compatibility matrix.

## Goals

- Prevent stale-target paste events.
- Preserve previous clipboard text when restoration is enabled.
- Never overwrite a newer user clipboard value.
- Treat terminal targets as higher risk.
- Produce typed outcomes and actionable errors.

## Output plan

```rust
struct OutputPlan {
    text: String,
    original_target: Option<TargetApplication>,
    insertion_policy: InsertionPolicy,
    safety_class: TargetSafetyClass,
}
```

The transcription pipeline creates an `OutputPlan`. Only the insertion component may perform clipboard and paste side effects.

## Target identity

Capture target identity when recording starts and re-check it immediately before insertion.

Default policy:

```text
Target unchanged -> apply selected insertion policy
Target changed -> copy only and warn
Target unavailable -> copy only and warn
```

Target identity is an opaque safety value from the insertion layer. It uses the minimum stable platform identifier available and is compared only for equality. It is not exposed to transcript processing, history, activation rules, or receipts. Application identity as processing context is a separate P2 permission. Window-title content is never required for target equality.

## Clipboard restoration

The initial clipboard contract covers plain text only:

1. Read and retain the current clipboard text.
2. Write the transcript.
3. Trigger paste.
4. Wait for the target to consume the paste.
5. Read the clipboard again.
6. Restore the previous value only if the clipboard still equals the transcript written by VibeVoice.

If the user copied something new, restoration is skipped. Rich clipboard formats must not be claimed as preserved until platform adapters can snapshot and restore them without loss.

When restoration is enabled and the previous clipboard cannot be read as plain text, VibeVoice does not write or paste automatically. It shows the result in preview and reports `PreviewRequired`. A user who deliberately disables restoration may continue with insertion, accepting that non-text clipboard data can be replaced.

For target-changed or target-unavailable results, VibeVoice writes the transcript only after capturing the previous text clipboard, shows a warning, and offers a conditional “Restore previous clipboard” action. That action restores only if the clipboard still contains VibeVoice's transcript.

## Terminal policy

- Preview by default.
- Never append a newline or simulate Enter.
- Warn on multiline output.
- Warn on configurable destructive-looking patterns.
- Preserve tokens exactly.
- Allow deliberate overrides for preview and warning thresholds in an advanced pack policy.
- Describe detection as advisory rather than a security sandbox.

The no-Enter and no-appended-newline rules are immutable for Terminal Safe Mode. A pack override cannot weaken them.

## Platform adapters

Provide explicit adapters for:

- Windows
- Linux Wayland
- Linux X11
- macOS

An unsupported adapter returns `CopiedOnly` with a diagnostic reason. It must not attempt an unrelated platform helper.

## Result model

```text
InsertionOutcome
Inserted
CopiedOnly
PreviewRequired
TargetChanged
ClipboardReadFailed
ClipboardWriteFailed
PasteHelperMissing
PasteFailed

ClipboardRestoreOutcome
NotRequested
Restored
RestoreSkippedBecauseClipboardChanged
RestoreFailed
```

History and diagnostics store one primary `InsertionOutcome` and one `ClipboardRestoreOutcome`, not only a free-form string.

## Failure behavior

- Clipboard write failure produces no paste attempt.
- Paste failure retains the transcript on the clipboard and displays recovery instructions.
- Restore failure does not erase the transcript and is reported separately from paste success.
- Target-detection failure follows the copy-only default.
- A warning or preview cannot press Enter on behalf of the user.

## Acceptance criteria

- No automatic paste occurs when the target changes under the default policy.
- Newer user clipboard content is never overwritten.
- macOS has an explicit adapter or explicit copy-only fallback.
- Terminal insertion never appends a newline or presses Enter.
- Multiline terminal output requires preview by default.
- Every insertion attempt produces one insertion outcome and one restoration outcome.
- The compatibility matrix declares platform and application limitations.
