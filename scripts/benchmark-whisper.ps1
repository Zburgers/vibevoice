param(
  [string]$EngineRoot = "$env:LOCALAPPDATA\VibeVoice\engines\whisper.cpp",
  [string]$AudioPath = "",
  [string]$CliPath = "",
  [string]$ModelPath = "$env:LOCALAPPDATA\VibeVoice\engines\whisper.cpp\models\ggml-base.en.bin",
  [string]$OutputDirectory = "outputs\whisper-performance",
  [int]$Repeats = 2,
  [string[]]$VariantNames = @('default','passive-4','passive-2','passive-1'),
  [switch]$AllowBusyHost
)
$ErrorActionPreference = "Stop"
$cli = $CliPath
if (!$cli) {
  $cli = Join-Path $EngineRoot "build\bin\Release\whisper-cli.exe"
  if (!(Test-Path -LiteralPath $cli)) { $cli = Join-Path $EngineRoot "build\bin\whisper-cli.exe" }
}
if (!$AudioPath) { $AudioPath = Join-Path $EngineRoot "samples\jfk.wav" }
$model = $ModelPath
$out = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($out) | Out-Null
$logical = [Environment]::ProcessorCount
$inputs = @($cli, $model, $AudioPath) + @(Get-ChildItem -LiteralPath (Split-Path $cli) -Filter '*.dll' | ForEach-Object FullName)
$metadata = [pscustomobject]@{
  recorded_at = [DateTimeOffset]::Now.ToString('o')
  logical_processors = $logical
  files = @($inputs | ForEach-Object { Get-FileHash -LiteralPath $_ -Algorithm SHA256 | Select-Object Path,Hash })
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $out 'metadata.json')
$variants = @(
  @{Name="default"; Threads=0; Passive=$false},
  @{Name="passive-4"; Threads=4; Passive=$true},
  @{Name="passive-2"; Threads=2; Passive=$true},
  @{Name="passive-1"; Threads=1; Passive=$true}
)
$results = @()
if ($Repeats -lt 1 -or $Repeats -gt 20) { throw 'Repeats must be between 1 and 20' }
$selectedNames = ($VariantNames -join ',').Split(',')
$variants = @($variants | Where-Object { $_.Name -in $selectedNames })
if (!$variants.Count) { throw 'No recognized benchmark variants selected' }
for ($round=1; $round -le $Repeats; $round++) {
  foreach ($variant in $variants) {
    $busy = @(Get-Process -Name whisper-cli,rustc,cl,MSBuild -ErrorAction SilentlyContinue)
    if ($busy.Count -and !$AllowBusyHost) {
      throw 'Another transcription/compiler is running. Retry on a quiet host, or explicitly use -AllowBusyHost for exploratory measurements.'
    }
    $prefix = Join-Path $out "$($variant.Name)-$round"
    $info = [Diagnostics.ProcessStartInfo]::new($cli)
    foreach ($arg in @('-m',$model,'-f',$AudioPath,'-otxt','-nt','-of',$prefix)) { $info.ArgumentList.Add($arg) }
    if ($variant.Threads) { $info.ArgumentList.Add('-t'); $info.ArgumentList.Add([string]$variant.Threads) }
    if ($variant.Passive) { $info.Environment['OMP_WAIT_POLICY']='PASSIVE' }
    else { $info.Environment.Remove('OMP_WAIT_POLICY') | Out-Null }
    $info.UseShellExecute=$false
    $info.CreateNoWindow=$true
    $info.RedirectStandardError=$true
    $info.RedirectStandardOutput=$true
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $process = [Diagnostics.Process]::Start($info)
    $stderr = $process.StandardError.ReadToEndAsync()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $peak = 0L
    $timedOut = $false
    while (!$process.WaitForExit(100)) {
      $process.Refresh()
      $peak = [Math]::Max($peak,$process.WorkingSet64)
      if ($watch.Elapsed.TotalSeconds -gt 180) {
        $timedOut = $true
        $process.Kill($true)
        $process.WaitForExit()
        break
      }
    }
    $watch.Stop()
    [IO.File]::WriteAllText("$prefix.stderr.txt", $stderr.GetAwaiter().GetResult())
    [IO.File]::WriteAllText("$prefix.stdout.txt", $stdout.GetAwaiter().GetResult())
    if ($timedOut) { throw "Benchmark exceeded 180 seconds; logs preserved at $prefix" }
    if ($process.ExitCode -ne 0) { throw "Whisper failed: $($process.ExitCode), see $prefix.stderr.txt" }
    $cpu = $process.TotalProcessorTime.TotalSeconds
    $result = [pscustomobject]@{
      variant=$variant.Name; round=$round; wall_seconds=[Math]::Round($watch.Elapsed.TotalSeconds,3)
      cpu_seconds=[Math]::Round($cpu,3); average_cpu_percent=[Math]::Round(100*$cpu/$watch.Elapsed.TotalSeconds/$logical,2)
      peak_working_set_mb=[Math]::Round($peak/1MB,2); transcript=[IO.File]::ReadAllText("$prefix.txt").Trim()
    }
    $results += $result
    $result | ConvertTo-Json -Compress
    $results | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $out 'results.json')
    $process.Dispose()
  }
}
