use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    str::FromStr,
    sync::Mutex,
    time::Instant,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use uuid::Uuid;

const DEFAULT_WHISPER: &str = "~/tools/whisper.cpp/build/bin/whisper-cli";
const DEFAULT_MODEL: &str = "~/tools/whisper.cpp/models/ggml-base.en.bin";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
enum VoiceState {
    Ready,
    Recording,
    Processing,
    Inserted,
    Copied,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Settings {
    whisper_binary_path: String,
    model_path: String,
    hotkey: String,
    recording_mode: String,
    auto_paste: bool,
    clipboard_fallback: bool,
    dictionary_cleanup: bool,
    start_on_login: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            whisper_binary_path: DEFAULT_WHISPER.to_string(),
            model_path: DEFAULT_MODEL.to_string(),
            hotkey: "Ctrl+Alt+Space".to_string(),
            recording_mode: "toggle".to_string(),
            auto_paste: true,
            clipboard_fallback: true,
            dictionary_cleanup: true,
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
    voice_state: VoiceState,
    settings: Settings,
    diagnostics: Diagnostics,
    history: Vec<HistoryItem>,
    dictionary: Vec<DictionaryRule>,
    last_transcript: Option<String>,
    last_error: Option<String>,
    recording_started_at: Option<DateTime<Utc>>,
}

struct RecordingSession {
    child: Child,
    audio_path: PathBuf,
    output_prefix: PathBuf,
    started: Instant,
    started_at: DateTime<Utc>,
}

struct RuntimeState {
    voice_state: VoiceState,
    recording: Option<RecordingSession>,
    last_transcript: Option<String>,
    last_error: Option<String>,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            voice_state: VoiceState::Ready,
            recording: None,
            last_transcript: None,
            last_error: None,
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
    Ok(AppStateSnapshot {
        voice_state: runtime.voice_state.clone(),
        settings: settings.clone(),
        diagnostics: diagnostics(&settings, runtime.last_error.clone()),
        history,
        dictionary,
        last_transcript: runtime.last_transcript.clone(),
        last_error: runtime.last_error.clone(),
        recording_started_at,
    })
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    register_global_hotkey(&app, &settings.hotkey)?;
    write_json(settings_path(&app)?, &settings)
}

#[tauri::command]
fn start_recording(app: AppHandle, data: tauri::State<AppData>) -> Result<(), String> {
    let settings = load_settings(&app)?;
    ensure_engine_ready(&settings)?;
    let tmp = PathBuf::from("/tmp/vibevoice");
    fs::create_dir_all(&tmp).map_err(|error| error.to_string())?;
    let stem = format!("recording-{}", Uuid::new_v4());
    let audio_path = tmp.join(format!("{stem}.wav"));
    let output_prefix = tmp.join(stem);
    let child = Command::new("arecord")
        .args(["-f", "S16_LE", "-r", "16000", "-c", "1"])
        .arg(&audio_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Recording failed: {error}"))?;

    let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
    if let Some(mut existing) = runtime.recording.take() {
        let _ = existing.child.kill();
    }
    runtime.voice_state = VoiceState::Recording;
    runtime.last_error = None;
    runtime.recording = Some(RecordingSession {
        child,
        audio_path,
        output_prefix,
        started: Instant::now(),
        started_at: Utc::now(),
    });
    Ok(())
}

#[tauri::command]
fn stop_recording(app: AppHandle, data: tauri::State<AppData>) -> Result<HistoryItem, String> {
    let mut session = {
        let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
        runtime.voice_state = VoiceState::Processing;
        runtime
            .recording
            .take()
            .ok_or_else(|| "No active recording to stop.".to_string())?
    };

    let _ = session.child.kill();
    let _ = session.child.wait();
    let settings = load_settings(&app)?;
    let dictionary = load_dictionary(&app)?;
    let raw_transcript = transcribe(&settings, &session.audio_path, &session.output_prefix)?;
    let mut final_transcript = cleanup_transcript(&raw_transcript);
    if settings.dictionary_cleanup {
        final_transcript = apply_dictionary(&final_transcript, &dictionary);
    }

    if final_transcript.is_empty() {
        let message = "Whisper returned an empty transcript.".to_string();
        set_runtime_error(&data, &message)?;
        return Err(message);
    }

    let mut insert_status = "none".to_string();
    let mut error = None;
    if settings.clipboard_fallback {
        match copy_to_clipboard(&final_transcript) {
            Ok(tool) => insert_status = format!("copied:{tool}"),
            Err(copy_error) => {
                error = Some(copy_error.clone());
                insert_status = "clipboard_failed".to_string();
            }
        }
    }
    if settings.auto_paste {
        match paste_from_clipboard() {
            Ok(tool) => insert_status = format!("inserted:{tool}"),
            Err(paste_error) => {
                if error.is_none() {
                    error = Some(paste_error);
                }
                if insert_status.starts_with("copied") {
                    insert_status = "copied".to_string();
                }
            }
        }
    }

    let item = HistoryItem {
        id: Uuid::new_v4().to_string(),
        created_at: Utc::now(),
        raw_transcript,
        final_transcript: final_transcript.clone(),
        duration_ms: Some(session.started.elapsed().as_millis()),
        insert_status: insert_status.clone(),
        error: error.clone(),
    };
    append_history(&app, item.clone())?;

    let mut runtime = data.runtime.lock().map_err(|lock_error| lock_error.to_string())?;
    runtime.voice_state = if insert_status.starts_with("inserted") {
        VoiceState::Inserted
    } else if insert_status == "copied" || insert_status.starts_with("copied") {
        VoiceState::Copied
    } else {
        VoiceState::Error
    };
    runtime.last_transcript = Some(final_transcript);
    runtime.last_error = error;
    Ok(item)
}

#[tauri::command]
fn copy_text(text: String, data: tauri::State<AppData>) -> Result<(), String> {
    copy_to_clipboard(&text)?;
    let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
    runtime.voice_state = VoiceState::Copied;
    runtime.last_transcript = Some(text);
    runtime.last_error = None;
    Ok(())
}

#[tauri::command]
fn insert_text(text: String, data: tauri::State<AppData>) -> Result<(), String> {
    copy_to_clipboard(&text)?;
    paste_from_clipboard()?;
    let mut runtime = data.runtime.lock().map_err(|error| error.to_string())?;
    runtime.voice_state = VoiceState::Inserted;
    runtime.last_transcript = Some(text);
    runtime.last_error = None;
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

#[tauri::command]
fn run_setup_script(app: AppHandle, data: tauri::State<AppData>) -> Result<String, String> {
    let script = find_repo_file(&app, "scripts/install-fedora.sh")
        .ok_or_else(|| "Setup script not found: scripts/install-fedora.sh".to_string())?;
    if !script.exists() {
        return Err(format!("Setup script not found: {}", script.display()));
    }
    let output = Command::new("bash")
        .arg(script)
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
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("vibevoice"));
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
            let candidate = path.join(relative);
            if candidate.exists() {
                return Some(candidate);
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

fn expand_home(path: &str) -> PathBuf {
    if let Some(rest) = path.strip_prefix("~/") {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")).join(rest)
    } else {
        PathBuf::from(path)
    }
}

fn diagnostics(settings: &Settings, last_error: Option<String>) -> Diagnostics {
    Diagnostics {
        whisper_found: expand_home(&settings.whisper_binary_path).is_file(),
        model_found: expand_home(&settings.model_path).is_file(),
        mic_available: command_exists("arecord"),
        clipboard_tool: first_command(&["wl-copy", "xclip"]),
        paste_tool: first_command(&["wtype", "xdotool", "ydotool"]),
        last_error,
    }
}

fn ensure_engine_ready(settings: &Settings) -> Result<(), String> {
    let whisper = expand_home(&settings.whisper_binary_path);
    let model = expand_home(&settings.model_path);
    if !whisper.is_file() {
        return Err(format!("Whisper binary missing: {}", whisper.display()));
    }
    if !model.is_file() {
        return Err(format!("Model file missing: {}", model.display()));
    }
    if !command_exists("arecord") {
        return Err("Microphone recorder missing: install alsa-utils for arecord.".to_string());
    }
    Ok(())
}

fn transcribe(settings: &Settings, audio_path: &Path, output_prefix: &Path) -> Result<String, String> {
    let output = Command::new(expand_home(&settings.whisper_binary_path))
        .arg("-m")
        .arg(expand_home(&settings.model_path))
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

fn copy_to_clipboard(text: &str) -> Result<String, String> {
    if command_exists("wl-copy") {
        let mut child = Command::new("wl-copy")
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|error| format!("wl-copy failed: {error}"))?;
        use std::io::Write;
        child
            .stdin
            .as_mut()
            .ok_or_else(|| "wl-copy stdin unavailable.".to_string())?
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        let status = child.wait().map_err(|error| error.to_string())?;
        return if status.success() {
            Ok("wl-copy".to_string())
        } else {
            Err("wl-copy exited with an error.".to_string())
        };
    }
    if command_exists("xclip") {
        let mut child = Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|error| format!("xclip failed: {error}"))?;
        use std::io::Write;
        child
            .stdin
            .as_mut()
            .ok_or_else(|| "xclip stdin unavailable.".to_string())?
            .write_all(text.as_bytes())
            .map_err(|error| error.to_string())?;
        let status = child.wait().map_err(|error| error.to_string())?;
        return if status.success() {
            Ok("xclip".to_string())
        } else {
            Err("xclip exited with an error.".to_string())
        };
    }
    Err("Clipboard tool missing. Install wl-clipboard or xclip.".to_string())
}

fn paste_from_clipboard() -> Result<String, String> {
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
                Err(format!("{cmd} exited with an error. Transcript remains in clipboard."))
            };
        }
    }
    Err("Paste tool missing. Install wtype on Wayland or xdotool on X11.".to_string())
}

fn command_exists(name: &str) -> bool {
    Command::new("sh")
        .arg("-c")
        .arg(format!("command -v '{}' >/dev/null 2>&1", name.replace('\'', "")))
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
    Ok(())
}

fn parse_hotkey(hotkey: &str) -> Result<Shortcut, String> {
    let normalized = hotkey
        .replace("Ctrl", "Control")
        .replace("ctrl", "Control")
        .replace(' ', "");
    Shortcut::from_str(&normalized).or_else(|_| {
        if normalized.eq_ignore_ascii_case("Control+Alt+Space") {
            Ok(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space))
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
                let _ = stop_recording(app_handle.clone(), app_handle.state::<AppData>());
            } else {
                let _ = start_recording(app_handle.clone(), app_handle.state::<AppData>());
            }
        })
        .map_err(|error| format!("Hotkey registration failed: {error}"))
}

fn register_global_hotkey(app: &AppHandle, hotkey: &str) -> Result<(), String> {
    let shortcut = parse_hotkey(hotkey)?;
    register_hotkey_handler(app, shortcut)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            add_dictionary_rule,
            delete_dictionary_rule,
            set_dictionary_rule_enabled,
            run_setup_script
        ])
        .setup(|app| {
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
