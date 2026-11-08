# Research: Initial Hindsight activation and cold admission readiness

- Query: Why did the first Hindsight retain after a completed activation lose its memory tools at the 7.5-second admission boundary, although the preceding official-model attempt admitted retain? What is the smallest product correction?
- Scope: internal; current Core contracts and tests, task acceptance, two stopped isolated real-run databases and logs. No production edits, service execution, model calls, original-data mutation, or Git operations.
- Date: 2026-11-06

## Findings

### Conclusion and scope decision

The immediate cause is proven: the second run reached the admission budget before its Character Bank's first D77 application binding existed. Capability negotiation had already succeeded. The earlier run also exceeded the same admission budget, but had published that first Bank binding soon enough to admit a partial memory Run.

The cold-admission behavior is deliberate and tested. The product gap is the boundary above it: initial activation reports completed/activated and installed-runtime availability before the necessary application preparation finishes. The owner requires an ordinary usable first memory chat after setup/activation. A harness-only Sync-now or sleep would demonstrate an operator recovery path, but would not fix that requirement.

A focused initial-activation correction is within the currently authorized usability/recovery work. It should reuse the existing Bank synchronization and durable receipts during the existing post-COMMIT binding phase. It is a coordinated service/composition/settlement/recovery change, not a one-line await. Keep general cold admission and its 7.5-second budget unchanged.

### Direct comparison of the two real runs

All times below are milliseconds after the corresponding `hindsight-global-retain.startedAt` in that run's `result.json`. Command timings are read with SQLite `mode=ro` from `hindsight_application_command_jobs`; `intent_bytes.artifact.artifact_kind` confirms the Bank and Source targets.

| Observation | X0GDzD: memory tools admitted | pF99hq: no memory tools |
| --- | ---: | ---: |
| Global Bank binding prepared | 1,522 | 2,340 |
| Global Bank binding receipt completed | 2,937 | 4,478 |
| Character Bank binding prepared | 5,568 | 9,571 |
| Character Bank binding receipt completed | 6,726 | 11,290 |
| Next Character Source binding prepared | 7,216 | 12,292 |
| Character deferred event | 7,514 | 7,544 |
| Chat acknowledgement | 7,555 | 7,570 |
| Memory-unavailable event | absent | 7,560 |

Receipt completion is not itself local publication. The next Source binding can start only after the Bank receipt has been pulled and published: `hindsight-application-sync-runner.ts:138-154` re-pulls after a binding, and `hindsight-application-binding-runner.ts:47-58` always binds the Bank before Sources. Thus the successful run had published its Character Bank before +7,216 ms. In pF99hq the Bank command was not even prepared until +9,571 ms, after the unavailable Run had been captured.

pF99hq also has `hindsight_application_runtime_admission.admitted_at=2026-11-06T11:28:36.538Z`, +6,060 ms after the turn began. There was negotiated evidence before the timeout; a missing-capability hypothesis does not explain this run.

The scheduler was actually running. In pF99hq the saved schedules show:

- Global: first attempt 11:28:30.388Z; success 11:28:36.207Z.
- Character: first attempt 11:28:36.232Z; no success; final error `HINDSIGHT_CANCELLED`.
- The harness began the turn at 11:28:30.478Z and stopped Core after its decoder exception. The Character Bank receipt and one Source receipt completed before shutdown; a Memory binding command remained prepared. This is not evidence that eventual recovery permanently failed.

The previous successful retain was not a fully synchronized cold capture: `G:/taki-real-memory-X0GDzD/core-private.log:16` reports the same Character deferred event. Its saved retain result nevertheless has `ok:true`, provider `hindsight`, and a durable Pending identity. pF99hq's deferred/unavailable events are at `core-private.log:16-17`.

The parent independently measured Core as mostly idle in the pF99hq CPU profile and measured the first Hindsight turn's observed model interval after admission. This review did not repeat that profiling. The saved Bank timings independently disprove a claim that the earlier run avoided the admission cutoff entirely. They do not isolate the exact Native/transport source of the slower HTTP sequence.

