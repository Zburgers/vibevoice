import { ChevronDown, Copy, GripVertical, Home, RotateCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";
import vibevoiceIcon from "./assets/vibevoice-icon.png";
import { phaseCopy, phaseTone } from "./types";
import type { AppState, Phase } from "./types";
import { MicVisualizer } from "./ui";

export function PillWindow({
  state,
  phase,
  expanded,
  lastText,
  recordingSeconds,
  primaryDisabled,
  ActionIcon,
  flipX,
  flipY,
  onToggleExpanded,
  onCollapse,
  onDrag,
  onPrimary,
  onCopy,
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
  /** When true, the expanded panel opens to the LEFT (pill is in the right portion of screen) */
  flipX?: boolean;
  /** When true, the expanded panel opens UPWARD (pill is in the bottom portion of screen) */
  flipY?: boolean;
  onToggleExpanded: () => void;
  onCollapse: () => void;
  onDrag: (event: MouseEvent<HTMLElement>) => void;
  onPrimary: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onOpenMain: () => void;
}) {
  const tone = phaseTone[phase];
  return (
    <main
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
      className={`floating-shell ${expanded ? "is-expanded" : ""} ${flipX ? "flip-x" : ""} ${flipY ? "flip-y" : ""}`}
    >
      <div className="pill-anchor">
        {!expanded && (
          <button
            type="button"
            className="pill-grip-floating"
            onMouseDown={onDrag}
            aria-label="Move pill"
            title="Move"
          >
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
            <img className="pill-icon" draggable={false} src={vibevoiceIcon} alt="" aria-hidden="true" />
            <span className="pill-dot" />
          </span>
          {(
            <>
              <span className="pill-copy">
                <span className="pill-title">{phaseCopy[phase]}</span>
                <span className="pill-subtitle">{state.voice_state === "Recording" ? `${recordingSeconds}s` : state.settings.hotkey}</span>
              </span>
              <MicVisualizer bands={state.mic_bands} active={state.voice_state === "Recording"} compact />
            </>
          )}
        </button>

        {expanded && (
        <section className="pill-panel" aria-live="polite">
          <div className="pill-panel-top">
            <button type="button" className="icon-button is-drag" onMouseDown={onDrag} aria-label="Move pill" title="Move">
              <GripVertical size={15} />
            </button>
            <span className="pill-panel-label">Voice controls</span>
            <button type="button" className="icon-button" onClick={onCollapse} aria-label="Collapse" title="Collapse">
              <ChevronDown size={16} />
            </button>
          </div>

          <div className="pill-transcript-heading">
            <div className="pill-transcript-label">Latest transcript</div>
            <button type="button" className="pill-copy-button" disabled={!state.last_transcript} onClick={onCopy} aria-label="Copy transcript" title="Copy transcript">
              <Copy size={14} />
              <span>Copy</span>
            </button>
          </div>
          <div className="pill-transcript" tabIndex={0}>{lastText}</div>

          <div className="pill-actions">
            <button type="button" className={`primary-action tone-${tone}`} disabled={primaryDisabled} onClick={onPrimary}>
              <ActionIcon size={16} className={state.voice_state === "Preparing" || state.voice_state === "Processing" ? "spin" : ""} />
              <span>{state.voice_state === "Recording" ? "Stop" : state.voice_state === "Preparing" ? "Cancel start" : state.voice_state === "Processing" ? "Cancel" : state.voice_state === "Error" ? "Retry" : "Record"}</span>
            </button>
            <button type="button" className="secondary-action" disabled={!state.last_transcript || ["Preparing", "Recording", "Processing"].includes(state.voice_state)} onClick={onPaste}>
              <RotateCcw size={15} />
              <span>Paste</span>
            </button>
            <button type="button" className="icon-action" onClick={onOpenMain} aria-label="Open app" title="Open app">
              <Home size={16} />
            </button>
          </div>
        </section>
        )}
      </div>
    </main>
  );
}
