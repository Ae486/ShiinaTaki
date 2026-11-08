# P1-Y journey C supplement — 2026-11-07

## 1. Outcome

**Done — harness implementation and static checks. Runtime acceptance: UNKNOWN, pending the leader's journey.** Added independent `sync-during-home` and `pending-restart` steps after step 9. Existing step IDs, relative order and assertions are preserved. Neither new check has been executed against Core/Native/Home in this assignment. [source native-smoke.mjs:871] [source native-smoke.mjs:872] [run artifact G:/taki-codex-work/tmp-y/delta-audit.json]

No Core, Native, PG, Home, journey, model call or Vitest worker was started. Resource disposition: nothing to stop. No task create/start/finish/archive, Git mutation, product change, original-data access or edit to leader-owned/prompt/template/real-model files was performed.

Citation convention: bare `.mjs`/`.py` names below are under `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/`; `research/` is relative to the assigned task; `packages/` and `apps/` paths are relative to `H:/TakiAgent`. G: artifacts are this assignment's actual static-check artifacts, not journey results.

## 2. Changes

| File | Purpose |
| --- | --- |
| `first-use-runtime/native-smoke.mjs` | Adds the two steps and hashes the selected journey's helper bytes in `result.baseline.harness.files`. Restores original Bank settings after each new step. |
| `first-use-runtime/native-fault.mjs` | Extends the existing proxy with a Bank-specific application-state GET response hold, release, live/aborted response evidence and teardown release. Existing retain-POST 503 behavior is unchanged. |
| `first-use-runtime/home-browser.mjs` | Adds an optional ready/continue handshake so browser startup precedes the held Native request. Existing actions retain their one-message stdin behavior. |
| `first-use-runtime/home-check.py` | Adds one Home action, records `config.list` and `memory.replica.configure` reply timing, and accepts newline-delimited startup input for the handshake. |
| `first-use-runtime/pending-write-evidence.mjs` (new) | Reads the exact durable parent/child identities and runs the read-only Native observation helper. |
| `first-use-runtime/native-write-evidence.py` (new) | Uses one read-only, repeatable-read transaction against the journey's disposable PG to enumerate matching documents, base facts and the original Native operation receipt. |
| `research/journey-c-supplement-20261107.md` (new) | This requested report. |

The four pre-existing edited files were copied before their first edit to `G:/taki-codex-work/tmp-y/baseline/`. New files had no prior bytes. The complete seven-file unified delta is `G:/taki-codex-work/tmp-y/p1y.patch`; before/after SHA-256 values, additions/deletions and new-file markers are recorded in `delta-audit.json`. All edited files remain UTF-8 without BOM and use their existing LF convention. [run artifact G:/taki-codex-work/tmp-y/delta-audit.json] [run artifact G:/taki-codex-work/tmp-y/p1y.patch]

## 3. Evidence and checks run

### Static verification actually performed

Environment: `H:/TakiAgent`, branch `main`, Node `v24.18.0`, Python `3.12.7`; `TEMP=TMP=G:/taki-codex-work/tmp-y`, `PYTHONPYCACHEPREFIX=G:/taki-codex-work/tmp-y/pycache`. All commands below exited 0. [run artifact G:/taki-codex-work/tmp-y/syntax-checks.txt]

```powershell
node --check .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs
node --check .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-fault.mjs
node --check .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/home-browser.mjs
node --check .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/pending-write-evidence.mjs
python -m py_compile .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/home-check.py
python -m py_compile .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-write-evidence.py
node G:/taki-codex-work/tmp-y/check-harness-baseline.mjs
python G:/taki-codex-work/tmp-y/audit-delta.py
git apply --reverse --check G:/taki-codex-work/tmp-y/p1y.patch
```