### Existing code patterns and ownership

1. `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:119-123` derives the foreground admission allowance as `min(requestTimeoutMs, floor(chatAckMs / 2))`, with the effective default 15,000 ms ACK budget.
2. `hindsight-capture-sync.ts:29-58` races synchronization against that allowance. Work remains owned by the Bank service after the race. A partial capture requires both routed application Bank bindings plus the provider capability snapshot. It does not grant tools based only on a configured B3 Bank or a completed B4 promotion.
3. `hindsight-capture-sync.ts:61-72` sequences Global then Character. `hindsight-runtime-bank-service.ts:58-69,73-96` serializes on-demand work against earlier Bank work and keeps exact lease/cancellation ownership.
4. `hindsight-memory-runtime.ts:59-71` permanently captures either the unavailable Run or the canonical tools for that Run. Later background completion cannot rewrite a queued Run's tool set.
5. `hindsight-runtime-state.ts:49-53` saves authenticated admission evidence before snapshot/binding completion. `hindsight-memory-provider-context.ts:63-81` reads the evidence under exact epoch/configuration identity and does not equate it with Bank readiness.
6. `hindsight-application-sync-runner.ts:116-135` negotiates admission, publishes a complete first snapshot/incremental pull, then performs binding passes. `hindsight-application-binding-runner.ts:42-58,149-179` uses deterministic Bank/Source/Memory commands and durable intent-derived receipts; it does not call a model for Bank binding. Reuse this producer; do not add another data validator or fabricate a readiness record.
7. `packages/core/src/db/hindsight-application-replica-query.ts:40-51` already provides a guarded current Bank-binding read, with checkpoint, namespace, exact head and projection validation. The existing synchronization producer consumes this evidence; activation settlement does not need a second recurring readiness reader.

The scheduler is not omitted from activation. `hindsight-memory-subsystem.ts:96` starts it; `hindsight-replica-scheduler.ts:75-85` arms initial catch-up asynchronously. New automatic schedules are immediately due (`hindsight-replica-schedule-state.ts:18-24`). Therefore adding another fire-and-forget startup job would duplicate existing work without making completion meaningful.

### Why completed activation and runtime.available were insufficient

- `hindsight-activation/hindsight-activation-service.ts:148-162`: after promotion and Local retirement, synchronous `bind()` is followed immediately by progress `completed`.
- `runtime-composition.ts:175-184`: binding/recovery publish and start the subsystem; they do not await application Bank synchronization.
- `hindsight-runtime-binding.ts:74-81,100-104,163-170`: published matching runtime is available. This is installation/lifetime evidence, not first D77 Bank preparation.
- `operations/memory-authority-status.ts:49-79`: the composite availability projection retains that installed-runtime meaning and current connection/evidence error handling.
- The live harness at `research/first-use-runtime/real-model-memory.mjs:341-346` waits only for the activation operation and checks `authority.mode === "hindsight" && runtime.available`, then immediately requests retain. No intermediate Sync-now occurs.

No current acceptance text makes manual Sync-now a prerequisite between activation and ordinary first use. The PRD's first-usable acceptance (`prd.md:17-29`) requires guided activation and ordinary correct Global/Character retain/recall. Manual/automatic sync is a separate observable capability. The current design also says to reuse existing producers, not introduce a second scheduler.

### Deliberate tradeoff versus defect

The exact low-level failure is deliberately covered by `hindsight-capture-sync.test.ts:70-112`: Global is bound, capabilities are negotiated, Character snapshot/Bank binding is held, 7,499 ms remains pending, 7,500 ms returns no memory tools, and a later capture succeeds after background completion. Keep this behavior for general cold/unavailable captures.

