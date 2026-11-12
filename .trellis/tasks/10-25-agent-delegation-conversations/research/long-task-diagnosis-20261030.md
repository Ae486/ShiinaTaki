# Long-task failure diagnosis and calibration repair

## Scope and retained evidence

The original real-model failure is retained unchanged at
`target/agent-delegation-20261030-validation/real-long-audit/goals-long-audit-checkin-yMUxwG/`.
This investigation made no model calls and did not change that database, fixture, runtime configuration or task pointer.
The parent subsequently authorized the narrowly verified calibration repair described below. Other dirty work is preserved.

Reproduce the historical projection without executing task work:

```powershell
node target/followup-review-20261030/long-task-diagnosis/replay.mjs
```

The probe opens the original SQLite database read-only; repository write/transaction methods and model generation
throw if called. It adds exports for existing pure private-context helpers through in-memory TypeScript transpilation,
without changing their implementations. Historical liveness is bypassed solely to price immutable snapshots. The first
Run uses its original input watermark 1; the resumption uses watermark 2. Output is counts/codes and synthetic IDs in
`projection-evidence.json`; no credentials, headers or raw provider exceptions are retained.

The projection's source files matched the original case's `sourceAfter` hashes during diagnosis:

| File, relative to `packages/core/src/` | SHA-256 |
| --- | --- |
| `agents/private-task-context.ts` | `5d7eb514572fbaec225fc507aa4b0dbbb4a93ca2c373f680e0777c756108f8ee` |
| `agents/context-reduction.ts` | `3aeaa69ce9a92d29306431dfdf25e6180cc24231c6bc43bb7799ae35eebba502` |
| `agents/worker-sdk-segment.ts` | `cfbd51a7aa76bd450d9e12e152b2b7e08bb093e5995adf7939ca861aa99eff86` |
| `main.ts` | `56d667c58375b238cbbc8f18cd17d18db930a5db3ac97ff246e9a8f18e5320c4` |

## What actually completed

The fixture (`e2e/src/agent-delegation-goals-real.e2e.test.ts`, long-audit scenario) declared context 24,000, history
ratio 0.2, `compactKeepMessages=4`, check-in N=8/K=0, and 24 independent evidence files of about 8.9 KB each.

- Child `7f054816-545b-4500-98fe-1d6db4ab5e94`, work `13fac049-4a1e-4f42-b3a6-bdd9cbd36e9e`.
- First Run `8feef5cb-163a-45ad-a7b6-a7d32a035356`, Attempt `62e3b23e-3544-455b-bb10-3904dfa3b135`.
- Completed task step 0 read the manifest; step 1 read evidence files 1-6 in parallel. All those model/tool Effects
  settled. There were only **two completed task steps**, no check-ins and no summary-intent records.
- One governed Utility summary succeeded. Revision 1 covers through sequence 3: the original task and manifest,
  not the six evidence results. Text size is 5,294 characters / 1,324 estimated tokens; its wrapper costs 1,376.
- The first Run failed with `subagent_execution_failed` and retained partial tool-call text. A later parent correction
  asked for three files at a time. Resumed Run `0da53781-1c5a-4043-8a30-0ba715d890aa` failed before a model request;
  the correction remained unconsumed.
- Source-unchanged, cleanup and required request capture checks passed; the case deadline did not expire.

This is not evidence of an eighth-step checkpoint failure. Execution never reached that boundary.

## Actual budget and protected-round refusal

The nominal 4,800 history budget was not the live budget after parent completion:

```text
slot_window_state: slot=main, effective_window=24000, factor=2
updated_at=2026-10-30T11:13:23.162Z
effectiveWindow() = floor(24000 / 2) = 12000
history budget = floor(12000 * 0.2) = 2400
```

The stored real-token window did not shrink through overflow handling. The estimator correction factor halved the
usable estimator-unit budget. The configured 24,000 is a synthetic operator declaration, not an experimentally proven
provider maximum: this case's provider accepted parent requests with reported input usage 25,276 and 27,530. These
observations do not establish the provider's actual maximum context size.

