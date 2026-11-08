# Fixed Root-only read-only Docker preflight for the current application artifact.
# The marked client staging is retained for interruption recovery; no resource is deleted.
$ErrorActionPreference = 'Stop'
$Token = 'ad8bf8b8-9577-4420-9fd9-212574bd4568'
$Stage = "G:/TakiAgent-c2b-native-api/application-root-$Token"
$Docker = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe'
$Buildx = 'C:/Program Files/Docker/Docker/resources/cli-plugins/docker-buildx.exe'
$Endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$Base = 'sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db'
$Utf8 = [Text.UTF8Encoding]::new($false)
$Report = [ordered]@{ token = $Token; observedAt = [DateTime]::UtcNow.ToString('o'); complete = $false; deploymentReady = $false; commands = @(); stage = $Stage }

$EvidenceFile = Join-Path $Stage 'preflight.json'
. (Join-Path $PSScriptRoot 'docker-command.ps1')
if (Test-Path -LiteralPath $Stage) { throw 'root_stage_already_exists_inspect_original_preflight' }
Assert-PlainPath (Split-Path $Stage)
if ((Get-FileHash -LiteralPath $Docker -Algorithm SHA256).Hash.ToLowerInvariant() -ne '0a4d8fe2ab107ceae44ee5f5fc1e1c155790042b7e3d3163826660da882b389d') { throw 'docker_pin' }
if ((Get-FileHash -LiteralPath $Buildx -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'c8d20cd80c940cf866717dd938eca50dbe588e06e0c0ced5a9d97b06b27bf8a7') { throw 'buildx_pin' }
$null = New-Item -ItemType Directory -Path $Stage
[IO.File]::WriteAllText((Join-Path $Stage '.c2b-application-root-owner'), $Token, $Utf8)
$null = New-Item -ItemType Directory -Path (Join-Path $Stage 'client-config')
$null = New-Item -ItemType Directory -Path (Join-Path $Stage 'build-config')
[IO.File]::WriteAllText((Join-Path $Stage 'build-config/config.json'), '{"cliPluginsExtraDirs":["C:/Program Files/Docker/Docker/resources/cli-plugins"]}', $Utf8)
$Report.dockerSha256 = (Get-FileHash -LiteralPath $Docker -Algorithm SHA256).Hash.ToLowerInvariant()
$Report.buildxSha256 = (Get-FileHash -LiteralPath $Buildx -Algorithm SHA256).Hash.ToLowerInvariant()
$Report.diskFreeBytes = @{ G = (Get-PSDrive G).Free; H = (Get-PSDrive H).Free; C = (Get-PSDrive C).Free }
try {
    if ($Report.diskFreeBytes.G -lt 20GB -or $Report.diskFreeBytes.C -lt 1GB) { throw 'insufficient_staging_space' }
    $Report.engine = (Invoke-FixedDocker @('info', '--format', '{"id":{{json .ID}},"version":{{json .ServerVersion}},"os":{{json .OSType}},"architecture":{{json .Architecture}}}')) | ConvertFrom-Json
    if ($Report.engine.id -ne '93e8319e-24b7-4a7d-88f1-60923ad681e0' -or $Report.engine.version -ne '29.0.1' -or $Report.engine.os -ne 'linux') { throw 'engine_changed' }
    $Report.base = (Invoke-FixedDocker @('image', 'inspect', 'taki-hindsight-api:local', '--format', '{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},"volumes":{{json (index .Config "Volumes")}}}')) | ConvertFrom-Json
    if ($Report.base.id -ne $Base -or $Report.base.os -ne 'linux' -or $Report.base.architecture -ne 'amd64' -or ($null -ne $Report.base.volumes -and @($Report.base.volumes.PSObject.Properties).Count -ne 0)) { throw 'base_changed' }
    $Report.builder = Invoke-FixedDocker @('buildx', 'inspect', 'default') $true
    if ($Report.builder -notmatch '(?m)^Driver:\s+docker\s*$' -or $Report.builder -notmatch '(?m)^Status:\s+running\s*$' -or $Report.builder -notmatch '(?m)^BuildKit version:\s+v0\.25\.2\s*$') { throw 'builder_changed' }
    $Report.defaultEndpoint = Invoke-FixedDocker @('context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}', 'default') $true
    if (($Report.defaultEndpoint | ConvertFrom-Json) -ne $Endpoint) { throw 'builder_endpoint_changed' }
    $containerIds = Invoke-FixedDocker @('ps', '-a', '--no-trunc', '--format', '{{.ID}}')
    $Report.containers = @()
    if ($containerIds) {
        $ids = @($containerIds -split '\r?\n')
        if ($ids.Count -gt 64 -or @($ids | Where-Object { $_ -notmatch '^[a-f0-9]{64}$' }).Count) { throw 'container_inventory_bound' }
        $projection = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Image}},"status":{{json .State.Status}},"running":{{json .State.Running}},"startedAt":{{json .State.StartedAt}},"finishedAt":{{json .State.FinishedAt}}}'
        $records = Invoke-FixedDocker (@('container', 'inspect') + $ids + @('--format', $projection))
        $Report.containers = @($records -split '\r?\n' | ForEach-Object { $_ | ConvertFrom-Json })
    }
    $Report.complete = $true
} catch {
    $Report.failure = $_.Exception.Message
    throw
} finally {
    Save-Report
    $archive = Join-Path (Split-Path $PSScriptRoot) 'c2b-application-root-preflight-01a180b6.json'
    if (-not (Test-Path -LiteralPath $archive)) { [IO.File]::Copy((Join-Path $Stage 'preflight.json'), $archive, $false) }
    [pscustomobject]$Report | Select-Object complete, failure, stage, diskFreeBytes | ConvertTo-Json -Depth 3
}
