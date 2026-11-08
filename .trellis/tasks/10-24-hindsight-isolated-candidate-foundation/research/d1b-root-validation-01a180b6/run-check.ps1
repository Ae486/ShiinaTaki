param([ValidateSet('lint','shared','core','desktop','tests','regressions','migration','shared-tests')][string]$Check, [int]$Attempt = 1)
$ErrorActionPreference = 'Stop'
$taskEnvironment = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../d1b-validation-01a180b6/environment.json') -Raw | ConvertFrom-Json
$env:TEMP = $taskEnvironment.staging
$env:TMP = $taskEnvironment.staging
Set-Location -LiteralPath 'H:/TakiAgent'
$arguments = switch ($Check) {
    'lint' { @('exec','eslint',
        'packages/shared/src/hindsight-candidate-domain-schema*.ts','packages/shared/src/memory-operation-schema.ts',
        'packages/core/src/memory/hindsight-candidates/hindsight-candidate-domain*.ts','packages/core/src/memory/hindsight-candidates/hindsight-candidate-service.ts',
        'packages/core/src/memory/operations/memory-operation-contract.ts','packages/core/src/memory/operations/memory-operation-kinds.ts',
        'packages/core/src/memory/operations/memory-operation-kind-candidate*.ts','packages/core/src/memory/operations/memory-operation-service.ts',
        'packages/core/src/db/migrations/060-*.ts','packages/core/src/db/migrations/index-list*.ts',
        'packages/core/src/db/migrations/041-canonical-memory-maintenance.test.ts','packages/core/src/db/migrations/059-hindsight-template-execution.test.ts',
        'packages/core/src/db/migrations/lineage-reopen-matrix.test.ts','apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts',
        'packages/core/src/memory/hindsight-candidates/hindsight-candidate-fixtures.ts','packages/core/src/memory/hindsight-candidates/hindsight-candidate-admission.test.ts',
        'packages/core/src/testing/hindsight-runtime-composition-fixtures.ts','packages/core/src/testing/hindsight-template-backup-joint-fixture.ts',
        'packages/core/src/testing/hindsight-template-backup-consumer-fixture.ts','packages/core/src/memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts') }
    'shared' { @('--filter','@taki/shared','typecheck') }
    'core' { @('--filter','@taki/core','typecheck') }
    'desktop' { @('--filter','@taki/desktop','typecheck') }
    'shared-tests' { @('--filter','@taki/shared','test','src/memory-operation-schema.test.ts','--maxWorkers=2') }
    'migration' { @('--filter','@taki/core','test','src/db/migrations/060-hindsight-candidates.test.ts','--maxWorkers=2') }
    'regressions' { @('--filter','@taki/core','test','src/memory/hindsight-candidates/hindsight-candidate-admission.test.ts',
        'src/memory/hindsight-candidates/hindsight-candidate-verifier.test.ts','src/db/migrations/060-hindsight-candidates.test.ts',
        'src/db/migrations/041-canonical-memory-maintenance.test.ts','src/db/migrations/lineage-reopen-matrix.test.ts','--maxWorkers=2') }
    'tests' { @('--filter','@taki/core','test','src/memory/operations','src/memory/hindsight-candidates',
        'src/db/migrations/060-hindsight-candidates.test.ts','src/db/migrations/index-list.test.ts',
        'src/db/migrations/041-canonical-memory-maintenance.test.ts','src/db/migrations/059-hindsight-template-execution.test.ts',
        'src/db/migrations/lineage-reopen-matrix.test.ts','--maxWorkers=2') }
}
$stem = "$Check-a$Attempt"
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot "$stem.result.json")) { throw 'check_result_exists' }
$start = [DateTime]::UtcNow.ToString('o')
$result = & pnpm @arguments 2>&1
$exitCode = $LASTEXITCODE
$encoding = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "$stem.log"), ($result -join "`n") + "`n", $encoding)
$record = @{ argv = @('pnpm') + $arguments; startedAt = $start; completedAt = [DateTime]::UtcNow.ToString('o'); exitCode = $exitCode; temporaryDirectory = $taskEnvironment.staging }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "$stem.result.json"), ($record | ConvertTo-Json -Depth 4), $encoding)
$result
exit $exitCode
