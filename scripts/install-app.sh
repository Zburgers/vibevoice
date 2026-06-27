#!/usr/bin/env bash
set -euo pipefail
umask 022

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$SOURCE_DIR/app"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

case "$(uname -s)" in
  Linux)
    npm run tauri build -- --bundles deb,rpm
    bundle_root="$SOURCE_DIR/app/src-tauri/target/release/bundle"
    deb="$(find "$bundle_root/deb" -maxdepth 1 -name '*.deb' -type f 2>/dev/null | sort | tail -n 1 || true)"
    rpm="$(find "$bundle_root/rpm" -maxdepth 1 -name '*.rpm' -type f 2>/dev/null | sort | tail -n 1 || true)"
    if [[ -n "$deb" && -x "$(command -v dpkg)" ]]; then
      sudo dpkg -i "$deb"
    elif [[ -n "$rpm" && -x "$(command -v dnf)" ]]; then
      sudo dnf install -y "$rpm"
    elif [[ -n "$rpm" && -x "$(command -v rpm)" ]]; then
      sudo rpm -Uvh "$rpm"
    else
      echo "No supported Linux package was produced."
      exit 1
    fi
    ;;
  Darwin)
    npm run tauri build -- --bundles app,dmg
    app_bundle="$SOURCE_DIR/app/src-tauri/target/release/bundle/macos/VibeVoice.app"
    mkdir -p "$HOME/Applications"
    rm -rf "$HOME/Applications/VibeVoice.app"
    cp -R "$app_bundle" "$HOME/Applications/VibeVoice.app"
    ;;
  *)
    echo "Use scripts/install-app.ps1 on Windows."
    exit 1
    ;;
esac
