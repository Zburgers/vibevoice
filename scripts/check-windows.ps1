$ErrorActionPreference = "Stop"

$EngineRoot = if ($env:VIBEVOICE_ENGINE_DIR) { $env:VIBEVOICE_ENGINE_DIR } else { Join-Path $env:LOCALAPPDATA "VibeVoice\engines\whisper.cpp" }
$WhisperCli = Join-Path $EngineRoot "build\bin\Release\whisper-cli.exe"
$AltWhisperCli = Join-Path $EngineRoot "build\bin\whisper-cli.exe"
$ModelPath = Join-Path $EngineRoot "models\ggml-base.en.bin"

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Status($Key, $Value) {
  Write-Output "$Key=$Value"
}

Status "vibevoice.check" "1"
Status "platform" "windows"
Status "engine_root" $EngineRoot
Status "whisper_cli" $(if ((Test-Path $WhisperCli) -or (Test-Path $AltWhisperCli)) { "present" } else { "missing" })
Status "whisper_cli_path" $(if (Test-Path $WhisperCli) { $WhisperCli } else { $AltWhisperCli })
Status "whisper_model" $(if (Test-Path $ModelPath) { "present" } else { "missing" })
Status "whisper_model_path" $ModelPath
Status "git" $(if (Test-Command "git") { "present" } else { "missing" })
Status "cmake" $(if (Test-Command "cmake") { "present" } else { "missing" })
Status "ffmpeg" $(if (Test-Command "ffmpeg") { "present" } else { "missing" })
Status "powershell_clipboard" $(if (Test-Command "powershell") { "present" } else { "missing" })
Status "ready" $(if (((Test-Path $WhisperCli) -or (Test-Path $AltWhisperCli)) -and (Test-Path $ModelPath)) { "1" } else { "0" })
