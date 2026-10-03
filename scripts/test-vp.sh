#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
export HOME="$fixture/home"
export TMPDIR="$fixture/tmp"
export VP_TEST_LOG="$fixture/log"
mkdir -p "$HOME/tools/whisper.cpp/build/bin" "$TMPDIR" "$fixture/bin" "$VP_TEST_LOG"
export PATH="$fixture/bin:$PATH"
cat > "$fixture/bin/arecord" <<'SH'
#!/usr/bin/env bash
audio="${!#}"
printf 'audio' > "$audio"
printf '%s' "$audio" > "$VP_TEST_LOG/audio"
stat -c '%a' "$(dirname "$audio")" > "$VP_TEST_LOG/dir-mode"
stat -c '%a' "$audio" > "$VP_TEST_LOG/file-mode"
trap 'exit 0' TERM INT
while :; do sleep 0.05; done
SH
cat > "$HOME/tools/whisper.cpp/build/bin/whisper-cli" <<'SH'
#!/usr/bin/env bash
[[ "${VP_TEST_FAIL:-0}" == 0 ]] || exit 17
while [[ $# -gt 0 ]]; do
  if [[ "$1" == -of ]]; then out="$2"; shift; fi
  shift
done
printf '  private transcript  \n' > "$out.txt"
stat -c '%a' "$out.txt" > "$VP_TEST_LOG/transcript-mode"
SH
cat > "$fixture/bin/wl-copy" <<'SH'
#!/usr/bin/env bash
cat > "$VP_TEST_LOG/clipboard"
SH
chmod +x "$fixture/bin/arecord" "$fixture/bin/wl-copy" "$HOME/tools/whisper.cpp/build/bin/whisper-cli"

run_case() {
  local fail="$1" signal="${2:-}" pid status=0
  rm -f "$VP_TEST_LOG/audio"
  mkfifo "$fixture/input"
  exec 3<> "$fixture/input"
  VP_TEST_FAIL="$fail" bash "$repo/vp" < "$fixture/input" > "$fixture/output" &
  pid=$!
  printf '\n' >&3
  for _ in {1..100}; do [[ -f "$VP_TEST_LOG/file-mode" && -f "$VP_TEST_LOG/audio" ]] && break; sleep 0.02; done
  [[ -f "$VP_TEST_LOG/audio" ]]
  if [[ -n "$signal" ]]; then kill -"$signal" "$pid"; else printf '\n' >&3; fi
  wait "$pid" || status=$?
  exec 3>&-
  rm "$fixture/input"
  local audio
  audio="$(cat "$VP_TEST_LOG/audio")"
  [[ "$audio" == "$TMPDIR"/voice-prompt.*/prompt.wav ]]
  [[ ! -e "$(dirname "$audio")" ]]
  if [[ -n "$signal" || "$fail" != 0 ]]; then [[ "$status" != 0 ]]; else [[ "$status" == 0 ]]; fi
}

# Preplanted old paths must never be opened or removed.
mkdir "$TMPDIR/voice-prompt"
printf 'untouched' > "$fixture/target"
ln -s "$fixture/target" "$TMPDIR/voice-prompt/prompt.wav"
run_case 0
[[ "$(cat "$VP_TEST_LOG/clipboard")" == 'private transcript' ]]
[[ "$(cat "$VP_TEST_LOG/dir-mode")" == 700 ]]
[[ "$(cat "$VP_TEST_LOG/file-mode")" == 600 ]]
[[ "$(cat "$VP_TEST_LOG/transcript-mode")" == 600 ]]
run_case 1
run_case 0 TERM
[[ "$(cat "$fixture/target")" == untouched ]]
[[ "$(cat "$TMPDIR/voice-prompt/prompt.wav")" == untouched ]]
echo 'vp privacy, success, failure and signal cleanup checks passed.'