The integration acceptance test is weaker than its title: `hindsight-activation-journey.test.ts:40-70` says activation serves a Hindsight Run, but its final assertion checks only `snapshot.providerId === "hindsight"`. An unavailable Run has that same provider. It does not prove tools or recall are usable after activation.

## Recommended correction

### Minimal responsibility change

Add one narrow asynchronous activation-preparation seam on the existing runtime composition, for example `prepareHindsightActivation(epochId, bankIds, signal)`. This is a proposed signature, not a new general framework.

- The activation service calls it after the existing committed binding is installed, while its producer remains in phase `binding`.
- The target is the finite Bank set named by the activation receipt/producer: Global plus the existing Character Bank(s). Do not make future Character provisioning or every later Run a prerequisite for the original activation.
- Resolve the current matching subsystem, reuse its `state.service.synchronize`, preserve existing Bank queue/lease/receipt behavior, and check the same current authority/connection after awaited work.
- Reusing complete synchronization is the smallest safe first implementation. It prepares necessary Bank/policy/source projections once at activation and avoids a second special-purpose "Bank-only" pull algorithm. This can make activation longer; that cost must be reported.
- Pass `mode: "foreground"` explicitly for this new preparation port, with the existing per-HTTP request allowance and activation/runtime cancellation signal. The port had no previous whole-operation deadline; do not convert the single-request knob into one. Preserve every other existing bounded operation and any explicitly supplied absolute deadline. Do not spend the 7.5-second chat ACK allowance on this lifecycle operation.
- Only publish phase `completed` after preparation succeeds. Do not return an unavailable captured Run as successful preparation; invoking ordinary `captureRun` and checking provider identity repeats the existing mistake.

Use the existing durable producer phase as the preparation completion evidence. Do not add a separate `activationReady()` port or revalidate Bank data on each settlement/status read. `createActivationProgress()` writes phases through its checkpoint callback (`hindsight-activation-chain.ts:44-55`); the operation owner persists the producer through the existing running-row CAS (`memory-operation-service.ts:168-177,191-204`). Shared already defines both `binding` and `completed`. The existing Bank producer validates actual preparation; the operation checkpoint records whether that work finished.

The one new async preparation port is sufficient. New activation and recovery write `completed` only after its await succeeds. Receipt plus a non-completed phase means post-COMMIT preparation is incomplete. Crash after preparation but before the completed checkpoint conservatively requires same-receipt recovery; this safely reuses the existing application commands. A completed checkpoint remains historical operation evidence, not a certificate that all future runtime data is ready.

### Required settlement and recovery companions

A lone await is unsafe because current receipt-based settlement would erase its failure:

- `memory-operation-kind-hindsight.ts:128-139` calls `committedSettlement` for any exception once the matching promotion receipt exists.
- `memory-operation-hindsight-evidence.ts:72-79` calls that completed whenever the runtime is installed.
- `memory-operation-kind-hindsight.ts:153-159` uses the same shortcut at boot.
- `memory-operation-kind-hindsight.ts:142-151` repairs synchronously; `runtime-selector.ts:88-97` returns healthy immediately for an already installed matching subsystem.
- `hindsight-activation-status.ts:39-49` currently offers recovery only when installed runtime availability is false, although `admitRecover` itself permits exact committed-epoch recovery.

Recommended small integration: keep generic installed-runtime availability truthful, but make activation completion require the producer's completed checkpoint as well as the existing matching receipt/runtime checks. `committedSettlement` must stop synthesizing phase completed merely from installed availability. A known committed preparation failure must remain a failed operation in phase `binding`, with its original classified error and exact epoch/transaction identity. A failed operation may use the existing nullable result instead of falsely claiming the installed runtime was removed. If the implementation actually withdraws a failed draft, only then use the existing `binding_unavailable` result.

