# Reproducible Host deployment process fixtures

## Result and cause

The prior `test-host-final-20261112.json` recorded 55 passing tests, 32 failures and one existing opt-in skip.
All 32 failures occurred before deployment behavior while hashing the absent historical
`G:/Temp/taki-c2a-source-20261014-impl/fake-key-adapter.exe`.

The two process suites now prepare their own fixed fake adapter from the retained
`apps/hindsight-host/test-fixtures/fake-key-adapter.rs` when no explicit `TAKI_C2A_KEY_ADAPTER` is supplied.
An explicit override remains authoritative and fails normally if unavailable. No test assertion, supported behavior,
timeout, gate or skip was weakened.

## Changes

- `apps/hindsight-host/test-fixtures/deployment-key-adapter-fixture.ts`: resolve the explicitly installed
  `stable-x86_64-pc-windows-msvc` compiler without auto-install, compile the retained standard-library-only source
  offline, retain source/compiler/binary provenance, and probe the actual executable's fixed 36-byte frame.
- `apps/hindsight-host/src/deployment-test-fixtures.ts`: prepare that test-only adapter in a new owned root when absent.
- `apps/hindsight-host/src/deployment-core.test.ts` and `deployment-owner.test.ts`: remove the manually prepared old-temp
  fallback and verify resolved temporary parent/prefix before cleanup of each tracked fresh root.
- `apps/hindsight-host/src/index.md`: update only the fixture navigation entry.
- Research contains this report, the proof-generation script, preserved build proof, commands and three new test receipts.

Compilation occurs once per isolated test worker. Later fixtures receive an exclusive copy of the actual compiled
bytes, then independently execute and validate the real adapter again. Each fixture retains `test-key-adapter/build-receipt.json`
until its normal owned cleanup. This avoids charging three compilations to the existing five-second ask/resume test.
The first preparatory run passed 31/32 but that three-fixture case exceeded five seconds; no timeout was enlarged.

Only newly created paths are written. The historical temp and existing orphan fixture directories were preserved.
No production application, original profile, Credential Manager, stopped backup, branch or Git index was modified.

## Toolchain and retained evidence

- Node 24.18.0; pnpm 10.22.0; existing Rust MSVC 1.97.0 (`2d8144b78`, 2026-07-07).
- Existing Native Python 3.11.5 at `H:/hindsight/.venv/Scripts/python.exe`.
- Native pipe owner and fixed fake child already run with `-I -B`; their retained sources are read-only.
- `TEMP`/`TMP` are `G:\Temp`. The retained proof root is `G:/Temp/taki-host-adapter-proof-4LsJaq`.
- Retained Rust source SHA-256: `50f17ba43882725d5e23884ffafd121f03f4e4deec4977a9cea2c25ef76b14be`.
- Actual sample adapter SHA-256: `e063cb5c7e42c3378d86d4d994cd4da14bb7d635172955b1d6f4cb44ec740a89` (155,648 bytes).
- Actual compiler SHA-256: `6d1c5543ed3a45cfbc1c1332d42d6550d883c14d3c2e323427e631c331cebeeb`.

`host-adapter-build-proof-20261112.json` records exact compiler arguments, versions, real successful protocol output
shape, owned paths and individual before/after hashes for 20 Native Python source files; all source hashes agree.
No actual key payload or generated Catalog values are written to this evidence.

## Verification

All Vitest commands used `--maxWorkers=1` from `G:/TakiAgent-integration/apps/hindsight-host`.

| Receipt | Result |
| --- | --- |
| `test-host-deployment-preparation-first-20261112.json` | 31/32 pass; repeated compiler setup exposed the existing five-second test deadline |
| `test-host-deployment-preparation-second-20261112.json` | **32/32 pass**, 58.64 seconds |
| `test-host-preparation-final-20261112.json` | **87 pass, 0 fail, 1 existing skip**, 10 files, 64.06 seconds |

The exact complete-suite command and environment are in `test-host-preparation-command-20261112.json`:

```powershell
pnpm exec vitest run --maxWorkers=1 --reporter=json --outputFile=../../.trellis/tasks/11-11-main-t4-baseline-integration/research/test-host-preparation-final-20261112.json
```

`pnpm --filter @taki/hindsight-host typecheck`, scoped ESLint for all four changed TS files, tracked source/index
`git diff --check`, and no-BOM checks passed. After complete-suite cleanup there were zero remaining
`c2a_pipe_owner.py` / `managed_bootstrap/fake_child.py` processes.

## Limits

These tests execute the real Node helper and fixed Python owner/child against a substituted engine, with synthetic
fake-only Catalog values. They do not use Docker, a Native/PG service or a provider. The existing installed-Shell test
remains gated by `TAKI_C2A_INSTALLED_FIXTURE=1`; this task did not enable that separate protected-installation acceptance.
Peak RSS was not independently instrumented. No dependency installation, network, staging, commit or push occurred.
