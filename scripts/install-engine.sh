#!/usr/bin/env bash
set -euo pipefail

MODEL_NAME="${VIBEVOICE_MODEL_NAME:-base.en}"
MODEL_FILE="ggml-${MODEL_NAME}.bin"
WHISPER_REF="v1.9.3"
WHISPER_COMMIT="7246b7311e089fe092c4abe7cfad5d0921f8be00"
MODEL_REVISION="5359861c739e955e79d9a303bcbc70fb988958b1"
DEFAULT_MODEL_SHA256="a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
MODEL_SHA256="${VIBEVOICE_MODEL_SHA256:-$DEFAULT_MODEL_SHA256}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
ENGINE_ROOT="${VIBEVOICE_ENGINE_DIR:-$DATA_HOME/vibevoice/engines/whisper.cpp}"
TMP_DIR="${VIBEVOICE_TMP_DIR:-${TMPDIR:-/tmp}/vibevoice}"

say() {
  printf '%s\n' "$1"
}

if [[ ! "$MODEL_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  say "Invalid model name: $MODEL_NAME"
  exit 1
fi
if [[ "$MODEL_NAME" != "base.en" && -z "${VIBEVOICE_MODEL_SHA256:-}" ]]; then
  say "Set VIBEVOICE_MODEL_SHA256 when using a non-default model."
  exit 1
fi
if [[ ! "$MODEL_SHA256" =~ ^[A-Fa-f0-9]{64}$ ]]; then
  say "VIBEVOICE_MODEL_SHA256 must be a 64-character SHA-256 digest."
  exit 1
fi

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

  verify_checkout() {
    local actual
    actual="$(git -C "$ENGINE_ROOT" rev-parse HEAD)"
    if [[ "$actual" != "$WHISPER_COMMIT" ]]; then
      say "Refusing unverified whisper.cpp checkout: $actual"
      exit 1
    fi
  }

  verify_model() {
    local actual
    actual="$(sha256sum "$model" | cut -d ' ' -f 1)"
    if [[ "$actual" != "$MODEL_SHA256" ]]; then
      say "Refusing model with unexpected SHA-256: $actual"
      rm -f "$model"
      exit 1
    fi
  }

  if [[ -x "$cli" && -f "$model" ]]; then
    verify_checkout
    verify_model
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
    run git clone --branch "$WHISPER_REF" --depth 1 https://github.com/ggml-org/whisper.cpp.git "$ENGINE_ROOT"
  else
    say "Reusing whisper.cpp checkout: $ENGINE_ROOT"
  fi
  verify_checkout

  if [[ ! -f "$model" ]]; then
    (cd "$ENGINE_ROOT" && run sh ./models/download-ggml-model.sh "$MODEL_NAME")
  else
    say "Model already present: $model"
  fi
  verify_model

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
