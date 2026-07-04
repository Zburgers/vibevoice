use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    str::FromStr,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    thread::{self},
    time::{Duration, Instant},
};
use tauri::{
    async_runtime,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use uuid::Uuid;

#[cfg(any(target_os = "windows", target_os = "macos"))]
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    SampleFormat, Stream,
};

#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::sync::mpsc::{self, Sender};

const AUTO_PATH: &str = "auto";
const MODEL_FILE_NAME: &str = "ggml-base.en.bin";
const LEGACY_DEFAULT_WHISPER: &str = "~/tools/whisper.cpp/build/bin/whisper-cli";
const LEGACY_DEFAULT_MODEL: &str = "~/tools/whisper.cpp/models/ggml-base.en.bin";
const STATE_CHANGED_EVENT: &str = "vibevoice-state-changed";
const METER_CHANGED_EVENT: &str = "vibevoice-meter-changed";
const RELEASES_URL: &str = "https://github.com/Zburgers/vibevoice/releases";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
enum VoiceState {
    Ready,
    Preparing,
    Recording,
    Processing,
    Inserted,
    Copied,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Settings {
    whisper_binary_path: String,
    model_path: String,
    hotkey: String,
    recording_mode: String,
    auto_paste: bool,
    clipboard_fallback: bool,
    dictionary_cleanup: bool,
    history_enabled: bool,
    start_on_login: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            whisper_binary_path: AUTO_PATH.to_string(),
            model_path: AUTO_PATH.to_string(),
            hotkey: "Ctrl+Alt+Space".to_string(),
            recording_mode: "toggle".to_string(),
            auto_paste: true,
            clipboard_fallback: true,
            dictionary_cleanup: true,
            history_enabled: false,
            start_on_login: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Diagnostics {
    whisper_found: bool,
    model_found: bool,
    mic_available: bool,
    clipboard_tool: Option<String>,
    paste_tool: Option<String>,
    whisper_path: Option<String>,
    model_path: Option<String>,
    recorder: Option<String>,
    input_device: Option<String>,
    platform: String,
    setup_script_path: Option<String>,
    setup_command: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryItem {
    id: String,
    created_at: DateTime<Utc>,
    raw_transcript: String,
    final_transcript: String,
    duration_ms: Option<u128>,
    insert_status: String,
    error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DictionaryRule {
    id: String,
    spoken: String,
    replacement: String,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppStateSnapshot {
    app_version: String,
    voice_state: VoiceState,
    settings: Settings,
    diagnostics: Diagnostics,
    history: Vec<HistoryItem>,
    dictionary: Vec<DictionaryRule>,
    last_transcript: Option<String>,
    last_error: Option<String>,
    mic_level: f32,
    recording_started_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize)]
struct MeterPayload {
    mic_level: f32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct InsertActionStatus {
    insert_status: String,
    error: Option<String>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
struct RecordingSession {
    audio_path: PathBuf,
    output_prefix: PathBuf,
    started: Instant,
    started_at: DateTime<Utc>,
    stream: Stream,
    writer_tx: std::sync::mpsc::Sender<AudioWriterMessage>,
    writer_thread: Option<std::thread::JoinHandle<Result<(), String>>>,
    mic_level: Arc<AtomicU32>,
}

#[cfg(target_os = "linux")]
use std::process::Child;

#[cfg(target_os = "linux")]
struct RecordingSession {
    audio_path: PathBuf,
    output_prefix: PathBuf,
    started: Instant,
    started_at: DateTime<Utc>,
    recorder_process: Child,
    mic_level: Arc<AtomicU32>,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
unsafe impl Send for RecordingSession {}

#[cfg(target_os = "linux")]
unsafe impl Send for RecordingSession {}

#[cfg(any(target_os = "windows", target_os = "macos"))]
enum AudioWriterMessage {
    Samples(Vec<i16>),
    Stop,
}

struct RuntimeState {
    voice_state: VoiceState,
    recording: Option<RecordingSession>,
    last_transcript: Option<String>,
    last_error: Option<String>,
    mic_level: f32,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            voice_state: VoiceState::Ready,
            recording: None,
            last_transcript: None,
            last_error: None,
            mic_level: 0.0,
        }
    }
}

struct AppData {
    runtime: Mutex<RuntimeState>,
}

#[tauri::command]
fn get_app_state(app: AppHandle, data: tauri::State<AppData>) -> Result<AppStateSnapshot, String> {
    let settings = load_settings(&app)?;
    let dictionary = load_dictionary(&app)?;
    let history = load_history(&app)?;
    let runtime = data.runtime.lock().map_err(|error| error.to_string())?;
    let recording_started_at = runtime.recording.as_ref().map(|session| session.started_at);
    let mic_level = runtime
        .recording
        .as_ref()
        .map(|session| session.mic_level.load(Ordering::Relaxed) as f32 / 1000.0)
        .unwrap_or(runtime.mic_level);
    Ok(AppStateSnapshot {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        voice_state: runtime.voice_state.clone(),
        settings: settings.clone(),
        diagnostics: diagnostics(&app, &settings, runtime.last_error.clone()),
        history,
        dictionary,
        last_transcript: runtime.last_transcript.clone(),
        last_error: runtime.last_error.clone(),
        mic_level,
        recording_started_at,
    })
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    register_global_hotkey(&app, &settings.hotkey)?;
    write_json(settings_path(&app)?, &settings)
}

#[tauri::command]
async fn start_recording(app: AppHandle, data: tauri::State<'_, AppData>) -> Result<(), String> {
    begin_recording(app, data)
}

fn begin_recording(app: AppHandle, data: tauri::State<'_, AppData>) -> Result<(), String> {
    {
        let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
        match runtime.voice_state {
            VoiceState::Preparing => return Err("Recording is still starting.".to_string()),
            VoiceState::Recording => return Err("Recording is already active.".to_string()),
            VoiceState::Processing => {
                return Err("Recording is still processing. Please wait.".to_string())
            }
            _ => {}
        }
        runtime.voice_state = VoiceState::Preparing;
        runtime.last_error = None;
        runtime.mic_level = 0.0;
        runtime.recording = None;
    }
    emit_state_changed(&app);

    let app_handle = app.clone();
    async_runtime::spawn_blocking(move || match prepare_recording_session(&app_handle) {
        Ok(mut session) => {
            let mic_level = Arc::clone(&session.mic_level);
            let data = app_handle.state::<AppData>();
            let mut runtime = match data.runtime.lock() {
                Ok(runtime) => runtime,
                Err(error) => {
                    let _ = stop_audio_capture(&mut session);
                    let _ = set_runtime_error(&data, &error.to_string());
                    emit_state_changed(&app_handle);
                    return;
                }
            };
            if !matches!(runtime.voice_state, VoiceState::Preparing) {
                let _ = stop_audio_capture(&mut session);
                return;
            }
            runtime.voice_state = VoiceState::Recording;
            runtime.last_error = None;
            runtime.mic_level = 0.0;
            runtime.recording = Some(session);
            drop(runtime);
            emit_state_changed(&app_handle);
            spawn_meter_emitter(app_handle.clone(), mic_level);
        }
        Err(error) => {
            let data = app_handle.state::<AppData>();
            let _ = set_runtime_error(&data, &error);
            emit_state_changed(&app_handle);
        }
    });
    Ok(())
}

fn prepare_recording_session(app: &AppHandle) -> Result<RecordingSession, String> {
    let settings = load_settings(app)?;
    ensure_engine_ready(&settings)?;
    let tmp = temp_workspace();
    fs::create_dir_all(&tmp).map_err(|error| error.to_string())?;
    let stem = format!("recording-{}", Uuid::new_v4());
    let audio_path = tmp.join(format!("{stem}.wav"));
    let output_prefix = tmp.join(stem);
    let session = start_audio_capture(audio_path, output_prefix)?;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    start_recording_stream(&session)?;
    Ok(session)
}

#[tauri::command]
async fn stop_recording(app: AppHandle, data: tauri::State<'_, AppData>) -> Result<(), String> {
    let mut session = {
        let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
        match runtime.recording.take() {
            Some(session) => {
                runtime.voice_state = VoiceState::Processing;
                session
            }
            None => {
                let message = if matches!(runtime.voice_state, VoiceState::Preparing) {
                    "Recording is still starting. Try stopping again in a moment."
                } else {
                    "No active recording to stop."
                };
                runtime.voice_state = if matches!(runtime.voice_state, VoiceState::Preparing) {
                    VoiceState::Preparing
                } else {
                    VoiceState::Ready
                };
                runtime.last_error = Some(message.to_string());
                return Err(message.to_string());
            }
        }
    };
    emit_state_changed(&app);

    let app_handle = app.clone();
    async_runtime::spawn_blocking(move || {
        if let Err(error) = finish_recording(app_handle.clone(), &mut session) {
            let state = app_handle.state::<AppData>();
            let _ = set_runtime_error(&state, &error);
            emit_state_changed(&app_handle);
        }
    });
    Ok(())
}

fn finish_recording(app: AppHandle, session: &mut RecordingSession) -> Result<HistoryItem, String> {
    stop_audio_capture(session)?;
    let settings = load_settings(&app)?;
    let dictionary = load_dictionary(&app)?;
    let raw_transcript = transcribe(&settings, &session.audio_path, &session.output_prefix)?;
    let mut final_transcript = cleanup_transcript(&raw_transcript);
    if settings.dictionary_cleanup {
        final_transcript = apply_dictionary(&final_transcript, &dictionary);
    }

    if final_transcript.is_empty() {
        let message = "Whisper returned an empty transcript.".to_string();
        return Err(message);
    }

    let copy_result = settings
        .clipboard_fallback
        .then(|| copy_to_clipboard(&app, &final_transcript));
    let paste_result = if settings.auto_paste && !matches!(copy_result, Some(Err(_))) {
        Some(paste_from_clipboard())
    } else {
        None
    };
    let action_status = resolve_insert_status(
        settings.clipboard_fallback,
        settings.auto_paste,
        copy_result,
        paste_result,
    );

    let item = HistoryItem {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now(),
        raw_transcript,
        final_transcript: final_transcript.clone(),
        duration_ms: Some(session.started.elapsed().as_millis()),
        insert_status: action_status.insert_status.clone(),
        error: action_status.error.clone(),
    };
    if settings.history_enabled {
        append_history(&app, item.clone())?;
    }

    let data = app.state::<AppData>();
    let mut runtime = data
        .runtime
        .lock()
        .map_err(|lock_error| lock_error.to_string())?;
    runtime.voice_state = voice_state_for_insert_status(&action_status);
    runtime.last_transcript = Some(final_transcript);
    runtime.last_error = action_status.error;
    runtime.mic_level = 0.0;
    drop(runtime);
    emit_state_changed(&app);
    Ok(item)
}

#[tauri::command]
async fn copy_text(
    app: AppHandle,
    text: String,
    data: tauri::State<'_, AppData>,
) -> Result<(), String> {
    copy_to_clipboard(&app, &text)?;
    let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
    runtime.voice_state = VoiceState::Copied;
    runtime.last_transcript = Some(text);
    runtime.last_error = None;
    drop(runtime);
    emit_state_changed(&app);
    Ok(())
}

#[tauri::command]
async fn insert_text(
    app: AppHandle,
    text: String,
    data: tauri::State<'_, AppData>,
) -> Result<(), String> {
    copy_to_clipboard(&app, &text)?;
    async_runtime::spawn_blocking(paste_from_clipboard)
        .await
        .map_err(|error| format!("Paste task failed: {error}"))??;
    let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
    runtime.voice_state = VoiceState::Inserted;
    runtime.last_transcript = Some(text);
    runtime.last_error = None;
    drop(runtime);
    emit_state_changed(&app);
    Ok(())
}

#[tauri::command]
fn delete_history_item(app: AppHandle, id: String) -> Result<(), String> {
    let history: Vec<HistoryItem> = load_history(&app)?
        .into_iter()
        .filter(|item| item.id != id)
        .collect();
    write_json(history_path(&app)?, &history)
}

#[tauri::command]
fn clear_history(app: AppHandle) -> Result<(), String> {
    write_json(history_path(&app)?, &Vec::<HistoryItem>::new())
}

#[tauri::command]
fn add_dictionary_rule(app: AppHandle, spoken: String, replacement: String) -> Result<(), String> {
    let mut dictionary = load_dictionary(&app)?;
    dictionary.push(DictionaryRule {
        id: Uuid::new_v4().to_string(),
        spoken: spoken.trim().to_string(),
        replacement: replacement.trim().to_string(),
        enabled: true,
    });
    write_json(dictionary_path(&app)?, &dictionary)
}

#[tauri::command]
fn delete_dictionary_rule(app: AppHandle, id: String) -> Result<(), String> {
    let dictionary: Vec<DictionaryRule> = load_dictionary(&app)?
        .into_iter()
        .filter(|rule| rule.id != id)
        .collect();
    write_json(dictionary_path(&app)?, &dictionary)
}

#[tauri::command]
fn set_dictionary_rule_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    let mut dictionary = load_dictionary(&app)?;
    for rule in &mut dictionary {
        if rule.id == id {
            rule.enabled = enabled;
        }
    }
    write_json(dictionary_path(&app)?, &dictionary)
}

fn setup_script_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "scripts/install-windows.ps1"
    } else {
        "scripts/install-engine.sh"
    }
}

fn setup_script_path(app: &AppHandle) -> Option<PathBuf> {
    find_repo_file(app, setup_script_name()).filter(|script| script.exists())
}

fn setup_command(script: &Path) -> String {
    if cfg!(target_os = "windows") {
        format!(
            "powershell -NoProfile -ExecutionPolicy Bypass -File \"{}\"",
            script.display()
        )
    } else {
        format!("bash \"{}\"", script.display())
    }
}

#[tauri::command]
fn run_setup_script(app: AppHandle, data: tauri::State<AppData>) -> Result<String, String> {
    let script_name = setup_script_name();
    let script =
        setup_script_path(&app).ok_or_else(|| format!("Setup script not found: {script_name}"))?;
    if !script.exists() {
        return Err(format!("Setup script not found: {}", script.display()));
    }
    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("powershell");
        command.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]);
        command.arg(script);
        command
    } else {
        let mut command = Command::new("bash");
        command.arg(script);
        command
    };
    let output = command
        .output()
        .map_err(|error| format!("Setup failed to start: {error}"))?;
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if output.status.success() {
        Ok(combined)
    } else {
        set_runtime_error(&data, &combined)?;
        Err(combined)
    }
}