| Historical snapshot | Projected tokens | Budget 2,400 | Budget 4,800 |
| --- | ---: | --- | --- |
| First Run after summary commit | 4,385 | `SUBAGENT_CONTEXT_ROUND_UNFIT` | fits |
| Resumption with complete pending correction | 4,662 | `SUBAGENT_CONTEXT_ROUND_UNFIT` | fits |

The newest protected complete round alone costs **3,009**: 23 tokens for the assistant calls and 2,986 for six reduced
results. Each result's projection is 1,768 characters, including a bounded body, source and exact-history pointer.
The raw round costs 14,787 estimated tokens. Even deleting the entire summary could not fit that protected floor in
2,400. Before summary the full selected projection cost 4,391; afterwards it cost 4,385, a net saving of six tokens.

The private compactor retains recent **complete rounds by tokens**; the separate `compactKeepMessages=4` setting does
not control this path. Explicit refusal for an unfit protected round is the current `private-worker-context.md`
contract, with full raw evidence retained and pageable. This is not a missing-pagination finding.

The original inner exception was not retained in the final child error. `ROUND_UNFIT` is reproduced with the real
projection against the historical snapshot. The following live boundary is supported by code and timing, but remains
an inference rather than a captured original stack:

| UTC | Event |
| --- | --- |
| 11:13:20.227 | First child model request |
| 11:13:21.763 | Second child task-model request |
| 11:13:22.980 | Utility summary request starts |
| 11:13:23.162 | Main completion writes factor 2 |
| 11:13:29.763 | Summary revision 1 commits |
| 11:13:29.810 | Child fails |

Summary preparation likely started with the earlier budget; re-preparation after Utility completion encountered the
smaller shared calibrated budget. The resumed snapshot independently reproduces the same refusal before dispatch.

## Genuine calibration producer defect

Before repair, `agents/agent-attempt.ts` retained the latest prepared tools but passed **initial outgoing messages**
and **`result.usage`** to `fireUsageReport`. Installed `ai@7.0.148` implements its `usage` getter at
`src/generate-text/stream-text.ts:3375` as `return this.totalUsage`. `turn-usage-report.ts` estimated a single envelope;
`main.ts:546` passed that estimate and aggregate input usage directly to `windowCalibrator.onUsage`.

Original parent Run `09cb0146-9a66-4be9-a35a-3233eef3e9a7` has captured requests 1, 2, 3 and 5:

```text
reported inputs = 17784 + 18325 + 25276 + 27530 = 88915
initial instruction estimate = 4649
initial outgoing message estimate = 159
last prepared tool definitions estimate = 10289
supplied single-request denominator = 15097
observed / estimated = 88915 / 15097 = 5.889580711399616
EMA from factor 1 = 0.3 * ratio + 0.7 = 2.4668742134198847
clamp to [0.5, 2] = 2
```

This precisely explains the persisted factor and violates the documented same-request calibration contract. It is
not merely ordinary valid calibration to a small fixture window. Later request estimates in the probe are wire-shape
approximations; they do not prove an exact corrected historical factor or that repairing calibration alone would
make the original long-task acceptance pass.

The probe additionally passes the historical mismatched pair through the unchanged `fireUsageReport` implementation
and actual `createWindowCalibrator`, using an isolated in-memory repo. It reproduces observed input 88,915, estimated
input 15,097, persisted real window 24,000/factor 2, and effective estimator window 12,000. This is executable producer
evidence, not only a hand-computed EMA. It does not update historical SQLite state.

## Repair and tradeoffs

The repair stays within `agent-attempt.ts`, existing `turn-usage-report.ts`, focused tests, the agents directory index
and `compaction-harness.md`. The SDK's model-call-start event supplies actual instructions, messages and prepared
definitions; its matching completed-step event supplies `event.usage`, including cache details. The bounded capture
retains the last completed request, and the existing after-commit owner emits one paired sample for a successful,
non-cancelled primary turn. Failed or unsupported request capture never falls back to a different request's envelope.

