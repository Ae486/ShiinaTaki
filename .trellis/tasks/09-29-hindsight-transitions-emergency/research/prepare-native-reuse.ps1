# Copy a proven stopped historical PostgreSQL corpus without starting or changing it.
# The resulting directory is a private baseline; later tests must derive working copies.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = 'H:/TakiAgent'
$sourceRoot = Join-Path $repoRoot '.trellis/.runtime/d78-real-data/654131f0175a'
$sourceData = [IO.Path]::GetFullPath((Join-Path $sourceRoot 'native/data'))
$pg0 = 'H:/hindsight/.venv/Lib/site-packages/pg0/bin/pg0.exe'
$sourceName = 'taki-d78-real-654131f0175a'
$targetBase = [IO.Path]::GetFullPath((Join-Path $repoRoot '.trellis/.runtime/stage4-conversion-native'))
$runId = [Guid]::NewGuid().ToString('N')
$targetRoot = [IO.Path]::GetFullPath((Join-Path $targetBase $runId))
$targetData = Join-Path $targetRoot 'data'

function Read-StoppedSource {
    $raw = & $pg0 info --name $sourceName --output json
    if ($LASTEXITCODE -ne 0) { throw 'Cannot verify the historical native instance.' }
    $info = $raw | ConvertFrom-Json
    if ($info.name -ne $sourceName -or $info.running -ne $false -or
        [IO.Path]::GetFullPath($info.data_dir) -ne $sourceData) {
        throw 'Historical native ownership or stopped state does not match.'
    }
    if (Test-Path -LiteralPath (Join-Path $sourceData 'postmaster.pid')) {
        throw 'Historical PostgreSQL still has a postmaster PID file; no copy is admitted.'
    }
    return $info
}

function Read-FileManifest([string]$directory) {
    $base = [IO.Path]::GetFullPath($directory).TrimEnd('\', '/')
    return @(Get-ChildItem -LiteralPath $base -Recurse -Force -File | Sort-Object FullName | ForEach-Object {
        [pscustomobject]@{
            path = [IO.Path]::GetRelativePath($base, $_.FullName).Replace('\', '/')
            bytes = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
}

$source = Read-StoppedSource
if ((Get-Content -LiteralPath (Join-Path $sourceData 'PG_VERSION') -Raw).Trim() -ne '18' -or
    $source.version -ne '18.1.0') { throw 'The historical native PostgreSQL version is not the validated version.' }
$links = @(Get-ChildItem -LiteralPath $sourceData -Recurse -Force -Attributes ReparsePoint)
if ($links.Count -ne 0) { throw 'Historical native data has reparse points; physical copy needs separate review.' }
if (-not $targetRoot.StartsWith($targetBase.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar,
    [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $targetRoot)) {
    throw 'The unique private target is invalid or already exists.'
}
$before = Read-FileManifest $sourceData
$totalBytes = ($before | Measure-Object bytes -Sum).Sum
if ((Get-PSDrive H).Free -lt (2 * $totalBytes + 1GB)) { throw 'Insufficient disk space for a retained baseline and working copy.' }

[void](New-Item -ItemType Directory -Path $targetRoot -Force)
# Preserve the existing private ACL before copying any data. All descendants inherit it.
Set-Acl -LiteralPath $targetRoot -AclObject (Get-Acl -LiteralPath $sourceRoot)
[void](New-Item -ItemType Directory -Path $targetData)
foreach ($item in Get-ChildItem -LiteralPath $sourceData -Force) {
    Copy-Item -LiteralPath $item.FullName -Destination $targetData -Recurse
}
$null = Read-StoppedSource
$after = Read-FileManifest $sourceData
$copied = Read-FileManifest $targetData
$beforeJson = ConvertTo-Json -InputObject $before -Depth 4 -Compress
if ($beforeJson -ne (ConvertTo-Json -InputObject $after -Depth 4 -Compress)) {
    throw 'Historical source changed during copying. Retain the incomplete target for investigation.'
}
if ($beforeJson -ne (ConvertTo-Json -InputObject $copied -Depth 4 -Compress)) {
    throw 'Native baseline copy failed exact file/hash equality. Retain it for investigation.'
}
$summary = [ordered]@{
    id = $runId
    sourceInstance = $sourceName
    sourceData = $sourceData
    targetRoot = $targetRoot
    targetData = $targetData
    pgVersion = $source.version
    files = $before.Count
    bytes = $totalBytes
    sourceRemainedStopped = $true
    sourceHashesUnchanged = $true
    copiedHashesEqual = $true
    sourceStarted = $false
    copyStarted = $false
    conversionExecuted = $false
    llmCalls = 0
    checkedAt = [DateTime]::UtcNow.ToString('o')
}
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $targetRoot 'files.json'), (ConvertTo-Json -InputObject $before -Depth 4), $utf8)
[IO.File]::WriteAllText((Join-Path $targetRoot 'inventory.json'), (ConvertTo-Json -InputObject $summary -Depth 4), $utf8)
ConvertTo-Json -InputObject $summary -Depth 4
