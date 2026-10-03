import { Download, ShieldCheck } from "lucide-react";
import type { AppState, WhisperProgress } from "./types";

export function WhisperUpdatePanel({ state, progress, pending, onUpdate, onCancel }: {
  state: AppState;
  progress: WhisperProgress | null;
  pending: boolean;
  onUpdate: (component: "engine" | "model") => void;
  onCancel: () => void;
}) {
  const catalog = state.whisper_update;
  const busy = pending || Boolean(catalog?.busy);
  const recording = ["Preparing", "Recording", "Processing"].includes(state.voice_state);
  const disabled = busy || recording || !catalog;
  return (
    <article className="detail-block whisper-components">
      <div className="block-head"><span>Whisper components</span><ShieldCheck size={16} /></div>
      <p>Recommended engine: {catalog ? `Whisper ${catalog.engine_version}` : "Open the desktop app"}. Default model: {catalog?.model_name ?? "base.en"}.</p>
      <p>Update the engine separately from the model. Model verification repairs or selects the default English model; valid weights need no download.</p>
      <div className="action-row">
        <button type="button" className="secondary-action" disabled={disabled || !catalog?.engine_supported} onClick={() => onUpdate("engine")}>
          <Download size={16} /><span>Update Whisper engine</span>
        </button>
        <button type="button" className="secondary-action" disabled={disabled} onClick={() => onUpdate("model")}>
          <ShieldCheck size={16} /><span>Verify / repair model</span>
        </button>
        {busy && <button type="button" className="secondary-action" onClick={onCancel}>Cancel update</button>}
      </div>
      {catalog && !catalog.engine_supported && <p>Automatic engine updates support Windows x64 and ARM64. Use manual engine setup on this platform.</p>}
      {recording && <p>Finish recording and transcription before updating.</p>}
      {busy && progress && progress.total_bytes > 0 && <progress aria-label="Whisper download progress" max={progress.total_bytes} value={progress.downloaded_bytes} />}
      {progress && <p role="status" aria-live="polite">{progress.message}</p>}
    </article>
  );
}