Keeping one sample per committed turn preserves the current EMA update cadence and avoids weighting longer tool
loops more heavily merely because they have more steps. Earlier requests remain fully counted by canonical
Run/Effect usage; calibration is not cumulative billing/accounting. Child work does not retain this primary-only
sample. Existing cancellation, final persistence, retry and pressure-publication owners remain unchanged.

Alternatives considered: aggregate numerator plus summed per-request denominators could form a weighted calibration
ratio, but a summed request is not one meaningful complete-envelope pressure measurement. Emitting every step would
change EMA cadence and require a different deferred sample policy. The last completed actual request is sufficient
for the existing single-sample contract and requires neither alternative.

Historical persisted correction factors are not reset: resetting could erase valid past observations or conflate
estimator calibration with real overflow shrink. Future correctly paired samples adjust the factor normally.

## Fixture treatment and remaining acceptance

Do not weaken compaction, N=8/K=0, exact same-work continuation, source coverage or final-result assertions. Keep the
original failure as evidence and the protected-round refusal as a separately meaningful boundary test.

For positive long-task acceptance, use evidence with real sequential dependencies: an opaque next filename disclosed
only by its predecessor, with bounded per-file evidence. This naturally requires multiple reasoning steps without
prescribing tool names, argument lists or an artificial exact call sequence. Price summary/current-input/recent-round
costs against the worst supported factor 2, or select a realistic declared context/history policy and record the
resulting effective budget. Independent files legitimately allow parallel reads, so file count alone cannot require
eight model steps. Exact-history paging should remain available for details retired from the projection.

The calibration repair does not yet establish real-model long-task compaction/check-in success, native UI behavior,
human acceptance, native Hindsight or T4/main convergence. The coordinator owns the revised fixture and paid rerun.

## Verification

- Historical read-only projection replay: pass; explicit 2,400 refusal and nominal 4,800 fit reproduced.
- Focused calibration/request measurement: 3 files / 32 tests passed. The actual-SDK regression changes second-request
  messages, inbox instructions and dynamically disclosed tools; synthetic observed input equals that same request's
  independent estimate, and the real persisted calibrator remains factor 1. Cache usage and single callback are checked.
- Existing cancel-before-output, string-reason cancellation and partial-output cancellation usage tests passed.
- Scoped ESLint: pass. Core typecheck: pass. Scoped `git diff --check`: pass.
- Additional shared-loop regressions: 4 files / 48 tests passed (`chat-agent-overflow`,
  `chat-agent-step-recording-failure`, `tool-disclosure`, `chat-agent-worker-context`). Total focused tests: **80**.

Commands, from the worktree root except the two explicitly scoped Vitest invocations:

```powershell
pnpm --filter @taki/core exec vitest run src/agents/chat-agent-usage.test.ts src/agents/request-measurement.test.ts src/agents/window-calibrator.test.ts --maxWorkers=2
pnpm --filter @taki/core exec vitest run src/agents/chat-agent-overflow.test.ts src/agents/chat-agent-step-recording-failure.test.ts src/agents/tool-disclosure.test.ts src/agents/chat-agent-worker-context.test.ts --maxWorkers=2
pnpm --filter @taki/core typecheck
pnpm exec eslint packages/core/src/agents/agent-attempt.ts packages/core/src/agents/turn-usage-report.ts packages/core/src/agents/chat-agent-usage.test.ts
git diff --check -- packages/core/src/agents/agent-attempt.ts packages/core/src/agents/turn-usage-report.ts packages/core/src/agents/chat-agent-usage.test.ts packages/core/src/agents/index.md .trellis/spec/backend/compaction-harness.md
```

These used the installed locked `ai@7.0.148` and Vitest 4.1.10. The coordinator owns whole-worktree validation and the
real-model rerun; no broader acceptance is implied by these scoped checks. Production/test/spec files were frozen
after verification to permit that independent campaign.

## Subsequent full-chain failure and boundary repairs

