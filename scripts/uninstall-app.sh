#!/usr/bin/env bash
set -euo pipefail

case "$(uname -s)" in
  Linux)
    if command -v dnf >/dev/null 2>&1 && rpm -q vibevoice >/dev/null 2>&1; then
      sudo dnf remove -y vibevoice
    elif command -v dpkg >/dev/null 2>&1 && dpkg -s vibevoice >/dev/null 2>&1; then
      sudo dpkg -r vibevoice
    else
      rm -f "${XDG_BIN_HOME:-$HOME/.local/bin}/VibeVoice.AppImage"
    fi
    ;;
  Darwin)
    rm -rf "$HOME/Applications/VibeVoice.app"
    ;;
  *)
    echo "Use scripts/uninstall-app.ps1 on Windows."
    exit 1
    ;;
esac

echo "VibeVoice app removed. User data remains in the platform config directory."
