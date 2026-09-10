param(
  [string]$ModelName = "base.en",
  [string]$EngineRoot = $(if ($env:VIBEVOICE_ENGINE_DIR) { $env:VIBEVOICE_ENGINE_DIR } else { Join-Path $env:LOCALAPPDATA "VibeVoice\engines\whisper.cpp" })
)

$ErrorActionPreference = "Stop"
$ModelFile = "ggml-$ModelName.bin"
$WhisperRef = "v1.9.3"
$WhisperCommit = "7246b7311e089fe092c4abe7cfad5d0921f8be00"
$ModelRevision = "5359861c739e955e79d9a303bcbc70fb988958b1"
$DefaultModelSha256 = "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002"
$ModelSha256 = if ($env:VIBEVOICE_MODEL_SHA256) { $env:VIBEVOICE_MODEL_SHA256 } else { $DefaultModelSha256 }
$ModelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/$ModelRevision/$ModelFile"

if ($ModelName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
  throw "Invalid model name: $ModelName"
}
if (($ModelName -ne "base.en") -and [string]::IsNullOrWhiteSpace($env:VIBEVOICE_MODEL_SHA256)) {
  throw "Set VIBEVOICE_MODEL_SHA256 when using a non-default model."
}
if ($ModelSha256 -notmatch '^[A-Fa-f0-9]{64}$') {
  throw "VIBEVOICE_MODEL_SHA256 must be a 64-character SHA-256 digest."
}

function Write-Step($Message) {
  Write-Host $Message
}

function Test-Command($Name) {
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Add-ProcessPath($Directory) {
  if ([string]::IsNullOrWhiteSpace($Directory) -or -not (Test-Path $Directory)) {
    return
  }
  $pathParts = $env:Path -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($pathParts -notcontains $Directory) {
    $env:Path = "$Directory;$env:Path"
  }
}

function Refresh-ProcessPath {
  $segments = @($env:Path)
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not [string]::IsNullOrWhiteSpace($machinePath)) {
    $segments += $machinePath
  }
  if (-not [string]::IsNullOrWhiteSpace($userPath)) {
    $segments += $userPath
  }
  $env:Path = (($segments -join ';') -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique) -join ';'
}

function Resolve-Tool($Name, [string[]]$CandidatePaths = @()) {
  Refresh-ProcessPath
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  foreach ($candidate in $CandidatePaths) {
    if (Test-Path $candidate) {
      Add-ProcessPath (Split-Path -Parent $candidate)
      return $candidate
    }
  }

  return $null
}

function Get-CMakeCandidates {
  $candidates = @()
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "CMake\bin\cmake.exe")
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "CMake\bin\cmake.exe")
  }
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\CMake\bin\cmake.exe")
    $candidates += (Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\Kitware.CMake_Microsoft.Winget.Source_8wekyb3d8bbwe\CMake\bin\cmake.exe")
  }
  return $candidates
}

function Get-ToolOrThrow($Name, [string[]]$CandidatePaths = @()) {
  $tool = Resolve-Tool -Name $Name -CandidatePaths $CandidatePaths
  if ($tool) {
    Write-Step "$Name resolved to: $tool"
    return $tool
  }
  throw "$Name was installed or requested, but this PowerShell process cannot find it. Close and reopen PowerShell, or add the tool's bin directory to PATH."
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

  $script:GitExe = Get-ToolOrThrow -Name "git"
  $script:CMakeExe = Get-ToolOrThrow -Name "cmake" -CandidatePaths (Get-CMakeCandidates)
  $script:FfmpegExe = Get-ToolOrThrow -Name "ffmpeg"

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

  function Verify-WhisperCheckout {
    $actual = (& $script:GitExe -C $EngineRoot rev-parse HEAD).Trim()
    if ($actual -ne $WhisperCommit) {
      throw "Refusing unverified whisper.cpp checkout: $actual"
    }
  }

  function Verify-Model {
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $ModelPath).Hash
    if ($actual -ne $ModelSha256.ToUpperInvariant()) {
      Remove-Item -Force -LiteralPath $ModelPath
      throw "Refusing model with unexpected SHA-256: $actual"
    }
  }

  if ((Test-Path $WhisperCli) -and (Test-Path $ModelPath)) {
    Verify-WhisperCheckout
    Verify-Model
    Write-Step "Existing whisper.cpp engine detected: $EngineRoot"
    return
  }

  $EngineParent = Split-Path -Parent $EngineRoot
  New-Item -ItemType Directory -Force -Path $EngineParent | Out-Null

  if (-not (Test-Path (Join-Path $EngineRoot ".git"))) {
    if ((Test-Path $EngineRoot) -and ((Get-ChildItem -Force $EngineRoot | Select-Object -First 1) -ne $null)) {
      throw "$EngineRoot exists but is not a whisper.cpp git checkout. Set VIBEVOICE_ENGINE_DIR to an empty directory or existing checkout."
    }
    Write-Step "+ git clone --branch $WhisperRef --depth 1 https://github.com/ggml-org/whisper.cpp.git `"$EngineRoot`""
    & $script:GitExe clone --branch $WhisperRef --depth 1 https://github.com/ggml-org/whisper.cpp.git $EngineRoot
  } else {
    Write-Step "Reusing whisper.cpp checkout: $EngineRoot"
  }
  Verify-WhisperCheckout

  New-Item -ItemType Directory -Force -Path (Join-Path $EngineRoot "models") | Out-Null
  if (-not (Test-Path $ModelPath)) {
    Write-Step "Downloading $ModelFile"
    Invoke-WebRequest -Uri $ModelUrl -OutFile $ModelPath
  } else {
    Write-Step "Model already present: $ModelPath"
  }
  Verify-Model

  if (-not ((Test-Path $WhisperCli) -or (Test-Path $AltWhisperCli))) {
    Write-Step "+ cmake -S `"$EngineRoot`" -B `"$EngineRoot\build`" -A x64"
    & $script:CMakeExe -S $EngineRoot -B (Join-Path $EngineRoot "build") -A x64
    Write-Step "+ cmake --build `"$EngineRoot\build`" --config Release --parallel"
    & $script:CMakeExe --build (Join-Path $EngineRoot "build") --config Release --parallel
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
