#!/usr/bin/env bash
set -euo pipefail

WHISPER_CLI="${WHISPER_CLI:-$HOME/tools/whisper.cpp/build/bin/whisper-cli}"
WHISPER_MODEL="${WHISPER_MODEL:-$HOME/tools/whisper.cpp/models/ggml-base.en.bin}"
TMP_DIR="${VIBEVOICE_TMP_DIR:-/tmp/vibevoice}"

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
status "whisper_cli" "$(present "$WHISPER_CLI")"
status "whisper_model" "$(present_file "$WHISPER_MODEL")"
status "arecord" "$(command_present arecord)"
status "git" "$(command_present git)"
status "cmake" "$(command_present cmake)"
status "make" "$(command_present make)"
status "gcc" "$(command_present gcc)"
status "gpp" "$(command_present g++)"
status "ffmpeg" "$(command_present ffmpeg)"
status "wl_copy" "$(command_present wl-copy)"
status "xclip" "$(command_present xclip)"

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

if ! command -v arecord >/dev/null 2>&1; then
  status "critical.arecord" "missing"
  missing_critical=1
else
  status "critical.arecord" "present"
fi

if [[ -d "$HOME/tools/whisper.cpp" ]]; then
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
