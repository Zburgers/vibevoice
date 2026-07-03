import { Activity, BookOpen, Clipboard, History, Info, Wrench, Zap } from "lucide-react";
import type { AppState, Settings } from "../types";
import { Field, Toggle } from "../ui";

export function SettingsView({
  state,
  onUpdate,
  onSetup,
  onOpenDiagnostics,
}: {
  state: AppState;
  onUpdate: (patch: Partial<Settings>) => void;
  onSetup: () => void;
  onOpenDiagnostics: () => void;
}) {
  return (
    <section className="view settings-view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Paths, hotkey, and output.</h1>
        </div>
        <button type="button" className="secondary-action" onClick={onSetup}>
          <Wrench size={16} />
          <span>Run setup</span>
        </button>
      </div>

      <div className="settings-grid">
        <Field label="Whisper binary path" value={state.settings.whisper_binary_path} onChange={(value) => onUpdate({ whisper_binary_path: value })} />
        <Field label="Model path" value={state.settings.model_path} onChange={(value) => onUpdate({ model_path: value })} />
        <Field label="Hotkey" value={state.settings.hotkey} onChange={(value) => onUpdate({ hotkey: value })} />
        <label className="field">
          <span>Recording mode</span>
          <select value={state.settings.recording_mode} onChange={() => onUpdate({ recording_mode: "toggle" })}>
            <option value="toggle">Toggle recording</option>
          </select>
        </label>
      </div>

      <div className="toggle-grid">
        <Toggle icon={Zap} label="Auto paste" value={state.settings.auto_paste} onClick={() => onUpdate({ auto_paste: !state.settings.auto_paste })} />
        <Toggle icon={Clipboard} label="Clipboard fallback" value={state.settings.clipboard_fallback} onClick={() => onUpdate({ clipboard_fallback: !state.settings.clipboard_fallback })} />
        <Toggle icon={BookOpen} label="Dictionary cleanup" value={state.settings.dictionary_cleanup} onClick={() => onUpdate({ dictionary_cleanup: !state.settings.dictionary_cleanup })} />
        <Toggle icon={History} label="Save local history" value={state.settings.history_enabled} onClick={() => onUpdate({ history_enabled: !state.settings.history_enabled })} />
        <Toggle icon={Activity} label="Start on login" value={state.settings.start_on_login} onClick={() => onUpdate({ start_on_login: !state.settings.start_on_login })} />
        <button type="button" className="toggle as-link" onClick={onOpenDiagnostics}>
          <Info size={18} />
          <span>Diagnostics</span>
          <strong>Open</strong>
        </button>
      </div>
    </section>
  );
}
