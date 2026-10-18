$ErrorActionPreference = 'Stop'
$b1RuntimeRoot = [IO.Path]::GetFullPath('H:/TakiAgent/.trellis/.runtime/g1-validation')
$b1FixtureSuffixes = @(
    '9b1caf3bb472', '26b13d415121', 'da81fad5d7e5', '38311cdee71c',
    'cf93163e37bf', '881b0fa8004f', '8dd90b85eb50', '5a4962484a6d', 'befa9df1db23'
)
# Read process identities once. Only emit bounded identifiers, never command lines.
$b1Processes = @(Get-CimInstance Win32_Process)
# This audit itself runs below the retained-evidence Python wrapper. Its active
# ancestors are expected; exclude that exact chain, not all Python processes.
$b1AuditAncestors = New-Object 'System.Collections.Generic.HashSet[int]'
$b1Cursor = [int]$PID
while ($b1Cursor -gt 0 -and $b1AuditAncestors.Add($b1Cursor)) {
    $b1Parent = $b1Processes | Where-Object { $_.ProcessId -eq $b1Cursor } | Select-Object -First 1
    if ($null -eq $b1Parent) { break }
    $b1Cursor = [int]$b1Parent.ParentProcessId
}
$b1Fixtures = @(
    foreach ($b1Suffix in $b1FixtureSuffixes) {
        $b1Name = 'taki-hindsight-g1-' + $b1Suffix
        $b1Root = Join-Path $b1RuntimeRoot $b1Name
        $b1Ownership = Get-Content -LiteralPath (Join-Path $b1Root 'ownership.json') -Raw | ConvertFrom-Json
        $b1Info = Get-Content -LiteralPath (Join-Path $b1Root 'info.stdout.log') -Raw | ConvertFrom-Json
        if ($b1Ownership.name -ne $b1Name -or
            [IO.Path]::GetFullPath($b1Ownership.root) -ne $b1Root -or
            $b1Ownership.stopped -ne $true) {
            throw ('Fixture ownership or recorded stop mismatch: ' + $b1Name)
        }
        [pscustomobject]@{
            fixture = $b1Name
            stoppedRecorded = $b1Ownership.stopped
            dataRemoved = -not (Test-Path -LiteralPath (Join-Path $b1Root 'data'))
            registryRemoved = -not (Test-Path -LiteralPath $b1Ownership.registry)
            originalPostgresPid = $b1Info.pid
            originalPostgresPidAbsent = @($b1Processes | Where-Object { $_.ProcessId -eq $b1Info.pid }).Count -eq 0
        }
    }
)
$b1CommandPattern = 'b1-independent-native|run_isolated_hindsight\.py|generate_openapi\.py|hindsight-(template-compatibility|configuration-compatibility|configuration-service|compatibility-service)\.test\.ts'
$b1SurvivingChecks = @($b1Processes | Where-Object {
    -not $b1AuditAncestors.Contains([int]$_.ProcessId) -and
    $_.Name -in @('python.exe', 'python3.exe', 'node.exe', 'pg0.exe', 'postgres.exe') -and
    ($_.CommandLine -match $b1CommandPattern -or $_.CommandLine -like '*taki-hindsight-g1-*')
} | Select-Object ProcessId, ParentProcessId, Name)
$b1Passed = @($b1Fixtures | Where-Object {
    -not $_.dataRemoved -or -not $_.registryRemoved -or -not $_.originalPostgresPidAbsent
}).Count -eq 0 -and $b1SurvivingChecks.Count -eq 0
[pscustomobject]@{
    observedAt = [DateTimeOffset]::Now.ToString('o')
    fixtures = $b1Fixtures
    survivingCheckProcesses = $b1SurvivingChecks
    passed = $b1Passed
} | ConvertTo-Json -Depth 5
if (-not $b1Passed) { exit 1 }
