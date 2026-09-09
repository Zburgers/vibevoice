# VibeVoice issue tracker

This file records the repository-side status for the 0.2.7 stabilization work. GitHub issues remain open until the pull request is merged and the release gates are complete.

## 0.2.7 stabilization

### #15 — UI text and icons disappear after transcription

- Status: addressed on `fix/vibevoice-0.2.7-stabilization`; release-gate verification pending.
- Change: stale state refreshes can no longer overwrite a newer render, event-listener cleanup handles async registration races, and jsdom coverage exercises repeated pill transitions.
- Evidence: `npm --prefix app run build`, `npm --prefix app test`, and packaged Tauri debug build pass. A real 10-cycle Linux recording smoke test still requires a display, microphone, whisper binary, and model.

### #34 — SemVer precedence for updater fallback

- Status: addressed.
- Change: maintained `semver` parsing/comparison validates stable versions, prereleases, build metadata, leading `v`, and malformed tags. Malformed values produce an updater error state instead of an installable/current claim.
- Evidence: focused SemVer matrix tests pass.

### #8 — Copy diagnostics report

- Status: addressed.
- Change: added a typed backend report and Diagnostics action using backend clipboard access. The report includes platform, engine/model, recorder/input device, clipboard/paste adapters, updater enum, and categorized errors while excluding transcripts, history, clipboard text, vocabulary, and raw errors.
- Evidence: native redaction test and frontend build/tests pass.

### #33 — CSP and pill capability isolation

- Status: addressed.
- Change: replaced the shared capability with audited `main.json` and `pill.json` policies, removed `core:default`, added caller-window authorization, and configured packaged CSP.
- Evidence: capability-policy test, `tauri info`, and Tauri debug build pass.

### Resize cursor defect

- Status: addressed on this branch; no separate open GitHub issue existed. Related historical resize issue #19 is already closed.
- Change: native Tauri cursor icons are set on enter/leave for all eight edge/corner handles, with matching CSS fallback and existing resize dragging retained.
- Evidence: mapping is covered by the implementation; manual eight-handle verification remains a release-gate task in a graphical desktop session.

## Safe follow-up candidates

- #11 model selection and engine health UI: bounded settings/diagnostics work, independent of the stabilization changes.
- #10 post-processing presets: bounded local transformation work with deterministic Rust tests.
- #12 recording profiles: larger but still safe after #10, because it composes existing settings and cleanup behavior.

These follow-ups should remain separate from the 0.2.7 stabilization PR and should not be started until the release-gate verification is complete unless explicitly requested.
