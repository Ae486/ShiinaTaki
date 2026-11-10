param(
    [Parameter(Mandatory = $true)][int]$DesktopProcessId,
    [Parameter(Mandatory = $true)][int]$CoreProcessId,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [int]$IntervalSeconds = 30,
    [int]$Intervals = 3
)

# Read-only process observations. No CDP profiler or application instrumentation.
$ErrorActionPreference = 'Stop'
$desktopStart = (Get-Process -Id $DesktopProcessId).StartTime.ToUniversalTime()
$coreStart = (Get-Process -Id $CoreProcessId).StartTime.ToUniversalTime()
$clock = [Diagnostics.Stopwatch]::StartNew()

function Read-OwnedProcesses {
    if ((Get-Process -Id $DesktopProcessId).StartTime.ToUniversalTime() -ne $desktopStart -or
        (Get-Process -Id $CoreProcessId).StartTime.ToUniversalTime() -ne $coreStart) {
        throw 'Owned process identity changed during observation'
    }
    $all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
    $owned = [Collections.Generic.HashSet[int]]::new()
    [void]$owned.Add($DesktopProcessId)
    do {
        $added = $false
        foreach ($entry in $all) {
            if ($owned.Contains([int]$entry.ParentProcessId) -and $owned.Add([int]$entry.ProcessId)) {
                $added = $true
            }
        }
    } while ($added)
    [void]$owned.Add($CoreProcessId)
    $rows = @($owned | Sort-Object | ForEach-Object {
        $item = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($null -ne $item) {
            [ordered]@{
                id = $item.Id
                group = $(if ($item.Id -eq $CoreProcessId) { 'core' } else { 'desktop' })
                name = $item.ProcessName
                startedUtc = $item.StartTime.ToUniversalTime().ToString('o')
                cpuSeconds = $item.CPU
                workingSetBytes = $item.WorkingSet64
                privateBytes = $item.PrivateMemorySize64
                handles = $item.HandleCount
                threads = $item.Threads.Count
            }
        }
    })
    [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); elapsedSeconds = $clock.Elapsed.TotalSeconds; processes = $rows }
}

$samples = [Collections.Generic.List[object]]::new()
$samples.Add((Read-OwnedProcesses))
for ($index = 1; $index -le $Intervals; $index++) {
    Start-Sleep -Seconds $IntervalSeconds
    $samples.Add((Read-OwnedProcesses))
    Write-Output "Sample $index/$Intervals recorded"
}
$result = [ordered]@{
    desktopProcessId = $DesktopProcessId
    coreProcessId = $CoreProcessId
    logicalProcessors = [Environment]::ProcessorCount
    requestedIntervalSeconds = $IntervalSeconds
    samples = $samples.ToArray()
    caveats = @('Working sets can share pages; their sum is not unique resident memory.',
        'CPU deltas are valid for matching process ID and start time; inspect process churn.',
        'This is a current-build observation, not a historical before/after regression test.')
}
$parent = Split-Path -Parent $OutputPath
[void][IO.Directory]::CreateDirectory($parent)
[IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output "Evidence: $OutputPath"
