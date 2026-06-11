import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type TabKey = "main" | "settings" | "history" | "dictionary" | "diagnostics";
type VoiceState = "Ready" | "Recording" | "Processing" | "Inserted" | "Copied" | "Error";
type Phase = "ready" | "recording" | "transcribing" | "inserted" | "copied" | "error";

type Settings = {
  whisper_binary_path: string;
  model_path: string;
  hotkey: string;
  recording_mode: "toggle";
  auto_paste: boolean;
  clipboard_fallback: boolean;
  dictionary_cleanup: boolean;
  start_on_login: boolean;
};

type Diagnostics = {
  whisper_found: boolean;
  model_found: boolean;
  mic_available: boolean;
  clipboard_tool: string | null;
  paste_tool: string | null;
  last_error: string | null;
};

type HistoryItem = {
  id: string;
  created_at: string;
  raw_transcript: string;
  final_transcript: string;
  duration_ms: number | null;
  insert_status: string;
  error: string | null;
};

type DictionaryRule = {
  id: string;
  spoken: string;
  replacement: string;
  enabled: boolean;
};

type AppState = {
  voice_state: VoiceState;
  settings: Settings;
  diagnostics: Diagnostics;
  history: HistoryItem[];
  dictionary: DictionaryRule[];
  last_transcript: string | null;
  last_error: string | null;
  recording_started_at: string | null;
};

const fallbackState: AppState = {
  voice_state: "Ready",
  settings: {
    whisper_binary_path: "~/tools/whisper.cpp/build/bin/whisper-cli",
    model_path: "~/tools/whisper.cpp/models/ggml-base.en.bin",
    hotkey: "Ctrl+Alt+Space",
    recording_mode: "toggle",
    auto_paste: true,
    clipboard_fallback: true,
    dictionary_cleanup: true,
    start_on_login: false,
  },
  diagnostics: {
    whisper_found: false,
    model_found: false,
    mic_available: false,
    clipboard_tool: null,
    paste_tool: null,
    last_error: null,
  },
  history: [],
  dictionary: [],
  last_transcript: null,
  last_error: null,
  recording_started_at: null,
};

const stateToPhase: Record<VoiceState, Phase> = {
  Ready: "ready",
  Recording: "recording",
  Processing: "transcribing",
  Inserted: "inserted",
  Copied: "copied",
  Error: "error",
};

const phaseCopy: Record<Phase, string> = {
  ready: "Ready",
  recording: "Recording",
  transcribing: "Transcribing",
  inserted: "Inserted",
  copied: "Copied",
  error: "Error",
};