#[tauri::command]
async fn show_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        // Window exists – just show and focus it
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    } else {
        // Window was fully closed; re-create it from the config
        tauri::WebviewWindowBuilder::from_config(
            &app,
            app.config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .ok_or_else(|| "Main window config not found".to_string())?,
        )
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_release_page(url: Option<String>) -> Result<(), String> {
    let url = url.unwrap_or_else(|| RELEASES_URL.to_string());
    if !url.starts_with(RELEASES_URL) {
        return Err("Release URL is outside the VibeVoice repository.".to_string());
    }

    let mut command = if cfg!(target_os = "windows") {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", &url]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&url);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&url);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open release page: {error}"))
}

fn load_settings(app: &AppHandle) -> Result<Settings, String> {
    read_json_or_default(settings_path(app)?)
}

fn load_dictionary(app: &AppHandle) -> Result<Vec<DictionaryRule>, String> {
    let path = dictionary_path(app)?;
    if path.exists() {
        read_json_or_default(path)
    } else {
        let defaults = default_dictionary();
        write_json(path, &defaults)?;
        Ok(defaults)
    }
}

fn load_history(app: &AppHandle) -> Result<Vec<HistoryItem>, String> {
    let mut history: Vec<HistoryItem> = read_json_or_default(history_path(app)?)?;
    history.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    history.truncate(100);
    Ok(history)
}

