# Host test prerequisite and fixture baseline repair

Scope: the existing Host test failures from
`G:/taki-hindsight-first-use-20261104-checks/hindsight-host-tests.log`. The parent ran
`pnpm --filter @taki/hindsight-host test --maxWorkers=2`: 42 failures in three files,
45 passing tests in six files, and one skipped test. This note does not claim a rerun.

## Causes and focused changes

The 15 `deployment-core` and 17 `deployment-owner` failures are `ENOENT` while the
fixture hashes its explicitly selected fake key adapter, before deployment behavior is
exercised. Both callers already support `TAKI_C2A_KEY_ADAPTER`; their historical fallback
`G:/Temp/taki-c2a-source-20261014-impl/fake-key-adapter.exe` is absent. Rebuild the existing
fixed `apps/hindsight-host/test-fixtures/fake-key-adapter.rs` into fresh G: staging and use
that override. Do not substitute the real credential adapter or skip the process tests.
The fixed source emits the generated fixture's 32-byte `0xa5` key and never reads Credential
Manager. These source-process tests use the existing Native pipe owner and substituted
engine; they need neither a Host payload build nor Docker.

All ten `host-session` tests fail while reading a missing `capability.challenge`.
`custody-test-fixtures.ts` refreshes dispatch/deadline timestamps but previously retained
`registryRevision: 2` from the historical Shared JSON example. Current `host-gate.ts`
requires `GOVERNANCE_REGISTRY_REVISION` (3), so classification refuses before sending the
challenge. The example contains no `expiresAt`; the refreshed 60-second deadline is not
the observed cause. The session's send callback appends the frame synchronously, excluding
an awaited frame-delivery race for this failure.

Only `custody-test-fixtures.ts` and `deployment-test-fixtures.ts` change. They import the
existing Shared registry revision and use it before recomputing the projection digest.
The deployment helper's former literal 3 already matches current behavior; using the same
source prevents the identical stale-baseline cause on the next registry revision.
Historical protocol JSON, Host gates, test assertions and production behavior are unchanged.

## Parent execution commands

From `H:/TakiAgent`, use a fresh G: staging directory and the existing local Rust/MSVC
toolchain. This is the documented tiny-adapter command from
`10-14-hindsight-managed-deployment/research/docker-acceptance/README.md`, applied without
its unrelated Docker/installed-Host steps:

```powershell
$hostFixtureRoot = 'G:/taki-hindsight-first-use-20261104-checks/host-fixture-prereqs'
New-Item -ItemType Directory -Path $hostFixtureRoot -ErrorAction Stop
rustc H:/TakiAgent/apps/hindsight-host/test-fixtures/fake-key-adapter.rs --edition=2021 -C debuginfo=0 -o "$hostFixtureRoot/fake-key-adapter.exe"
if ($LASTEXITCODE -ne 0) { throw 'Fake adapter build failed' }
$env:TAKI_C2A_KEY_ADAPTER = "$hostFixtureRoot/fake-key-adapter.exe"
$env:TAKI_C2A_TEMP = $hostFixtureRoot
$env:TAKI_C2A_NATIVE_ROOT = 'H:/hindsight'
$env:TAKI_C2A_PYTHON = 'H:/hindsight/.venv/Scripts/python.exe'
pnpm --filter @taki/hindsight-host test --maxWorkers=2
```

Keep compiler staging on G: and retain the output digest with the parent check logs.
Verification was limited to source/log inspection: no build, test, service, credential
access, Native edit or Git action. The parent must rerun the tests with the built prerequisite;
later process failures, if any, remain unverified. Existing installed-platform and managed
deployment acceptance boundaries remain separate.

## Follow-up: missing/corrupt registry process refusal

The parent rerun with the staged adapter passed 85 tests, skipped one and timed out on
the two missing/corrupt ownership cases at the unchanged Vitest 5-second deadline
(`hindsight-host-recheck.log`). A one-worker rerun of only those cases reproduced both
timeouts (`host-ownership-recheck.log`); this is not evidence for ordinary machine load.

Both cases invalidate `deployment.json` before the helper's first request. The
`DeploymentRegistry` constructor rejects inside `serveDeploymentRequests`' owner factory,
before `DeploymentOwner.execute` and before any reply frame. The fixture's top-level catch
set `exitCode=1` and disconnected IPC but left the suspended resident iterator's inherited
stdin handle open. The parent therefore awaited stdout closure until its 10-second frame
read timer, after Vitest's 5-second deadline. Enlarging the test timeout would let the old
generic rejection assertion mistake that read deadline for the intended process refusal.

The authorized fixture-only correction destroys stdin before disconnecting IPC in
`test-fixtures/deployment-child.ts`. The two existing `deployment-owner.test.ts` cases now
require `fixture pipe closed`, await the child close, and require exit code 1; their zero
external-effect and preserved missing/corrupt-state assertions remain. No timeout or
production code changes. The parent owns the confirming rerun.

D94 follow-up: production `serveDeploymentRequests` also advances its async generator
manually and has no `finally` that closes it when the owner factory throws; installed
`main.ts` records only exit code 1 for this resident failure. This source path is reachable
for an invalid registry, but the installed Shell/pipe lifetime and actual process exit
need separate verification before claiming the fixture's timing symptom exists in release.
Record it with later managed-lifecycle work; it does not block the existing-instance
first-use delivery and was not repaired or accepted here.
