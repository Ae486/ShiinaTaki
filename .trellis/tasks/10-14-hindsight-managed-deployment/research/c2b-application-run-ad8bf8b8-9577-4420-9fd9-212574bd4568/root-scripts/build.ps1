param([Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{64}$')][string]$ReleaseSha256)
# One local-only derived-image build. Unknown results remain fenced and retained for inspection.
$ErrorActionPreference = 'Stop'
$Token = 'ad8bf8b8-9577-4420-9fd9-212574bd4568'
$Stage = "G:/TakiAgent-c2b-native-api/application-root-$Token"
$ArtifactStage = "G:/TakiAgent-c2b-native-api/application-$Token"
$Packet = Join-Path (Split-Path $PSScriptRoot) 'docker-application-artifact'
$Docker = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe'
$Buildx = 'C:/Program Files/Docker/Docker/resources/cli-plugins/docker-buildx.exe'
$Endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$Base = 'sha256:ba5161f9e70f2811c17a90e40921b17240ae275d51a7a4001fcb75fcb61c10db'
$Tag = "taki-c2b-application:$Token"
$Utf8 = [Text.UTF8Encoding]::new($false)
$EvidenceFile = Join-Path $Stage 'build.json'
$CommandDeadline = [Environment]::TickCount64 + 660000
. (Join-Path $PSScriptRoot 'docker-command.ps1')
Assert-PlainPath $Stage
Assert-PlainPath $ArtifactStage
if ((Get-Content -LiteralPath (Join-Path $Stage '.c2b-application-root-owner') -Raw) -cne $Token) { throw 'root_owner' }
if ((Get-Content -LiteralPath (Join-Path $ArtifactStage '.c2b-application-owner') -Raw) -cne $Token) { throw 'artifact_owner' }
if (Test-Path -LiteralPath $EvidenceFile) { throw 'build_already_attempted_inspect_original' }
if ((Get-FileHash -LiteralPath (Join-Path $Packet 'release.json') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ReleaseSha256) { throw 'release_hash' }
$Preflight = Get-Content -LiteralPath (Join-Path $Stage 'preflight.json') -Raw | ConvertFrom-Json
if (-not $Preflight.complete -or $Preflight.token -cne $Token) { throw 'preflight_missing' }
if ((Get-FileHash -LiteralPath $Buildx -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Preflight.buildxSha256) { throw 'buildx_changed' }
$Report = [ordered]@{ token = $Token; startedAt = [DateTime]::UtcNow.ToString('o'); stage = $Stage; commands = @(); complete = $false;
    deploymentReady = $false; releaseSha256 = $ReleaseSha256; dockerSha256 = $Preflight.dockerSha256; buildxSha256 = $Preflight.buildxSha256;
    sourceSnapshotSha256 = (Get-FileHash -LiteralPath (Join-Path $ArtifactStage 'snapshot.json') -Algorithm SHA256).Hash.ToLowerInvariant();
    tag = $Tag; buildDispatched = $false; disposition = 'retain-for-next-artifact-check'; gFreeBefore = (Get-PSDrive G).Free }
$Report.driverHashes = @{}
foreach ($sourceFile in Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.ps1') {
    $Report.driverHashes[$sourceFile.Name] = (Get-FileHash -LiteralPath $sourceFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
# The fixed report itself is the single-use fence, including failures before build dispatch.
$fence = [IO.File]::Open($EvidenceFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$fence.Dispose()
Save-Report
try {
    if ($Report.gFreeBefore -lt 20GB) { throw 'insufficient_space' }
    $engine = Invoke-FixedDocker @('info', '--format', '{{.ID}}')
    if ($engine -cne $Preflight.engine.id) { throw 'engine_changed' }
    $builder = Invoke-FixedDocker @('buildx', 'inspect', 'default') $true
    if ($builder -notmatch '(?m)^Driver:\s+docker\s*$' -or $builder -notmatch '(?m)^Status:\s+running\s*$' -or $builder -notmatch '(?m)^BuildKit version:\s+v0\.25\.2\s*$') { throw 'builder_changed' }
    $null = Invoke-FixedDocker @('image', 'inspect', $Tag, '--format', '{{.Id}}') $false 10000 $true
    $absence = $Report.commands[-1]
    if ($absence.exitCode -ne 1 -or $absence.stdout.Trim() -ne '' -or $absence.stderr.Trim() -notmatch ('^Error(?: response from daemon)?: No such image: ' + [regex]::Escape($Tag) + '$')) { throw 'tag_not_absent' }
    $image = Invoke-FixedDocker @('image', 'inspect', 'taki-hindsight-api:local', '--format', '{{.Id}}')
    if ($image -cne $Base) { throw 'base_changed' }
    $Report.baseLayers = (Invoke-FixedDocker @('image', 'inspect', $Base, '--format', '{{json .RootFS.Layers}}')) | ConvertFrom-Json
    $Report.buildDispatched = $true
    Save-Report
    $null = Invoke-FixedDocker @('buildx', 'build', '--builder', 'default', '--pull=false', '--network=none', '--load', '--progress=plain',
        '--label', "taki.c2b.application=$Token", '--label', 'taki.c2b.role=application-source-cache-prerequisite', '--iidfile', (Join-Path $Stage 'image-id.txt'), '--tag', $Tag,
        '--file', (Join-Path $ArtifactStage 'context/Dockerfile'), (Join-Path $ArtifactStage 'context')) $true 600000
    $id = (Get-Content -LiteralPath (Join-Path $Stage 'image-id.txt') -Raw).Trim()
    if ($id -notmatch '^sha256:[a-f0-9]{64}$' -or $id -ceq $Base) { throw 'result_image_identity' }
    $projection = '{"id":{{json .Id}},"tags":{{json .RepoTags}},"os":{{json .Os}},"architecture":{{json .Architecture}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json .Config.Cmd}},"labels":{{json .Config.Labels}},"layers":{{json .RootFS.Layers}},"volumes":{{json (index .Config "Volumes")}}}'
    $Report.image = (Invoke-FixedDocker @('image', 'inspect', $Tag, '--format', $projection)) | ConvertFrom-Json
    if ($Report.image.id -cne $id -or $Report.image.user -cne '1000:1000' -or $Report.image.os -cne 'linux' -or $Report.image.architecture -cne 'amd64' -or $Report.image.labels.'taki.c2b.application' -cne $Token) { throw 'result_image_mismatch' }
    if ($Report.image.labels.'taki.c2b.role' -cne 'application-source-cache-prerequisite' -or ($Report.image.entrypoint -join '|') -cne '/app/api/.venv/bin/python|-I|-B|-S|/opt/taki-c2b-application/artifact-check.py' -or $Report.image.cmd -or ($Report.image.volumes -and @($Report.image.volumes.PSObject.Properties).Count -gt 0)) { throw 'result_image_configuration' }
    $Report.environmentCheck = Invoke-FixedDocker @('image', 'inspect', $id, '--format', '{{range .Config.Env}}{{if eq . "TIKTOKEN_CACHE_DIR=/opt/taki-c2b-application/tokenizer"}}cache-ok {{end}}{{if eq . "PYTHON_DOTENV_DISABLED=true"}}dotenv-ok {{end}}{{end}}')
    if ((($Report.environmentCheck -split '\s+' | Sort-Object) -join '|') -cne 'cache-ok|dotenv-ok') { throw 'result_image_environment' }
    if ($Report.image.layers.Count -le $Report.baseLayers.Count) { throw 'base_layer_lineage' }
    for ($layerIndex = 0; $layerIndex -lt $Report.baseLayers.Count; $layerIndex++) {
        if ($Report.baseLayers[$layerIndex] -cne $Report.image.layers[$layerIndex]) { throw 'base_layer_lineage' }
    }
    $baseAfter = Invoke-FixedDocker @('image', 'inspect', 'taki-hindsight-api:local', '--format', '{{.Id}}')
    if ($baseAfter -cne $Base) { throw 'base_changed_after_build' }
    $Report.complete = $true
} catch {
    $Report.failure = $_.Exception.Message
    $Report.disposition = 'retain-original-build-evidence-and-resources-no-replay'
    throw
} finally {
    $Report.gFreeAfter = (Get-PSDrive G).Free
    if ($Report.gFreeAfter -lt 20GB -or $Report.gFreeBefore - $Report.gFreeAfter -gt 2GB) { $Report.complete = $false; $Report.spaceBoundExceeded = $true }
    $Report.finishedAt = [DateTime]::UtcNow.ToString('o')
    Save-Report
    $archive = Join-Path (Split-Path $PSScriptRoot) 'c2b-application-root-build-01a180b6.json'
    if (-not (Test-Path -LiteralPath $archive)) { [IO.File]::Copy($EvidenceFile, $archive, $false) }
    [pscustomobject]$Report | Select-Object complete,failure,tag,image,disposition | ConvertTo-Json -Depth 5
}
if (-not $Report.complete) { throw 'build_incomplete' }
