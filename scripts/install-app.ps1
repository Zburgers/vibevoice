$ErrorActionPreference = "Stop"
$env:MSYS = "$env:MSYS umask=022"
$SourceDir = Resolve-Path (Join-Path $PSScriptRoot "..")

Set-Location (Join-Path $SourceDir "app")
if (Test-Path "package-lock.json") {
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
} else {
  npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed with exit code $LASTEXITCODE." }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "Frontend build failed with exit code $LASTEXITCODE." }
$BuildStarted = Get-Date
npm run tauri build -- --bundles msi,nsis
if ($LASTEXITCODE -ne 0) { throw "Installer build failed with exit code $LASTEXITCODE." }

$BundleRoot = Join-Path $SourceDir "app\src-tauri\target\release\bundle"
$Msi = Get-ChildItem -Path $BundleRoot -Recurse -Filter "*.msi" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -ge $BuildStarted } |
  Sort-Object LastWriteTime |
  Select-Object -Last 1
$Setup = Get-ChildItem -Path $BundleRoot -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -ge $BuildStarted } |
  Sort-Object LastWriteTime |
  Select-Object -Last 1

if ($Msi) {
  $Installer = Start-Process -Wait -PassThru -FilePath "msiexec.exe" -ArgumentList @("/i", ('"{0}"' -f $Msi.FullName))
} elseif ($Setup) {
  $Installer = Start-Process -Wait -PassThru -FilePath $Setup.FullName
} else {
  throw "No Windows installer was produced under $BundleRoot."
}
if ($Installer.ExitCode -notin @(0, 1641, 3010)) { throw "Installer failed with exit code $($Installer.ExitCode)." }
