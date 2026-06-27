#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:?source checkout path is required}"
CURRENT_EXE="${2:-}"
LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/vibevoice"
LOG_FILE="$LOG_DIR/update.log"

mkdir -p "$LOG_DIR"
exec >>"$LOG_FILE" 2>&1

say() {
  printf '[%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

run() {
  say "+ $*"
  "$@"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1
}

install_linux_bundle() {
  local bundle_root="$SOURCE_DIR/app/src-tauri/target/release/bundle"
  local deb rpm appimage
  deb="$(find "$bundle_root/deb" -maxdepth 1 -name '*.deb' -type f 2>/dev/null | sort | tail -n 1 || true)"
  rpm="$(find "$bundle_root/rpm" -maxdepth 1 -name '*.rpm' -type f 2>/dev/null | sort | tail -n 1 || true)"
  appimage="$(find "$bundle_root/appimage" -maxdepth 1 -name '*.AppImage' -type f 2>/dev/null | sort | tail -n 1 || true)"

  if [[ -n "$deb" ]] && need_cmd dpkg; then
    if need_cmd pkexec; then
      run pkexec dpkg -i "$deb"
    else
      run sudo dpkg -i "$deb"
    fi
  elif [[ -n "$rpm" ]] && need_cmd rpm; then
    if need_cmd dnf; then
      if need_cmd pkexec; then
        run pkexec dnf install -y "$rpm"
      else
        run sudo dnf install -y "$rpm"
      fi
    elif need_cmd pkexec; then
      run pkexec rpm -Uvh "$rpm"
    else
      run sudo rpm -Uvh "$rpm"
    fi
  elif [[ -n "$appimage" ]]; then
    local target="${XDG_BIN_HOME:-$HOME/.local/bin}/VibeVoice.AppImage"
    mkdir -p "$(dirname "$target")"
    run cp "$appimage" "$target"
    run chmod +x "$target"
  else
    say "No Linux bundle found under $bundle_root."
    return 1
  fi
}

install_macos_bundle() {
  local app_bundle="$SOURCE_DIR/app/src-tauri/target/release/bundle/macos/VibeVoice.app"
  if [[ ! -d "$app_bundle" ]]; then
    say "macOS .app bundle was not produced: $app_bundle"
    return 1
  fi
  run rm -rf "$HOME/Applications/VibeVoice.app"
  run mkdir -p "$HOME/Applications"
  run cp -R "$app_bundle" "$HOME/Applications/VibeVoice.app"
}

relaunch() {
  case "$(uname -s)" in
    Darwin)
      if [[ -d "$HOME/Applications/VibeVoice.app" ]]; then
        run open "$HOME/Applications/VibeVoice.app"
      elif [[ -n "$CURRENT_EXE" ]]; then
        run open "$CURRENT_EXE"
      fi
      ;;
    *)
      if need_cmd gtk-launch && [[ -f /usr/share/applications/VibeVoice.desktop ]]; then
        run gtk-launch VibeVoice || true
      elif [[ -n "$CURRENT_EXE" && -x "$CURRENT_EXE" ]]; then
        nohup "$CURRENT_EXE" >/dev/null 2>&1 &
      elif need_cmd vibevoice; then
        nohup vibevoice >/dev/null 2>&1 &
      fi
      ;;
  esac
}

main() {
  say "Starting VibeVoice source update from $SOURCE_DIR"
  cd "$SOURCE_DIR"

  if [[ -n "$(git status --porcelain)" ]]; then
    say "Refusing to update because the source checkout has uncommitted changes."
    exit 1
  fi

  run git fetch --prune
  upstream="$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null || printf 'origin/master')"
  run git merge --ff-only "$upstream"

  cd "$SOURCE_DIR/app"
  if [[ -f package-lock.json ]]; then
    run npm ci
  else
    run npm install
  fi
  run npm run build
  case "$(uname -s)" in
    Darwin) run npm run tauri build -- --bundles app,dmg ;;
    Linux) run npm run tauri build -- --bundles deb,rpm ;;
    *)
      say "Unsupported platform: $(uname -s)"
      exit 1
      ;;
  esac

  case "$(uname -s)" in
    Darwin) install_macos_bundle ;;
    Linux) install_linux_bundle ;;
  esac

  say "Update installed. Relaunching VibeVoice."
  relaunch
}

main "$@"
