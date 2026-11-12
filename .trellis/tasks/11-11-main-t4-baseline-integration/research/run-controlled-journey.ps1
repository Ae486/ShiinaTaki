# Run the actual integrated journey with an isolated OS profile as well as isolated Core/Native/PG data.
param([switch]$PreflightOnly)

$ErrorActionPreference = 'Stop'
# Prior runs consumed at most 3.446 GiB of available physical memory; keep about 2 GiB of estimated headroom.
# Later journey stages are not yet measured. Retain one heavyweight stack and continuous resource sampling.
$minimumAvailableGiB = 5.5
$taskResearch = 'G:/TakiAgent-integration/.trellis/tasks/11-11-main-t4-baseline-integration/research'
$harnessRoot = 'G:/TakiAgent-integration/.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime'
$runId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$journeyLog = Join-Path $taskResearch ('journey-' + $runId + '.log')
$launchReceipt = Join-Path $taskResearch ('journey-launch-' + $runId + '.json')
$profilePath = Join-Path 'G:/taki-codex-work' ('integration-profile-' + [guid]::NewGuid().ToString('N'))
foreach ($part in @('', 'AppData/Local', 'AppData/Roaming', 'Temp')) {
    New-Item -ItemType Directory -Path (Join-Path $profilePath $part) | Out-Null
}
$env:USERPROFILE = $profilePath
$env:LOCALAPPDATA = Join-Path $profilePath 'AppData/Local'
$env:APPDATA = Join-Path $profilePath 'AppData/Roaming'
$env:TEMP = Join-Path $profilePath 'Temp'
$env:TMP = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
$os = Get-CimInstance Win32_OperatingSystem
$availableGiB = $os.FreePhysicalMemory / 1MB
$launch = [ordered]@{ runId = $runId; profile = $profilePath; availableGiB = [math]::Round($availableGiB, 2); minimumAvailableGiB = $minimumAvailableGiB;
    repository = 'G:/TakiAgent-integration'; migrationHead = 77; provider = 'controlled loopback'; native = 'real mock-model service';
    preflightOnly = [bool]$PreflightOnly; log = $journeyLog; receipt = $launchReceipt; stage = 'browser-preflight'; status = 'running' }
$launch | ConvertTo-Json | Set-Content -LiteralPath $launchReceipt -Encoding utf8NoBOM
Write-Host ('Journey log: ' + $journeyLog)
Write-Host ('Journey launch receipt: ' + $launchReceipt)
$journeyExit = 1
try {
    node (Join-Path $harnessRoot 'home-browser.mjs') --preflight 2>&1 | Tee-Object -FilePath $journeyLog
    if ($LASTEXITCODE -ne 0) { throw 'Home browser preflight failed; the full stack was not started.' }
    $launch.browserPreflight = 'passed'
    if ($PreflightOnly) {
        $journeyExit = 0
    } else {
        $launch.stage = 'memory-gate'
        $os = Get-CimInstance Win32_OperatingSystem
        $launch.availableGiB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
        if ($os.FreePhysicalMemory / 1MB -lt $minimumAvailableGiB) { throw "Controlled full-stack journey requires $minimumAvailableGiB GiB available physical memory." }
        $launch.stage = 'model-cache'
        & 'H:/hindsight/.venv/Scripts/python.exe' -B (Join-Path $taskResearch 'prepare-native-cache.py') $profilePath 2>&1 |
            Tee-Object -FilePath $journeyLog -Append
        if ($LASTEXITCODE -ne 0) { throw 'Isolated offline model-cache preparation failed.' }
        $launch.stage = 'journey'
        $launch | ConvertTo-Json | Set-Content -LiteralPath $launchReceipt -Encoding utf8NoBOM
        node (Join-Path $harnessRoot 'native-smoke.mjs') --with-transitions 2>&1 | Tee-Object -FilePath $journeyLog -Append
        $journeyExit = $LASTEXITCODE
    }
    $launch.status = if ($journeyExit -eq 0) { 'passed' } else { 'failed' }
} catch {
    $launch.status = 'failed'
    $_.Exception.Message | Tee-Object -FilePath $journeyLog -Append
} finally {
    $launch.exitCode = $journeyExit
    $launch.finishedAt = [DateTime]::UtcNow.ToString('o')
    $launch | ConvertTo-Json | Set-Content -LiteralPath $launchReceipt -Encoding utf8NoBOM
}
('exit=' + $journeyExit) | Add-Content -LiteralPath $journeyLog -Encoding utf8NoBOM
exit $journeyExit