- The delta audit checks all **43 pre-existing native-smoke helper functions** except the intentionally extended `journey`/`main`, all **10 pre-existing Home action bodies**, and the original step order. It also checks added-line whitespace, BOM and line endings. It is a preservation audit, not behavioral acceptance. [run artifact G:/taki-codex-work/tmp-y/delta-audit.json]
- Git's reverse **check only** accepts the exact patch against the delivered files; it did not apply/reverse any change. [run artifact G:/taki-codex-work/tmp-y/patch-check.txt]
- The baseline check evaluates only `harnessBaseline`, without importing/executing the journey. It resolves and hashes **10 helpers** for the ordinary journey and **15** with `--with-transitions`, including archived provider/launcher code, paired-restore Python, the W6 inventory helper, Native's fixture conftest and Core's capture logger. These hashes enter the actual run's baseline before services start. [source native-smoke.mjs:1098] [source native-smoke.mjs:1115] [run artifact G:/taki-codex-work/tmp-y/harness-baseline-check.json]
- API/shape checks used current Shared schemas, Home client source, Native receipt/table definitions and installed Python APIs. In particular, a scheduled run's identity is `run.lease.runId`; the Native identity proof is `memory_native_operation_receipts`, independent of transient task rows. [source packages/shared/src/memory-replica-schedule-schema.ts:35] [source packages/shared/src/pending-memory-schema.ts:71] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/native_operation_receipts.py:543] [source H:/hindsight/.venv/Lib/site-packages/asyncpg/connection.py:279] [source G:/Roaming/Python/Python312/site-packages/playwright/sync_api/_generated.py:20266]

### New check: `sync-during-home` — F3/A2

Failure modes covered: Core stops answering while sync runs; Settings remains loading; only a cached/rendered control appears without a fresh Core reply; a save fails, targets the wrong Bank or is lost on sync completion; the sync finishes/retries/times out before the interaction, producing a false concurrency claim. [source home-check.py:293] [source home-check.py:318] [source native-smoke.mjs:695]

| Exact assertion | Location |
| --- | --- |
| Begin on the Global Bank in idle manual mode; after browser readiness, submit one registered incremental sync. Require a held real HTTP 200 response, operation `running`, and a non-null scheduler run. | [source native-smoke.mjs:670] [source native-smoke.mjs:686] |
| Home reads the same operation and `run.lease.runId` as running before interacting. | [source home-check.py:310] |
| Open Settings and require a fresh, successful `config.list` reply in under 15,000 ms; return to Operations and save a changed increment interval. Require exactly one successful `memory.replica.configure` reply for that Bank in under 15,000 ms. | [source home-check.py:293] [source home-check.py:318] [source home-check.py:325] |
| Read back the changed interval through Core, require the same operation/run still running, and require the interaction to finish within Home's 45,000 ms result budget. | [source home-check.py:329] [source home-check.py:330] [source home-check.py:334] |
| Independently require the same running sync after Home returns, at least one unreleased live response and no aborted held response. The changed interval must already be in Core. | [source native-smoke.mjs:695] [source native-smoke.mjs:698] |
| Release the response; require that exact operation to complete and retain the saved interval, mode and full-reconciliation interval. Then restore and verify the original settings. | [source native-smoke.mjs:700] [source native-smoke.mjs:703] [source native-smoke.mjs:717] |

The proxy holds real response delivery, not fabricated success or Core execution. Native's request deadline is unchanged; an abort before release fails the test. Browser initialization happens before arming the hold. Home's 15-second RPC / 45-second result limits match the existing development policy. [source native-fault.mjs:23] [source native-fault.mjs:52] [source home-browser.mjs:73] [source packages/shared/src/timing-policy-schema.ts:59]

**Expected extra runtime:** approximately **5–20 seconds**, including a fresh browser and a small incremental sync; estimate only. After existing step 7, Native's request timeout is 15 seconds, so the live-held part must also fit that unchanged limit. Failure paths retain the existing operation/browser cleanup budgets. [source native-smoke.mjs:609] [source native-smoke.mjs:666] [inference]

