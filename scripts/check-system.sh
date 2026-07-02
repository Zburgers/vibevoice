#!/usr/bin/env bash
set -euo pipefail

DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ENGINE_ROOT="${VIBEVOICE_ENGINE_DIR:-$DATA_HOME/vibevoice/engines/whisper.cpp}"
LEGACY_ROOT="$HOME/tools/whisper.cpp"
WHISPER_CLI="${WHISPER_CLI:-}"
WHISPER_MODEL="${WHISPER_MODEL:-}"
TMP_DIR="${VIBEVOICE_TMP_DIR:-${TMPDIR:-/tmp}/vibevoice}"

if [[ -z "$WHISPER_CLI" ]]; then
  if [[ -x "$ENGINE_ROOT/build/bin/whisper-cli" ]]; then
    WHISPER_CLI="$ENGINE_ROOT/build/bin/whisper-cli"
  else
    WHISPER_CLI="$LEGACY_ROOT/build/bin/whisper-cli"
  fi
fi

if [[ -z "$WHISPER_MODEL" ]]; then
  if [[ -f "$ENGINE_ROOT/models/ggml-base.en.bin" ]]; then
    WHISPER_MODEL="$ENGINE_ROOT/models/ggml-base.en.bin"
  else
    WHISPER_MODEL="$LEGACY_ROOT/models/ggml-base.en.bin"
  fi
fi

if [[ -r /etc/os-release ]]; then
  # shellcheck disable=SC1091
  source /etc/os-release
fi

status() {
  printf '%s=%s\n' "$1" "$2"
}

present() {
  if [[ -x "$1" ]]; then
    printf 'present'
  else
    printf 'missing'
  fi
}

present_file() {
  if [[ -f "$1" ]]; then
    printf 'present'
  else
    printf 'missing'
  fi
}

command_present() {
  if command -v "$1" >/dev/null 2>&1; then
    printf 'present'
  else
    printf 'missing'
  fi
}

echo "vibevoice.check=1"
status "platform" "$(uname -s)"
status "distro" "${ID:-unknown}"
status "tmp_dir" "$TMP_DIR"
status "engine_root" "$ENGINE_ROOT"
status "whisper_cli" "$(present "$WHISPER_CLI")"
status "whisper_cli_path" "$WHISPER_CLI"
status "whisper_model" "$(present_file "$WHISPER_MODEL")"
status "whisper_model_path" "$WHISPER_MODEL"
status "alsa_devel" "$(pkg-config --exists alsa 2>/dev/null && printf present || printf missing)"
status "git" "$(command_present git)"
status "cmake" "$(command_present cmake)"
status "make" "$(command_present make)"
status "gcc" "$(command_present gcc)"
status "gpp" "$(command_present g++)"
status "ffmpeg" "$(command_present ffmpeg)"
status "wl_copy" "$(command_present wl-copy)"
status "wl_paste" "$(command_present wl-paste)"
status "xclip" "$(command_present xclip)"
status "xsel" "$(command_present xsel)"
status "wtype" "$(command_present wtype)"
status "xdotool" "$(command_present xdotool)"
status "ydotool" "$(command_present ydotool)"

missing_critical=0
if [[ ! -x "$WHISPER_CLI" ]]; then
  status "critical.whisper_cli" "missing"
  missing_critical=1
else
  status "critical.whisper_cli" "present"
fi

if [[ ! -f "$WHISPER_MODEL" ]]; then
  status "critical.whisper_model" "missing"
  missing_critical=1
else
  status "critical.whisper_model" "present"
fi

if [[ -d "$ENGINE_ROOT" || -d "$LEGACY_ROOT" ]]; then
  status "whisper_repo" "present"
else
  status "whisper_repo" "missing"
fi

if [[ -d "$TMP_DIR" ]]; then
  status "tmp_workspace" "present"
else
  status "tmp_workspace" "missing"
fi

if (( missing_critical )); then
  echo "ready=0"
  exit 1
fi

echo "ready=1"
