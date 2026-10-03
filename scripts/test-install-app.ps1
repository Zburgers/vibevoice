$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('vv-installer-test-' + [guid]::NewGuid())
$originalLocation = Get-Location
$originalMsys = $env:MSYS
New-Item -ItemType Directory -Path (Join-Path $fixture 'scripts'), (Join-Path $fixture 'app') | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install-app.ps1') -Destination (Join-Path $fixture 'scripts/install-app.ps1')
$bundle = Join-Path $fixture 'app/src-tauri/target/release/bundle'
New-Item -ItemType Directory -Path $bundle -Force | Out-Null

function npm {
  $state = $global:VibeVoiceInstallerTest
  $state.calls++
  $global:LASTEXITCODE = if ($state.calls -eq $state.failAt) { 1 } else { 0 }
  if ($args[0] -eq 'run' -and $args[1] -eq 'tauri' -and $LASTEXITCODE -eq 0 -and $state.fresh) {
    $file = Join-Path $state.bundle ('new.' + $state.extension)
    Set-Content -LiteralPath $file -Value 'mock installer'
    (Get-Item -LiteralPath $file).LastWriteTime = (Get-Date).AddSeconds(1)
  }
}
function Start-Process {
  param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
  $global:VibeVoiceInstallerTest.launched++
  $global:VibeVoiceInstallerTest.launchedPath = $FilePath
  $global:VibeVoiceInstallerTest.arguments = $ArgumentList
  [pscustomobject]@{ ExitCode = $global:VibeVoiceInstallerTest.installerExit }
}

try {
  foreach ($case in @(
    @{ fail=1; fresh=$false; ext='msi'; exit=0; throws=$true; launches=0 },
    @{ fail=2; fresh=$false; ext='msi'; exit=0; throws=$true; launches=0 },
    @{ fail=3; fresh=$false; ext='msi'; exit=0; throws=$true; launches=0 },
    @{ fail=0; fresh=$false; ext='msi'; exit=0; throws=$true; launches=0 },
    @{ fail=0; fresh=$true; ext='msi'; exit=0; throws=$false; launches=1 },
    @{ fail=0; fresh=$true; ext='exe'; exit=3010; throws=$false; launches=1 },
    @{ fail=0; fresh=$true; ext='exe'; exit=1603; throws=$true; launches=1 }
    @{ fail=0; fresh=$true; ext='exe'; exit=0; throws=$false; launches=1; future=$true }
  )) {
    Get-ChildItem -LiteralPath $bundle | Remove-Item -Force
    Set-Content -LiteralPath (Join-Path $bundle 'old.msi') -Value 'stale'
    (Get-Item -LiteralPath (Join-Path $bundle 'old.msi')).LastWriteTime = if ($case.future) { (Get-Date).AddDays(1) } else { (Get-Date).AddDays(-1) }
    $global:VibeVoiceInstallerTest = @{ calls=0; failAt=$case.fail; fresh=$case.fresh;
      extension=$case.ext; installerExit=$case.exit; launched=0; bundle=$bundle }
    $threw=$false
    try { & (Join-Path $fixture 'scripts/install-app.ps1') } catch { $threw=$true; $errorText=$_.Exception.Message }
    if ($threw -ne $case.throws -or $global:VibeVoiceInstallerTest.launched -ne $case.launches) { throw "Unexpected installer result: $($case | ConvertTo-Json -Compress): $errorText" }
    if ($case.ext -eq 'msi' -and $global:VibeVoiceInstallerTest.launched -eq 1 -and $global:VibeVoiceInstallerTest.arguments[1] -notmatch '^".*"$') { throw 'MSI argument was not quoted.' }
    if ($case.future -and $global:VibeVoiceInstallerTest.launchedPath -ne (Join-Path $bundle 'new.exe')) { throw 'Future-dated stale MSI was installed instead of the new EXE.' }
  }
  Write-Output 'Installer failure, stale artifact, success and exit-code checks passed.'
} finally {
  Set-Location $originalLocation
  $env:MSYS = $originalMsys
  Remove-Variable VibeVoiceInstallerTest -Scope Global -ErrorAction SilentlyContinue
  # The verified unique fixture root is the only recursively removed path.
  Remove-Item -LiteralPath $fixture -Recurse -Force
}