**Still not proved:** responsiveness during CPU-heavy large-library application, every Home action, packaged Tauri behavior or owner UI judgment. Delaying a response mainly exercises the waiting portion of a real sync. The test does not validate responsiveness throughout every processing phase. [source native-fault.mjs:24] [inference]

Future leader-run evidence will be `steps[id="sync-during-home"].observed` plus the recorded Home artifact directory's `sync-during-home.json`, `rpc-timings.json` and screenshots. These runtime files were not generated here. [source home-check.py:335] [source home-browser.mjs:62]

### New check: `pending-restart` — F4

Failure modes covered: the fault never reaches Native; the retain silently succeeds or is lost; parent/child rows disappear or are replaced on shutdown/restart; write, Bank, generation or Native UUID identity changes; automatic settings do not survive; recovery needs an explicit replay; a failed/unknown child is mistaken for drained Pending; duplicate or mismatched Native effects; Core completion without the original Native receipt. [source native-smoke.mjs:743] [source native-smoke.mjs:774] [source native-smoke.mjs:789] [source native-smoke.mjs:806]

| Exact assertion | Location |
| --- | --- |
| Enable existing automatic recovery with a one-minute interval before retain. Require `retain.data.status="pending"`, one original parent and child, allowed Pending phases, the intended Bank, and a new rejected retain POST. | [source native-smoke.mjs:738] [source native-smoke.mjs:743] [source native-smoke.mjs:725] [source pending-write-evidence.mjs:19] [source pending-write-evidence.mjs:23] |
| Before restart, require zero Native documents/base facts/operation receipts for the original request. Stop Core cleanly while the fault remains enabled and recheck Pending plus immutable identities while it is stopped. | [source native-smoke.mjs:749] [source native-smoke.mjs:758] [source native-smoke.mjs:761] |
| Boot against the same owned data/credentials/ports. Require the same authority and an available runtime; the exact original parent/child sequence, request, intent hashes, Native UUID, lineage/generation and document identity must survive as Pending. Core status must still show positive Pending child and parent counts. | [source native-smoke.mjs:762] [source native-smoke.mjs:770] [source native-smoke.mjs:773] [source native-smoke.mjs:774] [source native-smoke.mjs:777] [source pending-write-evidence.mjs:26] |
| Automatic mode and the one-minute interval survive. Native remains unchanged while the provider is still faulted. | [source native-smoke.mjs:780] [source native-smoke.mjs:782] |
| Restore provider access and use read-only status/SQLite observation, without `submit`, `syncPendingBanks`, another chat or replay. Require zero failed/unknown/Pending children and parents, original parent/child completion, idle sync and a successful timestamp after restoration. Require the scheduler lease to have no manual-request attribution. | [source native-smoke.mjs:783] [source native-smoke.mjs:789] [source native-smoke.mjs:794] [source native-smoke.mjs:329] [source native-smoke.mjs:369] |
| Reuse the original Source/fact and returned-memory preservation assertion. Require identical original write/operation identities after completion. Native must contain exactly one matching document, one base fact with the same document/memory IDs as the replica, and one completed retain receipt for the original Native UUID, Bank, lineage and generation. | [source native-smoke.mjs:800] [source native-smoke.mjs:802] [source native-smoke.mjs:806] [source native-smoke.mjs:194] [source native-write-evidence.py:15] |

**Expected extra runtime:** approximately **60–150 seconds** for one controlled retain, orderly Core stop/reboot, three short PG observations and normal scheduled settlement; unmeasured. If restart overlaps a failed scheduled retry, normal backoff can add five minutes. Observation allows **600,000 ms after provider restoration** (five-minute second backoff plus the existing five-minute operation observation window). This changes only the new test's observation window; Core/Native deadlines and retry policy are unchanged. [source native-smoke.mjs:788] [source packages/shared/src/memory-replica-schedule-schema.ts:17] [inference]

