#!/usr/bin/env bash
set -euo pipefail

WHISPER_ROOT="${WHISPER_ROOT:-$HOME/tools/whisper.cpp}"
WHISPER_CLI="$WHISPER_ROOT/build/bin/whisper-cli"
WHISPER_MODEL="$WHISPER_ROOT/models/ggml-base.en.bin"
TMP_DIR="${VIBEVOICE_TMP_DIR:-/tmp/vibevoice}"

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

require_fedora() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    source /etc/os-release
  fi
  if [[ "${ID:-}" != "fedora" ]]; then
    say "This installer is Fedora-first and only auto-installs dependencies on Fedora."
    say "Detected distro: ${ID:-unknown}"
    exit 1
  fi
}

install_packages() {
  local packages=()
  local pkg
  for pkg in git cmake gcc gcc-c++ make ffmpeg alsa-utils wl-clipboard xclip; do
    case "$pkg" in
      git) need_cmd git || packages+=("$pkg") ;;
      cmake) need_cmd cmake || packages+=("$pkg") ;;
      gcc) need_cmd gcc || packages+=("$pkg") ;;
      gcc-c++) need_cmd g++ || packages+=("$pkg") ;;
      make) need_cmd make || packages+=("$pkg") ;;
      ffmpeg) need_cmd ffmpeg || packages+=("$pkg") ;;
      alsa-utils) need_cmd arecord || packages+=("$pkg") ;;
      wl-clipboard) need_cmd wl-copy || packages+=("$pkg") ;;
      xclip) need_cmd xclip || packages+=("$pkg") ;;
    esac
  done

  if ((${#packages[@]} == 0)); then
    say "Fedora dependencies are already installed."
    return 0
  fi

  say "Installing missing Fedora packages: ${packages[*]}"
  say "Commands:"
  say "  sudo dnf install -y ${packages[*]}"
  sudo dnf install -y "${packages[@]}"
}

ensure_whisper_repo() {
  if [[ -x "$WHISPER_CLI" && -f "$WHISPER_MODEL" ]]; then
    say "Existing whisper.cpp build and model detected."
    return 0
  fi

  mkdir -p "$HOME/tools"

  if [[ ! -d "$WHISPER_ROOT/.git" ]]; then
    if [[ -e "$WHISPER_ROOT" && ! -d "$WHISPER_ROOT" ]]; then
      say "Cannot use $WHISPER_ROOT because it exists as a non-directory."
      exit 1
    fi
    if [[ -d "$WHISPER_ROOT" ]]; then
      if find "$WHISPER_ROOT" -mindepth 1 -print -quit | grep -q .; then
        say "$WHISPER_ROOT exists but is not a git checkout."
        say "Refusing to write into a non-empty directory that may belong to the user."
        exit 1
      fi
      say "Using empty directory at $WHISPER_ROOT."
    else
      run git clone https://github.com/ggml-org/whisper.cpp.git "$WHISPER_ROOT"
    fi
  else
    say "Reusing existing whisper.cpp repository."
  fi

  if [[ ! -f "$WHISPER_MODEL" ]]; then
    if [[ -x "$WHISPER_ROOT/models/download-ggml-model.sh" ]]; then
      (cd "$WHISPER_ROOT" && run sh ./models/download-ggml-model.sh base.en)
    else
      say "Missing model download helper at $WHISPER_ROOT/models/download-ggml-model.sh"
      exit 1
    fi
  else
    say "Model already present: $WHISPER_MODEL"
  fi

  if [[ ! -x "$WHISPER_CLI" ]]; then
    if [[ -d "$WHISPER_ROOT" ]]; then
      (cd "$WHISPER_ROOT" && run cmake -B build -S . && run cmake --build build -j --config Release)
    else
      say "Missing whisper.cpp repository at $WHISPER_ROOT"
      exit 1
    fi
  else
    say "whisper-cli already built: $WHISPER_CLI"
  fi
}

main() {
  require_fedora
  say "Checking Fedora prerequisites."
  install_packages
  say "Checking local whisper.cpp assets."
  ensure_whisper_repo
  mkdir -p "$TMP_DIR"
  say "Temporary workspace ready: $TMP_DIR"
  say "Done."
}

main "$@"