Make activation recover asynchronous and always perform the required preparation after same-epoch receipt/custody verification, even if synchronous binding recovery says healthy. On successful preparation, explicitly persist the recovered producer's completed phase before returning completed settlement. Offer recover for a terminal operation with the same committed epoch/transaction and incomplete preparation, as well as an absent runtime. This is derived from the existing operation and receipt, without re-reading every Bank. Boot observation remains read-only: a matching receipt plus a non-completed producer checkpoint is incomplete binding preparation, including a crash between COMMIT and the binding checkpoint. Do not start hidden network work or manufacture completed from runtime installation. Recovery reuses the same epoch, transaction and command receipts and never re-promotes or reopens Local.

A separate readiness predicate is unnecessary because the operation checkpoint already records completed preparation. Older completed operations retain their historical pre-change meaning; do not rewrite them or claim they retroactively prove this new preparation step. Generic restart/cold capture remains governed by its existing evidence checks.

Cancellation must be wired explicitly. The initial activation implementation set a stopping flag then joined its in-flight attempts. A newly awaited foreground Bank operation must observe that stop; otherwise shutdown could join forever before the subsystem cancellation is reached. Reuse the Bank service's caller/runtime signal handling and normal drain. No additional scheduler or retry ledger is needed.

### Follow-up: preserve the REST timeout's meaning

A narrow read of the first implementation found `runtime-composition.ts:199-208` calling preparation synchronization without a mode. `knob-registry.ts:191` documents `TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS=10000` as the deadline for **one REST request**. The default path in `hindsight-runtime-bank-service.ts:73-88` instead creates `hindsightApplicationDeadline` before waiting for prior Bank work; its remaining allowance covers that queue and every subsequent HTTP request. Therefore this new call accidentally imposes a ten-second whole-Bank deadline. A 7.501-second held-binding test cannot distinguish that from the intended owned lifetime.

Use the existing foreground mode for this new activation and same-epoch binding preparation. It waits for complete progress or actual caller/runtime cancellation and keeps the per-request cap. The exact Bank/run/owner/fence lease is renewed only while live (`hindsight-runtime-bank-service.ts:99-110`); an explicitly supplied absolute deadline still takes precedence (`hindsight-application-sync-runner.ts:77-96`). The new activation service already aborts preparation and joins its in-flight work (`hindsight-activation-service.ts:121,150-152` in the reviewed implementation). Thus this needs neither another timeout parameter nor a numeric increase.

The cost is explicit: activation can remain in binding beyond ten seconds while healthy individual requests progress, until completion, a real HTTP failure, or service/caller cancellation. No prior total deadline exists for the new port, and the fact that it is an operator lifecycle action does not establish one. Scheduled synchronization, writes, Pending recovery and other explicitly bounded actions retain their old deadlines. Update the preparation comment and application-runtime/activation contracts narrowly to describe this new use of the existing lifetime primitive; do not relabel every explicit action as foreground.

Required discriminator: with the default 10,000-ms request knob unchanged, queue wait plus several individually successful requests totaling more than ten seconds must complete preparation. Also retain actual single-request timeout classification and demonstrate stop aborts and joins an in-progress preparation. This is a source-backed design recommendation, not a newly executed test result.

### Alternatives and costs

| Option | Benefit | Cost / rejection |
| --- | --- | --- |
| Await existing Bank preparation in activation and recovery | Directly fixes first chat after successful activation; reuses authority, leases, receipt recovery and phase binding | Small coordinated change across service/composition/operation settlement/status; activation can take longer |
| Truthful first-readiness UI/status plus explicit operator Sync-now | Makes the current asynchronous contract understandable and provides a supported recovery route | Needs actual Core readiness producer, protocol/UI/error states and first-use instruction changes; still does not meet an automatic ready-after-success expectation by itself |
| Harness-only Sync-now or sleep | Can exercise recovery and help diagnose the prior failed attempt | Not a product fix; would mask the first-use failure if counted as acceptance |
| Parallelize Global/Character or optimize Native request latency | May move this sample under 7.5 seconds | Does not establish readiness and remains timing-sensitive; needs separate evidence/ownership review |
| Increase admission timeout, expose tools before first bindings, or add a ready cache | Superficially admits the sample | Changes agreed deadlines or weakens evidence; reject |