**Still not proved:** a full Native outage, lost acknowledgements after remote acceptance, Native/PG restart, crash/power-loss durability, multiple restarts, append/mutation recovery, supersession, arbitrary future duplicate absence or real-model semantic quality. This is a graceful Core restart with retain POSTs returning 503; Native reads and other services remain online. It proves one original request's observed application/effects if the leader's run passes. [source native-fault.mjs:13] [source native-smoke.mjs:754] [source native-write-evidence.py:15]

Future leader-run evidence will be `steps[id="pending-restart"].observed` (before/stopped/after-restart/completed identities, Native observations, recovery timing and scheduler attribution) and `core-pending-restart.log`. No such runtime result is claimed here. [source native-smoke.mjs:744] [source native-smoke.mjs:762]

## 4. Trade-offs

- The two steps are inserted after existing step 9; **no existing step was reordered**. This preserves the original restart/reopen assertions before adding another Core lifetime. Both steps restore the original Bank settings. Cleanup errors are recorded separately so a Core stall's primary failure is not replaced by a settings-restoration timeout. [source native-smoke.mjs:709] [source native-smoke.mjs:817] [source native-smoke.mjs:871]
- One extra synthetic retain remains in the disposable database and can affect later ingestion batching, synchronization volume and backup contents. No data deletion hides that additional write. Existing assertions/order stay comparable; historical durations, identities and content inventories will not be byte-identical. [source native-smoke.mjs:741] [inference]
- Automatic mode is temporarily enabled at a supported one-minute interval to make automatic recovery observable in one journey. This tests durable recovery with automatic scheduling; it does not claim manual-only Banks self-recover. The longer observation window accounts for real scheduler backoff without modifying product behavior. [source native-smoke.mjs:738] [source native-smoke.mjs:788]
- Native effect observation is deliberately coupled to the existing disposable `taki_smoke` database and `public` schema. SQL/schema drift should fail visibly rather than return fake emptiness; maintaining that helper is the cost of directly checking Native duplicates. No dependency was installed. [source native-write-evidence.py:12] [source H:/hindsight/hindsight-api-slim/hindsight_api/extensions/builtin/tenant.py:56]
- Helper hashing uses an explicit inventory, including indirect archived/Python helpers. Future harness imports/launchers must update it. Third-party dependencies and the full production source tree are outside this new helper attestation; the original changed-source inventories remain as before. [source native-smoke.mjs:1098]

## 5. Open items / UNKNOWN

- **UNKNOWN:** both new runtime outcomes, actual additional duration, actual Home rendering and resource teardown in the leader's run. Missing evidence: the next connected journey's result, Home artifacts and process disposition.
- **Leader action:** run the controlled journey once with the usual options; no new flag is needed for either step. If it fails, inspect the failed step's first error, `restoreError` if present, Home RPC timings, held-response aborts or original Pending/Native identities. A failure is not evidence of emptiness or a license to alter product code within P1-Y. [source native-smoke.mjs:871] [source native-smoke.mjs:719] [source native-smoke.mjs:825]
- No typecheck, full-suite test, Vitest run, real model call, UI acceptance or original-data activation was performed. The assignment's required syntax checks and source preservation/hash audits are complete. [run artifact G:/taki-codex-work/tmp-y/syntax-checks.txt] [run artifact G:/taki-codex-work/tmp-y/delta-audit.json]

## 6. Anything outside scope noticed

No product defect was established by these static checks. Broader acceptance gaps from P1-X remain outside this assignment. In particular, these two added checks do not close whole-provider outage, interrupted activation, full transition-queue/recovery, large-library or owner-judgment coverage. The original production `sourceBaseline` still inventories changed source rather than attesting the entire build/dependency closure; only the requested harness-byte gap is addressed here. [source native-smoke.mjs:1090] [source research/acceptance-after-journey12-20261107.md:27]
