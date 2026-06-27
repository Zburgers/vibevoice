$ErrorActionPreference = "Stop"

$product = Get-CimInstance Win32_Product |
  Where-Object { $_.Name -eq "VibeVoice" } |
  Select-Object -First 1

if ($product) {
  Start-Process -Wait -FilePath "msiexec.exe" -ArgumentList @("/x", $product.IdentifyingNumber)
} else {
  $installDir = Join-Path $env:LOCALAPPDATA "Programs\VibeVoice"
  if (Test-Path $installDir) {
    Remove-Item -Recurse -Force $installDir
  }
}

Write-Host "VibeVoice app removed. User data remains in the platform config directory."
