import { Activity, Copy, ExternalLink, Keyboard, Mic, RotateCcw, ShieldCheck, SlidersHorizontal, Wrench, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import vibevoiceIcon from "../assets/vibevoice-icon.png";
import { actionLabel, phaseTone } from "../types";
import type { AppState, Phase } from "../types";
import { Metric, MicVisualizer, StatusChip } from "../ui";
import { TranscriptContent } from "../TranscriptContent";

const sessionCopy: Record<Phase, { title: string; detail: string }> = {
  ready: { title: "Ready when you are.", detail: "Record your voice, then send your words to the focused app." },
  preparing: { title: "Opening your microphone.", detail: "Your recording will begin in a moment." },
  recording: { title: "Listening to you.", detail: "Stop recording when you’re finished speaking." },
  transcribing: { title: "Turning voice into text.", detail: "Transcribing locally on your device." },
  inserted: { title: "Your words are in.", detail: "Transcript inserted into the focused app. Ready for the next thought." },
  copied: { title: "Ready to paste.", detail: "Transcript copied to your clipboard." },
  error: { title: "Let’s try that again.", detail: "Check the error below, then retry your recording." },
};

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
  const recording = state.voice_state === "Recording";
  const session = phase === "error" && state.last_transcript
    ? { title: "Your last transcript is available.", detail: "Copy or retry your saved words, and check the error below before recording again." }
    : sessionCopy[phase];
  const hasTranscript = Boolean(state.last_transcript);
  const outputDisabled = !hasTranscript || ["Preparing", "Recording", "Processing"].includes(state.voice_state);
  const timer = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`;
  return (
    <section className="view control-view">
      <div className="view-head control-head">
        <div>
          <div className="eyebrow">Control</div>
          <h1>Speak into the focused app.</h1>
        </div>
        <StatusChip phase={phase} />
      </div>

      <div className={`control-surface tone-${tone}`}>
        <div className="session-topline">
          <span className="session-label"><Mic size={14} aria-hidden="true" /> Voice session</span>
          <span className="session-local">On-device transcription</span>
        </div>
        <div className="record-copy">
          <h2>{session.title}</h2>
          <p>{session.detail}</p>
          <div className="session-action">
            <button type="button" className={`primary-action large tone-${tone}`} disabled={primaryDisabled} onClick={onPrimary}>
              <ActionIcon size={18} aria-hidden="true" className={state.voice_state === "Preparing" || state.voice_state === "Processing" ? "spin" : ""} />
              <span>{actionLabel(state.voice_state)}</span>
            </button>
            {recording && <span className="session-timer" aria-label={`Recording duration: ${recordingSeconds} seconds`}>{timer}</span>}
          </div>
        </div>
        <div className={`session-meter ${recording ? "is-recording" : ""}`} aria-hidden="true">
          <img src={vibevoiceIcon} alt="" draggable={false} />
          <MicVisualizer bands={state.mic_bands} active={recording} />
          <span>{recording ? "Live spectrum · low → high" : "Voice → text"}</span>
        </div>
        <div className="session-shortcut">
          <span><Keyboard size={15} aria-hidden="true" /> Keyboard shortcut</span>
          <div className="shortcut-keys" role="group" aria-label={state.settings.hotkey}>
            {state.settings.hotkey.split("+").map((key, index) => (
              <span className="shortcut-key" key={`${key}-${index}`}>
                {index > 0 && <span className="shortcut-plus" aria-hidden="true">+</span>}
                <kbd>{key.trim()}</kbd>
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="quick-grid control-details">
        <Metric icon={Zap} label="Output" value={state.settings.auto_paste ? "Auto paste" : state.settings.clipboard_fallback ? "Clipboard only" : "Saved transcript"} />
        <Metric icon={ShieldCheck} label="Engine" value={state.diagnostics.whisper_found && state.diagnostics.model_found ? "Ready" : "Setup needed"} />
        <Metric icon={Activity} label="Recorder" value={state.diagnostics.recorder || "Unavailable"} />
      </div>

      <div className="action-row control-tools">
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

      <article className={`transcript-block control-transcript ${state.last_error ? "has-error" : ""}`} aria-labelledby="last-transcript-title">
        <div className="block-head transcript-heading">
          <h2 id="last-transcript-title">Last transcript</h2>
          <div className="action-row">
            <button type="button" className="ghost-button" disabled={outputDisabled} onClick={onCopy}>
              <Copy size={15} aria-hidden="true" />
              <span>Copy transcript</span>
            </button>
            <button type="button" className="ghost-button" disabled={outputDisabled} onClick={onPaste}>
              <RotateCcw size={15} aria-hidden="true" />
              <span>{state.voice_state === "Inserted" ? "Paste again" : "Retry insertion"}</span>
            </button>
          </div>
        </div>
        <div className={`transcript-content ${!hasTranscript && !state.last_error ? "is-empty" : ""}`}>
          {!hasTranscript && !state.last_error && <Mic size={22} aria-hidden="true" />}
          <TranscriptContent transcript={state.last_transcript} error={state.last_error} />
          {!hasTranscript && !state.last_error && <span>Start a recording to see your words here.</span>}
        </div>
        <div className="transcript-feedback" role="status">{commandStatus}</div>
      </article>
    </section>
  );
}
