import { Copy, RefreshCw, Wrench } from "lucide-react";
import type { AppState, Tone } from "../types";

export function DiagnosticsView({
  state,
  setupMessage,
  commandStatus,
  onRefresh,
  onSetup,
  onCopyCommand,
}: {
  state: AppState;
  setupMessage: string;
  commandStatus: string;
  onRefresh: () => void;
  onSetup: () => void;
  onCopyCommand: () => void;
}) {
  const rows: Array<{ label: string; value: string; tone: Tone; mono?: boolean }> = [
    { label: "Whisper binary", value: state.diagnostics.whisper_found ? "Found" : "Missing", tone: state.diagnostics.whisper_found ? "good" : "bad" },
    { label: "Model file", value: state.diagnostics.model_found ? "Found" : "Missing", tone: state.diagnostics.model_found ? "good" : "bad" },
    { label: "Microphone", value: state.diagnostics.mic_available ? "Available" : "Unavailable", tone: state.diagnostics.mic_available ? "good" : "bad" },
    { label: "Recorder", value: state.diagnostics.recorder || "Unavailable", tone: state.diagnostics.recorder ? "good" : "bad" },
    { label: "Input device", value: state.diagnostics.input_device || "System default unavailable", tone: state.diagnostics.input_device ? "good" : "warn" },
    { label: "Clipboard", value: state.diagnostics.clipboard_tool || "Missing", tone: state.diagnostics.clipboard_tool ? "good" : "bad" },
    { label: "Paste tool", value: state.diagnostics.paste_tool || "Missing", tone: state.diagnostics.paste_tool ? "good" : "warn" },
    { label: "Resolved binary", value: state.diagnostics.whisper_path || "Not resolved", tone: state.diagnostics.whisper_path ? "good" : "warn", mono: true },
    { label: "Resolved model", value: state.diagnostics.model_path || "Not resolved", tone: state.diagnostics.model_path ? "good" : "warn", mono: true },
  ];

  return (
    <section className="view diagnostics-view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Diagnostics</div>
          <h1>Engine, microphone, and desktop tools.</h1>
        </div>
        <div className="action-row tight">
          <button type="button" className="secondary-action" onClick={onRefresh}>
            <RefreshCw size={16} />
            <span>Refresh</span>
          </button>
          <button type="button" className="primary-action" onClick={onSetup}>
            <Wrench size={16} />
            <span>Run setup</span>
          </button>
        </div>
      </div>

      <div className="diagnostics-grid">
        <div className="diag-list">
          {rows.map((row) => (
            <div className="diag-row" key={row.label}>
              <span>{row.label}</span>
              <strong className={`tone-${row.tone} ${row.mono ? "mono" : ""}`}>{row.value}</strong>
            </div>
          ))}
        </div>

        <div className="side-stack">
          <article className="detail-block">
            <div className="block-head">
              <span>Setup command</span>
              <span>{state.diagnostics.platform}</span>
            </div>
            <p className="mono">{state.diagnostics.setup_command || "Setup script not found."}</p>
            <div className="action-row">
              <button type="button" className="secondary-action" disabled={!state.diagnostics.setup_command} onClick={onCopyCommand}>
                <Copy size={16} />
                <span>Copy command</span>
              </button>
            </div>
          </article>

          <article className="detail-block">
            <div className="block-head">
              <span>Setup log</span>
              <span>{commandStatus}</span>
            </div>
            <p className="mono">{setupMessage}</p>
          </article>

          <article className="version-strip">
            <span>Version {state.app_version}</span>
            <strong>Source updates are handled outside the app.</strong>
          </article>
        </div>
      </div>
    </section>
  );
}
