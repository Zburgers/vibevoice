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
$BundleRoot = Join-Path $SourceDir "app\src-tauri\target\release\bundle"
function Get-BundleFingerprint($File) {
  return '{0}:{1}:{2}' -f $File.LastWriteTimeUtc.Ticks, $File.Length, (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash
}
$PriorBundles = @{}
Get-ChildItem -Path $BundleRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -in @('.msi', '.exe') } |
  ForEach-Object { $PriorBundles[$_.FullName] = Get-BundleFingerprint $_ }
function Test-CurrentBundle($File) {
  return $File.LastWriteTime -ge $BuildStarted -and (
    -not $PriorBundles.ContainsKey($File.FullName) -or
    $PriorBundles[$File.FullName] -ne (Get-BundleFingerprint $File)
  )
}
$BuildStarted = Get-Date
npm run tauri build -- --bundles msi,nsis
if ($LASTEXITCODE -ne 0) { throw "Installer build failed with exit code $LASTEXITCODE." }

$Msi = Get-ChildItem -Path $BundleRoot -Recurse -Filter "*.msi" -ErrorAction SilentlyContinue |
  Where-Object { Test-CurrentBundle $_ } |
  Sort-Object LastWriteTime |
  Select-Object -Last 1
$Setup = Get-ChildItem -Path $BundleRoot -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
  Where-Object { Test-CurrentBundle $_ } |
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
