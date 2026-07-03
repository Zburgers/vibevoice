#!/usr/bin/env bash
set -euo pipefail

MODEL_NAME="${VIBEVOICE_MODEL_NAME:-base.en}"
MODEL_FILE="ggml-${MODEL_NAME}.bin"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ENGINE_ROOT="${VIBEVOICE_ENGINE_DIR:-$DATA_HOME/vibevoice/engines/whisper.cpp}"
TMP_DIR="${VIBEVOICE_TMP_DIR:-${TMPDIR:-/tmp}/vibevoice}"

say() {
  printf '%s\n' "$1"
}

run() {
  say "+ $*"
  "$@"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_linux_packages() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
  fi

  case "${ID:-unknown}" in
    fedora)
      local packages=()
      local pkg
      for pkg in git cmake gcc gcc-c++ make ffmpeg alsa-utils alsa-lib-devel pkgconf-pkg-config wl-clipboard xclip xsel wtype xdotool; do
        case "$pkg" in
          git) need_cmd git || packages+=("$pkg") ;;
          cmake) need_cmd cmake || packages+=("$pkg") ;;
          gcc) need_cmd gcc || packages+=("$pkg") ;;
          gcc-c++) need_cmd g++ || packages+=("$pkg") ;;
          make) need_cmd make || packages+=("$pkg") ;;
          ffmpeg) need_cmd ffmpeg || packages+=("$pkg") ;;
          alsa-utils) need_cmd arecord || packages+=("$pkg") ;;
          alsa-lib-devel) pkg-config --exists alsa 2>/dev/null || packages+=("$pkg") ;;
          pkgconf-pkg-config) need_cmd pkg-config || packages+=("$pkg") ;;
          wl-clipboard) need_cmd wl-copy || packages+=("$pkg") ;;
          xclip) need_cmd xclip || packages+=("$pkg") ;;
          xsel) need_cmd xsel || packages+=("$pkg") ;;
          wtype) need_cmd wtype || packages+=("$pkg") ;;
          xdotool) need_cmd xdotool || packages+=("$pkg") ;;
        esac
      done
      if ((${#packages[@]} > 0)); then
        say "Installing missing Fedora packages: ${packages[*]}"
        run sudo dnf install -y "${packages[@]}"
      else
        say "Linux dependencies are already installed."
      fi
      ;;
    ubuntu | debian)
      local packages=()
      need_cmd git || packages+=(git)
      need_cmd cmake || packages+=(cmake)
      need_cmd gcc || packages+=(build-essential)
      need_cmd ffmpeg || packages+=(ffmpeg)
      pkg-config --exists alsa 2>/dev/null || packages+=(libasound2-dev pkg-config)
      need_cmd wl-copy || packages+=(wl-clipboard)
      need_cmd xclip || packages+=(xclip)
      need_cmd xsel || packages+=(xsel)
      need_cmd wtype || packages+=(wtype)
      need_cmd xdotool || packages+=(xdotool)
      if ((${#packages[@]} > 0)); then
        say "Installing missing Debian/Ubuntu packages: ${packages[*]}"
        run sudo apt-get update
        run sudo apt-get install -y "${packages[@]}"
      else
        say "Linux dependencies are already installed."
      fi
      ;;
    *)
      say "Unsupported Linux distro for automatic package install: ${ID:-unknown}"
      say "Install git, cmake, a C/C++ toolchain, ffmpeg, ALSA tools, clipboard helpers, and paste helpers, then rerun."
      ;;
  esac
}

ensure_whisper_repo() {
  local cli="$ENGINE_ROOT/build/bin/whisper-cli"
  local model="$ENGINE_ROOT/models/$MODEL_FILE"

  if [[ -x "$cli" && -f "$model" ]]; then
    say "Existing whisper.cpp engine detected: $ENGINE_ROOT"
    return 0
  fi

  mkdir -p "$(dirname "$ENGINE_ROOT")"
  if [[ ! -d "$ENGINE_ROOT/.git" ]]; then
    if [[ -e "$ENGINE_ROOT" && ! -d "$ENGINE_ROOT" ]]; then
      say "Cannot use $ENGINE_ROOT because it exists as a non-directory."
      exit 1
    fi
    if [[ -d "$ENGINE_ROOT" ]] && find "$ENGINE_ROOT" -mindepth 1 -print -quit | grep -q .; then
      say "$ENGINE_ROOT exists but is not a whisper.cpp git checkout."
      say "Set VIBEVOICE_ENGINE_DIR to an empty directory or an existing whisper.cpp checkout."
      exit 1
    fi
    run git clone https://github.com/ggml-org/whisper.cpp.git "$ENGINE_ROOT"
  else
    say "Reusing whisper.cpp checkout: $ENGINE_ROOT"
  fi

  if [[ ! -f "$model" ]]; then
    (cd "$ENGINE_ROOT" && run sh ./models/download-ggml-model.sh "$MODEL_NAME")
  else
    say "Model already present: $model"
  fi

  if [[ ! -x "$cli" ]]; then
    (cd "$ENGINE_ROOT" && run cmake -B build -S . && run cmake --build build -j --config Release)
  else
    say "whisper-cli already built: $cli"
  fi
}

main() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    say "Use scripts/install-windows.ps1 on Windows."
    exit 1
  fi
  install_linux_packages
  ensure_whisper_repo
  mkdir -p "$TMP_DIR"
  say "Temporary workspace ready: $TMP_DIR"
  say "Done."
}

main "$@"
