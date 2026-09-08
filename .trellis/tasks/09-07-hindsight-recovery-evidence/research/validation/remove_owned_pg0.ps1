param([Parameter(Mandatory=$true)][string]$OwnershipFile)

$ErrorActionPreference = 'Stop'
$g1RuntimeRoot = [IO.Path]::GetFullPath('H:/TakiAgent/.trellis/.runtime/g1-validation')
$g1RecordPath = [IO.Path]::GetFullPath($OwnershipFile)
$g1FixtureRoot = [IO.Path]::GetDirectoryName($g1RecordPath)
$g1FixtureName = [IO.Path]::GetFileName($g1FixtureRoot)
if (-not $g1FixtureRoot.StartsWith($g1RuntimeRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
    $g1FixtureName -notmatch '^taki-hindsight-g1-[0-9a-f]{12}$' -or
    [IO.Path]::GetFileName($g1RecordPath) -ne 'ownership.json') {
    throw 'Unexpected fixture ownership path'
}
$g1Fixture = Get-Content -LiteralPath $g1RecordPath -Raw | ConvertFrom-Json
$g1ExpectedRegistry = [IO.Path]::GetFullPath((Join-Path $env:USERPROFILE ('.pg0/instances/' + $g1FixtureName)))
$g1DataPath = [IO.Path]::Combine($g1FixtureRoot, 'data')
if ($g1Fixture.name -ne $g1FixtureName -or [IO.Path]::GetFullPath($g1Fixture.root) -ne $g1FixtureRoot -or
    [IO.Path]::GetFullPath($g1Fixture.registry) -ne $g1ExpectedRegistry -or $g1Fixture.stopped -ne $true) {
    throw 'Owned fixture identity or stop status mismatch'
}
$g1Info = & 'H:/hindsight/.venv/Lib/site-packages/pg0/bin/pg0.exe' info --name $g1FixtureName --output json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $g1Info.running -ne $false -or [IO.Path]::GetFullPath($g1Info.data_dir) -ne $g1DataPath) {
    throw 'Refusing cleanup without a stopped instance at the exact owned data path'
}
foreach ($g1OwnedPath in @($g1DataPath, $g1ExpectedRegistry)) {
    if (Test-Path -LiteralPath $g1OwnedPath) {
        if ((Get-Item -LiteralPath $g1OwnedPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Unexpected fixture junction'
        }
        Remove-Item -LiteralPath $g1OwnedPath -Recurse -Force
    }
}
[pscustomobject]@{
    Fixture=$g1FixtureName
    Stopped=$true
    DataRemoved=(-not (Test-Path -LiteralPath $g1DataPath))
    RegistryRemoved=(-not (Test-Path -LiteralPath $g1ExpectedRegistry))
    Logs=$g1FixtureRoot
} | ConvertTo-Json
