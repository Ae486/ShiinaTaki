# Fixed Docker process owner shared only by this task's Root scripts.
function Save-Report {
    $destination = $EvidenceFile
    [IO.File]::WriteAllText($destination, ($Report | ConvertTo-Json -Depth 16), $Utf8)
}

function Assert-PlainPath([string]$Path) {
    $entry = Get-Item -LiteralPath $Path -Force
    while ($null -ne $entry) {
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'redirected_path' }
        $entry = $entry.Parent
    }
}

function Invoke-FixedDocker([string[]]$Arguments, [bool]$UseBuildConfig = $false, [int]$TimeoutMs = 10000, [bool]$AllowFailure = $false) {
    if ($CommandDeadline) {
        $remaining = $CommandDeadline - [Environment]::TickCount64 - 2000
        if ($remaining -lt 1000) { throw 'total_command_deadline' }
        $TimeoutMs = [int][Math]::Min($TimeoutMs, $remaining)
    }
    if ((Get-FileHash -LiteralPath $Docker -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Report.dockerSha256) { throw 'docker_changed' }
    $config = Join-Path $Stage $(if ($UseBuildConfig) { 'build-config' } else { 'client-config' })
    $argv = @('--host', $Endpoint, '--config', $config) + $Arguments
    $record = [ordered]@{ argv = @($Docker) + $argv; dispatchedAt = [DateTime]::UtcNow.ToString('o'); exitCode = $null; closed = $false }
    $Report.commands += $record
    Save-Report
    $start = [Diagnostics.ProcessStartInfo]::new($Docker)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.WorkingDirectory = $Stage
    $start.Environment.Clear()
    $start.Environment['SystemRoot'] = $env:SystemRoot
    $start.Environment['TEMP'] = $Stage
    $start.Environment['TMP'] = $Stage
    foreach ($argument in $argv) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    try {
        if (-not $process.Start()) { throw 'spawn_failed' }
        $record.pid = $process.Id
        Save-Report
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutMs)) {
            $record.timedOut = $true
            $process.Kill($true)
            $record.closed = $process.WaitForExit(3000)
            throw 'docker_command_timeout'
        }
        $record.closed = $true
        $record.exitCode = $process.ExitCode
        $record.stdout = $stdout.GetAwaiter().GetResult()
        $record.stderr = $stderr.GetAwaiter().GetResult()
        $record.stdoutSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($record.stdout))).ToLowerInvariant()
        $record.stderrSha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($record.stderr))).ToLowerInvariant()
        if ($record.stdout.Length -gt 262144 -or $record.stderr.Length -gt 262144) { throw 'docker_output_bound' }
        if ($record.exitCode -ne 0 -and -not $AllowFailure) { throw 'docker_command_failed' }
        return $record.stdout.Trim()
    } finally {
        Save-Report
        $process.Dispose()
    }
}


