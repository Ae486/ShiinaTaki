# W6 extra-audit boundary and committed-receipt harness repair

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Reviewer: `/root/w5_postpatch_review`. Date: 2026-10-06.

## Current outcome and authorization

The parent reported that fourth actual history `baa914d916a34442a654f436f63b4298` committed receipt
`5da1b2448bcc7ccaf0a41d5cbfa50fc9ea5e6f77e3610082300c7ea9477eed31` for the original transition
`0faf660d-9d8c-4215-ae5f-954f9f574734`, then retained an unknown operation after a binding lease refusal.
Target epoch is `c4f53993-517e-4d97-96cd-7e916620ce29`; original capture and incident remain unchanged.
The previous publication-only rehearsal passed but did not exercise the complete bind/settlement/restart path.
This reviewer did not open actual corpus/runtime files; the parent owns those facts and subsequent actual runs.

Readonly source tracing found that the task driver performed two extra complete synchronous audits before
calling production bind. Their measured combined cost was about 184 seconds. Production bind independently
verifies publication and authority again before starting Local. Contiguous harness plus production work could
starve the existing heartbeat even when each individual section fits the unchanged five-minute lease.

The parent authorized harness/test changes first and required a fresh owned-copy whole-driver rehearsal before
same-receipt actual recovery. This batch changes no production TypeScript or Native source, lease duration,
admission TTL, evidence context scope, runtime verification, Local sweeper or production heartbeat behavior.

## Findings (fixed)

- `w6-owned-audit-boundary.mjs` captures one existing executor before each extra synchronous audit, checks it
  before and immediately after that work, yields through real timer/check phases, then checks the same identity.
  Already expired work refuses before yielding. A due 30-second heartbeat must have extended that lease before
  another long section continues. The helper never renews, claims or adopts an executor. Async callbacks refuse.
  Successful and failed audits both record elapsed time and completion state.
- `w6-owned-emergency-driver.mjs` separates extra publication, candidate and installation/retention audits from
  production bind and queue execution. Production bind, settlement and overall operation execution each have
  independent wall-clock records, including failed calls. All production readers and writers remain in place.
- Committed recovery accepts only an explicit `--recovery-transition-id <id> --recovery-evidence-path <path>`
  pair on the emergency phase. The evidence's real path must lie in this owned root's emergency-history directory.
  Verify the failed history's version/phase/completion, actual unknown operation producer/result, original receipt,
  target/candidate, full pre-start installation identity, exact-installation phase and zero dispatch counters.
  No latest-history discovery or uncommitted wrapper is substituted.
- Current committed state is checked using the existing complete producer-backed retention audit. The prior
  exact installation remains historical evidence; post-start retention changes are not compared blindly with
  pristine installed rows. Before and after binding, original receipt/evidence bytes and every related old unknown
  operation's complete SQL row hash remain unchanged. Restart repeats these checks before starting Local writers.
- Testing index and the emergency spec record these task-only boundaries. Previous manifests/reports remain
  intact; this batch has its own `w6-bind-harness-source-ownership.json`.

## Verification

All new execution used synthetic owned Core data with at most two Vitest workers. No real corpus, model service
or Native instance was opened by this reviewer.

```powershell
pnpm --filter @taki/core exec vitest run src/testing/memory-transition-emergency-process.test.ts src/testing/w6-owned-audit-boundary.test.ts --maxWorkers=2
pnpm --filter @taki/core exec vitest run src/testing/memory-transition-emergency-process.test.ts -t committed-recovery --maxWorkers=2
pnpm lint
pnpm -r typecheck
```

- Complete group: **2 files / 9 tests PASS, 58.98 seconds**. Fresh, sealed-recovery and committed-recovery each
  execute actual Node driver and distinct-process restart. Committed setup starts the real Local sweeper to
  produce one retention receipt, then loses bind completion. Recovery preserves that receipt and original unknown
  operation, audits the changed row, binds the same target and restarts with zero additional dispatch.
- Six heartbeat tests pass: actual existing callback delivery/renewal across cumulative work beyond the original
  lease; expired-before-yield refusal; foreign owner during yield; stopped heartbeat; renewal failure; async misuse
  with a failed timing record. Fixture clocks jump, but timer/check yields and production heartbeat code are real.
- Eight committed refusal subcases pass: missing evidence, foreign path, wrong receipt, wrong candidate, missing
  prior exact-installation phase, changed original operation result, mismatched preserved unknown row hash, and
  changed historical bytes at restart. Every refusal preserves the stopped Core file SHA and starts no new recovery.
- Final committed-only rerun after the last path/producer checks: **1 PASS / 2 intentionally filtered,
  37.61 seconds**. Final root lint and all five workspace typechecks PASS. Both MJS syntax checks, UTF-8/no-BOM
  and whitespace checks PASS.
- Initial setup failure was an invalid fixture policy ownership: Character-only intentions had been assigned to
  Global. The fixture now uses a legitimate Character record; no product guard was weakened. Typecheck found a
  callback inferred as never-returning and access to leaseUntil through the narrower lease token; tests now use
  explicit callback typing and the actual read attempt. Restart refusal originally sanitized an equality assertion
  to the generic code; boolean hash guards retain the fixed non-sensitive error code.
- The latest combined/context manifests' 15 non-test TypeScript entries still match their previously released
  hashes. Native HEAD remains `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. Native tests and W5 were not repeated.

## Parent supervisor compatibility and remaining gates

Readonly review of `w6-owned-emergency-committed-recovery.py` and `w6-owned-committed-rehearsal.py` confirms the
emergency 13-argument and restart 9-argument interfaces. The rehearsal copies the current Core, original sealed
Core/manifest, and exact fourth driver/supervisor evidence into a fresh owned root. Its explicit evidence path
passes the driver's ownership rule; it uses the existing bounded `paired.child` lifetime without starting Native.
The existing source inventory includes the new MJS helper. Parent-reported 11 and 5 Python tests and actual readonly
preflight are separate parent evidence, not reviewer reruns.

SOURCE RELEASE follows the new manifest. Source/test/JSON writes and reviewer tests stop while the parent runs
the fresh whole-driver bind/settlement plus independent restart rehearsal. Only then may the parent run the
reviewed same committed receipt recovery. Do not call a prior uncommitted wrapper or create another emergency.
Real committed recovery/restart and D91 remain required before consolidated W6 PASS; W7/W8 and manual acceptance
remain open. No commit, dependency change, task rebinding or archive was performed.
