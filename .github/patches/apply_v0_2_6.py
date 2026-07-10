from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return content.replace(old, new, 1)


# Rust backend: durable history, serialized mutations, recovery, and customization.
path = "app/src-tauri/src/lib.rs"
content = read(path)
content = replace_once(
    content,
    'use chrono::{DateTime, Duration as ChronoDuration, Utc};\n',
    'use atomicwrites::{AllowOverwrite, AtomicFile};\nuse chrono::{DateTime, Duration as ChronoDuration, Utc};\n',
    "atomicwrites import",
)
content = replace_once(
    content,
    '    fs, io,\n',
    '    fs,\n    io::{self, Write},\n',
    "io write import",
)
content = replace_once(
    content,
    '    history_retention_days: u32,\n    start_on_login: bool,\n',
    '    history_retention_days: u32,\n    pill_always_on_top: bool,\n    start_on_login: bool,\n',
    "settings field",
)
content = replace_once(
    content,
    '            history_retention_days: 0,\n            start_on_login: false,\n',
    '            history_retention_days: 0,\n            pill_always_on_top: true,\n            start_on_login: false,\n',
    "settings default",
)
content = replace_once(
    content,
    'struct AppData {\n    runtime: Mutex<RuntimeState>,\n    diagnostics_cache: Mutex<Option<DiagnosticsCache>>,\n}',
    'struct AppData {\n    runtime: Mutex<RuntimeState>,\n    diagnostics_cache: Mutex<Option<DiagnosticsCache>>,\n    history: Mutex<()>,\n}',
    "app data history lock",
)
content = replace_once(
    content,
    '    let history = load_history_for_settings(&app, &settings)?;\n',
    '    let history = load_history_for_settings(&app, &settings, &data.history)?;\n',
    "state history load",
)
content = replace_once(
    content,
    '''    if settings.history_enabled {
        append_history(&app, item.clone())?;
    }

    let data = app.state::<AppData>();
''',
    '''    let data = app.state::<AppData>();
    if settings.history_enabled {
        append_history(&app, &data.history, item.clone())?;
    }

''',
    "recording history append",
)
content = replace_once(
    content,
    '''#[tauri::command]
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
fn export_history(app: AppHandle, format: String) -> Result<String, String> {
    let settings = load_settings(&app)?;
    let history = load_history_for_settings(&app, &settings)?;
''',
    '''#[tauri::command]
fn delete_history_item(
    app: AppHandle,
    data: tauri::State<AppData>,
    id: String,
) -> Result<(), String> {
    with_history_lock(&data.history, || {
        let path = history_path(&app)?;
        let history: Vec<HistoryItem> = read_history_with_recovery(&path)?
            .into_iter()
            .filter(|item| item.id != id)
            .collect();
        write_history(&path, &history)
    })
}

#[tauri::command]
fn clear_history(app: AppHandle, data: tauri::State<AppData>) -> Result<(), String> {
    with_history_lock(&data.history, || {
        write_history(&history_path(&app)?, &Vec::<HistoryItem>::new())
    })
}

#[tauri::command]
fn export_history(
    app: AppHandle,
    data: tauri::State<AppData>,
    format: String,
) -> Result<String, String> {
    let settings = load_settings(&app)?;
    let history = load_history_for_settings(&app, &settings, &data.history)?;
''',
    "history commands",
)
old_history_helpers = '''fn load_history(app: &AppHandle) -> Result<Vec<HistoryItem>, String> {
    let settings = load_settings(app)?;
    load_history_for_settings(app, &settings)
}

fn load_history_for_settings(
    app: &AppHandle,
    settings: &Settings,
) -> Result<Vec<HistoryItem>, String> {
    let path = history_path(app)?;
    let history: Vec<HistoryItem> = read_json_or_default(path.clone())?;
    let original_len = history.len();
    let history = apply_history_retention(history, settings, Utc::now());
    if history.len() != original_len {
        write_json(path, &history)?;
    }
    Ok(history)
}

fn append_history(app: &AppHandle, item: HistoryItem) -> Result<(), String> {
    let settings = load_settings(app)?;
    let mut history = load_history_for_settings(app, &settings)?;
    history.insert(0, item);
    let history = apply_history_retention(history, &settings, Utc::now());
    write_json(history_path(app)?, &history)
}
'''
new_history_helpers = '''fn with_history_lock<T>(
    history_lock: &Mutex<()>,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = history_lock.lock().map_err(|error| error.to_string())?;
    operation()
}

fn load_history_for_settings(
    app: &AppHandle,
    settings: &Settings,
    history_lock: &Mutex<()>,
) -> Result<Vec<HistoryItem>, String> {
    with_history_lock(history_lock, || {
        load_history_for_settings_unlocked(app, settings)
    })
}

fn load_history_for_settings_unlocked(
    app: &AppHandle,
    settings: &Settings,
) -> Result<Vec<HistoryItem>, String> {
    let path = history_path(app)?;
    let history = read_history_with_recovery(&path)?;
    let original_len = history.len();
    let history = apply_history_retention(history, settings, Utc::now());
    if history.len() != original_len {
        write_history(&path, &history)?;
    }
    Ok(history)
}

fn append_history(
    app: &AppHandle,
    history_lock: &Mutex<()>,
    item: HistoryItem,
) -> Result<(), String> {
    let settings = load_settings(app)?;
    with_history_lock(history_lock, || {
        let path = history_path(app)?;
        let mut history = read_history_with_recovery(&path)?;
        history.insert(0, item);
        let history = apply_history_retention(history, &settings, Utc::now());
        write_history(&path, &history)
    })
}
'''
content = replace_once(content, old_history_helpers, new_history_helpers, "history helpers")
old_json_helpers = '''fn read_json_or_default<T>(path: PathBuf) -> Result<T, String>
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
'''
new_json_helpers = '''fn read_json_or_default<T>(path: PathBuf) -> Result<T, String>
where
    T: for<'de> Deserialize<'de> + Default,
{
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).map_err(|error| error.to_string()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(T::default()),
        Err(error) => Err(error.to_string()),
    }
}

fn history_backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn read_history_file(path: &Path) -> Result<Option<Vec<HistoryItem>>, String> {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content)
            .map(Some)
            .map_err(|error| format!("Could not parse {}: {error}", path.display())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Could not read {}: {error}", path.display())),
    }
}

fn preserve_corrupt_history(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let preserved = parent.join(format!(
        "history.corrupt-{}-{}.json",
        Utc::now().format("%Y%m%d-%H%M%S%.3f"),
        Uuid::new_v4()
    ));
    fs::copy(path, &preserved)
        .map(|_| preserved)
        .map_err(|error| format!("Could not preserve corrupt history: {error}"))
}

fn read_history_with_recovery(path: &Path) -> Result<Vec<HistoryItem>, String> {
    match read_history_file(path) {
        Ok(Some(history)) => return Ok(history),
        Ok(None) => {}
        Err(error) => {
            match preserve_corrupt_history(path) {
                Ok(preserved) => eprintln!(
                    "{error}. Preserved the unreadable file at {}.",
                    preserved.display()
                ),
                Err(preserve_error) => eprintln!("{error}. {preserve_error}"),
            }
        }
    }

    let backup = history_backup_path(path);
    match read_history_file(&backup) {
        Ok(Some(history)) => {
            write_history(path, &history)?;
            return Ok(history);
        }
        Ok(None) => {}
        Err(error) => eprintln!("{error}. Starting with an empty history."),
    }

    let history = Vec::new();
    write_history(path, &history)?;
    Ok(history)
}

fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    AtomicFile::new(path, AllowOverwrite)
        .write(|file| {
            file.write_all(content)?;
            file.sync_all()
        })
        .map_err(|error| error.to_string())
}

fn serialized_json<T: Serialize>(value: &T) -> Result<Vec<u8>, String> {
    let mut content = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    content.push(b'\\n');
    Ok(content)
}

fn write_json<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    atomic_write(&path, &serialized_json(value)?)
}

fn write_history(path: &Path, history: &[HistoryItem]) -> Result<(), String> {
    let content = serialized_json(&history)?;
    atomic_write(path, &content)?;
    atomic_write(&history_backup_path(path), &content)
}
'''
content = replace_once(content, old_json_helpers, new_json_helpers, "atomic json helpers")
content = replace_once(
    content,
    '            diagnostics_cache: Mutex::new(None),\n',
    '            diagnostics_cache: Mutex::new(None),\n            history: Mutex::new(()),\n',
    "managed history lock",
)
# Add regression tests before the shared history_item helper.
marker = '''    fn history_item(final_transcript: &str, created_at: DateTime<Utc>) -> HistoryItem {
'''
tests = '''    #[test]
    fn corrupted_history_recovers_from_valid_backup() {
        let root = std::env::temp_dir().join(format!("vibevoice-history-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("history.json");
        let expected = vec![history_item("kept transcript", Utc::now())];
        write_history(&path, &expected).unwrap();
        fs::write(&path, b"{truncated").unwrap();

        let recovered = read_history_with_recovery(&path).unwrap();

        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].final_transcript, "kept transcript");
        assert!(read_history_file(&path).unwrap().is_some());
        assert!(fs::read_dir(&root).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("history.corrupt-")
        }));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn serialized_history_mutations_do_not_lose_entries() {
        let root = std::env::temp_dir().join(format!("vibevoice-history-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = Arc::new(root.join("history.json"));
        let history_lock = Arc::new(Mutex::new(()));
        write_history(path.as_ref(), &[]).unwrap();

        let workers: Vec<_> = (0..16)
            .map(|index| {
                let path = Arc::clone(&path);
                let history_lock = Arc::clone(&history_lock);
                thread::spawn(move || {
                    with_history_lock(&history_lock, || {
                        let mut history = read_history_with_recovery(path.as_ref())?;
                        history.push(history_item(&format!("entry {index}"), Utc::now()));
                        write_history(path.as_ref(), &history)
                    })
                    .unwrap();
                })
            })
            .collect();

        for worker in workers {
            worker.join().unwrap();
        }

        let history = read_history_with_recovery(path.as_ref()).unwrap();
        assert_eq!(history.len(), 16);
        assert!(read_history_file(&history_backup_path(path.as_ref()))
            .unwrap()
            .is_some());
        let _ = fs::remove_dir_all(root);
    }

'''
content = replace_once(content, marker, tests + marker, "history regression tests")
write(path, content)

