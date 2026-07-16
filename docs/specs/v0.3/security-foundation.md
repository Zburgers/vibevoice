# Tauri Security Foundation Specification

**Status:** Proposed
**Phase:** P0
**Blocks:** Context capture
**Tracks:** Issue [#33](https://github.com/Zburgers/vibevoice/issues/33)

## Current state

The Tauri CSP is disabled. One capability targets both `main` and `pill` and grants clipboard writes, process restart, updater access, and broad window operations. The pill is a transparent always-on-top control surface and does not require the main window's privilege set.

## Goals

- Enforce a production CSP.
- Separate main and pill capabilities by least privilege.
- Restrict privileged custom commands by caller window.
- Keep network access explicit and minimal.
- Prevent context features from expanding native privileges silently.

## Plugin and core capability split

```text
main.json
- normal main-window controls
- updater and restart
- diagnostics, settings, history, and pack commands

pill.json
- drag, size, visibility, focus, and always-on-top
- start and stop recording
- open main window
- restricted reinsert-last-transcript operation if retained
```

The pill must not accept arbitrary text for privileged clipboard or insertion commands. A reinsert action should request backend-owned last-transcript state rather than pass attacker-controlled text from the renderer.

Clipboard access remains backend-owned in P0; neither renderer receives direct clipboard plugin permission. Audit and replace `core:default` with an explicit core allowlist for each window so the split is genuinely least privilege.

## CSP contract

Development and packaged production have different needs. The production policy starts from:

```text
default-src 'self';
object-src 'none';
base-uri 'none';
frame-ancestors 'none';
```

Add only the script, style, image, font, IPC, updater, and asset sources proven necessary by packaged builds. Development-server allowances must not widen production policy.

Inline styles or scripts should be removed or explicitly justified. Navigation to arbitrary remote content is not allowed in either renderer.

## Custom command authorization

Direct frontend calls to updater, process restart, and core window APIs are controlled by Tauri plugin/core capabilities. Rust caller checks cannot replace those ACLs.

Plugin capability files do not automatically protect application-defined Rust commands. Privileged custom commands must inspect the invoking window label or use generated command-specific ACLs.

At minimum, caller checks apply to:

- Settings writes
- History reads and deletion
- Diagnostics details
- Clipboard read/write
- Context collection
- Pack and hotkey changes

## Context permissions

Context providers remain unavailable until the selected pack policy, application exclusion policy, and caller authorization all permit the source. A renderer cannot bypass backend policy by invoking a lower-level collection command.

## Regression controls

- Capability files use explicit window labels.
- An automated check rejects updater, restart, arbitrary clipboard, and unrelated window controls in the pill capability.
- A packaged-build smoke test verifies the production CSP.
- New native permissions require a documentation update explaining the workflow and window.
- Context collection has deny-by-default tests.

## Acceptance criteria

- Production CSP is non-null and validated in packaged builds.
- Main and pill use separate capabilities.
- Pill cannot invoke updater, restart, arbitrary clipboard operations, settings writes, or history reads.
- Privileged application commands enforce caller identity.
- Windows, Linux, and macOS builds remain functional.
- Issue `#33` can close with configuration diff, tests, and packaged-build evidence.
