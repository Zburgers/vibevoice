import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clipboard,
  Home,
  Loader2,
  Mic,
  Settings,
  Square,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type TabKey = "control" | "settings" | "library" | "diagnostics";
export type LibraryMode = "history" | "dictionary";
export type VoiceState = "Ready" | "Preparing" | "Recording" | "Processing" | "Inserted" | "Copied" | "Error";
export type Phase = "ready" | "preparing" | "recording" | "transcribing" | "inserted" | "copied" | "error";
export type Tone = "good" | "warn" | "bad" | "neutral" | "accent";

export type Settings = {
  whisper_binary_path: string;
  model_path: string;
  hotkey: string;
  recording_mode: "toggle";
  auto_paste: boolean;
  clipboard_fallback: boolean;
  dictionary_cleanup: boolean;
  history_enabled: boolean;
  max_history_entries: number;
  history_retention_days: number;
  pill_always_on_top: boolean;
  start_on_login: boolean;
};

export type Diagnostics = {
  whisper_found: boolean;
  model_found: boolean;
  mic_available: boolean;
  clipboard_tool: string | null;
  paste_tool: string | null;
  whisper_path: string | null;
  model_path: string | null;
  recorder: string | null;
  input_device: string | null;
  platform: string;
  setup_available: boolean;
  setup_script_path: string | null;
  setup_command: string | null;
  last_error: string | null;
};

export type HistoryItem = {
  id: string;
  created_at: string;
  raw_transcript: string;
  final_transcript: string;
  duration_ms: number | null;
  insert_status: string;
  error: string | null;
};

export type DictionaryRule = {
  id: string;
  spoken: string;
  replacement: string;
  enabled: boolean;
};

export type AppState = {
  app_version: string;
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

export type MeterPayload = {
  mic_level: number;
};

export type UpdateStatus = {
  state: "idle" | "checking" | "available" | "current" | "installing" | "installed" | "error";
  latestVersion: string | null;
  releaseUrl: string;
  message: string;
  canInstall: boolean;
};

export const fallbackState: AppState = {
  app_version: "0.2.6",
  voice_state: "Ready",
  settings: {
    whisper_binary_path: "auto",
    model_path: "auto",
    hotkey: "Ctrl+Alt+Space",
    recording_mode: "toggle",
    auto_paste: true,
    clipboard_fallback: true,
    dictionary_cleanup: true,
    history_enabled: false,
    max_history_entries: 100,
    history_retention_days: 0,
    pill_always_on_top: true,
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
    input_device: null,
    platform: "unknown",
    setup_available: false,
    setup_script_path: null,
    setup_command: null,
    last_error: null,
  },
  history: [],
  dictionary: [],
  last_transcript: null,
  last_error: null,
  mic_level: 0,
  recording_started_at: null,
};

export const stateToPhase: Record<VoiceState, Phase> = {
  Ready: "ready",
  Preparing: "preparing",
  Recording: "recording",
  Processing: "transcribing",
  Inserted: "inserted",
  Copied: "copied",
  Error: "error",
};

export const phaseCopy: Record<Phase, string> = {
  ready: "Ready",
  preparing: "Starting",
  recording: "Recording",
  transcribing: "Transcribing",
  inserted: "Inserted",
  copied: "Copied",
  error: "Error",
};

export const phaseTone: Record<Phase, Tone> = {
  ready: "good",
  preparing: "accent",
  recording: "warn",
  transcribing: "accent",
  inserted: "good",
  copied: "good",
  error: "bad",
};

export const phaseIcons: Record<Phase, LucideIcon> = {
  ready: CheckCircle2,
  preparing: Loader2,
  recording: Mic,
  transcribing: Loader2,
  inserted: CheckCircle2,
  copied: Clipboard,
  error: AlertTriangle,
};

export const navItems: Array<{ key: TabKey; label: string; icon: LucideIcon }> = [
  { key: "control", label: "Control", icon: Home },
  { key: "settings", label: "Settings", icon: Settings },
  { key: "library", label: "Library", icon: BookOpen },
  { key: "diagnostics", label: "Diagnostics", icon: Wrench },
];

export function formatDuration(duration: number | null) {
  if (!duration) return "No duration";
  if (duration < 1000) return `${duration} ms`;
  return `${(duration / 1000).toFixed(1)} s`;
}

export function actionLabel(state: VoiceState) {
  if (state === "Recording") return "Stop recording";
  if (state === "Preparing") return "Starting";
  if (state === "Processing") return "Transcribing";
  if (state === "Error") return "Retry recording";
  return "Start recording";
}

export function canStartOrStop(state: VoiceState) {
  return state !== "Preparing" && state !== "Processing";
}

export function actionIcon(state: VoiceState): LucideIcon {
  if (state === "Recording") return Square;
  if (state === "Preparing" || state === "Processing") return Loader2;
  return Mic;
}
