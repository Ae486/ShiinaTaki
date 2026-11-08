# Recover only the successful original build's readback after an optional Config.Cmd template error.
$ErrorActionPreference = 'Stop'
$Token = 'ad8bf8b8-9577-4420-9fd9-212574bd4568'
$Stage = "G:/TakiAgent-c2b-native-api/application-root-$Token"
$Docker = 'C:/Program Files/Docker/Docker/resources/bin/docker.exe'
$Endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$Utf8 = [Text.UTF8Encoding]::new($false)
$EvidenceFile = Join-Path $Stage 'build-inspection.json'
$CommandDeadline = [Environment]::TickCount64 + 60000
. (Join-Path $PSScriptRoot 'docker-command.ps1')
Assert-PlainPath $Stage
if ((Get-Content -LiteralPath (Join-Path $Stage '.c2b-application-root-owner') -Raw) -cne $Token) { throw 'root_owner' }
if (Test-Path -LiteralPath $EvidenceFile) { throw 'inspection_already_recorded' }
$Original = Get-Content -LiteralPath (Join-Path $Stage 'build.json') -Raw | ConvertFrom-Json
$Preflight = Get-Content -LiteralPath (Join-Path $Stage 'preflight.json') -Raw | ConvertFrom-Json
$buildCommands = @($Original.commands | Where-Object { $_.argv -contains 'build' -and $_.argv -contains 'buildx' })
if ($Original.token -cne $Token -or $buildCommands.Count -ne 1 -or $buildCommands[0].exitCode -ne 0 -or -not $buildCommands[0].closed) { throw 'original_build_not_proven' }
if ($Original.commands[-1].stderr -notmatch 'map has no entry for key "Cmd"') { throw 'unexpected_original_failure' }
$id = (Get-Content -LiteralPath (Join-Path $Stage 'image-id.txt') -Raw).Trim()
if ($id -notmatch '^sha256:[a-f0-9]{64}$' -or $id -ceq $Preflight.base.id) { throw 'original_image_identity' }
$Report = [ordered]@{ token = $Token; complete = $false; deploymentReady = $false; commands = @();
    dockerSha256 = $Original.dockerSha256; tag = $Original.tag; originalBuildRetained = $true;
    originalBuildSha256 = (Get-FileHash -LiteralPath (Join-Path $Stage 'build.json') -Algorithm SHA256).Hash.ToLowerInvariant();
    recovery = 'read-only original-image inspection after optional Config.Cmd projection failure' }
try {
    $engine = Invoke-FixedDocker @('info', '--format', '{{.ID}}')
    if ($engine -cne $Preflight.engine.id) { throw 'engine_changed' }
    $projection = '{"id":{{json .Id}},"tags":{{json .RepoTags}},"os":{{json .Os}},"architecture":{{json .Architecture}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"cmd":{{json (index .Config "Cmd")}},"labels":{{json .Config.Labels}},"layers":{{json .RootFS.Layers}},"volumes":{{json (index .Config "Volumes")}}}'
    $Report.image = (Invoke-FixedDocker @('image', 'inspect', $id, '--format', $projection)) | ConvertFrom-Json
    $tagId = Invoke-FixedDocker @('image', 'inspect', $Original.tag, '--format', '{{.Id}}')
    if ($Report.image.id -cne $id -or $tagId -cne $id -or $Report.image.user -cne '1000:1000' -or $Report.image.os -cne 'linux' -or $Report.image.architecture -cne 'amd64' -or $Report.image.labels.'taki.c2b.application' -cne $Token) { throw 'result_image_mismatch' }
    if ($Report.image.labels.'taki.c2b.role' -cne 'application-source-cache-prerequisite' -or ($Report.image.entrypoint -join '|') -cne '/app/api/.venv/bin/python|-I|-B|-S|/opt/taki-c2b-application/artifact-check.py' -or $Report.image.cmd -or ($Report.image.volumes -and @($Report.image.volumes.PSObject.Properties).Count -gt 0)) { throw 'result_image_configuration' }
    if ($Report.image.layers.Count -le $Original.baseLayers.Count) { throw 'base_layer_lineage' }
    for ($index = 0; $index -lt $Original.baseLayers.Count; $index++) {
        if ($Original.baseLayers[$index] -cne $Report.image.layers[$index]) { throw 'base_layer_lineage' }
    }
    $Report.environmentCheck = Invoke-FixedDocker @('image', 'inspect', $id, '--format', '{{range .Config.Env}}{{if eq . "TIKTOKEN_CACHE_DIR=/opt/taki-c2b-application/tokenizer"}}cache-ok {{end}}{{if eq . "PYTHON_DOTENV_DISABLED=true"}}dotenv-ok {{end}}{{end}}')
    if ((($Report.environmentCheck -split '\s+' | Sort-Object) -join '|') -cne 'cache-ok|dotenv-ok') { throw 'result_image_environment' }
    $baseAfter = Invoke-FixedDocker @('image', 'inspect', 'taki-hindsight-api:local', '--format', '{{.Id}}')
    if ($baseAfter -cne $Preflight.base.id) { throw 'base_changed' }
    $Report.complete = $true
} catch { $Report.failure = $_.Exception.Message; throw }
finally {
    Save-Report
    $archive = Join-Path (Split-Path $PSScriptRoot) 'c2b-application-root-build-inspection-01a180b6.json'
    if (-not (Test-Path -LiteralPath $archive)) { [IO.File]::Copy($EvidenceFile, $archive, $false) }
    [pscustomobject]$Report | Select-Object complete,failure,tag,image | ConvertTo-Json -Depth 4
}