The revised real case `real-long-confirmed/goals-long-audit-checkin-Rkarum` failed after 29 task steps, nine summaries
and three Core check-ins. Two separate boundaries were identified; later Utility cancellation was scenario teardown.

1. Historical `preparePrivateTaskContext` replay for Run `7e6ee08d` proves a selection defect. At budget9,271 the
   summary wrapper/head costs3,361; two retained projected rounds cost6,465, giving9,826. The newest round alone costs
   3,695, so head plus newest fits at7,056. Raw-token retention tried to reach40% of the whole budget and unnecessarily
   protected the older round. It returned no retiring prefix and raised `SUBAGENT_CONTEXT_ROUND_UNFIT`.
2. Run `ac346c28` had a fitting6,495-token projection and complete Effects, but its last round included invalid
   `read_file` arguments with a matching SDK-local error result. The installed SDK directly emits `tool-error` and
   performs zero executions for this case. Core rejected every `call.invalid` at retained-byte pressure. The local
   SDK probe confirms the predicate defect; the original inner exception was not retained, so the historical timing
   attribution remains inference rather than a captured stack.

The repaired selector measures initial snapshot, summary wrapper, pending input and rounds through the actual
request projection. Forty percent of the remaining space is a soft recent-tail target. The newest complete round
stays protected; an optional older round is not retained if that would make the request unfit. Retiring prefixes
still require complete/historical outcomes and summaries still pass the existing source, owner, revision and quality
checks. The full projection is remeasured after each replacement; raw history is never deleted or declared consumed
because it appears only in a summary.

The frontier repair allows an invalid local call only with its matching completed local `tool-error`. Success
mis-pairs, provider execution, missing results, preliminary results and approvals remain unsafe. Runtime unknown
Effect guards remain unchanged. This predicate also controls check-ins, so invalid arguments exactly at N now pause
normally instead of requesting an unauthorized next step.

Tradeoff: no new summary-output budget or clipping policy was introduced. A replacement summary can grow relative
to its predecessor while shrinking relative to the retired evidence. Core remeasures and retires further eligible
history where possible. If the final protected envelope genuinely cannot fit, it still fails explicitly; these
repairs do not promise that every arbitrary summary or current round fits every declared window.

Verification:

- Selection unit suite plus actual SDK/SQLite worker context and explicit-GC retention: 27PASS. The unit suite alone
  uses stubbed repository boundaries and is not claimed as CAS/integration evidence. Its failing-before scenarios
  reproduce both existing-summary pressure and an oversized optional old round.
- Frontier matrix, actual SDK invalid/corrected execution, N=1 check-in and existing worker/check-in regressions:
  33PASS; invalid execution count0, corrected read count1, one Run/Attempt and durable error before continuation.
- Core typecheck and scoped ESLint PASS. Independent advisor and post-repair review found no additional blocker.
- Current-source historical replay retires exact older rows124-125 and reaches summary generation at budget9,271,
  where the baseline refused. It intentionally does not synthesize a fake summary or mutate original SQLite.
- Saved baseline: `target/followup-review-20261030/long-task-diagnosis/confirmed-projection-evidence.json`.
  Corrected probe: `repaired-replay.mjs` and `repaired-projection-evidence.json` in that directory. The old
  `confirmed-replay.mjs` uses the baseline internal selector signature and must not be run unchanged against repaired
  source to claim a baseline result. Paid full-chain retest is tracked in the acceptance/checkpoint documents.

## Latest retained campaign observation

The previously running `real-long-global-deadline/goals-long-audit-checkin-yWfwCu` campaign has finished and failed
at the boundary assertion: `Audit ended without a new check-in or validated final` (622.48 seconds). Its retained
`result.json` reports unchanged source and no scenario deadline expiry. The same work accumulated 27 task steps,
12 summaries and three check-ins; its fourth worker Run ended failed with partial output, without a validated final.
Two earlier `SUBAGENT_SUMMARY_FAILED` receipts are present, but these observations alone do not identify the terminal
cause. This is an outstanding long-task acceptance failure, separate from the foreground eight-result prompt audit.
No further long-task rerun or production change was made while examining this result.
