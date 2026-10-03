# VibeVoice issue tracker

This file records repository-side release truth and points to the canonical GitHub backlog. The 0.2.7 stabilization below remains historical evidence; 0.2.8 additions are summarized separately. Open feature work remains tracked in GitHub rather than duplicated here.

## Current open GitHub backlog

Audited 2026-10-04 during 0.2.8 publication preparation. GitHub issue bodies and acceptance criteria are authoritative; this index is intentionally concise and should be updated when an issue's status changes.

| Issue | Status | Scope |
| --- | --- | --- |
| [#10](https://github.com/Zburgers/vibevoice/issues/10) | Open future work | Deterministic cleanup presets and context-aware output profiles |
| [#11](https://github.com/Zburgers/vibevoice/issues/11) | Partially delivered | Automatic/Custom model selection and health checks in 0.2.8; model discovery, in-app benchmarking, and profile selection remain |
| [#12](https://github.com/Zburgers/vibevoice/issues/12) | Open future work | Recording profiles for context-safe dictation workflows |
| [#36](https://github.com/Zburgers/vibevoice/issues/36) | Partially delivered | 0.2.8 adds native clipboard preservation checks, macOS paste, recovery and warning semantics; target/focus verification and desktop acceptance remain |
| [#37](https://github.com/Zburgers/vibevoice/issues/37) | Open future work | Reviewable adaptive developer vocabulary and import/export |
| [#38](https://github.com/Zburgers/vibevoice/issues/38) | Open future work | Explicit spoken punctuation, layout, and literal-mode commands |
| [#39](https://github.com/Zburgers/vibevoice/issues/39) | Partially delivered | Measured frequency feedback and bounded audio handoff in 0.2.8; silence/clipping preflight, input selection and overrides remain |
| [#40](https://github.com/Zburgers/vibevoice/issues/40) | Open future work | Latest-transcript correction loop and safe dictionary suggestions |
| [#41](https://github.com/Zburgers/vibevoice/issues/41) | Partially delivered | 0.2.8 adds verified Windows engine and cross-platform default model updates, progress/cancel and preserved old files; disk-space handling, explicit rollback/removal and wider installation acceptance remain |
| [#42](https://github.com/Zburgers/vibevoice/issues/42) | Partially delivered | Preparation cancellation and clearer controls in 0.2.8; screen-reader/reduced-motion coverage, recording safeguards and complete keyboard acceptance remain |
| [#43](https://github.com/Zburgers/vibevoice/issues/43) | Open future work | Bounded voice-command mode with preview and confirmation |
| [#44](https://github.com/Zburgers/vibevoice/issues/44) | Open future work | Opt-in local privacy-preserving transcription telemetry |
| [#45](https://github.com/Zburgers/vibevoice/issues/45) | Open cross-repository work | Lightweight VibeVoice and mdview profile demonstration assets |
| [#68](https://github.com/Zburgers/vibevoice/issues/68) | Packaging fix integrated | RPM/DEB/AppImage icons and AppStream metadata from #70; inspect final tagged packages and verify Fedora graphical presentation |

Completed stabilization issues are intentionally not recreated or duplicated in this backlog; their shipped status and evidence are recorded below and in their GitHub history.

## 0.2.8 release work

[Release notes](releases/v0.2.8.md) identify the delivered features and link merged PRs #69–#77. PR #77 merged into master at `02a1c58f457a1df701ad94c5afd2935096723cea`; all six checks passed on that exact merge. Release publication is tag-driven and separate from the merge.

Issue #68's missing packaged metadata/icon is addressed by #70. The earlier Linux fixture reused a 0.2.7 binary and remains metadata evidence only; the protected 0.2.8 workflow produces current-source packages. Broader issues #11, #36, #39, #41, #42 and #44 are related to this release but are not closed by partial feature delivery. The canonical GitHub issue state takes precedence over this index.

## 0.2.7 stabilization

### #15 — UI text and icons disappear after transcription

- Status: shipped in `v0.2.7` and present on `master`.
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

### Pill HUD edge and corner overflow

- Status: shipped in `v0.2.7` and present on `master`.
- Change: expansion moves the native window into the active monitor work area before resizing, clamps both axes using physical dimensions, reconciles the actual outer size, and rejects stale layout requests.
- Source: `origin/agent/fix-pill-edge-positioning-0.2.7` (`4479a69`).

### Transactional insertion timeout cleanup

- Status: shipped in `v0.2.7` and present on `master`.
- Change: paste helpers time out after two seconds and are killed/reaped, concurrent clipboard operations serialize, failed insertion restores the prior text when possible, and structured insertion results flow through history and the retry UI. Legacy history entries receive safe defaults.
- Evidence: Rust unit suite `18 passed`; frontend suite `5 passed`; frontend production build passed.

## 0.2.7 WP1–WP4 scope (shipped tag `v0.2.7`, commit `6f198176`)

Integration order: WP1 (`b5179d1` transcription timeout/cancel port of `fix/issue-48-transcription-timeout`)
→ WP2 (`d5b6016`) → WP4 (`3af6285`) → WP3 (`bd16e2c`, cherry-picked cleanly as `70a0c76`;
disjoint files, no semantic conflicts). Shutdown architecture (#58), timeout/cancel (#48),
artifact ownership (#47), preparation cancellation (#50), child-process shutdown (#51),
safe opener (#52), Unicode dictionary (#53), and clear-history semantics (#54) all verified
present on the shipped tag and reconciled `master`.

### #47 — stale recording artifact ownership

- Status: shipped in `v0.2.7`. Per-process ownership (`recording-<pid>-<uuid>.wav` + `.txt` companion),
  conservative stale-age reconciliation for legacy/own-pid files, live files never deleted,
  `0700` workspace, best-effort startup reclaim, malformed names ignored.
- Evidence: 9 focused Rust groups green on the shipped candidate (stale+companion, live/recent,
  malformed, error path, legacy stale, post-crash, `0700`, dead-owner reclaim, artifact cleanup).

### #48 — transcription timeout and cancellation

- Status: shipped in `v0.2.7`. Configurable timeout (default 900 s, clamped 30–1800 s), user-visible
  cancel during Processing, process-group termination on Unix (`CREATE_NEW_PROCESS_GROUP` on
  Windows), shutdown-aware cancellation.
- Evidence: 8 focused Rust groups green on the shipped candidate (timeout kill+reap, cancellation kill+reap,
  grandchild-group termination, cancel flag, shutdown cancel, default/persist/normalize settings).

### #50 — prepare-stop race

- Status: shipped in `v0.2.7`. Generation-based pending-start ownership: fresh generation per start,
  stop during Preparing invalidates and returns Ok, late workers discard (stop/clean audio,
  never install), stale failures harmless, shutdown invalidates, no mutex across blocking audio.
- Evidence: 9 focused `wp4_` preparation groups green on the shipped candidate.

### #51 — shutdown child reaping

- Status: shipped in `v0.2.7`. PR #58 path kept; recorder spawns in its own process group; stop does
  graceful SIGINT then group-SIGKILL sweep (including on graceful exit); reap on every path.
- Evidence: 6 focused `wp4_` shutdown/reaping groups green on the shipped candidate (group kill incl. grandchild,
  SIGINT-ignoring fixture, normal-exit reap, stop-then-quit, shutdown-during-recording,
  artifact cleanup on shutdown) plus `terminate_process_tree`, `shutdown_flag_*`,
  `paste_helper_timeout` groups.

### #52 — safe release-page opener

- Status: shipped in `v0.2.7`. Native `opener().open_url` (no shell), strict canonical
  releases/tag/download URL allow-list, opener plugin init + capability allow-list.
- Evidence: 4 focused `release_url_*` groups green on the shipped candidate.

### #53 — Unicode-safe dictionary cleanup

- Status: shipped in `v0.2.7`. Folded-char ranges from `char_indices`; no byte offsets from
  transformed strings.
- Evidence: 5 focused `dictionary_*` groups green on the shipped candidate (İ, combining marks, non-ASCII,
  ASCII/overlap, ordering).

### #54 — clear-history privacy semantics

- Status: shipped in `v0.2.7`. `write_history(&[])` clears active+backup, then removes only regular
  `history.corrupt-*.json` files with actionable errors.
- Evidence: `clear_history_helper_removes_only_corrupt_copies`,
  `corrupt_history_cleanup_reports_missing_directory_actionably`,
  `corrupt_history_matcher_requires_exact_contract` green.

### #55 — supply-chain/release hardening

- Status: shipped in `v0.2.7`. All Actions SHA-pinned, least-privilege permissions, no manual dispatch,
  fail-closed version/tag/Cargo/Tauri consistency (bare-`v` guard), tag ruleset + master
  ruleset + `release` environment limiting publishing to protected refs.
- Evidence: `actionlint` clean; consistency probe 4/4 scenarios on the shipped candidate
  (matching tag passes, bare `v` fails closed, mismatched tag fails closed, master passes).

### #56 — dependency hygiene

- Status: shipped in `v0.2.7`. Minimal lockfile bumps (nanoid, postcss, vitest), `npm audit
  --audit-level=high` reports 0 vulnerabilities, frontend tests 6/6, production build green.

### #36 — transactional insertion (stabilization subset only)

- Status: partially delivered. 0.2.7 ships exactly: 2-second paste-helper timeout with
  kill/reap, serialized clipboard transactions, failed-insertion clipboard restore when
  possible, structured insertion reports through history and retry UI, safe defaults for
  legacy history entries. The broader #36 feature is NOT claimed complete; remaining
  acceptance work stays open.

### #41 — engine/model lifecycle (installer-integrity subset only)

- Status: partially delivered. 0.2.7 ships exactly: immutable whisper commit + model revision,
  SHA-256 verification, custom-model digest requirement, case normalization, tmp-staging with
  verify-before-activate, Bash/PowerShell parity. No `Fixes #41` closure claim exists anywhere
  in the tree; the full engine/model lifecycle remains open.

## Safe follow-up candidates

- #11 model selection and engine health UI: bounded settings/diagnostics work, independent of the stabilization changes.
- #10 post-processing presets: bounded local transformation work with deterministic Rust tests.
- #12 recording profiles: larger but still safe after #10, because it composes existing settings and cleanup behavior.

These follow-ups remain separate from the shipped 0.2.7 stabilization and should not be started as part of reconciliation unless explicitly requested.
