param(
  [string]$ModelName = "base.en",
  [string]$EngineRoot = $(if ($env:VIBEVOICE_ENGINE_DIR) { $env:VIBEVOICE_ENGINE_DIR } else { Join-Path $env:LOCALAPPDATA "VibeVoice\engines\whisper.cpp" })
)

$ErrorActionPreference = "Stop"
$ModelFile = "ggml-$ModelName.bin"
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$ModelFile"

function Write-Step($Message) {
  Write-Host $Message
}

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-VsBuildTools {
  $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (-not (Test-Path $VsWhere)) {
    return $false
  }
  $InstallPath = & $VsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  return -not [string]::IsNullOrWhiteSpace($InstallPath)
}

function Install-WingetPackage($Id, $Name, $Override = $null) {
  if (Test-Command $Name) {
    Write-Step "$Name is already available."
    return
  }
  if (-not (Test-Command "winget")) {
    throw "winget is required to install $Id automatically. Install $Name manually, then rerun this script."
  }
  $args = @("install", "--id", $Id, "--exact", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements")
  if ($Override) {
    $args += @("--override", $Override)
  }
  Write-Step "+ winget $($args -join ' ')"
  & winget @args
}

function Ensure-Dependencies {
  Install-WingetPackage -Id "Git.Git" -Name "git"
  Install-WingetPackage -Id "Kitware.CMake" -Name "cmake"
  Install-WingetPackage -Id "Gyan.FFmpeg" -Name "ffmpeg"

  if (-not ((Test-Command "cl") -or (Test-VsBuildTools))) {
    Install-WingetPackage `
      -Id "Microsoft.VisualStudio.2022.BuildTools" `
      -Name "cl" `
      -Override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
  }
}

function Ensure-WhisperCpp {
  $WhisperCli = Join-Path $EngineRoot "build\bin\Release\whisper-cli.exe"
  $AltWhisperCli = Join-Path $EngineRoot "build\bin\whisper-cli.exe"
  $ModelPath = Join-Path $EngineRoot "models\$ModelFile"

  if ((Test-Path $WhisperCli) -and (Test-Path $ModelPath)) {
    Write-Step "Existing whisper.cpp engine detected: $EngineRoot"
    return
  }

  $EngineParent = Split-Path -Parent $EngineRoot
  New-Item -ItemType Directory -Force -Path $EngineParent | Out-Null

  if (-not (Test-Path (Join-Path $EngineRoot ".git"))) {
    if ((Test-Path $EngineRoot) -and ((Get-ChildItem -Force $EngineRoot | Select-Object -First 1) -ne $null)) {
      throw "$EngineRoot exists but is not a whisper.cpp git checkout. Set VIBEVOICE_ENGINE_DIR to an empty directory or existing checkout."
    }
    Write-Step "+ git clone https://github.com/ggml-org/whisper.cpp.git `"$EngineRoot`""
    & git clone https://github.com/ggml-org/whisper.cpp.git $EngineRoot
  } else {
    Write-Step "Reusing whisper.cpp checkout: $EngineRoot"
  }

  New-Item -ItemType Directory -Force -Path (Join-Path $EngineRoot "models") | Out-Null
  if (-not (Test-Path $ModelPath)) {
    Write-Step "Downloading $ModelFile"
    Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelPath
  } else {
    Write-Step "Model already present: $ModelPath"
  }

  if (-not ((Test-Path $WhisperCli) -or (Test-Path $AltWhisperCli))) {
    Write-Step "+ cmake -S `"$EngineRoot`" -B `"$EngineRoot\build`" -A x64"
    & cmake -S $EngineRoot -B (Join-Path $EngineRoot "build") -A x64
    Write-Step "+ cmake --build `"$EngineRoot\build`" --config Release --parallel"
    & cmake --build (Join-Path $EngineRoot "build") --config Release --parallel
  } else {
    Write-Step "whisper-cli already built."
  }

  if (-not ((Test-Path $WhisperCli) -or (Test-Path $AltWhisperCli))) {
    throw "whisper-cli.exe was not produced by the build."
  }
}

Ensure-Dependencies
Ensure-WhisperCpp
New-Item -ItemType Directory -Force -Path (Join-Path $env:TEMP "vibevoice") | Out-Null
Write-Step "Done."
