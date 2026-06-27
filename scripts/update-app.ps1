param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDir,
  [string]$CurrentExe = ""
)

$ErrorActionPreference = "Stop"
$env:MSYS = "$env:MSYS umask=022"
$LogDir = Join-Path $env:LOCALAPPDATA "VibeVoice\logs"
$LogFile = Join-Path $LogDir "update.log"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Path $LogFile -Append | Out-Null

function Write-Step($Message) {
  Write-Host "[$((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))] $Message"
}

function Invoke-Step([string]$Command, [string[]]$Arguments) {
  Write-Step "+ $Command $($Arguments -join ' ')"
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE"
  }
}

try {
  Write-Step "Starting VibeVoice source update from $SourceDir"
  Set-Location $SourceDir

  $dirty = git status --porcelain
  if (-not [string]::IsNullOrWhiteSpace(($dirty -join ""))) {
    throw "Refusing to update because the source checkout has uncommitted changes."
  }

  Invoke-Step "git" @("fetch", "--prune")
  $upstream = git rev-parse --abbrev-ref "@{u}" 2>$null
  if ([string]::IsNullOrWhiteSpace($upstream)) {
    $upstream = "origin/master"
  }
  Invoke-Step "git" @("merge", "--ff-only", $upstream)

  Set-Location (Join-Path $SourceDir "app")
  if (Test-Path "package-lock.json") {
    Invoke-Step "npm" @("ci")
  } else {
    Invoke-Step "npm" @("install")
  }
  Invoke-Step "npm" @("run", "build")
  Invoke-Step "npm" @("run", "tauri", "build", "--", "--bundles", "msi,nsis")

  $bundleRoot = Join-Path $SourceDir "app\src-tauri\target\release\bundle"
  $msi = Get-ChildItem -Path $bundleRoot -Recurse -Filter "*.msi" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime |
    Select-Object -Last 1
  $setup = Get-ChildItem -Path $bundleRoot -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime |
    Select-Object -Last 1

  if ($msi) {
    Invoke-Step "msiexec.exe" @("/i", $msi.FullName, "/qn", "/norestart")
  } elseif ($setup) {
    Invoke-Step $setup.FullName @("/S")
  } else {
    throw "No Windows installer was produced under $bundleRoot."
  }

  Write-Step "Update installed. Relaunching VibeVoice."
  if (-not [string]::IsNullOrWhiteSpace($CurrentExe) -and (Test-Path $CurrentExe)) {
    Start-Process -FilePath $CurrentExe
  } else {
    $installed = Join-Path $env:LOCALAPPDATA "Programs\VibeVoice\VibeVoice.exe"
    if (Test-Path $installed) {
      Start-Process -FilePath $installed
    }
  }
} finally {
  Stop-Transcript | Out-Null
}