This should remain one focused initial-activation increment. Do not broaden synchronous boot, every later capture, general re-entry, Native model verification or template lifecycle merely to solve this reproduced first-activation gap. If chosen implementation requires generic async construction across those paths or a new protocol/state machine, stop and reassess that expansion against this narrower seam.

## Validation required before claiming the fix

1. **Red integration case:** hold the Character first snapshot/binding beyond 7.5 seconds through the real composition. The activation operation must stay in `binding`; after releasing the hold, it completes and the immediately following ordinary capture exposes retain/recall and retrieves the actual imported Character fact. Merely checking providerId is insufficient.
2. **Known committed failure:** fail preparation after promotion. Keep one Hindsight receipt/epoch, Local retired, original error visible, operation not completed, recover action available. Retry through registered recovery and demonstrate ordinary tools/recall afterward.
3. **Lost ACK/restart/stop:** interrupt while preparing; shutdown settles; boot does not turn receipt plus binding/non-completed checkpoint into success merely because runtime installation succeeded. Cover the crash after preparation but before the completed checkpoint, and the crash after that checkpoint but before terminal settlement. Recovery reuses the exact application command/receipt and does not duplicate promotion or writes.
4. **Isolation:** manual-only scheduling still permits activation's explicit required preparation without changing future schedule preferences; an unrelated later Character does not retroactively invalidate completed initial activation.
5. **Integrity and compatibility:** current capability/Bank/authority corruption continues to refuse; preserve the existing cold-unavailable and warm-partial capture tests, stop tests, and original current-proof boundaries.
6. **Real gate:** rerun the first ordinary retain after completed activation without a harness pre-warm or arbitrary sleep. Keep the pF99hq failure, separate model/request timing, and the exact new-write/receipt assertions. Later Pending Sync-now remains a separately recorded operator recovery capability.

Likely ownership: activation service and its fixtures/tests; a narrow runtime-composition helper (prefer a cohesive separate file if required); activation operation handler/evidence and status action; the existing composition/activation journey tests and relevant spec updates. No new dependency or schema migration is justified. Estimated scope is several coordinated Core files plus tests/specs, not a blanket runtime refactor. Final source scope depends on how the implementation preserves cancellation and truthful post-COMMIT settlement.

## Native model-call attribution follow-up

- Query: Were pF99hq's 21 `native_other` model requests repeated connection/validation probes, or reachable setup/activation work?
- Scope: current Native source in `H:/hindsight/hindsight-api-slim/hindsight_api`, the task launcher, and content-free timing/count extraction from existing stopped-run logs. No Native edit, service/model run, or broader audit.
- Date: 2026-11-06

### Findings

The 21 requests are accounted for by one startup connection verification and four five-request Reflect runs. The observer label was misleading: its 17 `verification_or_unknown` requests include 16 Reflect tool-calling iterations. The launcher wraps `LLMProvider.call` only (`real-model-native-launcher.py:60-81`); Reflect's `call_with_tools` bypasses that wrapper and inherits the default label. Four final synthesis calls correctly carry `scope=reflect`.

| Observed Native work | Requests | Reported tokens | Reflect wall time |
| --- | ---: | ---: | ---: |
| Startup connection verification | 1 | 59 | not a Reflect; 3.157 s verification span |
| Setup, Global template generation | 5 | 16,160 | 14.000 s |
| Setup, Character template generation | 5 | 16,313 | 13.600 s |
| Activation, Character maintenance | 5 | 17,490 | 18.800 s |
| Activation, Global maintenance | 5 | 15,999 | 12.890 s |
| Consolidation, separately labelled | 1 | 4,119 | not attributed by this review |
| Total | 22 | 70,140 | individual work spans are not a total runtime metric |

