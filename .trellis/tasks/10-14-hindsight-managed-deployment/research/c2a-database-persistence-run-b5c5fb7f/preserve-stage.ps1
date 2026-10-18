param(
  [Parameter(Mandatory=$true)][string]$Token,
  [Parameter(Mandatory=$true)][string]$Archive,
  [switch]$RequireAlreadyArchived
)
$ErrorActionPreference = 'Stop'
$stage = [IO.Path]::GetFullPath("G:/TakiAgent-c2a-database/persistence-$Token")
$allowedRoot = [IO.Path]::GetFullPath('G:/TakiAgent-c2a-database')
$researchRoot = [IO.Path]::GetFullPath('H:/TakiAgent/.trellis/tasks/10-14-hindsight-managed-deployment/research')
$archiveRoot = [IO.Path]::GetFullPath($Archive)
if ($Token -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'INVALID_TOKEN' }
if ([IO.Path]::GetDirectoryName($stage) -ne $allowedRoot) { throw 'STAGE_OUTSIDE_ALLOWED_ROOT' }
if ([IO.Path]::GetDirectoryName($archiveRoot) -ne $researchRoot) { throw 'ARCHIVE_OUTSIDE_RESEARCH' }
if (!(Test-Path -LiteralPath $archiveRoot -PathType Container)) { throw 'ARCHIVE_ABSENT' }
function Assert-Tree([string]$Root) {
  $cursor = Get-Item -LiteralPath $Root -Force
  while ($null -ne $cursor) {
    if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "REPARSE_ANCESTOR:$($cursor.FullName)" }
    $cursor = $cursor.Parent
  }
  $items = @(Get-ChildItem -LiteralPath $Root -Force -Recurse)
  foreach ($item in $items) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "REPARSE_CHILD:$($item.FullName)" }
    if (!$item.FullName.StartsWith($Root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'CHILD_OUTSIDE_ROOT' }
  }
  return $items
}
$resolved = (Resolve-Path -LiteralPath $stage).ProviderPath
if ($resolved -ne $stage) { throw 'STAGE_RESOLUTION_MISMATCH' }
if ([IO.File]::ReadAllText((Join-Path $stage '.c2a-docker-owner')) -cne $Token) { throw 'OWNER_MISMATCH' }
$items = @(Assert-Tree $stage)
$null = @(Assert-Tree $archiveRoot)
$files = @($items | Where-Object { !$_.PSIsContainer })
foreach ($directory in @($items | Where-Object { $_.PSIsContainer })) {
  $relative = $directory.FullName.Substring($stage.Length + 1)
  $destination = Join-Path $archiveRoot $relative
  if (!(Test-Path -LiteralPath $destination -PathType Container)) {
    if ($RequireAlreadyArchived) { throw "UNARCHIVED_DIRECTORY:$relative" }
    $null = New-Item -ItemType Directory -Path $destination -Force
  }
}
$rows = @()
foreach ($file in $files) {
  $relative = $file.FullName.Substring($stage.Length + 1)
  $destination = Join-Path $archiveRoot $relative
  $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if (!(Test-Path -LiteralPath $destination -PathType Leaf)) {
    if ($RequireAlreadyArchived) { throw "UNARCHIVED_FILE:$relative" }
    $parent = [IO.Path]::GetDirectoryName($destination)
    if (!(Test-Path -LiteralPath $parent)) { $null = New-Item -ItemType Directory -Path $parent -Force }
    Copy-Item -LiteralPath $file.FullName -Destination $destination
  }
  $archiveHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $archiveHash -or (Get-Item -LiteralPath $destination).Length -ne $file.Length) { throw "ARCHIVE_MISMATCH:$relative" }
  $rows += [ordered]@{ path=$relative.Replace('\','/'); bytes=$file.Length; sha256=$sourceHash }
}
$current = @(Assert-Tree $stage | Where-Object { !$_.PSIsContainer })
if ($current.Count -ne $files.Count) { throw 'STAGE_CHANGED_DURING_ARCHIVE' }
foreach ($row in $rows) {
  $source = Join-Path $stage $row.path
  if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $row.sha256) { throw "STAGE_CHANGED:$($row.path)" }
}
$manifestName = if ($RequireAlreadyArchived) { 'leftover-stage-archive-verification.json' } else { 'stage-archive-manifest.json' }
$manifestPath = Join-Path $archiveRoot $manifestName
if (Test-Path -LiteralPath $manifestPath) { throw 'MANIFEST_ALREADY_EXISTS' }
$manifest = [ordered]@{ token=$Token; stage=$stage; archive=$archiveRoot; verifiedAt=[DateTime]::UtcNow.ToString('o'); files=$rows; allHashesMatch=$true; requireAlreadyArchived=[bool]$RequireAlreadyArchived }
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
# Delete only the validated exact stage, after complete archive read-back.
if ((Resolve-Path -LiteralPath $stage).ProviderPath -ne $stage -or [IO.Path]::GetDirectoryName($stage) -ne $allowedRoot) { throw 'FINAL_PATH_CHECK_FAILED' }
if ([IO.File]::ReadAllText((Join-Path $stage '.c2a-docker-owner')) -cne $Token) { throw 'FINAL_OWNER_CHECK_FAILED' }
Remove-Item -LiteralPath $stage -Recurse -Force
if (Test-Path -LiteralPath $stage) { throw 'STAGE_REMOVAL_FAILED' }
$totalBytes = [long]0
foreach ($row in $rows) { $totalBytes += [long]$row.bytes }
$cleanup = [ordered]@{ token=$Token; stage=$stage; archive=$archiveRoot; removed=$true; filesVerified=$rows.Count; bytesVerified=$totalBytes; manifestSha256=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant(); verifiedAt=[DateTime]::UtcNow.ToString('o') }
$cleanupName = if ($RequireAlreadyArchived) { 'leftover-stage-cleanup.json' } else { 'stage-cleanup.json' }
[IO.File]::WriteAllText((Join-Path $archiveRoot $cleanupName), ($cleanup | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
$cleanup | ConvertTo-Json -Depth 5
