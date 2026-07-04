import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, monitorFromPoint, Window as TauriWindow } from "@tauri-apps/api/window";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";
import { Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import vibevoiceIcon from "./assets/vibevoice-icon.png";
import { PillWindow } from "./PillWindow";
import {
  actionIcon,
  canStartOrStop,
  fallbackState,
  navItems,
  stateToPhase,
} from "./types";
import type { AppState, LibraryMode, MeterPayload, Settings, TabKey, UpdateStatus } from "./types";
import { StatusChip } from "./ui";
import { ControlView } from "./views/ControlView";
import { DiagnosticsView } from "./views/DiagnosticsView";
import { LibraryView } from "./views/LibraryView";
import { SettingsView } from "./views/SettingsView";
import "./App.css";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function initialTab(): TabKey {
  if (isTauriRuntime()) return "control";
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "settings" || tab === "library" || tab === "diagnostics" ? tab : "control";
}

function initialLibraryMode(): LibraryMode {
  const mode = new URLSearchParams(window.location.search).get("library");
  return mode === "dictionary" ? "dictionary" : "history";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const RELEASES_URL = "https://github.com/Zburgers/vibevoice/releases";
const LATEST_RELEASE_API = "https://api.github.com/repos/Zburgers/vibevoice/releases/latest";

const initialUpdateStatus: UpdateStatus = {
  state: "idle",
  latestVersion: null,
  releaseUrl: RELEASES_URL,
  message: "Check GitHub Releases for newer installers.",
  canInstall: false,
};

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, "");
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const count = Math.max(leftParts.length, rightParts.length, 3);
  for (let index = 0; index < count; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function App() {
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [libraryMode, setLibraryMode] = useState<LibraryMode>(initialLibraryMode);
  const [state, setState] = useState<AppState>(fallbackState);
  const [expanded, setExpanded] = useState(false);
  const [commandStatus, setCommandStatus] = useState("Idle");
  const [setupMessage, setSetupMessage] = useState("Setup has not run in this session.");
  const [selectedHistoryId, setSelectedHistoryId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [newRuleSpoken, setNewRuleSpoken] = useState("");
  const [newRuleReplacement, setNewRuleReplacement] = useState("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(initialUpdateStatus);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [, setTimerTick] = useState(0);
  const [pillFlipX, setPillFlipX] = useState(false);
  const [pillFlipY, setPillFlipY] = useState(false);

  const inTauri = isTauriRuntime();
  const currentWindow = useMemo(() => (inTauri ? getCurrentWindow() : null), [inTauri]);
  const isPillWindow = currentWindow?.label === "pill";
  const phase = stateToPhase[state.voice_state];
  const selectedHistory = useMemo(
    () => state.history.find((entry) => entry.id === selectedHistoryId) ?? (selectedHistoryId ? undefined : state.history[0]),
    [state.history, selectedHistoryId],
  );
  const recordingSeconds = useMemo(() => {
    if (!state.recording_started_at || state.voice_state !== "Recording") return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(state.recording_started_at).getTime()) / 1000));
  }, [state.recording_started_at, state.voice_state]);
  const lastText = state.last_error || state.last_transcript || "No transcript captured yet.";
  const primaryDisabled = !canStartOrStop(state.voice_state);
  const ActionIcon = actionIcon(state.voice_state);

  async function refresh() {
    if (!inTauri) {
      setState(fallbackState);
      return;
    }
    const next = await invoke<AppState>("get_app_state");
    setState(next);
    setSelectedHistoryId((currentId) => {
      if (currentId && next.history.some((entry) => entry.id === currentId)) return currentId;
      return next.history[0]?.id ?? "";
    });
  }

  async function refreshUpdateStatus() {
    setUpdateStatus((current) => ({
      ...current,
      state: "checking",
      message: "Checking for a newer release.",
      canInstall: false,
    }));
    setPendingUpdate(null);

    let updaterError = "";
    if (inTauri) {
      try {
        const update = await check({ timeout: 12000 });
        if (update) {
          setPendingUpdate(update);
          setUpdateStatus({
            state: "available",
            latestVersion: update.version,
            releaseUrl: `${RELEASES_URL}/tag/v${normalizeVersion(update.version)}`,
            message: `Version ${update.version} is ready to install.`,
            canInstall: true,
          });
          return;
        }
      } catch (error) {
        updaterError = errorMessage(error);
      }
    }

    try {
      const response = await fetch(LATEST_RELEASE_API, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
      }
      const release = (await response.json()) as {
        tag_name?: string;
        html_url?: string;
        name?: string;
      };
      const latestVersion = normalizeVersion(release.tag_name || release.name || "");
      if (!latestVersion) {
        throw new Error("Latest release did not include a version.");
      }
      const releaseUrl = release.html_url || `${RELEASES_URL}/tag/v${latestVersion}`;
      const versionDelta = compareVersions(latestVersion, state.app_version);
      const isNewer = versionDelta > 0;
      setUpdateStatus({
        state: isNewer ? "available" : "current",
        latestVersion,
        releaseUrl,
        message: isNewer
          ? updaterError
            ? `Version ${latestVersion} is available. Open the release page to install it.`
            : `Version ${latestVersion} is available.`
          : versionDelta < 0
            ? "This build is newer than the latest public release."
            : "You are on the latest public release.",
        canInstall: false,
      });
    } catch (error) {
      setUpdateStatus({
        state: "error",
        latestVersion: null,
        releaseUrl: RELEASES_URL,
        message: updaterError || errorMessage(error),
        canInstall: false,
      });
    }
  }

  useEffect(() => {
    if (!inTauri) return;
    refresh().catch((error) => setCommandStatus(errorMessage(error)));

    let cleanupState: (() => void) | undefined;
    let cleanupMeter: (() => void) | undefined;

    listen("vibevoice-state-changed", () => {
      refresh().catch(() => undefined);
    })
      .then((cleanup) => {
        cleanupState = cleanup;
      })
      .catch((error) => setCommandStatus(errorMessage(error)));

    listen<MeterPayload>("vibevoice-meter-changed", (event) => {
      setState((current) => ({ ...current, mic_level: event.payload.mic_level }));
    })
      .then((cleanup) => {
        cleanupMeter = cleanup;
      })
      .catch((error) => setCommandStatus(errorMessage(error)));

    return () => {
      cleanupState?.();
      cleanupMeter?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTauri]);

  useEffect(() => {
    if (state.voice_state !== "Recording") return;
    const timer = window.setInterval(() => setTimerTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [state.voice_state]);

  useEffect(() => {
    if (!isPillWindow) return;
    currentWindow?.setAlwaysOnTop(true).catch(() => undefined);
    currentWindow?.setSize(expanded ? new LogicalSize(318, 262) : new LogicalSize(68, 68)).catch(() => undefined);

    // When expanding, detect position relative to screen to decide flip direction
    if (expanded && currentWindow) {
      currentWindow.outerPosition().then(async (pos) => {
        const monitor = await monitorFromPoint(pos.x, pos.y);
        if (!monitor) return;
        const monitorSize = monitor.size;
        const scaleFactor = monitor.scaleFactor;
        const screenW = monitorSize.width / scaleFactor;
        const screenH = monitorSize.height / scaleFactor;
        const pillLogicalX = pos.x / scaleFactor;
        const pillLogicalY = pos.y / scaleFactor;
        // Flip horizontal if pill is in the right 50% of the screen
        setPillFlipX(pillLogicalX > screenW * 0.45);
        // Flip vertical (open upward) if pill is in the bottom 50% of the screen
        setPillFlipY(pillLogicalY > screenH * 0.5);
      }).catch(() => undefined);
    }
  }, [currentWindow, expanded, isPillWindow]);

  useEffect(() => {
    if (isPillWindow || activeTab !== "diagnostics" || updateStatus.state !== "idle") return;
    refreshUpdateStatus().catch((error) =>
      setUpdateStatus({
        state: "error",
        latestVersion: null,
        releaseUrl: RELEASES_URL,
        message: errorMessage(error),
        canInstall: false,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, isPillWindow, updateStatus.state]);

  useEffect(() => {
    if (isPillWindow) return;
    const collapseWhenNarrow = () => setSidebarCollapsed(window.innerWidth <= 1040);
    collapseWhenNarrow();
    window.addEventListener("resize", collapseWhenNarrow);
    return () => window.removeEventListener("resize", collapseWhenNarrow);
  }, [isPillWindow]);

  function dragPillWindow(event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    currentWindow?.startDragging().catch(() => undefined);
  }

  function handleTitlebarDrag(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    currentWindow?.startDragging().catch(() => undefined);
  }

  async function showMainWindow() {
    if (!inTauri) return;
    try {
      await invoke("show_main_window");
    } catch {
      // Fallback: try direct window API
      const mainWindow = await TauriWindow.getByLabel("main");
      await mainWindow?.show();
      await mainWindow?.setFocus();
    }
  }

  function minimizeWindow() {
    currentWindow?.minimize().catch((error) => setCommandStatus(errorMessage(error)));
  }

  function toggleMaximizeWindow() {
    currentWindow?.toggleMaximize().catch((error) => setCommandStatus(errorMessage(error)));
  }

  function closeWindow() {
    currentWindow?.close().catch((error) => setCommandStatus(errorMessage(error)));
  }

  async function handlePrimaryAction() {
    if (!canStartOrStop(state.voice_state)) return;
    if (!inTauri) {
      setCommandStatus("Desktop runtime unavailable in browser preview");
      return;
    }
    try {
      if (state.voice_state === "Recording") {
        setCommandStatus("Stopping recording");
        await invoke("stop_recording");
        setCommandStatus("Transcribing");
      } else {
        setCommandStatus("Starting recorder");
        await invoke("start_recording");
      }
      await refresh();
    } catch (error) {
      setCommandStatus(errorMessage(error));
      await refresh().catch(() => undefined);
    }
  }

  async function updateSettings(patch: Partial<Settings>) {
    const settings = { ...state.settings, ...patch };
    setState((current) => ({ ...current, settings }));
    if (!inTauri) return;
    try {
      await invoke("save_settings", { settings });
      setCommandStatus("Settings saved");
      await refresh();
    } catch (error) {
      setCommandStatus(errorMessage(error));
      await refresh().catch(() => undefined);
    }
  }

  async function handleSetup() {
    if (!inTauri) {
      setSetupMessage("Desktop runtime unavailable in browser preview.");
      return;
    }
    try {
      setSetupMessage(`Running ${state.diagnostics.setup_command || "setup script"}`);
      const output = await invoke<string>("run_setup_script");
      setSetupMessage(output.trim() || "Setup completed.");
      await refresh();
    } catch (error) {
      setSetupMessage(errorMessage(error));
      await refresh().catch(() => undefined);
    }
  }

  async function handleCopyText(text?: string | null) {
    const value = (text ?? state.last_transcript ?? selectedHistory?.final_transcript ?? "").trim();
    if (!value) return;
    if (!inTauri) {
      setCommandStatus("Desktop runtime unavailable in browser preview");
      return;
    }
    try {
      await invoke("copy_text", { text: value });
      setCommandStatus("Copied");
      await refresh();
    } catch (error) {
      setCommandStatus(errorMessage(error));
    }
  }

  async function handleInstallUpdate() {
    if (!pendingUpdate) {
      await handleOpenReleasePage();
      return;
    }
    try {
      setUpdateStatus((current) => ({
        ...current,
        state: "installing",
        message: "Downloading update.",
        canInstall: false,
      }));
      let downloaded = 0;
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateStatus((current) => ({
            ...current,
            message: event.data.contentLength ? `Downloading ${(event.data.contentLength / 1024 / 1024).toFixed(1)} MB update.` : "Downloading update.",
          }));
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setUpdateStatus((current) => ({
            ...current,
            message: `Downloaded ${(downloaded / 1024 / 1024).toFixed(1)} MB.`,
          }));
        }
        if (event.event === "Finished") {
          setUpdateStatus((current) => ({
            ...current,
            message: "Installing update.",
          }));
        }
      });
      setUpdateStatus((current) => ({
        ...current,
        state: "installed",
        message: "Update installed. Restarting VibeVoice.",
      }));
      await relaunch();
    } catch (error) {
      setPendingUpdate(null);
      setUpdateStatus((current) => ({
        ...current,
        state: "error",
        message: `${errorMessage(error)} Open the release page to install manually.`,
        canInstall: false,
      }));
    }
  }

  async function handleOpenReleasePage() {
    const url = updateStatus.releaseUrl || RELEASES_URL;
    if (!inTauri) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    try {
      await invoke("open_release_page", { url });
    } catch (error) {
      setUpdateStatus((current) => ({
        ...current,
        state: "error",
        message: errorMessage(error),
      }));
    }
  }

  async function handleReinsert(text?: string | null) {
    const value = (text ?? selectedHistory?.final_transcript ?? state.last_transcript ?? "").trim();
    if (!value) return;
    if (!inTauri) {
      setCommandStatus("Desktop runtime unavailable in browser preview");
      return;
    }
    try {
      await invoke("insert_text", { text: value });
      setCommandStatus("Inserted");
      await refresh();
    } catch (error) {
      setCommandStatus(errorMessage(error));
      await refresh().catch(() => undefined);
    }
  }

  async function handleDeleteHistory(id: string) {
    if (!inTauri) return;
    await invoke("delete_history_item", { id });
    setSelectedHistoryId("");
    await refresh();
  }

  async function handleClearHistory() {
    if (!inTauri) return;
    await invoke("clear_history");
    setSelectedHistoryId("");
    await refresh();
  }

  async function handleAddRule() {
    if (!newRuleSpoken.trim() || !newRuleReplacement.trim()) return;
    if (!inTauri) return;
    await invoke("add_dictionary_rule", {
      spoken: newRuleSpoken,
      replacement: newRuleReplacement,
    });
    setNewRuleSpoken("");
    setNewRuleReplacement("");
    await refresh();
  }

  async function toggleRule(id: string, enabled: boolean) {
    if (!inTauri) return;
    await invoke("set_dictionary_rule_enabled", { id, enabled });
    await refresh();
  }

  async function removeRule(id: string) {
    if (!inTauri) return;
    await invoke("delete_dictionary_rule", { id });
    await refresh();
  }

  if (isPillWindow) {
    return (
      <PillWindow
        state={state}
        phase={phase}
        expanded={expanded}
        lastText={lastText}
        recordingSeconds={recordingSeconds}
        primaryDisabled={primaryDisabled}
        ActionIcon={ActionIcon}
        flipX={pillFlipX}
        flipY={pillFlipY}
        onToggleExpanded={() => setExpanded((value) => !value)}
        onCollapse={() => setExpanded(false)}
        onDrag={dragPillWindow}
        onPrimary={handlePrimaryAction}
        onPaste={() => handleReinsert(state.last_transcript)}
        onOpenMain={showMainWindow}
      />
    );
  }

  return (
    <div className="desktop-frame">
      <header className="app-titlebar" onMouseDown={handleTitlebarDrag}>
        <div className="titlebar-brand">
          <img className="titlebar-icon" src={vibevoiceIcon} alt="" aria-hidden="true" />
          <span>VibeVoice</span>
        </div>
        <div className="titlebar-controls" aria-label="Window controls">
          <button type="button" className="titlebar-button" onClick={minimizeWindow} aria-label="Minimize" title="Minimize">
            <Minimize2 size={14} />
          </button>
          <button type="button" className="titlebar-button" onClick={toggleMaximizeWindow} aria-label="Maximize or restore" title="Maximize or restore">
            <Maximize2 size={14} />
          </button>
          <button type="button" className="titlebar-button is-close" onClick={closeWindow} aria-label="Close" title="Close">
            <X size={15} />
          </button>
        </div>
      </header>

      <div className={`app-shell ${sidebarCollapsed ? "is-rail" : "is-wide"}`}>
        <aside className="sidebar">
          <div className="brand-block">
            <img className="brand-mark" src={vibevoiceIcon} alt="" aria-hidden="true" />
            <div className="brand-copy">
              <div className="brand-name">VibeVoice</div>
              <div className="brand-subtitle">Local voice input</div>
            </div>
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </div>

          <nav className="tabs" aria-label="Views">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`tab ${activeTab === item.key ? "is-active" : ""}`}
                onClick={() => setActiveTab(item.key)}
                title={item.label}
                aria-label={item.label}
              >
                <item.icon size={18} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div className="sidebar-panel">
            <StatusChip phase={phase} />
            <span className="sidebar-line">{state.diagnostics.whisper_found ? "Whisper found" : "Whisper missing"}</span>
            <span className="sidebar-line">{state.diagnostics.model_found ? "Model found" : "Model missing"}</span>
          </div>
        </aside>

        <main className="content">
          {activeTab === "control" && (
            <ControlView
              state={state}
              phase={phase}
              commandStatus={commandStatus}
              recordingSeconds={recordingSeconds}
              primaryDisabled={primaryDisabled}
              ActionIcon={ActionIcon}
              onPrimary={handlePrimaryAction}
              onCopy={() => handleCopyText()}
              onPaste={() => handleReinsert(state.last_transcript)}
              onSetup={handleSetup}
              onOpenSettings={() => setActiveTab("settings")}
            />
          )}

          {activeTab === "settings" && (
            <SettingsView
              state={state}
              onUpdate={updateSettings}
              onSetup={handleSetup}
              onOpenDiagnostics={() => setActiveTab("diagnostics")}
            />
          )}

          {activeTab === "library" && (
            <LibraryView
              state={state}
              selectedHistory={selectedHistory}
              libraryMode={libraryMode}
              newRuleSpoken={newRuleSpoken}
              newRuleReplacement={newRuleReplacement}
              onModeChange={setLibraryMode}
              onSelectHistory={setSelectedHistoryId}
              onCopy={handleCopyText}
              onReinsert={handleReinsert}
              onDeleteHistory={handleDeleteHistory}
              onClearHistory={handleClearHistory}
              onUpdateSettings={updateSettings}
              onNewRuleSpoken={setNewRuleSpoken}
              onNewRuleReplacement={setNewRuleReplacement}
              onAddRule={handleAddRule}
              onToggleRule={toggleRule}
              onRemoveRule={removeRule}
            />
          )}

          {activeTab === "diagnostics" && (
            <DiagnosticsView
              state={state}
              updateStatus={updateStatus}
              setupMessage={setupMessage}
              commandStatus={commandStatus}
              onRefresh={refresh}
              onCheckUpdates={refreshUpdateStatus}
              onInstallUpdate={handleInstallUpdate}
              onOpenReleasePage={handleOpenReleasePage}
              onSetup={handleSetup}
              onCopyCommand={() => handleCopyText(state.diagnostics.setup_command)}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