# Cargo package/dependency.
path = "app/src-tauri/Cargo.toml"
content = read(path)
content = replace_once(content, 'version = "0.2.5"', 'version = "0.2.6"', "cargo version")
content = replace_once(content, '[dependencies]\n', '[dependencies]\natomicwrites = "0.4.4"\n', "atomicwrites dependency")
write(path, content)

# Frontend timer, pill bounds, resizable window, and pill pin customization.
path = "app/src/App.tsx"
content = read(path)
content = replace_once(
    content,
    'import { LogicalSize } from "@tauri-apps/api/dpi";\n',
    'import { LogicalSize, PhysicalPosition } from "@tauri-apps/api/dpi";\n',
    "physical position import",
)
content = replace_once(
    content,
    'import { getCurrentWindow, monitorFromPoint, Window as TauriWindow } from "@tauri-apps/api/window";\n',
    'import { getCurrentWindow, monitorFromPoint, Window as TauriWindow } from "@tauri-apps/api/window";\nimport type { ResizeDirection } from "@tauri-apps/api/window";\n',
    "resize type import",
)
content = replace_once(
    content,
    'const LATEST_RELEASE_API = "https://api.github.com/repos/Zburgers/vibevoice/releases/latest";\n',
    '''const LATEST_RELEASE_API = "https://api.github.com/repos/Zburgers/vibevoice/releases/latest";
const COLLAPSED_PILL_SIZE = new LogicalSize(68, 68);
const EXPANDED_PILL_SIZE = new LogicalSize(318, 262);
const resizeHandles: Array<{ direction: ResizeDirection; className: string }> = [
  { direction: "North", className: "is-north" },
  { direction: "South", className: "is-south" },
  { direction: "East", className: "is-east" },
  { direction: "West", className: "is-west" },
  { direction: "NorthEast", className: "is-north-east" },
  { direction: "NorthWest", className: "is-north-west" },
  { direction: "SouthEast", className: "is-south-east" },
  { direction: "SouthWest", className: "is-south-west" },
];
''',
    "pill sizes and resize handles",
)
content = replace_once(
    content,
    '  const settingsRef = useRef(fallbackState.settings);\n',
    '  const settingsRef = useRef(fallbackState.settings);\n  const pillExpansionRef = useRef({ flipX: false, flipY: false });\n',
    "pill expansion ref",
)
content = replace_once(
    content,
    '''  const recordingSeconds = useMemo(() => {
    if (!state.recording_started_at || state.voice_state !== "Recording") return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(state.recording_started_at).getTime()) / 1000));
  }, [state.recording_started_at, state.voice_state]);
''',
    '''  const recordingSeconds =
    state.recording_started_at && state.voice_state === "Recording"
      ? Math.max(0, Math.floor((Date.now() - new Date(state.recording_started_at).getTime()) / 1000))
      : 0;
''',
    "recording timer",
)
old_pill_effect = '''  useEffect(() => {
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
'''
new_pill_effect = '''  useEffect(() => {
    if (!isPillWindow || !currentWindow) return;
    let cancelled = false;

    async function positionPill() {
      await currentWindow.setAlwaysOnTop(state.settings.pill_always_on_top);
      const previousPosition = await currentWindow.outerPosition();
      const previousSize = await currentWindow.outerSize();
      const centerX = previousPosition.x + previousSize.width / 2;
      const centerY = previousPosition.y + previousSize.height / 2;
      const monitor = await monitorFromPoint(centerX, centerY);

      if (!monitor) {
        await currentWindow.setSize(expanded ? EXPANDED_PILL_SIZE : COLLAPSED_PILL_SIZE);
        return;
      }

      const workArea = monitor.workArea;
      const workRight = workArea.position.x + workArea.size.width;
      const workBottom = workArea.position.y + workArea.size.height;
      const flipX = expanded
        ? centerX > workArea.position.x + workArea.size.width / 2
        : pillExpansionRef.current.flipX;
      const flipY = expanded
        ? centerY > workArea.position.y + workArea.size.height / 2
        : pillExpansionRef.current.flipY;

      if (expanded) {
        pillExpansionRef.current = { flipX, flipY };
        setPillFlipX(flipX);
        setPillFlipY(flipY);
      }

      await currentWindow.setSize(expanded ? EXPANDED_PILL_SIZE : COLLAPSED_PILL_SIZE);
      const nextSize = await currentWindow.outerSize();
      let x = flipX ? previousPosition.x + previousSize.width - nextSize.width : previousPosition.x;
      let y = flipY ? previousPosition.y + previousSize.height - nextSize.height : previousPosition.y;
      x = Math.min(Math.max(x, workArea.position.x), Math.max(workArea.position.x, workRight - nextSize.width));
      y = Math.min(Math.max(y, workArea.position.y), Math.max(workArea.position.y, workBottom - nextSize.height));

      if (!cancelled) {
        await currentWindow.setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
      }
    }

    positionPill().catch((error) => setCommandStatus(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [currentWindow, expanded, isPillWindow, state.settings.pill_always_on_top]);
'''
content = replace_once(content, old_pill_effect, new_pill_effect, "edge-safe pill effect")
content = replace_once(
    content,
    '''  function closeWindow() {
    currentWindow?.close().catch((error) => setCommandStatus(errorMessage(error)));
  }
''',
    '''  function closeWindow() {
    currentWindow?.close().catch((error) => setCommandStatus(errorMessage(error)));
  }

  function startWindowResize(direction: ResizeDirection, event: MouseEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    currentWindow?.startResizeDragging(direction).catch((error) => setCommandStatus(errorMessage(error)));
  }
''',
    "resize handler",
)
content = replace_once(
    content,
    '''    <div className="desktop-frame">
      <header className="app-titlebar" onMouseDown={handleTitlebarDrag}>
''',
    '''    <div className="desktop-frame">
      {resizeHandles.map(({ direction, className }) => (
        <div
          key={direction}
          className={`window-resize-handle ${className}`}
          onMouseDown={(event) => startWindowResize(direction, event)}
          aria-hidden="true"
        />
      ))}
      <header className="app-titlebar" onMouseDown={handleTitlebarDrag}>
''',
    "resize handle markup",
)
write(path, content)

