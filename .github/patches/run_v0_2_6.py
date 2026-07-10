# Run the deterministic scoped patch, then apply compatibility corrections found by CI.
from pathlib import Path

script_path = Path(__file__).with_name("apply_v0_2_6.py")
source = script_path.read_text(encoding="utf-8")
old = (
    "content = replace_once(\n"
    "    content,\n"
    "    '    let history = load_history_for_settings(&app, &settings)?;\\n',\n"
    "    '    let history = load_history_for_settings(&app, &settings, &data.history)?;\\n',\n"
    "    \"state history load\",\n"
    ")\n"
)
new = (
    "content = replace_once(\n"
    "    content,\n"
    "    '''fn get_app_state(app: AppHandle, data: tauri::State<AppData>) -> Result<AppStateSnapshot, String> {\n"
    "    let settings = load_settings(&app)?;\n"
    "    let dictionary = load_dictionary(&app)?;\n"
    "    let history = load_history_for_settings(&app, &settings)?;\n"
    "''',\n"
    "    '''fn get_app_state(app: AppHandle, data: tauri::State<AppData>) -> Result<AppStateSnapshot, String> {\n"
    "    let settings = load_settings(&app)?;\n"
    "    let dictionary = load_dictionary(&app)?;\n"
    "    let history = load_history_for_settings(&app, &settings, &data.history)?;\n"
    "''',\n"
    "    \"state history load\",\n"
    ")\n"
)
if source.count(old) != 1:
    raise RuntimeError("Could not make the state-history patch anchor deterministic")
source = source.replace(old, new, 1)
exec(compile(source, str(script_path), "exec"), {"__file__": str(script_path), "__name__": "__main__"})

app_path = Path(__file__).resolve().parents[2] / "app/src/App.tsx"
app = app_path.read_text(encoding="utf-8")
app = app.replace('import type { ResizeDirection } from "@tauri-apps/api/window";\n', "")
resize_type = 'type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";\n\n'
release_marker = 'const RELEASES_URL = "https://github.com/Zburgers/vibevoice/releases";\n'
if app.count(release_marker) != 1:
    raise RuntimeError("Could not insert the local resize direction type")
app = app.replace(release_marker, resize_type + release_marker, 1)
effect_start = '  useEffect(() => {\n    if (!isPillWindow || !currentWindow) return;\n    let cancelled = false;\n\n    async function positionPill() {'
effect_replacement = '  useEffect(() => {\n    if (!isPillWindow || !currentWindow) return;\n    const pillWindow = currentWindow;\n    let cancelled = false;\n\n    async function positionPill() {'
if app.count(effect_start) != 1:
    raise RuntimeError("Could not capture the narrowed pill window")
app = app.replace(effect_start, effect_replacement, 1)
effect_end = '  }, [currentWindow, expanded, isPillWindow, state.settings.pill_always_on_top]);'
start = app.index(effect_replacement)
end = app.index(effect_end, start) + len(effect_end)
effect = app[start:end].replace("currentWindow.", "pillWindow.")
app = app[:start] + effect + app[end:]
app_path.write_text(app, encoding="utf-8")
