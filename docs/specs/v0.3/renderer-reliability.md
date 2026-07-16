# Renderer Reliability Specification

**Status:** Proposed
**Phase:** P0
**Tracks:** Issue [#15](https://github.com/Zburgers/vibevoice/issues/15)

## Problem

Text, icons, or backgrounds can disappear after repeated transcription cycles while controls remain clickable. The symptom suggests a paint, compositing, transparency, or renderer-state defect rather than a simple unmount.

Context Pack UI must not land on this unstable surface.

## Current surfaces

- Main renderer and event subscriptions: `app/src/App.tsx`
- Pill renderer: `app/src/PillWindow.tsx`
- Shared shell and transparent styles: `app/src/App.css`
- Transparent and undecorated window configuration: `app/src-tauri/tauri.conf.json`
- Broad `vibevoice-state-changed` refresh path in `App.tsx`
- Already-granular `vibevoice-meter-changed` path in `App.tsx`

## Investigation contract

Instrument before choosing a fix:

- React render and state transitions
- Event-listener attachment and cleanup counts
- Window visibility, position, and size
- CSS class and variable state
- Transparent-root and background state
- GPU and compositor information
- Memory growth across repeated cycles

Determine whether the failure affects main, pill, or both and whether it correlates with a display server, scale, GPU, or focus transition.

## Automated state-cycle harness

Drive the renderer deterministically through:

```text
Ready
-> Preparing
-> Recording
-> Processing
-> Inserted
-> Ready
```

The harness also covers:

- Pill expand and collapse
- Pill drag and monitor-edge placement
- Main-window resize and focus changes
- Meter updates
- Copied and Error voice states with target-changed and paste-failed insertion-result fixtures
- Error recovery

DOM/jsdom assertions cover React state and listener regressions only. At least one real packaged WebView/window harness must capture screenshots and compare visible labels, icons, backgrounds, and controls. Closing issue `#15` requires native compositor evidence on affected platforms; DOM presence alone is insufficient.

## Manual platform matrix

- Windows
- macOS Apple Silicon
- Linux X11
- Linux Wayland
- 100%, 125%, 150%, and 200% display scale where supported
- Single and multiple monitors

Manual release QA includes at least 10 real record/transcribe/insert cycles per release platform plus pill expand, collapse, and drag.

## Acceptance criteria

- No disappearing content across 500 automated state cycles.
- At least 10 real transcription cycles pass on each release platform.
- Pill content remains visible at monitor edges and supported display scales.
- No duplicate event subscriptions or unbounded renderer memory growth.
- The fix records a supported root-cause explanation and regression coverage.
- Issue `#15` closes before Context Pack UI work begins.
