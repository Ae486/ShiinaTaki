param([string]$Log, [string]$Out, [int]$MaxMinutes = 110)
# Sample owned descendants and PG data roots. Raw command lines and unrelated processes are never logged.
$started = Get-Date
$leaderPattern = 'TakiAgent-integration.*first-use-runtime[\\/]native-smoke\.mjs'
$ownedRoot = $null
while ($true) {
    if (-not $ownedRoot -and (Test-Path -LiteralPath $Log)) {
        $line = Select-String -LiteralPath $Log -Pattern '^\[smoke\] temp root (G:[\\/]+taki-first-use-[A-Za-z0-9]+)$' | Select-Object -First 1
        if ($line) { $ownedRoot = Get-Item -LiteralPath $line.Matches[0].Groups[1].Value }
    }
    if (-not $ownedRoot) {
        $ownedRoot = Get-ChildItem -LiteralPath 'G:/' -Directory -Filter 'taki-first-use-*' |
            Where-Object { $_.CreationTime -ge $started } | Sort-Object CreationTime -Descending | Select-Object -First 1
    }
    $rows = @(Get-CimInstance Win32_Process)
    $ownedIds = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($row in $rows) {
        if (($row.Name -eq 'node.exe' -and $row.CommandLine -match $leaderPattern) -or
            ($ownedRoot -and $row.CommandLine -and $row.CommandLine.Replace('/', '\').Contains($ownedRoot.FullName))) {
            [void]$ownedIds.Add([int]$row.ProcessId)
        }
    }
    do {
        $added = $false
        foreach ($row in $rows) {
            if ($ownedIds.Contains([int]$row.ParentProcessId) -and $ownedIds.Add([int]$row.ProcessId)) { $added = $true }
        }
    } while ($added)
    $os = Get-CimInstance Win32_OperatingSystem
    $processes = @($rows | Where-Object { $ownedIds.Contains([int]$_.ProcessId) } | ForEach-Object {
        $family = if ($_.Name -eq 'postgres.exe') { 'postgres' }
            elseif ($_.Name -eq 'python.exe' -and $_.CommandLine -match 'native_launcher|native-launcher|paired-restore') { 'native' }
            elseif ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'core-child|src[\\/]main\.ts') { 'core' }
            else { 'harness-or-browser' }
        @{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; family = $family;
           ws = [int64]$_.WorkingSetSize; private = [int64]$_.PrivatePageCount;
           cpu = [int64]$_.UserModeTime + [int64]$_.KernelModeTime }
    })
    @{ at = (Get-Date).ToUniversalTime().ToString('o'); freeKB = [int64]$os.FreePhysicalMemory;
       ownedRoot = $ownedRoot.FullName; processes = $processes } | ConvertTo-Json -Depth 5 -Compress |
        Add-Content -LiteralPath $Out -Encoding utf8NoBOM
    if ((Test-Path -LiteralPath $Log) -and (Select-String -LiteralPath $Log -Pattern '^exit=' -Quiet)) { break }
    if (((Get-Date) - $started).TotalMinutes -ge $MaxMinutes) { break }
    Start-Sleep -Seconds 5
}
