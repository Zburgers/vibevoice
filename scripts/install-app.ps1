$ErrorActionPreference = "Stop"
$SourceDir = Resolve-Path (Join-Path $PSScriptRoot "..")

Set-Location (Join-Path $SourceDir "app")
if (Test-Path "package-lock.json") {
  npm ci
} else {
  npm install
}
npm run build
npm run tauri build -- --bundles msi,nsis

$BundleRoot = Join-Path $SourceDir "app\src-tauri\target\release\bundle"
$Msi = Get-ChildItem -Path $BundleRoot -Recurse -Filter "*.msi" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime |
  Select-Object -Last 1
$Setup = Get-ChildItem -Path $BundleRoot -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime |
  Select-Object -Last 1

if ($Msi) {
  Start-Process -Wait -FilePath "msiexec.exe" -ArgumentList @("/i", $Msi.FullName)
} elseif ($Setup) {
  Start-Process -Wait -FilePath $Setup.FullName
} else {
  throw "No Windows installer was produced under $BundleRoot."
}