path = "app/src/App.css"
content = read(path)
content = replace_once(
    content,
    '''.desktop-frame {
  height: 100dvh;
''',
    '''.desktop-frame {
  position: relative;
  height: 100dvh;
''',
    "desktop frame positioning",
)
resize_css = '''
.window-resize-handle {
  position: absolute;
  z-index: 30;
  user-select: none;
}

.window-resize-handle.is-north,
.window-resize-handle.is-south {
  left: 10px;
  right: 10px;
  height: 6px;
}

.window-resize-handle.is-east,
.window-resize-handle.is-west {
  top: 10px;
  bottom: 10px;
  width: 6px;
}

.window-resize-handle.is-north { top: 0; cursor: n-resize; }
.window-resize-handle.is-south { bottom: 0; cursor: s-resize; }
.window-resize-handle.is-east { right: 0; cursor: e-resize; }
.window-resize-handle.is-west { left: 0; cursor: w-resize; }

.window-resize-handle.is-north-east,
.window-resize-handle.is-north-west,
.window-resize-handle.is-south-east,
.window-resize-handle.is-south-west {
  width: 12px;
  height: 12px;
}

.window-resize-handle.is-north-east { top: 0; right: 0; cursor: ne-resize; }
.window-resize-handle.is-north-west { top: 0; left: 0; cursor: nw-resize; }
.window-resize-handle.is-south-east { right: 0; bottom: 0; cursor: se-resize; }
.window-resize-handle.is-south-west { left: 0; bottom: 0; cursor: sw-resize; }

'''
content = replace_once(content, '.app-titlebar {\n', resize_css + '.app-titlebar {\n', "resize handle css")
write(path, content)

