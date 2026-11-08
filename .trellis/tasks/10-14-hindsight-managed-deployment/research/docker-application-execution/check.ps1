# One network-none, read-only check of the original derived image, followed by exact-ID cleanup.
$ErrorActionPreference = 'Stop'
$Token = 'ad8bf8b8-9577-4420-9fd9-212574bd4568'
$Stage = "G:/TakiAgent-c2b-native-api/application-root-$Token"
$Docker = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe'
$Endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$Name = "taki-c2b-application-check-$Token"
$Utf8 = [Text.UTF8Encoding]::new($false)
$EvidenceFile = Join-Path $Stage 'check.json'
$StartedTicks = [Environment]::TickCount64
$CommandDeadline = $StartedTicks + 180000
. (Join-Path $PSScriptRoot 'docker-command.ps1')
Assert-PlainPath $Stage
if ((Get-Content -LiteralPath (Join-Path $Stage '.c2b-application-root-owner') -Raw) -cne $Token) { throw 'root_owner' }
if (Test-Path -LiteralPath $EvidenceFile) { throw 'check_already_attempted_inspect_original' }
$Build = Get-Content -LiteralPath (Join-Path $Stage 'build.json') -Raw | ConvertFrom-Json
if (-not $Build.complete) {
    $Readback = Get-Content -LiteralPath (Join-Path $Stage 'build-inspection.json') -Raw | ConvertFrom-Json
    if ($Readback.originalBuildSha256 -cne (Get-FileHash -LiteralPath (Join-Path $Stage 'build.json') -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'original_build_drift' }
    $Build = $Readback
}
$Preflight = Get-Content -LiteralPath (Join-Path $Stage 'preflight.json') -Raw | ConvertFrom-Json
if (-not $Build.complete -or $Build.token -cne $Token -or -not $Preflight.complete) { throw 'build_or_preflight_incomplete' }
$ImageId = $Build.image.id
$Report = [ordered]@{ token = $Token; startedAt = [DateTime]::UtcNow.ToString('o'); stage = $Stage; commands = @(); complete = $false;
    deploymentReady = $false; imageId = $ImageId; dockerSha256 = $Build.dockerSha256; createAttempted = $false;
    cleanupProven = $false; resourceDisposition = 'not-created'; inspections = @() }
$Report.driverHashes = @{}
foreach ($sourceFile in Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1') {
    $Report.driverHashes[$sourceFile.Name] = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
$fence = [IO.File]::Open($EvidenceFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$fence.Dispose()
Save-Report
$ContainerId = $null
$Owned = $false
$Projection = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"path":{{json .Path}},"args":{{json .Args}},"user":{{json .Config.User}},"labels":{{json .Config.Labels}},"tty":{{json .Config.Tty}},"stdin":{{json .Config.OpenStdin}},"network":{{json .HostConfig.NetworkMode}},"readonly":{{json .HostConfig.ReadonlyRootfs}},"mounts":{{json .Mounts}},"bindings":{{json .HostConfig.PortBindings}},"privileged":{{json .HostConfig.Privileged}},"capAdd":{{json .HostConfig.CapAdd}},"capDrop":{{json .HostConfig.CapDrop}},"security":{{json .HostConfig.SecurityOpt}},"memory":{{json .HostConfig.Memory}},"cpus":{{json .HostConfig.NanoCpus}},"pids":{{json .HostConfig.PidsLimit}},"log":{{json .HostConfig.LogConfig.Type}},"restart":{{json .HostConfig.RestartPolicy.Name}},"running":{{json .State.Running}},"status":{{json .State.Status}},"exitCode":{{json .State.ExitCode}},"startedAt":{{json .State.StartedAt}},"oom":{{json .State.OOMKilled}}}'

function Observe-Original {
    if (-not $ContainerId) { throw 'unknown_original_container' }
    $engine = Invoke-FixedDocker @('info', '--format', '{{.ID}}')
    if ($engine -cne $Preflight.engine.id) { throw 'engine_changed' }
    $value = (Invoke-FixedDocker @('container', 'inspect', $ContainerId, '--format', $Projection)) | ConvertFrom-Json
    $expectedArgs = @('-I', '-B', '-S', '/opt/taki-c2b-application/artifact-check.py')
    if ($value.id -cne $ContainerId -or $value.name -cne "/$Name" -or $value.image -cne $ImageId -or $value.labels.'taki.c2b.application' -cne $Token -or $value.labels.'taki.c2b.role' -cne 'application-source-cache-check' -or
        $value.path -cne '/app/api/.venv/bin/python' -or ($value.args -join '|') -cne ($expectedArgs -join '|') -or
        $value.user -cne '1000:1000' -or $value.tty -or $value.stdin -or $value.network -cne 'none' -or -not $value.readonly -or
        @($value.mounts).Count -ne 0 -or ($value.bindings -and @($value.bindings.PSObject.Properties).Count -gt 0) -or $value.privileged -or
        $value.capAdd -or ($value.capDrop -join '|') -cne 'ALL' -or ($value.security -join '|') -cne 'no-new-privileges=true' -or
        $value.memory -ne 268435456 -or $value.cpus -ne 1000000000 -or $value.pids -ne 16 -or $value.log -cne 'none' -or $value.restart -cne 'no') { throw 'original_container_mismatch' }
    if ($Report.originalStartedAt -and $value.startedAt -cne $Report.originalStartedAt) { throw 'original_start_changed' }
    $Report.inspections += $value
    Save-Report
    return $value
}

function Assert-ContainerAbsent([string]$Reference) {
    $null = Invoke-FixedDocker @('container', 'inspect', $Reference, '--format', '{{.Id}}') $false 10000 $true
    $record = $Report.commands[-1]
    if ($record.exitCode -ne 1 -or $record.stdout.Trim() -ne '' -or $record.stderr.Trim() -notmatch ('^Error(?: response from daemon)?: No such (?:container|object): ' + [regex]::Escape($Reference) + '$')) { throw 'container_absence_unproven' }
}

try {
    $engine = Invoke-FixedDocker @('info', '--format', '{{.ID}}')
    if ($engine -cne $Preflight.engine.id) { throw 'engine_changed' }
    $currentImage = Invoke-FixedDocker @('image', 'inspect', $Build.tag, '--format', '{{.Id}}')
    if ($currentImage -cne $ImageId) { throw 'image_tag_changed' }
    Assert-ContainerAbsent $Name
    $Report.createAttempted = $true
    Save-Report
    $created = Invoke-FixedDocker @('create', '--name', $Name, '--label', "taki.c2b.application=$Token", '--label', 'taki.c2b.role=application-source-cache-check', '--pull=never', '--network=none',
        '--read-only', '--user=1000:1000', '--log-driver=none', '--memory=256m', '--cpus=1', '--pids-limit=16', '--cap-drop=ALL',
        '--security-opt=no-new-privileges=true', '--restart=no', '--entrypoint=/app/api/.venv/bin/python', $ImageId,
        '-I', '-B', '-S', '/opt/taki-c2b-application/artifact-check.py')
    if ($created -notmatch '^[a-f0-9]{64}$') { throw 'create_reply_unknown' }
    $ContainerId = $created
    $Report.containerId = $ContainerId
    Save-Report
    $before = Observe-Original
    if ($before.running -or $before.status -cne 'created') { throw 'unexpected_initial_state' }
    $Owned = $true
    $raw = Invoke-FixedDocker @('start', '--attach', $ContainerId) $false 180000 $true
    $execution = $Report.commands[-1]
    if ($execution.stdout.Length -gt 32768 -or $execution.stderr.Length -gt 16384) { throw 'checker_output_bound' }
    if ($raw) { $Report.checker = $raw | ConvertFrom-Json }
    $after = Observe-Original
    $Report.originalStartedAt = $after.startedAt
    if ($execution.exitCode -ne 0 -or $execution.stderr -ne '' -or $after.running -or $after.status -cne 'exited' -or $after.exitCode -ne 0 -or $after.oom) { throw 'checker_execution_failed' }
    $check = $Report.checker
    if ($check.schema -cne 'c2b-application-artifact-check-v1' -or $check.token -cne $Token -or -not $check.complete -or $check.deploymentReady -or
        -not $check.fileGatePassed -or -not $check.refusalCasesPassed -or -not $check.tokenizerLoadPassed -or
        $check.files.build -cne 'taki-memory-hindsight-0.9.0-template-backup-v1' -or $check.files.metadata.count -ne 221 -or
        -not $check.tokenizer.loaded -or -not $check.tokenizer.roundtrip -or $check.tokenizer.cacheReads -ne 1 -or $check.tokenizer.forbiddenEffects -ne 0) { throw 'artifact_check_incomplete' }
    $Report.complete = $true
} catch {
    $Report.failure = $_.Exception.Message
} finally {
    $Report.workElapsedMs = [Environment]::TickCount64 - $StartedTicks
    $CommandDeadline = $StartedTicks + 240000
    try {
        if ($Report.createAttempted -and -not $Owned) {
            $Report.resourceDisposition = 'unknown-create-retained-no-name-only-cleanup'
            throw 'ownership_unproven'
        }
        if ($Owned) {
            $observed = Observe-Original
            if ($observed.running) {
                $null = Invoke-FixedDocker @('stop', '--time=3', $ContainerId)
                $observed = Observe-Original
            }
            if ($observed.running -or $observed.status -notin @('created', 'exited')) { throw 'stop_unproven' }
            $null = Invoke-FixedDocker @('rm', $ContainerId)
            Assert-ContainerAbsent $ContainerId
            Assert-ContainerAbsent $Name
            $Report.resourceDisposition = 'original-container-stopped-removed-and-absent'
        }
        $Report.cleanupProven = $true
    } catch { $Report.cleanupFailure = $_.Exception.Message }
    $Report.elapsedMs = [Environment]::TickCount64 - $StartedTicks
    $Report.complete = $Report.complete -and $Report.cleanupProven -and $Report.elapsedMs -lt 240000
    $Report.finishedAt = [DateTime]::UtcNow.ToString('o')
    Save-Report
    $archive = Join-Path (Split-Path $PSScriptRoot) 'c2b-application-root-check-01a180b6.json'
    if (-not (Test-Path -LiteralPath $archive)) { [IO.File]::Copy($EvidenceFile, $archive, $false) }
    [pscustomobject]$Report | Select-Object complete,failure,cleanupProven,cleanupFailure,elapsedMs,resourceDisposition | ConvertTo-Json
}
if (-not $Report.complete) { throw 'artifact_check_failed_see_original_evidence' }
