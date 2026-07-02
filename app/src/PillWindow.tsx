import { ChevronDown, GripVertical, Home, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import vibevoiceIcon from "./assets/vibevoice-icon.png";
import { phaseCopy, phaseTone } from "./types";
import type { AppState, Phase } from "./types";
import { MicVisualizer, StatusChip } from "./ui";

export function PillWindow({
  state,
  phase,
  expanded,
  lastText,
  recordingSeconds,
  primaryDisabled,
  ActionIcon,
  onToggleExpanded,
  onCollapse,
  onDrag,
  onPrimary,
  onPaste,
  onOpenMain,
}: {
  state: AppState;
  phase: Phase;
  expanded: boolean;
  lastText: string;
  recordingSeconds: number;
  primaryDisabled: boolean;
  ActionIcon: LucideIcon;
  onToggleExpanded: () => void;
  onCollapse: () => void;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
  onPrimary: () => void;
  onPaste: () => void;
  onOpenMain: () => void;
}) {
  const tone = phaseTone[phase];
  return (
    <main className={`floating-shell ${expanded ? "is-expanded" : ""}`}>
      {!expanded && (
        <button type="button" className="pill-grip-floating" onMouseDown={onDrag} aria-label="Move pill" title="Move">
          <GripVertical size={13} strokeWidth={2.5} />
        </button>
      )}

      <button
        type="button"
        className={`voice-pill tone-${tone}`}
        onClick={onToggleExpanded}
        aria-expanded={expanded}
        aria-label={`${phaseCopy[phase]}. Open controls.`}
      >
        <span className="pill-mark">
          <img className="pill-icon" src={vibevoiceIcon} alt="" aria-hidden="true" />
          <span className="pill-dot" />
        </span>
        {expanded && (
          <>
            <span className="pill-copy">
              <span className="pill-title">{phaseCopy[phase]}</span>
              <span className="pill-subtitle">{state.voice_state === "Recording" ? `${recordingSeconds}s` : state.settings.hotkey}</span>
            </span>
            <MicVisualizer level={state.mic_level} active={state.voice_state === "Recording"} compact />
          </>
        )}
      </button>

      {expanded && (
        <section className="pill-panel" aria-live="polite">
          <div className="pill-panel-top">
            <button type="button" className="icon-button is-drag" onMouseDown={onDrag} aria-label="Move pill" title="Move">
              <GripVertical size={15} />
            </button>
            <StatusChip phase={phase} />
            <button type="button" className="icon-button" onClick={onCollapse} aria-label="Collapse" title="Collapse">
              <ChevronDown size={16} />
            </button>
          </div>

          <div className="pill-transcript">{lastText}</div>

          <div className="pill-actions">
            <button type="button" className={`primary-action tone-${tone}`} disabled={primaryDisabled} onClick={onPrimary}>
              <ActionIcon size={16} className={state.voice_state === "Preparing" || state.voice_state === "Processing" ? "spin" : ""} />
              <span>{state.voice_state === "Recording" ? "Stop" : state.voice_state === "Error" ? "Retry" : "Record"}</span>
            </button>
            <button type="button" className="secondary-action" onClick={onPaste}>
              <RotateCcw size={15} />
              <span>Paste</span>
            </button>
            <button type="button" className="icon-action" onClick={onOpenMain} aria-label="Open app" title="Open app">
              <Home size={16} />
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