fn append_history(app: &AppHandle, item: HistoryItem) -> Result<(), String> {
    let mut history = load_history(app)?;
    history.insert(0, item);
    history.truncate(100);
    write_json(history_path(app)?, &history)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("settings.json"))
}

fn dictionary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("dictionary.json"))
}

fn history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(config_dir(app)?.join("history.json"))
}

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().unwrap_or_else(|_| {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("vibevoice")
    });
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn find_repo_file(app: &AppHandle, relative: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(current) = std::env::current_dir() {
        candidates.push(current);
    }
    if let Ok(resource) = app.path().resource_dir() {
        candidates.push(resource);
    }

    for base in candidates {
        let mut cursor = Some(base.as_path());
        while let Some(path) = cursor {
            for candidate in [
                path.join(relative),
                path.join("_up").join("_up").join(relative),
            ] {
                if candidate.exists() {
                    return Some(candidate);
                }
            }
            cursor = path.parent();
        }
    }
    None
}

fn read_json_or_default<T>(path: PathBuf) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Default,
{
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).map_err(|error| error.to_string()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.to_string()),
    }
}

fn write_json<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

#[derive(Debug, Clone)]
struct EnginePaths {
    whisper_binary: PathBuf,
    model: PathBuf,
}

fn expand_home(path: &str) -> PathBuf {
    let expanded = if let Some(rest) = path.strip_prefix("~/") {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest)
    } else if let Some(rest) = path.strip_prefix("$HOME/") {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest)
    } else if let Some(rest) = path.strip_prefix("%USERPROFILE%\\") {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest)
    } else if let Some(rest) = path.strip_prefix("%LOCALAPPDATA%\\") {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(rest)
    } else {
        PathBuf::from(path)
    };
    expanded
}

