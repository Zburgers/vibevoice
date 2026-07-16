# Context Pack Specification

**Status:** Proposed for VibeVoice `0.3.0`
**Depends on:** Architecture extraction, security foundation, renderer reliability

## Purpose

A Context Pack is a versioned local policy that selects transcript processing, permitted context, activation, vocabulary, formatting, insertion, and safety behavior for one developer workflow.

Context Packs replace neither settings nor transcription engines. Global settings hold application-wide preferences. An engine produces a raw transcript. A pack decides how that transcript becomes output.

## Data model

```json
{
  "schema_version": 1,
  "id": "agent-prompt",
  "name": "Agent Prompt",
  "built_in": true,
  "activation": {
    "applications": [],
    "manual_hotkey": null
  },
  "vocabulary_sources": [
    "global-dictionary"
  ],
  "processing": {
    "preset": "structured-prompt",
    "remove_fillers": true,
    "preserve_paragraphs": true,
    "spoken_formatting_commands": true
  },
  "context_policy": {
    "application_identity": false,
    "project_metadata": false,
    "selected_text": false,
    "clipboard": false
  },
  "insertion_policy": {
    "mode": "auto-paste",
    "restore_clipboard": true,
    "target_change": "copy-and-warn",
    "require_preview": false
  }
}
```

The stored representation must reject unknown schema versions, invalid identifiers, duplicate hotkeys, invalid built-in overrides, and combinations that weaken a pack's mandatory safety policy.

## Built-in pack invariants

Safety-only target identity is part of the insertion layer from P0. It is an opaque equality check and is not processing context. Exposing application identity to pack activation or transcript processing remains P2 and requires the context policy.

### Raw Dictation

- Matches current cleanup and dictionary behavior as closely as practical
- Captures no application, clipboard, selection, or project context
- Preserves dictated punctuation
- Allows auto-paste when the target is unchanged

### Agent Prompt

- Preserves paragraph and Markdown structure
- Enables deterministic spoken formatting commands
- Uses the global dictionary in P1 and optional project vocabulary in P2
- Never invents requirements, test results, files, or implementation claims
- Copies and warns if the target changes during processing

### Developer Chat

- Applies light filler cleanup and punctuation normalization
- Retains conversational tone and technical vocabulary
- Avoids rigid prompt or commit formatting
- Copies and warns if the target changes

### Terminal Safe Mode

- Enters P2, not the initial P1 release
- Requires a preview by default
- Never appends a newline or simulates Enter
- Warns on multiline or destructive-looking output
- Preserves exact developer tokens defined by the terminal corpus

### Commit and Pull Request

- Enters P2
- Supports optional Conventional Commit structure
- Splits title and body deterministically
- Warns on configurable title length
- Never fabricates changed files, tests, issue status, or review outcomes

## Selection and activation

P1 supports manual selection and optional dedicated hotkeys. P2 may add application activation rules after the safety-only target provider is enriched and separately permissioned for context use.

Selection order in P2:

1. Explicit pack-specific hotkey
2. User-selected temporary override
3. Most specific enabled application rule
4. User's default pack
5. Raw Dictation fallback

Ties must produce a visible configuration error rather than nondeterministic selection.

## Storage and migration

- Store packs as versioned JSON in the existing application data area.
- Keep immutable built-in definitions in code or bundled resources.
- Store user changes as explicit overrides so built-ins can evolve safely.
- Add a top-level `schema_version` to settings before pack references are persisted.
- Back up the last valid configuration before migration.
- On invalid configuration, retain the invalid file for diagnosis, restore the last valid version where possible, and fall back to Raw Dictation.
- Existing `0.2.6` users migrate to Raw Dictation with their current global dictionary and insertion settings preserved.

Raw Dictation revision 1 preserves settings and workflow defaults but intentionally replaces unsafe substring matching with boundary-aware vocabulary rules. The migration shows a one-time note, reports conflicting rules before activation, and records changed replacements in receipts. Legacy characterization fixtures remain as evidence of the old behavior; they are not a requirement to preserve substring corruption.

## UI contract

- The main window shows the active pack and its material context/insertion policies.
- The pill shows only the active pack identity when space permits; it does not become a profile editor.
- A preview lists output text, selected pack, target, warnings, and context receipt.
- Built-in safety requirements cannot be disabled accidentally through a compact control.

## Acceptance criteria

- Existing users retain Raw Dictation settings and workflow behavior after migration, with the documented boundary-aware dictionary correction.
- Packs switch without restart and persist locally.
- Invalid or future schema versions fail safely.
- Pack selection is deterministic and test-covered.
- Each output record names the selected pack revision.
- P1 ships without automatic application activation, application-derived processing context, repository scanning, cloud providers, or LLM processing. Opaque target equality remains available for safe insertion.
