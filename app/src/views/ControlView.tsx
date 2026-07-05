import { Activity, Copy, ExternalLink, Keyboard, RotateCcw, ShieldCheck, SlidersHorizontal, Wrench, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import vibevoiceIcon from "../assets/vibevoice-icon.png";
import { actionLabel, phaseCopy, phaseTone } from "../types";
import type { AppState, Phase } from "../types";
import { Metric, MicVisualizer, StatusChip } from "../ui";

export function ControlView({
  state,
  phase,
  commandStatus,
  recordingSeconds,
  primaryDisabled,
  ActionIcon,
  onPrimary,
  onCopy,
  onPaste,
  onSetup,
  onOpenReleasePage,
  onOpenSettings,
}: {
  state: AppState;
  phase: Phase;
  commandStatus: string;
  recordingSeconds: number;
  primaryDisabled: boolean;
  ActionIcon: LucideIcon;
  onPrimary: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onSetup: () => void;
  onOpenReleasePage: () => void;
  onOpenSettings: () => void;
}) {
  const tone = phaseTone[phase];
  return (
    <section className="view control-view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Control</div>
          <h1>Speak into the focused app.</h1>
        </div>
        <StatusChip phase={phase} />
      </div>

      <div className={`control-surface tone-${tone}`}>
        <div className="record-orb">
          <img src={vibevoiceIcon} alt="" aria-hidden="true" />
          <span className="record-ring" />
        </div>
        <div className="record-copy">
          <span className="record-label">{phaseCopy[phase]}</span>
          <strong>{state.voice_state === "Recording" ? `${recordingSeconds}s` : state.settings.hotkey}</strong>
          <MicVisualizer level={state.mic_level} active={state.voice_state === "Recording"} />
        </div>
        <button type="button" className={`primary-action large tone-${tone}`} disabled={primaryDisabled} onClick={onPrimary}>
          <ActionIcon size={19} className={state.voice_state === "Preparing" || state.voice_state === "Processing" ? "spin" : ""} />
          <span>{actionLabel(state.voice_state)}</span>
        </button>
      </div>

      <div className="quick-grid">
        <Metric icon={Zap} label="Output" value={state.settings.auto_paste ? "Auto paste" : "Clipboard only"} />
        <Metric icon={ShieldCheck} label="Engine" value={state.diagnostics.whisper_found && state.diagnostics.model_found ? "Ready" : "Setup needed"} />
        <Metric icon={Keyboard} label="Hotkey" value={state.settings.hotkey} />
        <Metric icon={Activity} label="Recorder" value={state.diagnostics.recorder || "Unavailable"} />
      </div>

      <div className="action-row">
        <button type="button" className="secondary-action" onClick={onCopy}>
          <Copy size={16} />
          <span>Copy transcript</span>
        </button>
        <button type="button" className="secondary-action" onClick={onPaste}>
          <RotateCcw size={16} />
          <span>Paste again</span>
        </button>
        {state.diagnostics.setup_available ? (
          <button type="button" className="secondary-action" onClick={onSetup}>
            <Wrench size={16} />
            <span>Run setup</span>
          </button>
        ) : (
          <button type="button" className="secondary-action" onClick={onOpenReleasePage}>
            <ExternalLink size={16} />
            <span>Install guide</span>
          </button>
        )}
        <button type="button" className="ghost-button" onClick={onOpenSettings}>
          <SlidersHorizontal size={16} />
          <span>Settings</span>
        </button>
      </div>

      <article className={`transcript-block ${state.last_error ? "has-error" : ""}`}>
        <div className="block-head">
          <span>Last transcript</span>
          <span>{commandStatus}</span>
        </div>
        <p>{state.last_error || state.last_transcript || "No transcript captured yet."}</p>
      </article>
    </section>
  );
}