path = "app/src/types.ts"
content = read(path)
content = replace_once(
    content,
    '  history_retention_days: number;\n  start_on_login: boolean;\n',
    '  history_retention_days: number;\n  pill_always_on_top: boolean;\n  start_on_login: boolean;\n',
    "typescript settings field",
)
content = replace_once(content, '  app_version: "0.2.5",', '  app_version: "0.2.6",', "fallback version")
content = replace_once(
    content,
    '    history_retention_days: 0,\n    start_on_login: false,\n',
    '    history_retention_days: 0,\n    pill_always_on_top: true,\n    start_on_login: false,\n',
    "typescript settings default",
)
write(path, content)

path = "app/src/views/SettingsView.tsx"
content = read(path)
content = replace_once(
    content,
    'import { Activity, BookOpen, Clipboard, ExternalLink, History, Info, Keyboard, Wrench, Zap } from "lucide-react";\n',
    'import { Activity, BookOpen, Clipboard, ExternalLink, History, Info, Keyboard, Pin, Wrench, Zap } from "lucide-react";\n',
    "pin icon import",
)
content = replace_once(
    content,
    '        <Toggle icon={History} label="Save local history" value={state.settings.history_enabled} onClick={() => onUpdate({ history_enabled: !state.settings.history_enabled })} />\n        <Toggle icon={Activity}',
    '        <Toggle icon={History} label="Save local history" value={state.settings.history_enabled} onClick={() => onUpdate({ history_enabled: !state.settings.history_enabled })} />\n        <Toggle icon={Pin} label="Keep pill above other windows" value={state.settings.pill_always_on_top} onClick={() => onUpdate({ pill_always_on_top: !state.settings.pill_always_on_top })} />\n        <Toggle icon={Activity}',
    "pill pin toggle",
)
write(path, content)

