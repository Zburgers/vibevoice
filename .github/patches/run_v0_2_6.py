# This runner keeps the patch anchor deterministic before executing repository edits.
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
