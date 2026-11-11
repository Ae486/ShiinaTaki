param([string]$Log, [string]$Out, [int]$IntervalSec = 5, [int]$MaxMinutes = 110, [string]$RootFilter = 'taki-first-use-*')
# Leader-only measurement for one journey: system memory, per-process memory/CPU of the owned runtime, owned disk sizes.
$start = Get-Date
$filter = "Name='node.exe' OR Name='python.exe' OR Name='postgres.exe' OR Name='headless_shell.exe'"
$keep = 'native-smoke|core-child|home-browser|home-check|native_launcher|native-launcher|vite|taki-first-use|taki-hindsight-first-use|post-reentry'
$i = 0
while ($true) {
  $os = Get-CimInstance Win32_OperatingSystem
  $procs = Get-CimInstance Win32_Process -Filter $filter |
    Where-Object { $_.Name -eq 'postgres.exe' -or $_.Name -eq 'headless_shell.exe' -or ($_.CommandLine -and $_.CommandLine -match $keep) } |
    ForEach-Object {
      $c = if ($_.CommandLine) { $_.CommandLine.Substring(0, [math]::Min(220, $_.CommandLine.Length)) } else { '' }
      [ordered]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; ws = [int64]$_.WorkingSetSize
        priv = [int64]$_.PrivatePageCount; cpu = [int64]$_.UserModeTime + [int64]$_.KernelModeTime; cmd = $c }
    }
  $rec = [ordered]@{ t = (Get-Date).ToUniversalTime().ToString('o'); freeKB = [int64]$os.FreePhysicalMemory
    totalKB = [int64]$os.TotalVisibleMemorySize; commitKB = [int64]$os.TotalVirtualMemorySize - [int64]$os.FreeVirtualMemory; procs = @($procs) }
  if ($i % 12 -eq 0) {
    $root = Get-ChildItem -Directory 'G:\' -Filter $RootFilter | Where-Object { $_.CreationTime -ge $start } |
      Sort-Object CreationTime -Descending | Select-Object -First 1
    if ($root) {
      $sizes = [ordered]@{ root = $root.FullName }
      foreach ($d in 'pg-data', 'core-data', 'native-backups') {
        $p = Join-Path $root.FullName $d
        if (Test-Path $p) { $sizes[$d] = [int64](Get-ChildItem -Recurse -File -Force $p -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum }
      }
      $rec.disk = $sizes
    }
  }
  ($rec | ConvertTo-Json -Compress -Depth 5) | Add-Content -Path $Out -Encoding utf8
  $i++
  if ((Test-Path $Log) -and (Select-String -Path $Log -Pattern '^exit=' -Quiet)) { break }
  if (((Get-Date) - $start).TotalMinutes -ge $MaxMinutes) { break }
  Start-Sleep -Seconds $IntervalSec
}
