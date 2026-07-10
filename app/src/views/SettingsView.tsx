import { useEffect, useRef, useState } from "react";
import { Activity, BookOpen, Clipboard, ExternalLink, History, Info, Keyboard, Pin, Wrench, Zap } from "lucide-react";
import type { AppState, Settings } from "../types";
import { Toggle } from "../ui";

/** Converts a KeyboardEvent into a canonical hotkey string like "Ctrl+Alt+Space" */
function keyEventToHotkey(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  const key = event.key;
  // Ignore lone modifiers
  if (["Control", "Alt", "Shift", "Meta", "AltGraph"].includes(key)) {
    return "";
  }
  // Normalize common keys
  const normalized =
    key === " " ? "Space"
    : key.length === 1 ? key.toUpperCase()
    : key;
  parts.push(normalized);
  return parts.join("+");
}

function HotkeyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState("");
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;

    function onKeyDown(event: KeyboardEvent) {
      event.preventDefault();
      event.stopPropagation();
      const hotkey = keyEventToHotkey(event);
      if (hotkey) {
        setPreview(hotkey);
      }
    }

    function onKeyUp(event: KeyboardEvent) {
      event.preventDefault();
      const hotkey = keyEventToHotkey(event);
      if (hotkey) {
        onChange(hotkey);
        setRecording(false);
        setPreview("");
        buttonRef.current?.blur();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, [recording, onChange]);

  // Cancel recording on Escape or click outside
  useEffect(() => {
    if (!recording) return;
    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setRecording(false);
        setPreview("");
      }
    }
    function onBlur() {
      setRecording(false);
      setPreview("");
    }
    window.addEventListener("keydown", onEscape, true);
    buttonRef.current?.addEventListener("blur", onBlur);
    const btn = buttonRef.current;
    return () => {
      window.removeEventListener("keydown", onEscape, true);
      btn?.removeEventListener("blur", onBlur);
    };
  }, [recording]);

  return (
    <label className="field">
      <span>Global Hotkey</span>
      <div className="hotkey-field">
        <span className="hotkey-display">
          {recording ? (preview || "Press your hotkey combo…") : value || "Not set"}
        </span>
        <button
          ref={buttonRef}
          type="button"
          className={`hotkey-record-btn ${recording ? "is-recording" : ""}`}
          onClick={() => {
            setRecording((r) => !r);
            setPreview("");
          }}
          title={recording ? "Cancel recording" : "Click then press your hotkey combo"}
        >
          <Keyboard size={14} />
          <span>{recording ? "Cancel" : "Record"}</span>
        </button>
      </div>
    </label>
  );
}

export function SettingsView({
  state,
  onUpdate,
  onSetup,
  onOpenReleasePage,
  onOpenDiagnostics,
}: {
  state: AppState;
  onUpdate: (patch: Partial<Settings>) => void;
  onSetup: () => void;
  onOpenReleasePage: () => void;
  onOpenDiagnostics: () => void;
}) {
  const [whisperPath, setWhisperPath] = useState(state.settings.whisper_binary_path);
  const [modelPath, setModelPath] = useState(state.settings.model_path);
  const updateRef = useRef(onUpdate);

  useEffect(() => {
    updateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    setWhisperPath(state.settings.whisper_binary_path);
  }, [state.settings.whisper_binary_path]);

  useEffect(() => {
    setModelPath(state.settings.model_path);
  }, [state.settings.model_path]);

  useEffect(() => {
    if (whisperPath === state.settings.whisper_binary_path) return;
    const timer = window.setTimeout(() => {
      updateRef.current({ whisper_binary_path: whisperPath });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [state.settings.whisper_binary_path, whisperPath]);

  useEffect(() => {
    if (modelPath === state.settings.model_path) return;
    const timer = window.setTimeout(() => {
      updateRef.current({ model_path: modelPath });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [modelPath, state.settings.model_path]);

  return (
    <section className="view settings-view">
      <div className="view-head">
        <div>
          <div className="eyebrow">Settings</div>
          <h1>Paths, hotkey, and output.</h1>
        </div>
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
      </div>

      <div className="settings-grid">
        <label className="field">
          <span>Whisper binary path</span>
          <input
            value={whisperPath}
            onChange={(e) => setWhisperPath(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Model path</span>
          <input
            value={modelPath}
            onChange={(e) => setModelPath(e.target.value)}
          />
        </label>
        <HotkeyField
          value={state.settings.hotkey}
          onChange={(hotkey) => onUpdate({ hotkey })}
        />
        <label className="field">
          <span>Recording mode</span>
          <select
            value={state.settings.recording_mode}
            onChange={() => onUpdate({ recording_mode: "toggle" })}
          >
            <option value="toggle">Toggle recording</option>
          </select>
        </label>
        <label className="field">
          <span>Maximum saved transcripts</span>
          <input
            type="number"
            min={1}
            max={1000}
            value={state.settings.max_history_entries}
            onChange={(e) => onUpdate({ max_history_entries: Number(e.target.value) || 1 })}
          />
        </label>
        <label className="field">
          <span>Auto-delete after days</span>
          <input
            type="number"
            min={0}
            max={3650}
            value={state.settings.history_retention_days}
            onChange={(e) => onUpdate({ history_retention_days: Number(e.target.value) || 0 })}
          />
        </label>
      </div>

      <div className="toggle-grid">
        <Toggle icon={Zap} label="Auto paste" value={state.settings.auto_paste} onClick={() => onUpdate({ auto_paste: !state.settings.auto_paste })} />
        <Toggle icon={Clipboard} label="Clipboard fallback" value={state.settings.clipboard_fallback} onClick={() => onUpdate({ clipboard_fallback: !state.settings.clipboard_fallback })} />
        <Toggle icon={BookOpen} label="Dictionary cleanup" value={state.settings.dictionary_cleanup} onClick={() => onUpdate({ dictionary_cleanup: !state.settings.dictionary_cleanup })} />
        <Toggle icon={History} label="Save local history" value={state.settings.history_enabled} onClick={() => onUpdate({ history_enabled: !state.settings.history_enabled })} />
        <Toggle icon={Pin} label="Keep pill above other windows" value={state.settings.pill_always_on_top} onClick={() => onUpdate({ pill_always_on_top: !state.settings.pill_always_on_top })} />
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