fn diagnostics(app: &AppHandle, settings: &Settings, last_error: Option<String>) -> Diagnostics {
    let resolved = resolve_engine_paths(settings).ok();
    let setup_script = setup_script_path(app);
    Diagnostics {
        whisper_found: resolved
            .as_ref()
            .is_some_and(|paths| paths.whisper_binary.is_file()),
        model_found: resolved.as_ref().is_some_and(|paths| paths.model.is_file()),
        mic_available: default_input_device_available(),
        clipboard_tool: clipboard_tool_name(),
        paste_tool: paste_tool_name(),
        whisper_path: resolved
            .as_ref()
            .map(|paths| paths.whisper_binary.display().to_string()),
        model_path: resolved
            .as_ref()
            .map(|paths| paths.model.display().to_string()),
        recorder: recorder_name(),
        input_device: input_device_name(),
        platform: std::env::consts::OS.to_string(),
        setup_script_path: setup_script
            .as_ref()
            .map(|script| script.display().to_string()),
        setup_command: setup_script.as_ref().map(|script| setup_command(script)),
        last_error,
    }
}

fn ensure_engine_ready(settings: &Settings) -> Result<(), String> {
    let paths = resolve_engine_paths(settings)?;
    if !paths.whisper_binary.is_file() {
        return Err(format!(
            "Whisper binary missing: {}",
            paths.whisper_binary.display()
        ));
    }
    if !paths.model.is_file() {
        return Err(format!("Model file missing: {}", paths.model.display()));
    }
    if !default_input_device_available() {
        return Err("No default microphone input device is available.".to_string());
    }
    Ok(())
}