The four Reflect runs account for 65,962 reported tokens. Each Native completion trace lists `agent_1` through `agent_4` and `final`, with five iterations. Matching request-start timestamps to each logged Reflect start/completion interval finds four default-labelled requests plus one `reflect` request per interval. The only default-labelled request outside these intervals falls within the single startup verification interval. There are no unassigned `native_other` requests and no observed `/health/llm` calls. These are saved-run observations, not a new live experiment.

The actual source chain is:

- `engine/providers/openai_compatible_llm.py:684-703`: connection verification calls the concrete provider directly with a small `Say 'ok'` request. `engine/llm_wrapper.py:908-915` delegates verification to that method, so the task's `LLMProvider.call` wrapper cannot label it. `engine/memory_engine.py:4017-4066,4104-4115` performs startup verification for distinct configured provider/model pairs, under its initialization guard (`3950-3957`). Client construction alone is not another model verification.
- `api/http.py:6571-6626`: template import with `dry_run=true` returns after schema/semantic validation, before applying resources. Actual application delegates through `2721-2728` to `_apply_bank_template_resources`; `2782-2819` creates or updates each declared Mental Model, then submits its asynchronous refresh. The observed setup Global and Character Reflect runs follow the corresponding applied template imports and precede the current-state transfer requests.
- `engine/memory_engine.py:2903-2945` routes asynchronous refresh into `refresh_mental_model`; `14683-14709` executes the refresh, and `14222-14263` calls `reflect_async`. This is content generation, not a connectivity probe.
- `engine/cutover_verification_runner.py:259-278,379-386` executes explicit cutover verification maintenance, including each Mental Model requirement. It returns an already complete verification and skips complete steps. `engine/cutover_verification_model.py:210-237` invokes `refresh_mental_model` with `_cutover_proof` only when its action is not replayable. The last two observed Reflect runs occur within Character and Global `/cutover-verifications/.../verify` requests. They are initial maintenance executions, not proof that polling re-generates content.
- `engine/reflect/agent.py:881-908` uses `call_with_tools(scope="reflect_tool_call")` for agent iterations, then `682-716` and `_call` at `489-496` use `LLMProvider.call(scope="reflect")` for final synthesis. `engine/llm_wrapper.py:1203-1212` dispatches the separate tool-calling provider path. This accounts for the observer's missing labels without changing any model request.
- `engine/memory_engine.py:4429-4461` implements normal health as a database check, not an LLM probe. The distinct explicit `POST /v1/default/banks/{bank_id}/health/llm` (`api/http.py:4593-4613`) reaches `check_bank_llm`/`_probe_llm` (`memory_engine.py:13338-13400`), deduplicating shared configs within that action. That endpoint was not called in pF99hq. Repeated normal health/capability reads must not be described as repeated connectivity model calls from this evidence.

### Design implication and limits

Core idle CPU does not establish that there is no design latency. This journey serially generates template Mental Models during setup, then refreshes them again during post-transfer activation maintenance. The earlier generation cannot include Local data that has not yet been imported. This establishes a real sequencing cost and a specific question about whether initial generation on fresh Banks could be delayed.

It does not prove either stage can simply be removed. The post-transfer refresh has different current-version inputs and produces D78 maintenance evidence; it is not interchangeable with the earlier template refresh. Safely deferring initial generation would require checking the existing B3/template-ready contract and supported Native initialization behavior. No such change is proposed or authorized by this diagnostic follow-up. It also does not identify the per-HTTP latency during the later D77 first-binding phase.

Request observations contain no explicit parent Reflect ID. Attribution here combines non-overlapping saved time windows, five-call Native traces, exact scope counts, observed HTTP ordering, and reachable source calls. Future overlapping work needs explicit scope/operation linkage rather than assuming every default-labelled request is verification. No private prompt, generated answer, or credential is copied here.

## Files found