const phaseTone: Record<Phase, "good" | "warn" | "bad" | "neutral" | "accent"> = {
  ready: "good",
  recording: "warn",
  transcribing: "accent",
  inserted: "good",
  copied: "good",
  error: "bad",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [state, setState] = useState<AppState>(fallbackState);
  const [commandStatus, setCommandStatus] = useState("Idle");
  const [setupMessage, setSetupMessage] = useState("Local install path not yet verified.");
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [newRuleSpoken, setNewRuleSpoken] = useState("");
  const [newRuleReplacement, setNewRuleReplacement] = useState("");

  const phase = stateToPhase[state.voice_state];
  const selectedHistory = useMemo(
    () => state.history.find((entry) => entry.id === selectedHistoryId) ?? state.history[0],
    [state.history, selectedHistoryId],
  );
  const recordingSeconds = useMemo(() => {
    if (!state.recording_started_at || state.voice_state !== "Recording") return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(state.recording_started_at).getTime()) / 1000));
  }, [state.recording_started_at, state.voice_state]);

  async function refresh() {
    const next = await invoke<AppState>("get_app_state");
    setState(next);
    if (!selectedHistoryId && next.history[0]) setSelectedHistoryId(next.history[0].id);
  }

  useEffect(() => {
    refresh().catch((error) => setCommandStatus(errorMessage(error)));
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handlePrimaryAction() {
    try {
      if (state.voice_state === "Recording") {
        setCommandStatus("Stopping recording");
        await invoke("stop_recording");
      } else if (state.voice_state === "Processing") {
        return;
      } else {
        setCommandStatus("Starting recording");
        await invoke("start_recording");
      }
      await refresh();
      setCommandStatus("Idle");
    } catch (error) {
      setCommandStatus(errorMessage(error));
      await refresh().catch(() => undefined);
    }
  }

  async function updateSettings(patch: Partial<Settings>) {
    const settings = { ...state.settings, ...patch };
    setState((current) => ({ ...current, settings }));
    await invoke("save_settings", { settings });
    await refresh();
  }

  async function handleSetup() {
    try {
      setSetupMessage("Running setup script...");
      const output = await invoke<string>("run_setup_script");
      setSetupMessage(output.trim() || "Setup completed.");
      await refresh();
    } catch (error) {
      setSetupMessage(errorMessage(error));
      await refresh().catch(() => undefined);
    }
  }

  async function handleCopyTranscript(text = state.last_transcript || selectedHistory?.final_transcript || "") {
    if (!text.trim()) return;
    await invoke("copy_text", { text });
    await refresh();
  }

  async function handleReinsert(text = selectedHistory?.final_transcript || "") {
    if (!text.trim()) return;
    await invoke("insert_text", { text });
    await refresh();
  }

  async function handleDeleteHistory(id: string) {
    await invoke("delete_history_item", { id });
    setSelectedHistoryId("");
    await refresh();
  }

  async function handleAddRule() {
    if (!newRuleSpoken.trim() || !newRuleReplacement.trim()) return;
    await invoke("add_dictionary_rule", {
      spoken: newRuleSpoken,
      replacement: newRuleReplacement,
    });
    setNewRuleSpoken("");
    setNewRuleReplacement("");
    await refresh();
  }

  async function toggleRule(id: string, enabled: boolean) {
    await invoke("set_dictionary_rule_enabled", { id, enabled });
    await refresh();
  }

  async function removeRule(id: string) {
    await invoke("delete_dictionary_rule", { id });
    await refresh();
  }

  const actionLabel =
    state.voice_state === "Recording"
      ? "Stop Recording"
      : state.voice_state === "Processing"
        ? "Processing..."
        : state.voice_state === "Error"
          ? "Retry"
          : "Start Recording";

  const diagnosticRows = [
    { label: "Whisper binary", value: state.diagnostics.whisper_found ? "Found" : "Missing", tone: state.diagnostics.whisper_found ? "good" : "bad" },
    { label: "Model file", value: state.diagnostics.model_found ? "Found" : "Missing", tone: state.diagnostics.model_found ? "good" : "bad" },
    { label: "Microphone", value: state.diagnostics.mic_available ? "Available" : "Unavailable", tone: state.diagnostics.mic_available ? "good" : "bad" },
    { label: "Clipboard tool", value: state.diagnostics.clipboard_tool || "Missing", tone: state.diagnostics.clipboard_tool ? "good" : "bad" },
    { label: "Paste tool", value: state.diagnostics.paste_tool || "Missing", tone: state.diagnostics.paste_tool ? "good" : "warn" },
    { label: "Last error", value: state.last_error || "None", tone: state.last_error ? "bad" : "neutral" },
  ] as const;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">V</div>
          <div className="brand-copy">
            <div className="brand-name">VibeVoice</div>
            <div className="brand-subtitle">Local whisper utility</div>
          </div>
        </div>

        <nav className="tabs" aria-label="Views">
          {(["main", "settings", "history", "dictionary", "diagnostics"] as TabKey[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab ${activeTab === tab ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>

        <div className="sidebar-panel">
          <div className="sidebar-label">Current state</div>
          <div className={`status-chip tone-${phaseTone[phase]}`}>{phaseCopy[phase]}</div>
          <div className="sidebar-copy">{state.diagnostics.whisper_found ? "Whisper found" : "Whisper missing"}</div>
          <div className="sidebar-copy">{state.diagnostics.model_found ? "Model found" : "Model missing"}</div>
        </div>

        <button type="button" className="ghost-button" onClick={handleSetup}>
          Setup
        </button>
      </aside>

      <main className="content">
        {activeTab === "main" && (
          <section className="panel main-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Main</div>
                <h1>Voice input for the active app.</h1>
              </div>
              <div className={`status-chip tone-${phaseTone[phase]}`}>{phaseCopy[phase]}</div>
            </div>

            <div className="main-grid">
              <div className="stack">
                <Metric label="VibeVoice status" value={phaseCopy[phase]} />
                <Metric label="Whisper engine" value={state.diagnostics.whisper_found ? "Found" : "Missing"} />
                <Metric label="Model path" value={state.settings.model_path} mono />
              </div>

              <div className="stack">
                <Metric label="Hotkey" value={state.settings.hotkey} />
                <Metric label="Recording mode" value="Toggle" />
                <Metric label="Last transcript" value={state.last_transcript || "No transcript yet."} />
              </div>
            </div>

            <div className="action-row">
              <button
                type="button"
                className={`primary-action tone-${phaseTone[phase]}`}
                disabled={state.voice_state === "Processing"}
                onClick={handlePrimaryAction}
              >
                {actionLabel}
              </button>
              <button type="button" className="secondary-action" onClick={() => handleCopyTranscript()}>
                Copy Transcript
              </button>
              <button type="button" className="secondary-action" onClick={handleSetup}>
                Setup
              </button>
            </div>

            <div className="status-strip">
              <Status label="Output" value={state.settings.auto_paste ? "Paste into focus" : "Clipboard"} />
              <Status label="Clipboard fallback" value={state.settings.clipboard_fallback ? "On" : "Off"} />
              <Status label="Auto paste" value={state.settings.auto_paste ? "On" : "Off"} />
              <Status label="Command" value={commandStatus} />
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Settings</div>
                <h1>Local paths and capture behavior.</h1>
              </div>
              <button type="button" className="secondary-action" onClick={handleSetup}>
                Run Setup
              </button>
            </div>

            <div className="form-grid">
              <Field label="Whisper binary path" value={state.settings.whisper_binary_path} onChange={(value) => updateSettings({ whisper_binary_path: value })} />
              <Field label="Model path" value={state.settings.model_path} onChange={(value) => updateSettings({ model_path: value })} />
              <Field label="Hotkey" value={state.settings.hotkey} onChange={(value) => updateSettings({ hotkey: value })} />
              <label className="field">
                <span>Recording mode</span>
                <select value={state.settings.recording_mode} onChange={() => updateSettings({ recording_mode: "toggle" })}>
                  <option value="toggle">Toggle recording</option>
                </select>
              </label>
            </div>

            <div className="toggle-grid">
              <Toggle label="Clipboard fallback" value={state.settings.clipboard_fallback} onClick={() => updateSettings({ clipboard_fallback: !state.settings.clipboard_fallback })} />
              <Toggle label="Auto paste" value={state.settings.auto_paste} onClick={() => updateSettings({ auto_paste: !state.settings.auto_paste })} />
              <Toggle label="Dictionary cleanup" value={state.settings.dictionary_cleanup} onClick={() => updateSettings({ dictionary_cleanup: !state.settings.dictionary_cleanup })} />
              <Toggle label="Start on login" value={state.settings.start_on_login} onClick={() => updateSettings({ start_on_login: !state.settings.start_on_login })} />
            </div>
          </section>
        )}

        {activeTab === "history" && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">History</div>
                <h1>Recent local transcripts.</h1>
              </div>
            </div>

            <div className="history-layout">
              <div className="history-list">
                {state.history.length === 0 ? (
                  <div className="empty-state">No local history stored.</div>
                ) : (
                  state.history.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className={`history-row ${selectedHistory?.id === entry.id ? "is-selected" : ""}`}
                      onClick={() => setSelectedHistoryId(entry.id)}
                    >
                      <div className="history-topline">
                        <span>{new Date(entry.created_at).toLocaleString()}</span>
                        <span className={`tone-${entry.error ? "bad" : "good"}`}>{entry.insert_status}</span>
                      </div>
                      <div className="history-text">{entry.final_transcript}</div>
                    </button>
                  ))
                )}
              </div>

              <article className="detail-panel">
                <div className="eyebrow">Selected transcript</div>
                <div className="detail-text">{selectedHistory?.final_transcript || "Select a transcript."}</div>
                <div className="detail-meta">
                  <span>{selectedHistory?.duration_ms ? `${selectedHistory.duration_ms} ms` : "No duration"}</span>
                  <span>{selectedHistory?.error || "No error"}</span>
                </div>
                <div className="action-row">
                  <button type="button" className="secondary-action" onClick={() => handleCopyTranscript(selectedHistory?.final_transcript)}>
                    Copy
                  </button>
                  <button type="button" className="secondary-action" onClick={() => handleReinsert()}>
                    Re-insert
                  </button>
                  {selectedHistory && (
                    <button type="button" className="secondary-action" onClick={() => handleDeleteHistory(selectedHistory.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </article>
            </div>
          </section>
        )}

        {activeTab === "dictionary" && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Dictionary</div>
                <h1>Developer term replacements.</h1>
              </div>
            </div>

            <div className="dictionary-form">
              <label className="field">
                <span>Spoken phrase</span>
                <input value={newRuleSpoken} onChange={(event) => setNewRuleSpoken(event.target.value)} />
              </label>
              <label className="field">
                <span>Replacement</span>
                <input value={newRuleReplacement} onChange={(event) => setNewRuleReplacement(event.target.value)} />
              </label>
              <button type="button" className="primary-action small" onClick={handleAddRule}>
                Add rule
              </button>
            </div>

            <div className="rule-list">
              {state.dictionary.map((rule) => (
                <article key={rule.id} className={`rule-row ${rule.enabled ? "is-on" : ""}`}>
                  <button type="button" className="rule-toggle" onClick={() => toggleRule(rule.id, !rule.enabled)}>
                    {rule.enabled ? "On" : "Off"}
                  </button>
                  <div className="rule-text">
                    <div className="rule-find">{rule.spoken}</div>
                    <div className="rule-replace">{rule.replacement}</div>
                  </div>
                  <span className="rule-scope">local</span>
                  <button type="button" className="secondary-action" onClick={() => removeRule(rule.id)}>
                    Delete
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "diagnostics" && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Diagnostics</div>
                <h1>Local engine and desktop tools.</h1>
              </div>
              <div className="action-row tight">
                <button type="button" className="secondary-action" onClick={refresh}>
                  Refresh
                </button>
                <button type="button" className="secondary-action" onClick={handleSetup}>
                  Run setup
                </button>
              </div>
            </div>

            <div className="diag-grid">
              <div className="diag-list">
                {diagnosticRows.map((row) => (
                  <div className="diag-row" key={row.label}>
                    <span className="diag-label">{row.label}</span>
                    <span className={`diag-value tone-${row.tone}`}>{row.value}</span>
                  </div>
                ))}
              </div>
              <article className="detail-panel">
                <div className="eyebrow">Setup log</div>
                <div className="detail-text mono">{setupMessage}</div>
              </article>
            </div>
          </section>
        )}
      </main>

      <aside className="widget" aria-live="polite">
        <div className="widget-top">
          <div>
            <div className="widget-label">Floating widget</div>
            <div className={`status-chip tone-${phaseTone[phase]}`}>{phaseCopy[phase]}</div>
          </div>
          <button type="button" className="widget-close" onClick={refresh}>
            Sync
          </button>
        </div>
        <div className="widget-body">
          <div className="widget-line">
            <span>{state.settings.hotkey}</span>
            <span>{state.voice_state === "Recording" ? `${recordingSeconds}s` : state.settings.auto_paste ? "auto-paste" : "clipboard"}</span>
          </div>
          <div className="widget-text">{state.last_error || state.last_transcript || "Ready for local dictation."}</div>
          <div className="widget-actions">
            <button type="button" className="widget-action" onClick={handlePrimaryAction}>
              {state.voice_state === "Recording" ? "Stop" : "Record"}
            </button>
            <button type="button" className="widget-action" onClick={() => handleCopyTranscript()}>
              Copy
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <article className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${mono ? "mono" : ""}`}>{value}</div>
    </article>
  );
}

function Status({ label, value }: { label: string; value: string }) {
  return (
    <div className="status-item">
      <span className="status-label">{label}</span>
      <span className="status-value">{value}</span>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Toggle({ label, value, onClick }: { label: string; value: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`toggle ${value ? "is-on" : ""}`} onClick={onClick}>
      <span>{label}</span>
      <span>{value ? "On" : "Off"}</span>
    </button>
  );
}

export default App;