fn transcribe(
    settings: &Settings,
    audio_path: &Path,
    output_prefix: &Path,
) -> Result<String, String> {
    let paths = resolve_engine_paths(settings)?;
    let output = Command::new(paths.whisper_binary)
        .arg("-m")
        .arg(paths.model)
        .arg("-f")
        .arg(audio_path)
        .args(["-otxt", "-nt", "-np"])
        .arg("-of")
        .arg(output_prefix)
        .output()
        .map_err(|error| format!("Transcription failed to start: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Transcription failed: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    fs::read_to_string(output_prefix.with_extension("txt"))
        .map_err(|error| format!("Transcript file missing: {error}"))
}

fn resolve_engine_paths(settings: &Settings) -> Result<EnginePaths, String> {
    resolve_engine_paths_with_candidates(settings, &candidate_engine_roots())
}

fn resolve_engine_paths_with_candidates(
    settings: &Settings,
    extra_candidates: &[PathBuf],
) -> Result<EnginePaths, String> {
    let whisper_explicit = explicit_path(&settings.whisper_binary_path);
    let model_explicit = explicit_path(&settings.model_path);

    if let Some(path) = whisper_explicit.as_ref() {
        if !path.is_file() {
            return Err(format!(
                "Configured Whisper binary does not exist: {}",
                path.display()
            ));
        }
    }
    if let Some(path) = model_explicit.as_ref() {
        if !path.is_file() {
            return Err(format!(
                "Configured model file does not exist: {}",
                path.display()
            ));
        }
    }

    if let (Some(whisper_binary), Some(model)) = (whisper_explicit.clone(), model_explicit.clone())
    {
        return Ok(EnginePaths {
            whisper_binary,
            model,
        });
    }

    let mut roots = Vec::new();
    roots.extend(extra_candidates.iter().cloned());
    roots.extend(candidate_engine_roots());

    let discovered = discover_engine_in_roots(&roots);
    let whisper_binary = whisper_explicit
        .or_else(|| {
            discovered
                .as_ref()
                .map(|paths| paths.whisper_binary.clone())
        })
        .ok_or_else(|| "Whisper binary not found. Run setup to install whisper.cpp.".to_string())?;
    let model = model_explicit
        .or_else(|| model_near_binary(&whisper_binary))
        .or_else(|| discovered.as_ref().map(|paths| paths.model.clone()))
        .ok_or_else(|| format!("{MODEL_FILE_NAME} not found. Run setup to download the model."))?;

    Ok(EnginePaths {
        whisper_binary,
        model,
    })
}

fn explicit_path(value: &str) -> Option<PathBuf> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.eq_ignore_ascii_case(AUTO_PATH)
        || trimmed == LEGACY_DEFAULT_WHISPER
        || trimmed == LEGACY_DEFAULT_MODEL
    {
        None
    } else {
        Some(expand_home(trimmed))
    }
}

fn candidate_engine_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for name in ["VIBEVOICE_ENGINE_DIR", "WHISPER_ROOT", "WHISPER_CPP_ROOT"] {
        if let Ok(value) = std::env::var(name) {
            if !value.trim().is_empty() {
                roots.push(expand_home(&value));
            }
        }
    }
    if let Some(data_dir) = dirs::data_local_dir() {
        roots.push(data_dir.join("vibevoice").join("engines"));
        roots.push(data_dir.join("VibeVoice").join("engines"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join("tools"));
        roots.push(
            home.join(".local")
                .join("share")
                .join("vibevoice")
                .join("engines"),
        );
    }
    if let Ok(current) = std::env::current_dir() {
        roots.push(current);
    }
    roots
}

fn discover_engine_in_roots(roots: &[PathBuf]) -> Option<EnginePaths> {
    for base in roots {
        for root in whisper_root_candidates(base) {
            if let Some(paths) = engine_paths_under_root(&root) {
                return Some(paths);
            }
        }
    }
    None
}

fn whisper_root_candidates(base: &Path) -> Vec<PathBuf> {
    vec![
        base.to_path_buf(),
        base.join("whisper.cpp"),
        base.join("engines").join("whisper.cpp"),
        base.join("tools").join("whisper.cpp"),
    ]
}

fn engine_paths_under_root(root: &Path) -> Option<EnginePaths> {
    let binary_name = executable_name("whisper-cli");
    let binary_candidates = [
        root.join("build").join("bin").join(&binary_name),
        root.join("build")
            .join("bin")
            .join("Release")
            .join(&binary_name),
        root.join(&binary_name),
    ];
    let model = root.join("models").join(MODEL_FILE_NAME);
    binary_candidates
        .into_iter()
        .find(|binary| binary.is_file() && model.is_file())
        .map(|whisper_binary| EnginePaths {
            whisper_binary,
            model,
        })
}

fn model_near_binary(binary: &Path) -> Option<PathBuf> {
    for ancestor in binary.ancestors().take(6) {
        let model = ancestor.join("models").join(MODEL_FILE_NAME);
        if model.is_file() {
            return Some(model);
        }
    }
    None
}

fn executable_name(base: &str) -> String {
    if cfg!(target_os = "windows") && !base.ends_with(".exe") {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

fn temp_workspace() -> PathBuf {
    std::env::temp_dir().join("vibevoice")
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn default_input_device_available() -> bool {
    cpal::default_host().default_input_device().is_some()
}

#[cfg(target_os = "linux")]
fn default_input_device_available() -> bool {
    recorder_command().is_some()
}

fn start_audio_capture(
    audio_path: PathBuf,
    output_prefix: PathBuf,
) -> Result<RecordingSession, String> {
    start_audio_capture_impl(audio_path, output_prefix)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn start_audio_capture_impl(
    audio_path: PathBuf,
    output_prefix: PathBuf,
) -> Result<RecordingSession, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| "No default microphone input device found.".to_string())?;
    let supported_config = device
        .default_input_config()
        .map_err(|error| format!("Microphone config unavailable: {error}"))?;
    let sample_format = supported_config.sample_format();
    let config: cpal::StreamConfig = supported_config.into();
    let channels = config.channels as usize;
    let sample_rate = config.sample_rate.0;
    let mic_level = Arc::new(AtomicU32::new(0));
    let (writer_tx, writer_rx) = mpsc::channel::<AudioWriterMessage>();
    let writer_path = audio_path.clone();
    let writer_thread = thread::spawn(move || -> Result<(), String> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&writer_path, spec)
            .map_err(|error| format!("Could not create WAV file: {error}"))?;
        while let Ok(message) = writer_rx.recv() {
            match message {
                AudioWriterMessage::Samples(samples) => {
                    for sample in samples {
                        writer
                            .write_sample(sample)
                            .map_err(|error| format!("Could not write WAV sample: {error}"))?;
                    }
                }
                AudioWriterMessage::Stop => break,
            }
        }
        writer
            .finalize()
            .map_err(|error| format!("Could not finalize WAV file: {error}"))
    });

    let stream = match sample_format {
        SampleFormat::F32 => {
            let stream_tx = writer_tx.clone();
            let stream_level = Arc::clone(&mic_level);
            device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    write_mono_samples(data, channels, &stream_tx, &stream_level, f32_to_i16)
                },
                audio_stream_error_impl,
                None,
            )
        }
        SampleFormat::I16 => {
            let stream_tx = writer_tx.clone();
            let stream_level = Arc::clone(&mic_level);
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    write_mono_samples(data, channels, &stream_tx, &stream_level, |sample| sample)
                },
                audio_stream_error_impl,
                None,
            )
        }
        SampleFormat::U16 => {
            let stream_tx = writer_tx.clone();
            let stream_level = Arc::clone(&mic_level);
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    write_mono_samples(data, channels, &stream_tx, &stream_level, u16_to_i16)
                },
                audio_stream_error_impl,
                None,
            )
        }
        _ => {
            return Err(format!(
                "Unsupported microphone sample format: {sample_format:?}"
            ))
        }
    }
    .map_err(|error| format!("Could not open microphone stream: {error}"))?;

    Ok(RecordingSession {
        audio_path,
        output_prefix,
        started: Instant::now(),
        started_at: Utc::now(),
        stream,
        writer_tx,
        writer_thread: Some(writer_thread),
        mic_level,
    })
}

