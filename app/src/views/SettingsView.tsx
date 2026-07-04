import { useEffect, useRef, useState } from "react";
import { Activity, BookOpen, Clipboard, History, Info, Keyboard, Wrench, Zap } from "lucide-react";
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
        <label className="field">
          <span>Whisper binary path</span>
          <input
            value={state.settings.whisper_binary_path}
            onChange={(e) => onUpdate({ whisper_binary_path: e.target.value })}
          />
        </label>
        <label className="field">
          <span>Model path</span>
          <input
            value={state.settings.model_path}
            onChange={(e) => onUpdate({ model_path: e.target.value })}
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
