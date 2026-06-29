import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow, Window as TauriWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";
import vibevoiceIcon from "./assets/vibevoice-icon.png";
import "./App.css";

type TabKey = "main" | "settings" | "history" | "dictionary" | "updates" | "diagnostics";
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
  whisper_path: string | null;
  model_path: string | null;
  recorder: string | null;
  platform: string;
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
  mic_level: number;
  recording_started_at: string | null;
};

type UpdateInfo = {
  current_version: string;
  latest_version: string | null;
  current_commit: string | null;
  latest_commit: string | null;
  branch: string | null;
  update_ref: string | null;
  source_dir: string | null;
  update_available: boolean;
  can_update: boolean;
  status: string;
};

const fallbackState: AppState = {
  voice_state: "Ready",
  settings: {
    whisper_binary_path: "auto",
    model_path: "auto",
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
    whisper_path: null,
    model_path: null,
    recorder: null,
    platform: "unknown",
    last_error: null,
  },
  history: [],
  dictionary: [],
  last_transcript: null,
  last_error: null,
  mic_level: 0,
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

const tabLabels: Record<TabKey, string> = {
  main: "Main",
  settings: "Settings",
  history: "History",
  dictionary: "Dictionary",
  updates: "Updates",
  diagnostics: "Diagnostics",
};

const tabRailLabels: Record<TabKey, string> = {
  main: "M",
  settings: "S",
  history: "H",
  dictionary: "Di",
  updates: "Up",
  diagnostics: "Dx",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("main");
  const [state, setState] = useState<AppState>(fallbackState);
  const [expanded, setExpanded] = useState(false);
  const [commandStatus, setCommandStatus] = useState("Idle");
  const [setupMessage, setSetupMessage] = useState("Local install path not yet verified.");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateMessage, setUpdateMessage] = useState("Updates have not been checked yet.");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newRuleSpoken, setNewRuleSpoken] = useState("");
  const [newRuleReplacement, setNewRuleReplacement] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateStatus, setUpdateStatus] = useState("Checking for updates on launch.");
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);
  const updateStartedRef = useRef(false);

  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const isPillWindow = currentWindow.label === "pill";
  const sidebarClass = sidebarCollapsed ? "is-sidebar-collapsed" : "is-sidebar-expanded";
  const phase = stateToPhase[state.voice_state];
  const selectedHistory = useMemo(
    () => state.history.find((entry) => entry.id === selectedHistoryId) ?? (selectedHistoryId ? undefined : state.history[0]),
    [state.history, selectedHistoryId],
  );
  const recordingSeconds = useMemo(() => {
    if (!state.recording_started_at || state.voice_state !== "Recording") return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(state.recording_started_at).getTime()) / 1000));
  }, [state.recording_started_at, state.voice_state]);

  async function refresh() {
    const next = await invoke<AppState>("get_app_state");
    setState(next);
    setSelectedHistoryId((currentId) => {
      if (currentId && next.history.some((entry) => entry.id === currentId)) {
        return currentId;
      }
      return next.history[0]?.id ?? "";
    });
  }

  function trackUpdateProgress(event: DownloadEvent) {
    if (event.event === "Started") {
      setUpdateProgress(0);
      setUpdateStatus(
        event.data.contentLength
          ? `Downloading update (${Math.round(event.data.contentLength / 1024 / 1024)} MB).`
          : "Downloading update.",
      );
      return;
    }
    if (event.event === "Progress") {
      setUpdateProgress((current) => (current ?? 0) + event.data.chunkLength);
      return;
    }
    setUpdateStatus("Installing update.");
  }

  async function installUpdate(update: Update) {
    updateStartedRef.current = true;
    setAvailableUpdate(update);
    setUpdateProgress(null);
    setUpdateStatus(`Installing VibeVoice ${update.version}.`);
    await update.downloadAndInstall(trackUpdateProgress);
    setUpdateStatus("Update installed. Restarting VibeVoice.");
    await relaunch();
  }

  async function checkForUpdates(installAutomatically = false) {
    try {
      setUpdateStatus("Checking for updates.");
      setUpdateProgress(null);
      const update = await check();
      if (!update) {
        setAvailableUpdate(null);
        setUpdateStatus("VibeVoice is up to date.");
        return;
      }
      setAvailableUpdate(update);
      setUpdateStatus(`VibeVoice ${update.version} is available.`);
      if (installAutomatically) {
        await installUpdate(update);
      }
    } catch (error) {
      setUpdateStatus(`Update check failed: ${errorMessage(error)}`);
    }
  }

  useEffect(() => {
    refresh().catch((error) => setCommandStatus(errorMessage(error)));
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isPillWindow) return;
    invoke<UpdateInfo>("check_for_updates")
      .then((info) => {
        setUpdateInfo(info);
        setUpdateMessage(info.status);
        if (info.update_available) {
          setActiveTab("updates");
        }
      })
      .catch((error) => setUpdateMessage(errorMessage(error)));
    if (!updateStartedRef.current) {
      checkForUpdates(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPillWindow]);

  useEffect(() => {
    if (!isPillWindow) return;
    currentWindow.setAlwaysOnTop(true).catch(() => undefined);
    currentWindow
      .setSize(expanded ? new LogicalSize(390, 580) : new LogicalSize(352, 76))
      .catch(() => undefined);
  }, [currentWindow, expanded, isPillWindow]);

  useEffect(() => {
    if (isPillWindow) return;
    const collapseWhenNarrow = () => {
      if (window.innerWidth <= 1100) setSidebarCollapsed(true);
    };
    collapseWhenNarrow();
    window.addEventListener("resize", collapseWhenNarrow);
    return () => window.removeEventListener("resize", collapseWhenNarrow);
  }, [isPillWindow]);

  function handleWindowDrag(event: React.MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea")) return;
    if (isPillWindow) currentWindow.startDragging().catch(() => undefined);
  }

  async function showMainWindow() {
    const mainWindow = await TauriWindow.getByLabel("main");
    await mainWindow?.show();
    await mainWindow?.setFocus();
  }

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

  async function handleCheckUpdates() {
    try {
      setUpdateBusy(true);
      setUpdateMessage("Checking source control...");
      const info = await invoke<UpdateInfo>("check_for_updates");
      setUpdateInfo(info);
      setUpdateMessage(info.status);
    } catch (error) {
      setUpdateMessage(errorMessage(error));
    } finally {
      setUpdateBusy(false);
    }
  }

  async function handleInstallUpdate() {
    try {
      setUpdateBusy(true);
      setUpdateMessage("Starting updater. VibeVoice will close and reopen after installation.");
      await invoke("install_update_and_restart");
    } catch (error) {
      setUpdateBusy(false);
      setUpdateMessage(errorMessage(error));
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

  if (isPillWindow) {
    return (
    <main className={`floating-shell ${expanded ? "is-expanded" : ""}`} onMouseDown={handleWindowDrag}>
      <button
        type="button"
        className={`voice-pill tone-${phaseTone[phase]}`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span className="pill-icon-wrap">
          <img className="pill-icon" src={vibevoiceIcon} alt="" aria-hidden="true" />
          <span className="pill-dot" />
        </span>
        <span className="pill-copy">
          <span className="pill-title">{phaseCopy[phase]}</span>
          <span className="pill-subtitle">
            {state.voice_state === "Recording" ? `${recordingSeconds}s` : state.settings.hotkey}
          </span>
        </span>
        <MicVisualizer level={state.mic_level} active={state.voice_state === "Recording"} />
      </button>

      {expanded && (
        <section className="command-panel" aria-live="polite">
          <div className="command-bar">
            <button
              type="button"
              className={`primary-action tone-${phaseTone[phase]}`}
              disabled={state.voice_state === "Processing"}
              onClick={handlePrimaryAction}
            >
              {actionLabel}
            </button>
            <button type="button" className="secondary-action" onClick={() => handleReinsert(state.last_transcript || selectedHistory?.final_transcript)}>
              Paste previous
            </button>
            <button type="button" className="secondary-action icon-action" onClick={() => setExpanded(false)}>
              Close
            </button>
            <button type="button" className="secondary-action icon-action" onClick={showMainWindow}>
              App
            </button>
          </div>

          <nav className="tabs" aria-label="Views">
            {(["main", "history", "settings", "dictionary", "updates", "diagnostics"] as TabKey[]).map((tab) => (
              <button
                key={tab}
                type="button"
                className={`tab ${activeTab === tab ? "is-active" : ""}`}
                onClick={() => setActiveTab(tab)}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </nav>

          {activeTab === "main" && (
            <section className="panel main-panel">
              <div className="status-strip">
                <Status label="Engine" value={state.diagnostics.whisper_found ? "Ready" : "Missing"} />
                <Status label="Model" value={state.diagnostics.model_found ? "Ready" : "Missing"} />
                <Status label="Mic" value={state.diagnostics.mic_available ? "Ready" : "Missing"} />
                <Status label="Output" value={state.settings.auto_paste ? "Paste" : "Clipboard"} />
              </div>
              <article className="detail-panel transcript-panel">
                <div className="eyebrow">Last transcript</div>
                <div className="detail-text">{state.last_error || state.last_transcript || "No transcript yet."}</div>
              </article>
              <div className="command-status">{commandStatus}</div>
            </section>
          )}

          {activeTab === "history" && (
            <section className="panel">
              <div className="history-list compact-list">
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
              <div className="action-row">
                <button type="button" className="secondary-action" onClick={() => handleCopyTranscript(selectedHistory?.final_transcript)}>
                  Copy
                </button>
                <button type="button" className="secondary-action" onClick={() => handleReinsert()}>
                  Paste
                </button>
                {selectedHistory && (
                  <button type="button" className="secondary-action" onClick={() => handleDeleteHistory(selectedHistory.id)}>
                    Delete
                  </button>
                )}
              </div>
            </section>
          )}

          {activeTab === "settings" && (
            <section className="panel">
              <div className="form-grid">
                <Field label="Whisper binary path" value={state.settings.whisper_binary_path} onChange={(value) => updateSettings({ whisper_binary_path: value })} />
                <Field label="Model path" value={state.settings.model_path} onChange={(value) => updateSettings({ model_path: value })} />
                <Field label="Hotkey" value={state.settings.hotkey} onChange={(value) => updateSettings({ hotkey: value })} />
              </div>
              <div className="toggle-grid">
                <Toggle label="Clipboard fallback" value={state.settings.clipboard_fallback} onClick={() => updateSettings({ clipboard_fallback: !state.settings.clipboard_fallback })} />
                <Toggle label="Auto paste" value={state.settings.auto_paste} onClick={() => updateSettings({ auto_paste: !state.settings.auto_paste })} />
                <Toggle label="Dictionary cleanup" value={state.settings.dictionary_cleanup} onClick={() => updateSettings({ dictionary_cleanup: !state.settings.dictionary_cleanup })} />
              </div>
              <button type="button" className="secondary-action full-width" onClick={handleSetup}>
                Run setup
              </button>
            </section>
          )}

          {activeTab === "updates" && (
            <section className="panel">
              <div className="diag-list">
                <UpdateRows info={updateInfo} />
              </div>
              <article className="detail-panel">
                <div className="eyebrow">Update status</div>
                <div className="detail-text mono">{updateMessage}</div>
              </article>
              <div className="action-row">
                <button type="button" className="secondary-action" disabled={updateBusy} onClick={handleCheckUpdates}>
                  Check
                </button>
                <button
                  type="button"
                  className="primary-action"
                  disabled={updateBusy || !updateInfo?.update_available || !updateInfo?.can_update}
                  onClick={handleInstallUpdate}
                >
                  Update now
                </button>
                <button type="button" className="secondary-action" disabled={updateBusy} onClick={() => setActiveTab("main")}>
                  Later
                </button>
              </div>
            </section>
          )}

          {activeTab === "dictionary" && (
            <section className="panel">
              <div className="dictionary-form">
                <Field label="Spoken phrase" value={newRuleSpoken} onChange={setNewRuleSpoken} />
                <Field label="Replacement" value={newRuleReplacement} onChange={setNewRuleReplacement} />
                <button type="button" className="primary-action small" onClick={handleAddRule}>
                  Add
                </button>
              </div>
              <div className="rule-list compact-list">
                {state.dictionary.map((rule) => (
                  <article key={rule.id} className={`rule-row ${rule.enabled ? "is-on" : ""}`}>
                    <button type="button" className="rule-toggle" onClick={() => toggleRule(rule.id, !rule.enabled)}>
                      {rule.enabled ? "On" : "Off"}
                    </button>
                    <div className="rule-text">
                      <div className="rule-find">{rule.spoken}</div>
                      <div className="rule-replace">{rule.replacement}</div>
                    </div>
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
              <div className="diag-list">
                {diagnosticRows.map((row) => (
                  <div className="diag-row" key={row.label}>
                    <span className="diag-label">{row.label}</span>
                    <span className={`diag-value tone-${row.tone}`}>{row.value}</span>
                  </div>
                ))}
                <div className="diag-row">
                  <span className="diag-label">Resolved binary</span>
                  <span className="diag-value mono">{state.diagnostics.whisper_path || "Not resolved"}</span>
                </div>
                <div className="diag-row">
                  <span className="diag-label">Resolved model</span>
                  <span className="diag-value mono">{state.diagnostics.model_path || "Not resolved"}</span>
                </div>
              </div>
              <article className="detail-panel">
                <div className="eyebrow">Setup log</div>
                <div className="detail-text mono">{setupMessage}</div>
              </article>
              <div className="action-row">
                <button type="button" className="secondary-action" onClick={refresh}>
                  Refresh
                </button>
                <button type="button" className="secondary-action" onClick={handleSetup}>
                  Run setup
                </button>
              </div>
            </section>
          )}
        </section>
      )}
    </main>
  );
  }

  return (
    <div className={`app-shell ${sidebarClass}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <img className="brand-mark" src={vibevoiceIcon} alt="" aria-hidden="true" />
          <div className="brand-copy">
            <div className="brand-name">VibeVoice</div>
            <div className="brand-subtitle">Local Whisper Utility</div>
          </div>
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((value) => !value)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span aria-hidden="true">{sidebarCollapsed ? ">" : "<"}</span>
          </button>
        </div>

        <nav className="tabs" aria-label="Views">
          {(["main", "settings", "history", "dictionary", "updates", "diagnostics"] as TabKey[]).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab ${activeTab === tab ? "is-active" : ""}`}
              onClick={() => setActiveTab(tab)}
              title={tabLabels[tab]}
              aria-label={tabLabels[tab]}
            >
              <span className="tab-initial" aria-hidden="true">
                {tabRailLabels[tab]}
              </span>
              <span className="tab-label">{tabLabels[tab]}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-panel">
          <div className="sidebar-label">Current State</div>
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
                <Metric label="Resolved model" value={state.diagnostics.model_path || state.settings.model_path} mono />
              </div>

              <div className="stack">
                <Metric label="Hotkey" value={state.settings.hotkey} />
                <Metric label="Recorder" value={state.diagnostics.recorder || "Unavailable"} />
                <article className="metric">
                  <div className="metric-label">Mic input</div>
                  <MicVisualizer level={state.mic_level} active={state.voice_state === "Recording"} />
                </article>
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

            <article className="detail-panel update-panel">
              <div className="update-row">
                <div>
                  <div className="eyebrow">Updates</div>
                  <div className="detail-text update-status">{updateStatus}</div>
                  {updateProgress !== null && (
                    <div className="detail-meta">
                      <span>{Math.round(updateProgress / 1024 / 1024)} MB downloaded</span>
                    </div>
                  )}
                </div>
                <div className="action-row tight">
                  <button type="button" className="secondary-action" onClick={() => checkForUpdates(false)}>
                    Check
                  </button>
                  {availableUpdate && (
                    <button type="button" className="primary-action" onClick={() => installUpdate(availableUpdate)}>
                      Install
                    </button>
                  )}
                </div>
              </div>
            </article>

            <article className="detail-panel transcript-panel">
              <div className="eyebrow">Last transcript</div>
              <div className="detail-text">{state.last_error || state.last_transcript || "No transcript yet."}</div>
            </article>
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
              <Field label="Spoken phrase" value={newRuleSpoken} onChange={setNewRuleSpoken} />
              <Field label="Replacement" value={newRuleReplacement} onChange={setNewRuleReplacement} />
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

        {activeTab === "updates" && (
          <section className="panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Updates</div>
                <h1>Install the latest signed release.</h1>
              </div>
              <div className={`status-chip tone-${availableUpdate || updateInfo?.update_available ? "warn" : "good"}`}>
                {availableUpdate || updateInfo?.update_available ? "Available" : "Ready"}
              </div>
            </div>

            <div className="update-layout">
              <article className="detail-panel">
                <div className="eyebrow">Release update</div>
                <div className="detail-text mono">{updateStatus}</div>
                {updateProgress !== null && (
                  <div className="detail-meta">
                    <span>{Math.round(updateProgress / 1024 / 1024)} MB downloaded</span>
                  </div>
                )}
              </article>
              <article className="detail-panel">
                <div className="eyebrow">Source checkout</div>
                <div className="detail-text mono">{updateMessage}</div>
              </article>
            </div>

            <div className="action-row">
              <button type="button" className="secondary-action" onClick={() => checkForUpdates(false)}>
                Check release
              </button>
              <button type="button" className="primary-action" disabled={!availableUpdate} onClick={() => availableUpdate && installUpdate(availableUpdate)}>
                Install release
              </button>
              <button type="button" className="secondary-action" disabled={updateBusy} onClick={handleCheckUpdates}>
                Check source
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={updateBusy || !updateInfo?.update_available || !updateInfo?.can_update}
                onClick={handleInstallUpdate}
              >
                Update source
              </button>
              <button type="button" className="secondary-action" disabled={updateBusy} onClick={() => setActiveTab("main")}>
                Do it later
              </button>
            </div>

            <div className="diag-list">
              <UpdateRows info={updateInfo} />
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
                <div className="diag-row">
                  <span className="diag-label">Resolved binary</span>
                  <span className="diag-value mono">{state.diagnostics.whisper_path || "Not resolved"}</span>
                </div>
                <div className="diag-row">
                  <span className="diag-label">Resolved model</span>
                  <span className="diag-value mono">{state.diagnostics.model_path || "Not resolved"}</span>
                </div>
              </div>
              <article className="detail-panel">
                <div className="eyebrow">Setup log</div>
                <div className="detail-text mono">{setupMessage}</div>
              </article>
            </div>
          </section>
        )}
      </main>
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

function MicVisualizer({ level, active }: { level: number; active: boolean }) {
  const normalized = Math.max(0.04, Math.min(1, level || 0));
  return (
    <span className={`mic-visualizer ${active ? "is-active" : ""}`} aria-hidden="true">
      {Array.from({ length: 12 }).map((_, index) => {
        const wave = active ? Math.abs(Math.sin(index * 0.72 + normalized * 2.8)) : 0.16;
        const height = Math.round(18 + (active ? Math.max(normalized, wave * normalized) : wave) * 34);
        return <span key={index} style={{ height: `${height}px` }} />;
      })}
    </span>
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

function UpdateRows({ info }: { info: UpdateInfo | null }) {
  const rows = [
    { label: "Current version", value: info?.current_version || "0.1.0" },
    { label: "Latest version", value: info?.latest_version || "Unknown" },
    { label: "Current commit", value: info?.current_commit || "Unknown" },
    { label: "Latest commit", value: info?.latest_commit || "Unknown" },
    { label: "Branch", value: info?.branch || "Unknown" },
    { label: "Update ref", value: info?.update_ref || "Unknown" },
    { label: "Source checkout", value: info?.source_dir || "Not found" },
  ];

  return (
    <>
      {rows.map((row) => (
        <div className="diag-row" key={row.label}>
          <span className="diag-label">{row.label}</span>
          <span className="diag-value mono">{row.value}</span>
        </div>
      ))}
    </>
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