| Path | Role |
| --- | --- |
| `packages/core/src/memory/hindsight/hindsight-capture-sync.ts` | Bounded immutable Run-admission decision and detached sync ownership |
| `packages/core/src/memory/hindsight/hindsight-capture-sync.test.ts` | Exact cold no-tools and warm partial regression contracts |
| `packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts` | ACK-derived budget and scheduler/runtime composition |
| `packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts` | Existing serialized synchronization and caller/runtime lifetime |
| `packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts` | Complete pull, first binding passes, exact publication |
| `packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts` | Deterministic Bank-first binding and immutable receipt reuse |
| `packages/core/src/db/hindsight-application-replica-query.ts` | Guarded current Bank readiness evidence |
| `packages/core/src/db/hindsight-runtime-admission-repo.ts` | Persistent capability evidence scoped to epoch/configuration |
| `packages/core/src/memory/hindsight-activation/hindsight-activation-service.ts` | Current post-COMMIT completion point and same-epoch recovery seam |
| `packages/core/src/memory/runtime-composition.ts` | Installed subsystem binding/starting and recovery integration |
| `packages/core/src/memory/hindsight-runtime-binding.ts` | Installation/lifetime availability, independent of application readiness |
| `packages/core/src/memory/operations/memory-operation-kind-hindsight.ts` | Receipt-based failure/boot classification and repair execution |
| `packages/core/src/memory/operations/memory-operation-hindsight-evidence.ts` | Completion currently derived from installed availability |
| `packages/core/src/memory/hindsight-activation/hindsight-activation-status.ts` | Recovery action currently gated on installed availability |
| `packages/core/src/memory/hindsight-activation/hindsight-activation-journey.test.ts` | First activation integration test with weak provider-only final assertion |
| `research/first-use-runtime/real-model-memory.mjs` (task-relative) | Actual activation-to-first-retain sequence |
| `G:/taki-real-memory-pF99hq/{result.json,core-private.log,core-data/taki.db}` | Failed first-chat evidence and delayed first Bank command times |
| `G:/taki-real-memory-X0GDzD/{result.json,core-private.log,core-data/taki.db}` | Earlier partial admission and completed pre-budget first Bank binding |

## Related specs and external references

- `.trellis/spec/backend/hindsight-application-runtime.md:69-80,187-208`: owned foreground synchronization, chat budget, partial/degraded captures and immutable policy preparation.
- `.trellis/spec/backend/memory-hindsight-lifecycle.md:55-68`: a memory-unavailable Run deliberately has no memory tools.
- `.trellis/spec/backend/memory-hindsight-activation.md`: current R6/R7 installation-based post-COMMIT binding/recovery; any readiness correction must update this contract.
- `.trellis/spec/backend/memory-authority-validation.md`: current identity/data guards, full proof boundaries, known-invalid behavior and practical same-receipt recovery remain required.
- Task `prd.md`, `design.md`, `implement.md`, `research/validation-recovery-plan-2026-11-06.md`, and `research/real-model-delivery-20261106.md`: owner usability scope and actual evidence limits.
- Local version references only: D77 application_state 1.0.0, Hindsight 0.9.0 compatibility build requirements in the application-runtime spec; saved real report records Node 24.18.0, AI SDK 7.0.17 and OpenAI-compatible SDK 3.0.5. No external documentation/network research was needed for this internal ownership question.

## Caveats / Not Found

- No implementation or test run was performed by this advisor. Existing tests were read as contracts; their current pass status was not independently re-executed.
- Exact Native/HTTP per-stage latency is not timestamped by the saved access log, so the slower Bank-preparation sequence is proven but its transport/server sub-cause is not attributed.
- The pF99hq decoder exception is a separate harness defect owned elsewhere. Correcting it must preserve the underlying no-tools result; it cannot turn that turn into a successful retain.
- The parent supplied the active session binding for this task. The legacy `.trellis/.current-task` is intentionally empty; no task pointer or lifecycle operation was changed here.
- No private conversation body or credential was copied into this note. The two isolated databases were opened read-only and the original owner database was not accessed.

