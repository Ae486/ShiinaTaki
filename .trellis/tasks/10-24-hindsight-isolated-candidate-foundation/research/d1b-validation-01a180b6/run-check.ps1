param(
  [ValidateSet('lint','shared-types','core-types','shared-tests','core-tests')][string]$Check,
  [int]$Attempt = 1
)
$ErrorActionPreference = 'Stop'
$evidenceDir = $PSScriptRoot
$environment = Get-Content -LiteralPath (Join-Path $evidenceDir 'environment.json') -Raw | ConvertFrom-Json
$env:TEMP = $environment.staging
$env:TMP = $environment.staging
Set-Location -LiteralPath 'H:/TakiAgent'
$checkArguments = switch ($Check) {
  'lint' { @('exec','eslint','packages/core/src/memory/hindsight-candidates/hindsight-candidate-domain*.ts','packages/core/src/memory/hindsight-candidates/hindsight-candidate-service.ts','packages/shared/src/hindsight-candidate-domain-schema.ts','packages/shared/src/hindsight-candidate-domain-schema.test.ts') }
  'shared-types' { @('--filter','@taki/shared','typecheck') }
  'core-types' { @('--filter','@taki/core','typecheck') }
  'shared-tests' { @('--filter','@taki/shared','test','src/hindsight-candidate-domain-schema.test.ts','--maxWorkers=2') }
  'core-tests' { @('--filter','@taki/core','test','src/memory/hindsight-candidates/hindsight-candidate-domain.test.ts','--maxWorkers=2') }
}
$startedAt = [DateTime]::UtcNow.ToString('o')
$output = & pnpm @checkArguments 2>&1
$code = $LASTEXITCODE
$stem = $Check + '-a' + $Attempt
$encoding = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText((Join-Path $evidenceDir ($stem + '.log')), ($output -join "`n") + "`n", $encoding)
$result = @{ command = 'pnpm ' + ($checkArguments -join ' '); cwd='H:/TakiAgent'; startedAt=$startedAt;
  completedAt=[DateTime]::UtcNow.ToString('o'); exitCode=$code; temporaryDirectory=$environment.staging }
[System.IO.File]::WriteAllText((Join-Path $evidenceDir ($stem + '.result.json')), ($result | ConvertTo-Json), $encoding)
$output
$result | ConvertTo-Json -Compress
exit $code