# Version files and initial pill geometry.
for path in ["app/package.json", "app/package-lock.json", "app/src-tauri/tauri.conf.json"]:
    content = read(path)
    content = content.replace('"version": "0.2.5"', '"version": "0.2.6"')
    write(path, content)

path = "app/src-tauri/tauri.conf.json"
content = read(path)
content = replace_once(content, '        "width": 352,\n        "height": 76,', '        "width": 68,\n        "height": 68,', "collapsed pill geometry")
write(path, content)

# Release automation: only specially named release commits on master publish automatically.
path = ".github/workflows/release.yml"
content = read(path)
content = replace_once(
    content,
    '''  push:
    tags:
      - "v*"
''',
    '''  push:
    branches:
      - master
    tags:
      - "v*"
''',
    "release branch trigger",
)
content = replace_once(
    content,
    "    if: github.event_name != 'pull_request'\n",
    "    if: github.event_name == 'workflow_dispatch' || startsWith(github.ref, 'refs/tags/') || (github.event_name == 'push' && github.ref == 'refs/heads/master' && startsWith(github.event.head_commit.message, 'release: v'))\n",
    "release guard",
)
content = replace_once(
    content,
    "          includeRelease: ${{ startsWith(github.ref, 'refs/tags/') || github.event_name == 'workflow_dispatch' }}\n",
    "          includeRelease: true\n",
    "release publishing",
)
write(path, content)