#[cfg(target_os = "linux")]
fn start_audio_capture_impl(
    audio_path: PathBuf,
    output_prefix: PathBuf,
) -> Result<RecordingSession, String> {
    let (command, args) = recorder_command().ok_or_else(|| {
        "No supported Linux audio recorder found. Install pw-record, arecord, or ffmpeg."
            .to_string()
    })?;
    let child = Command::new(command)
        .args(args)
        .arg(&audio_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Audio recorder failed to start: {error}"))?;

    Ok(RecordingSession {
        audio_path,
        output_prefix,
        started: Instant::now(),
        started_at: Utc::now(),
        recorder_process: child,
        mic_level: Arc::new(AtomicU32::new(0)),
    })
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn audio_stream_error_impl(error: cpal::StreamError) {
    eprintln!("VibeVoice audio stream error: {error}");
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn start_recording_stream(session: &RecordingSession) -> Result<(), String> {
    session
        .stream
        .play()
        .map_err(|error| format!("Recording failed to start: {error}"))
}

fn stop_audio_capture(session: &mut RecordingSession) -> Result<(), String> {
    stop_audio_capture_impl(session)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn stop_audio_capture_impl(session: &mut RecordingSession) -> Result<(), String> {
    let _ = session.stream.pause();
    let _ = session.writer_tx.send(AudioWriterMessage::Stop);
    if let Some(writer_thread) = session.writer_thread.take() {
        writer_thread
            .join()
            .map_err(|_| "Audio writer thread panicked.".to_string())??;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
fn stop_audio_capture_impl(session: &mut RecordingSession) -> Result<(), String> {
    stop_linux_recorder(&mut session.recorder_process)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn write_mono_samples<T, F>(
    data: &[T],
    channels: usize,
    writer_tx: &Sender<AudioWriterMessage>,
    mic_level: &Arc<AtomicU32>,
    convert: F,
) where
    T: Copy,
    F: Fn(T) -> i16,
{
    if channels == 0 {
        return;
    }
    let mut output = Vec::with_capacity(data.len() / channels.max(1));
    let mut peak = 0_u32;
    for frame in data.chunks(channels) {
        let sum = frame
            .iter()
            .map(|sample| convert(*sample) as i32)
            .sum::<i32>();
        let mono = (sum / frame.len() as i32).clamp(i16::MIN as i32, i16::MAX as i32) as i16;
        peak = peak.max(mono.unsigned_abs() as u32);
        output.push(mono);
    }
    mic_level.store(
        ((peak as f32 / i16::MAX as f32) * 1000.0) as u32,
        Ordering::Relaxed,
    );
    let _ = writer_tx.send(AudioWriterMessage::Samples(output));
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn f32_to_i16(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn u16_to_i16(sample: u16) -> i16 {
    (sample as i32 - 32768).clamp(i16::MIN as i32, i16::MAX as i32) as i16
}

#[cfg(target_os = "linux")]
fn recorder_name() -> Option<String> {
    recorder_command().map(|(name, _)| name.to_string())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn recorder_name() -> Option<String> {
    Some("cpal".to_string())
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn input_device_name() -> Option<String> {
    cpal::default_host()
        .default_input_device()
        .and_then(|device| device.name().ok())
}

#[cfg(target_os = "linux")]
fn input_device_name() -> Option<String> {
    recorder_name().map(|recorder| format!("System default via {recorder}"))
}

#[cfg(target_os = "linux")]
fn recorder_command() -> Option<(&'static str, &'static [&'static str])> {
    if command_exists("pw-record") {
        Some((
            "pw-record",
            &["--rate", "16000", "--channels", "1", "--format", "s16"],
        ))
    } else if command_exists("arecord") {
        Some((
            "arecord",
            &["-q", "-c", "1", "-r", "16000", "-f", "S16_LE", "-t", "wav"],
        ))
    } else if command_exists("ffmpeg") {
        Some((
            "ffmpeg",
            &[
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-f",
                "pulse",
                "-i",
                "default",
                "-ac",
                "1",
                "-ar",
                "16000",
            ],
        ))
    } else {
        None
    }
}

#[cfg(target_os = "linux")]
fn stop_linux_recorder(child: &mut Child) -> Result<(), String> {
    let pid = child.id() as i32;
    unsafe {
        let _ = libc::kill(pid, libc::SIGINT);
    }
    for _ in 0..20 {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(());
        }
        thread::sleep(std::time::Duration::from_millis(100));
    }
    child
        .kill()
        .map_err(|error| format!("Failed to stop recorder: {error}"))?;
    let _ = child.wait();
    Ok(())
}

fn cleanup_transcript(text: &str) -> String {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('[') && trimmed.contains("-->") {
                None
            } else {
                Some(trimmed)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn apply_dictionary(text: &str, dictionary: &[DictionaryRule]) -> String {
    let mut result = text.to_string();
    for rule in dictionary.iter().filter(|rule| rule.enabled) {
        result = replace_case_insensitive(&result, &rule.spoken, &rule.replacement);
    }
    result
}

fn replace_case_insensitive(input: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return input.to_string();
    }
    let lower_input = input.to_lowercase();
    let lower_needle = needle.to_lowercase();
    let mut output = String::new();
    let mut index = 0;
    while let Some(found) = lower_input[index..].find(&lower_needle) {
        let start = index + found;
        let end = start + needle.len();
        output.push_str(&input[index..start]);
        output.push_str(replacement);
        index = end;
    }
    output.push_str(&input[index..]);
    output
}

fn copy_to_clipboard(app: &AppHandle, text: &str) -> Result<String, String> {
    app.clipboard()
        .write_text(text)
        .map_err(|error| format!("Clipboard write failed: {error}"))?;
    Ok("tauri-clipboard".to_string())
}

fn paste_from_clipboard() -> Result<String, String> {
    if cfg!(target_os = "windows") {
        let status = Command::new("powershell")
            .args([
                "-STA",
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
            ])
            .status()
            .map_err(|error| format!("Windows paste failed: {error}"))?;
        return if status.success() {
            Ok("powershell:SendKeys".to_string())
        } else {
            Err(
                "Windows paste command exited with an error. Transcript remains in clipboard."
                    .to_string(),
            )
        };
    }
    let candidates: [(&str, &[&str]); 3] = [
        ("wtype", &["-M", "ctrl", "v", "-m", "ctrl"]),
        ("xdotool", &["key", "ctrl+v"]),
        ("ydotool", &["key", "29:1", "47:1", "47:0", "29:0"]),
    ];
    for (cmd, args) in candidates {
        if command_exists(cmd) {
            let status = Command::new(cmd)
                .args(args)
                .status()
                .map_err(|error| format!("{cmd} failed: {error}"))?;
            return if status.success() {
                Ok(cmd.to_string())
            } else {
                Err(format!(
                    "{cmd} exited with an error. Transcript remains in clipboard."
                ))
            };
        }
    }
    Err("Paste tool missing. Install wtype on Wayland or xdotool on X11.".to_string())
}

fn command_exists(name: &str) -> bool {
    if cfg!(target_os = "windows") {
        return Command::new("where")
            .arg(name)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|status| status.success())
            .unwrap_or(false);
    }
    Command::new("sh")
        .arg("-c")
        .arg(format!(
            "command -v '{}' >/dev/null 2>&1",
            name.replace('\'', "")
        ))
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn first_command(names: &[&str]) -> Option<String> {
    names
        .iter()
        .find(|name| command_exists(name))
        .map(|name| (*name).to_string())
}

fn clipboard_tool_name() -> Option<String> {
    Some("tauri-clipboard".to_string())
}

fn paste_tool_name() -> Option<String> {
    if cfg!(target_os = "windows") {
        return command_exists("powershell").then(|| "powershell:SendKeys".to_string());
    }
    first_command(&["wtype", "xdotool", "ydotool"])
}

fn resolve_insert_status(
    clipboard_fallback: bool,
    auto_paste: bool,
    copy_result: Option<Result<String, String>>,
    paste_result: Option<Result<String, String>>,
) -> InsertActionStatus {
    let mut insert_status = "none".to_string();
    let mut error = None;

    if clipboard_fallback {
        match copy_result {
            Some(Ok(tool)) => insert_status = format!("copied:{tool}"),
            Some(Err(copy_error)) => {
                error = Some(copy_error);
                insert_status = "clipboard_failed".to_string();
            }
            None => {
                error = Some("Clipboard copy was not attempted.".to_string());
                insert_status = "clipboard_failed".to_string();
            }
        }
    }

    if auto_paste {
        match paste_result {
            Some(Ok(tool)) => insert_status = format!("inserted:{tool}"),
            Some(Err(paste_error)) => {
                if error.is_none() {
                    error = Some(paste_error);
                }
                if insert_status.starts_with("copied") {
                    insert_status = "copied".to_string();
                }
            }
            None if !clipboard_fallback => {
                error = Some("Paste requires clipboard copy to run first.".to_string());
            }
            None => {}
        }
    }

    InsertActionStatus {
        insert_status,
        error,
    }
}

fn voice_state_for_insert_status(status: &InsertActionStatus) -> VoiceState {
    if status.insert_status.starts_with("inserted") {
        VoiceState::Inserted
    } else if status.insert_status.starts_with("copied") {
        VoiceState::Copied
    } else if status.error.is_some() {
        VoiceState::Error
    } else {
        VoiceState::Ready
    }
}

fn default_dictionary() -> Vec<DictionaryRule> {
    [
        ("next js", "Next.js"),
        ("react js", "React.js"),
        ("typescript", "TypeScript"),
        ("java script", "JavaScript"),
        ("node js", "Node.js"),
        ("super base", "Supabase"),
        ("post gres", "PostgreSQL"),
        ("postgress", "PostgreSQL"),
        ("github", "GitHub"),
        ("github actions", "GitHub Actions"),
        ("open ai", "OpenAI"),
        ("open router", "OpenRouter"),
        ("tail wind", "Tailwind"),
        ("docker compose", "Docker Compose"),
        ("fast api", "FastAPI"),
    ]
    .into_iter()
    .map(|(spoken, replacement)| DictionaryRule {
        id: Uuid::new_v4().to_string(),
        spoken: spoken.to_string(),
        replacement: replacement.to_string(),
        enabled: true,
    })
    .collect()
}

fn set_runtime_error(data: &tauri::State<AppData>, message: &str) -> Result<(), String> {
    let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
    runtime.voice_state = VoiceState::Error;
    runtime.last_error = Some(message.to_string());
    runtime.mic_level = 0.0;
    Ok(())
}

fn emit_state_changed(app: &AppHandle) {
    let _ = app.emit(STATE_CHANGED_EVENT, ());
}

fn emit_meter_changed(app: &AppHandle, mic_level: f32) {
    let _ = app.emit(METER_CHANGED_EVENT, MeterPayload { mic_level });
}

fn spawn_meter_emitter(app: AppHandle, mic_level: Arc<AtomicU32>) {
    thread::spawn(move || loop {
        let is_recording = app
            .state::<AppData>()
            .runtime
            .lock()
            .map(|runtime| matches!(runtime.voice_state, VoiceState::Recording))
            .unwrap_or(false);
        if !is_recording {
            break;
        }
        emit_meter_changed(&app, mic_level.load(Ordering::Relaxed) as f32 / 1000.0);
        thread::sleep(Duration::from_millis(180));
    });
}

fn parse_hotkey(hotkey: &str) -> Result<Shortcut, String> {
    let normalized = hotkey
        .replace("Ctrl", "Control")
        .replace("ctrl", "Control")
        .replace(' ', "");
    Shortcut::from_str(&normalized).or_else(|_| {
        if normalized.eq_ignore_ascii_case("Control+Alt+Space") {
            Ok(Shortcut::new(
                Some(Modifiers::CONTROL | Modifiers::ALT),
                Code::Space,
            ))
        } else {
            Err(format!("Unsupported hotkey: {hotkey}. Try Ctrl+Alt+Space."))
        }
    })
}

fn register_hotkey_handler(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    let app_handle = app.clone();
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| format!("Hotkey unregister failed: {error}"))?;
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let state = app_handle.state::<AppData>();
            let is_recording = state
                .runtime
                .lock()
                .map(|runtime| matches!(runtime.voice_state, VoiceState::Recording))
                .unwrap_or(false);
            if is_recording {
                let app_for_stop = app_handle.clone();
                async_runtime::spawn(async move {
                    let state = app_for_stop.state::<AppData>();
                    let _ = stop_recording(app_for_stop.clone(), state).await;
                });
            } else {
                let app_for_start = app_handle.clone();
                async_runtime::spawn(async move {
                    let state = app_for_start.state::<AppData>();
                    let _ = start_recording(app_for_start.clone(), state).await;
                });
            }
        })
        .map_err(|error| format!("Hotkey registration failed: {error}"))
}

fn register_global_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey)?;
    register_hotkey_handler(app, shortcut)
}

fn show_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn toggle_window(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        match window.is_visible() {
            Ok(true) => {
                let _ = window.hide();
            }
            _ => {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    }
}

fn toggle_recording(app: &AppHandle) {
    let state = app.state::<AppData>();
    let is_recording = state
        .runtime
        .lock()
        .map(|runtime| matches!(runtime.voice_state, VoiceState::Recording))
        .unwrap_or(false);
    if is_recording {
        let app_for_stop = app.clone();
        async_runtime::spawn(async move {
            let state = app_for_stop.state::<AppData>();
            let _ = stop_recording(app_for_stop.clone(), state).await;
        });
    } else {
        let app_for_start = app.clone();
        async_runtime::spawn(async move {
            let state = app_for_start.state::<AppData>();
            let _ = start_recording(app_for_start.clone(), state).await;
        });
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let show_item = MenuItem::with_id(app, "show", "Show VibeVoice", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let pill_item = MenuItem::with_id(app, "toggle_pill", "Show or Hide Pill", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let record_item = MenuItem::with_id(
        app,
        "toggle_recording",
        "Start or Stop Recording",
        true,
        None::<&str>,
    )
    .map_err(|error| error.to_string())?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit VibeVoice", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(app, &[&show_item, &pill_item, &record_item, &quit_item])
        .map_err(|error| error.to_string())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "Default window icon is unavailable.".to_string())?;

    TrayIconBuilder::with_id("vibevoice")
        .icon(icon)
        .tooltip("VibeVoice")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app, "main"),
            "toggle_pill" => toggle_window(app, "pill"),
            "toggle_recording" => toggle_recording(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_window(tray.app_handle(), "main"),
            _ => {}
        })
        .build(app)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppData {
            runtime: Mutex::new(RuntimeState::default()),
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            save_settings,
            start_recording,
            stop_recording,
            copy_text,
            insert_text,
            delete_history_item,
            clear_history,
            add_dictionary_rule,
            delete_dictionary_rule,
            set_dictionary_rule_enabled,
            run_setup_script,
            open_release_page,
            show_main_window
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            let hotkey = load_settings(app.handle())
                .map(|settings| settings.hotkey)
                .unwrap_or_else(|_| Settings::default().hotkey);
            if let Err(error) = register_global_hotkey(app.handle(), &hotkey) {
                if let Ok(mut runtime) = app.state::<AppData>().runtime.lock() {
                    runtime.voice_state = VoiceState::Error;
                    runtime.last_error = Some(error);
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running VibeVoice");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_explicit_existing_engine_paths_first() {
        let root = std::env::temp_dir().join(format!("vibevoice-test-{}", Uuid::new_v4()));
        let bin_dir = root.join("bin");
        let model_dir = root.join("models");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&model_dir).unwrap();
        let whisper = bin_dir.join(executable_name("whisper-cli"));
        let model = model_dir.join("ggml-base.en.bin");
        fs::write(&whisper, "").unwrap();
        fs::write(&model, "").unwrap();

        let settings = Settings {
            whisper_binary_path: whisper.to_string_lossy().to_string(),
            model_path: model.to_string_lossy().to_string(),
            ..Settings::default()
        };

        let resolved = resolve_engine_paths_with_candidates(&settings, &[]).unwrap();

        assert_eq!(resolved.whisper_binary, whisper);
        assert_eq!(resolved.model, model);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn auto_discovers_whisper_from_candidate_roots() {
        let root = std::env::temp_dir().join(format!("vibevoice-test-{}", Uuid::new_v4()));
        let whisper_root = root.join("engines").join("whisper.cpp");
        let bin_dir = whisper_root.join("build").join("bin");
        let model_dir = whisper_root.join("models");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::create_dir_all(&model_dir).unwrap();
        let whisper = bin_dir.join(executable_name("whisper-cli"));
        let model = model_dir.join("ggml-base.en.bin");
        fs::write(&whisper, "").unwrap();
        fs::write(&model, "").unwrap();

        let settings = Settings {
            whisper_binary_path: "auto".to_string(),
            model_path: "auto".to_string(),
            ..Settings::default()
        };

        let resolved = resolve_engine_paths_with_candidates(&settings, &[root.clone()]).unwrap();

        assert_eq!(resolved.whisper_binary, whisper);
        assert_eq!(resolved.model, model);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn action_status_keeps_copy_success_when_paste_fails() {
        let status = resolve_insert_status(
            true,
            true,
            Some(Ok("tauri-clipboard".to_string())),
            Some(Err("Paste failed".to_string())),
        );

        assert_eq!(status.insert_status, "copied");
        assert_eq!(status.error.as_deref(), Some("Paste failed"));
    }

    #[test]
    fn action_status_reports_clipboard_failure_without_paste_attempt() {
        let status = resolve_insert_status(
            true,
            false,
            Some(Err("Clipboard unavailable".to_string())),
            None,
        );

        assert_eq!(status.insert_status, "clipboard_failed");
        assert_eq!(status.error.as_deref(), Some("Clipboard unavailable"));
    }

    #[test]
    fn native_clipboard_capability_is_reported_without_shell_helper() {
        assert_eq!(clipboard_tool_name(), Some("tauri-clipboard".to_string()));
    }
}