# README and release notes.
path = "README.md"
content = read(path)
content = replace_once(
    content,
    '- Always-on-top floating pill for quick dictation from any app\n',
    '- Configurable floating pill for quick dictation from any app\n',
    "readme customization highlight",
)
content = replace_once(
    content,
    '- Latest: [VibeVoice 0.2.5](docs/releases/v0.2.5.md)\n- Previous: [VibeVoice 0.2.3](docs/releases/v0.2.3.md)',
    '- Latest: [VibeVoice 0.2.6](docs/releases/v0.2.6.md)\n- Previous: [VibeVoice 0.2.5](docs/releases/v0.2.5.md)',
    "release links",
)
write(path, content)

release_notes = '''# VibeVoice 0.2.6

VibeVoice 0.2.6 is a reliability and desktop usability patch focused on protecting local transcript history and making the floating controls behave consistently.

## History reliability

- Serializes every history read-modify-write path, including append, delete, clear, export retention cleanup, and state refresh retention cleanup.
- Replaces direct JSON writes with same-directory atomic replacement and flushes completed writes before replacement.
- Keeps a valid `history.json.bak` recovery copy.
- Preserves malformed history as a timestamped `history.corrupt-*.json` file, then restores the last valid backup or starts with a valid empty history.
- Adds regression coverage for concurrent mutations and corrupt-file recovery. Resolves #20.

## Desktop fixes

- Fixes recording elapsed time so both the pill and dashboard update every second. Resolves #18.
- Keeps expanded and collapsed pill geometry inside the active monitor work area, including scaled and multi-monitor layouts. Resolves #17.
- Aligns the initial collapsed pill window with its runtime size so the drag handle remains attached to the mic control. Resolves #16.
- Adds resize hit targets to the undecorated main window so edges and corners resize normally. Resolves #19.

## Customization

- Adds a **Keep pill above other windows** setting. It remains enabled by default for existing behavior but can now be disabled.

## Release maintenance

- Corrects the README release trail and adds guarded release publishing for explicit `release: v*` commits on `master`. Resolves #21.

## Verification

- `npm --prefix app run build`
- `cd app/src-tauri && cargo fmt --check`
- `cd app/src-tauri && cargo check --no-default-features`
- `cd app/src-tauri && cargo test --no-default-features`
'''
write("docs/releases/v0.2.6.md", release_notes)
