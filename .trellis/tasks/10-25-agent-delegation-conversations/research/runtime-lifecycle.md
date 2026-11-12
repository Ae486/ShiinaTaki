# Research: durable delegation interaction and lifecycle

- Query: How should continuing child conversations deliver durable events to the main Companion without foreground interruption, task expiry, repeated processing or an independent runtime?
- Scope: internal source investigation, one deterministic local queue experiment, and previously recorded external precedents.
- Date: 2026-10-25.
- Workspace: `H:/TakiAgent-worktrees/t4`; existing dirty worktree. No production files, runtime databases, dependencies or Git state changed.
- Authority: the assigned task PRD and the October 24 owner discussion in `docs/AGENT-DELEGATION-RESEARCH.md:7-130`. Recommendations below are technical mappings, not new owner decisions.

## Findings

### Verified owners and concrete gaps

| File and lines | Verified behavior and implication |
| --- | --- |
| `packages/core/src/harness/subagent-composition.ts:18-29` | Composes the existing service, direct-request reports and authenticated RPCs, then calls `released()`. There is no generic persisted binding reconstruction here. |
| `packages/core/src/harness/subagent-service.ts:23-27,125-142` | Bindings begin in an empty process-local Map. Only explicit user Continue can reconstruct an ordinary lost binding; a source-bound execution refuses generic reconstruction. Routing recovery is a real gap, not solved by having persistent result rows. |
| `packages/core/src/db/subagent-execution-repo.ts:124-141` | Exactly one immutable `parent_run_id` belongs to a completed child execution, selected by completion ID and digest. This shape cannot describe several nonterminal child messages, a batch of different children, or separate handling attempts. |
| `packages/core/src/harness/subagent-completion.ts:19-44,49-72` | Scans pending results, requires the live binding, probes the Character background lane, defers busy/authority failures and admits `subagent-completion:<completionId>`. An in-memory refused set blocks repeated failed captures until `retry()`. There is no primary-boundary inbox delivery. |
| `packages/core/src/db/subagent-terminal.ts:29-49` | Final child result, completion disposition and pointer release commit together. `record_only` is excluded; every current `request_parent` result becomes pending, including cancellation caused by user Stop. Add origin-aware notification disposition here, not only in the UI or stop caller. |
| `packages/core/src/agents/subagent-result-tool.ts:25-45` | `complete_subagent` stages a proposal, commits it only after a matching completed SDK tool result, and structurally stops after commit. Reuse this witness pattern for final/input-request reports. |
| `packages/core/src/db/subagent-terminal.ts:33-41,78-83` | A natural model stop without a collector is already distinguishable as `unstructured` or `none`; Run `completed` does not imply validated task completion. Preserve that distinction in new lifecycle/UI projections. |
| `packages/core/src/agents/run-message-store.ts:51-74` | Addressed inputs are selected at `prepareStep`, consumed only at actual model Effect intent, and completed native messages are persisted. This is the pattern to reuse for inbox delivery receipts. A preparation callback alone proves no dispatch. |
| `packages/core/src/db/subagent-input-repo.ts:21-43,58-64` | Inputs are immutable/idempotent; exact control version and optional Run checks protect addressing. Only user-origin Continue clears a user-stop latch. Continue must be quiescent. |
| `packages/core/src/harness/subagent-service.ts:161-180` | Stop persists the latch and cancels exact execution, then notifies the feature owner's control callback. That callback is not inherently a main-Agent event. Preserve feature ownership while suppressing actual automatic main inbox events for user Stop. |
| `packages/core/src/agents/turn-queue.ts:51-66,87-95` | Primary reservations block background acquisition and take precedence over queued non-primary waiters. Good foreground priority, but no background fairness guarantee under continuous foreground requests. |
| `packages/core/src/main.ts:427-441` | Recovery runs before dispatch; Character release hints notify subagents and other existing owners. Primary-reserved callbacks currently yield Co-Watching/media preparation, not subagent parent continuations. |
| `packages/core/src/harness/subagent-recovery.ts:11-31` | Restart settles unfinished linked work as cancellation/deadline/unknown using real Effect evidence and requires explicit continuation. It does not replay the last completed model/tool or infer task completion. |
| `packages/core/src/harness/subagent-execution.ts:116-124` | Unknown non-model Effects block continuation; later addressed work is detected by work watermark. Keep these guards while adding input-wait state. |
| `packages/core/src/harness/subagent-queries.ts:10-26` | Summary state combines Run, latch, input watermark and live binding. There is no durable `needs_input` state; missing binding becomes deferred, not a false queued state. |

### Local fairness experiment

The following ran through Node's TypeScript stripping against the actual `turn-queue.ts`; it performs no I/O or model calls:

```powershell
@'
import { createTurnQueue } from './packages/core/src/agents/turn-queue.ts';
const queue = createTurnQueue();
const first = queue.reservePrimary('taki');
let release = await first.acquire();
let denied = 0;
for (let i = 0; i < 25; i++) {
  const next = queue.reservePrimary('taki');
  const acquired = next.acquire();
  if (queue.tryAcquireBackground('taki') === undefined) denied++;
  release();
  release = await acquired;
}
release();
const idleRelease = queue.tryAcquireBackground('taki');
console.log(JSON.stringify({ primaryTurns: 26, backgroundDenied: denied,
  backgroundAvailableAfterIdle: Boolean(idleRelease) }));
idleRelease?.();
'@ | node --input-type=module
```

Result: `{"primaryTurns":26,"backgroundDenied":25,"backgroundAvailableAfterIdle":true}`.
This proves the queue primitive's priority behavior, not full application scheduling. Merely adding more release hints cannot prove non-starvation.

## Recommended mapping

### 1. One durable inbox, two consumption opportunities

Extend the existing delegation coordinator and SQLite repositories. Keep TurnQueue, Run/Attempt/Effect, current tool governance and publication owners. Do not introduce a broker, a second agent loop, or an independent scheduler.

Add a small immutable child-event family with stable event ID, Character/child/work identity, per-inbox monotonic sequence, actual Run/Attempt/tool witness where applicable, origin, kind, body/material reference and acceptance time. Add a delivery/handling relation keyed by event and actual handling Run/Attempt/model Effect, with disposition and its durable witness. These records are private Runtime evidence. They are not relationship Timeline messages or reconstructed permission grants.

The existing one-parent-per-terminal-result columns remain legacy evidence. Do not overload them with several event types or mutate old links. A linked batch admission/terminal participant can coexist with the legacy scope during migration; its membership is an exact immutable event set.

Two paths share one atomic claim/delivery owner:

1. **Foreground boundary:** attach a bounded oldest eligible event batch immediately before the next primary model request, including an intra-loop safe boundary when appropriate. Keep the actual user message first-class and distinctly label Core child events. No abort, surprise user utterance or new lane acquisition is required. Do not attach raw private history. Do not persist these injected events as user Timeline rows or make them automatic primary Memory evidence.
2. **Idle main:** when no primary intent owns/waits for the Character lane, admit one separately captured internal main-Agent Run for a batch using the existing background lane. It can answer children or retain results silently. A primary reservation cooperatively retires/yields this handler at a safe boundary; it never steals a lane or replays completed Effects. Pending events remain durable for foreground delivery or a later idle opportunity.

Both paths commit delivery with the actual model Effect intent transaction, using exact event IDs/digests and consumer identity. `prepareStep` may prepare/reprepare without consumption. Deduplicate within the request, across retries, and across the idle/foreground race.

Engineering starting bounds: at most **8 events** and **16 KiB rendered UTF-8** per request; each body preview at most **1.5 KiB**, with explicit truncation and an exact detail/page reference. These are tunable projection defaults, not capacity measurements or task/action-count limits. Choose oldest `event_seq` first within the Character. A large oldest event gets a bounded envelope plus detail reference instead of permanently blocking the queue. Skipping a reconciliation-blocked event requires a durable, inspectable reason; it must not disappear as handled.

After a finite backlog and successful model/disposition opportunities, FIFO ensures each eligible event advances. An unbounded failing/never-completing provider cannot support a wall-clock completion guarantee; retain truthful failure and retry state rather than claiming one. No periodic polling is required from the model.

Expose outstanding count/oldest age and handling/reconciliation reasons from real rows. Optional async messages may be refused before acceptance under explicit storage pressure, with a clear `not_accepted` result. Canonical terminal/failure facts for already accepted work must always enter the same durable terminal transaction. A speculative fixed queue threshold must not become a task count/lifetime cap or a drop policy.

### 2. Acceptance, delivery, handling and speech

| Fact | Exact meaning |
| --- | --- |
| Accepted | Event and required source/terminal evidence committed. UI pushes are hints only. |
| Delivered | Event was included in an actual model Effect intent with exact identity. This does **not** prove the remote provider received it or the model reasoned correctly. |
| Handled | A validated per-event disposition committed with a completed tool/result or equivalent existing Core witness. Examples: retain, no action, answered child, request user input, propose speech. Natural model stop alone does not acknowledge all supplied events. |
| Published | Existing authorized publication/delivery records prove speech was committed/delivered under their own states. This is independent of inbox handling. |

A handler may make one disposition for several supplied events, but it must name that exact supplied set. A receipt marked delivered is not automatically handled. Missing or malformed disposition remains visible.

Automatic replay is allowed only for a failure proven to precede any model/tool intent and only under fresh valid authority. After intent, preserve terminal facts and completed side-effect receipts; unknown handling becomes `reconciliation_needed` with explicit continuation. If continuation is chosen, reuse the same event identity and carry previous attempts/results as history, not fresh work; deduplicate action intent by event/action identity. Never execute an already completed child reply twice merely because the handler failed before its final disposition.

### 3. Interactive child lifecycle

Keep Run outcome separate from continuing task disposition:

- Ordinary `interact` commits an asynchronous parent event and returns queue acceptance; it does not stop independent work.
- `needs_input` commits the event and a durable pending-input request identified by work and event/request ID. After the current completed action round, release the execution/lane. The execution Run can finish normally while the work remains awaiting input; this is not final task success.
- `final` uses the existing collector witness and retains a validated final report. The conversation remains reusable.
- Provider failure, external interruption or natural stop without final report use Runtime-authored event categories/reasons. A model cannot declare an exception away or promote partial text to a validated final report.

Use the current collector to stage one terminal disposition (`final` or `needs_input`) for a given attempt/token. Async messages have their own exact tool-call identities and do not consume the terminal proposal slot. Conflicting terminal dispositions refuse. Source-owned `validateAndPropose` work keeps its feature-specific validation and collector exclusions.

Add the minimum work-level waiting/disposition record rather than keeping a Run/controller/socket waiting across days. Address replies to the pending input request where present; a repeated old answer cannot clear a newer wait. A trusted same-work response can resume a needs-input wait, but cannot clear the separate user-stop latch. User and main-Agent directions remain distinct through actual authenticated entry points, private replay and UI.

For direct user Stop, retain the Run cancellation/result and private control event, with `notify_main=false` derived from trusted stop origin captured in the terminal transaction. Include cancellation-derived failure paths and restart repair. Parent inspection still sees the stop. Do not globally mute the child or change its reporting counterpart. Explicit user continuation creates a new Run and restores ordinary future reporting. Parent message/Continue cannot clear the user latch.

An event accepted before a later user Stop remains an historical event; suppress Stop-derived wake/events, and apply current control checks before acting on earlier requests. Do not retroactively turn previously delivered evidence into an event that never existed. The exact private transcript order must reference all existing input/output/control records; inbox sequence alone cannot order private inputs that were never parent-deliverable.

### 4. Restart routing and authority

Persist enough trusted generic routing metadata at work acceptance to identify the original Character/child/work counterpart, ordinary versus feature-owned policy, selected tool membership and source owner identity. On boot, after existing orphan Run recovery, restore **routing** for already accepted generic events and input waits so pending events do not depend on the old parent's closure. Each new model execution captures current authority/tool state; the old Run never reopens.

This does not automatically restart interrupted child work. Already accepted events may be delivered; interrupted/unknown child actions require explicit continuation/reconciliation. A feature source binding is resolved only by its trusted feature owner; generic restoration must not invent `checkCurrent`, callbacks, source validity or executable closures from copied JSON.

New automatic event delivery does not authorize publishing private results. Losing the original publication handle after restart must not strand inbox handling. The main handler can retain silently, inspect or answer the child under fresh admitted authority while recording `publication_unavailable`. A later genuine primary user turn may use its own ordinary speech authority. Do not silently claim a delayed automatic answer was delivered.

### 5. Task expiry removal and publication compatibility

The generic lifetime is currently wired through all of the following:

- Model/API request and stored input/result schemas: `packages/shared/src/subagent-tool-schema.ts:15`, `subagent-schema.ts:56-57,63-77`, `subagent-result-schema.ts:36-40`.
- Input creation and Continue: `packages/core/src/db/subagent-input-repo.ts:38,67-84`.
- Work currentness and scheduling: `packages/core/src/harness/subagent-state.ts:78-85`, `subagent-service.ts:209-214`, `subagent-queries.ts:19`.
- Linked child **and parent** Run admission: `subagent-execution-repo.ts:112,137,144-147`, `subagent-execution.ts:73-79`, `subagent-completion.ts:62-68`.
- Active child and parent timers: `subagent-execution.ts:33-35`, `subagent-parent-execution.ts:29-30`.
- Direct-request report acceptance, held root, publication authorization, candidates and timers: `packages/core/src/delivery/direct-request-report.ts:43-51,85-128`.

For new generic work, remove the model/API lifetime field and task deadline entirely. Do not use a huge sentinel date, renew it on each input, or replace it with an execution-wide hidden timer. Request/tool/network deadlines and feature-source validity remain independently enforced.

The current input column is `TEXT NOT NULL` and immutable; old results/digests/reply acceptance are also immutable (`packages/core/src/db/migrations/056-subagent-conversations.ts:41,122-135`). Use a new forward migration, not edits to migration 056. Permit absent active generic expiry in new storage and preserve old values as historical audit data. Readers must not use a legacy generic task deadline to reject a new addressed continuation. Keep existing expired/cancelled/unknown Run outcomes and all original digests/receipts unchanged. Migration emits no wake and replays no Effects.

Backfill an inbox bridge only for old pending/deferred eligible `request_parent` rows with a stable legacy event ID. Existing admitted/handled result links and `record_only` remain historical; do not generate a second automatic handler. An old withheld/expired disposition remains historical; explicit new continuation/event produces new evidence rather than editing the old result into success. Old source retirement remains actionable source truth.

**Original-request speech authority needs an explicit validity mapping.** The current direct-request adapter equates every publication scope with `workExpiresAt`; removing only the work field would either disable speech or accidentally fail open. `PreparedPublicationSource`/authorization/candidate require a timestamp (`packages/shared/src/prepared-publication-schema.ts:19-30`), the live authorizer compares it unconditionally (`packages/core/src/harness/prepared-publication-authorization.ts:35-43`), and the publisher expects an admitted finite delivery deadline (`packages/core/src/delivery/prepared-publication.ts:94-107`).

Recommended mapping for new original-request acceptance:

1. Represent accepted-source validity explicitly as finite expiry **or** until cancelled. Only the trusted original-request adapter selects the latter after validating the real primary user-row witness. Existing Co-Watching/media/source adapters continue selecting finite validity and retain their source checks.
2. Hold the original accepted report scope without a generic task deadline; preserve explicit cancellation, exact user-row identity, current authority and the one-final-delayed-answer policy. A finite candidate/delivery freshness deadline can be captured when speech is actually proposed; its expiry refuses/degrades that publication, not the task/inbox.
3. Keep historical `replyAcceptance.expiresAt` and closed/expired accepted roots unchanged. Migration must not extend an old publication grant or construct the WeakMap-backed live handle from persisted JSON. Its later event can still be handled silently when that original grant is unavailable.
4. An ordinary child interaction or a silent per-event handling decision must not consume the final delayed-answer right. Current `finishReport` closes work for every non-reply decision (`subagent-completion.ts:79-83`); replace that rule with closure on the appropriate **final work report** disposition/cancellation, preserving the existing legacy one-shot path.

The accepted-source validity extension is a shared authorization change and requires the independent architecture challenge and targeted finite-source regression tests before implementation. A nullable field plus unchecked `Date.parse(undefined)` is not a valid implementation.

### 6. Completion policy compatibility

- Ordinary new `delegate_subagent` work should use the trusted Companion reporting default (`request_parent`/new equivalent interactive event policy), so final/input-required/failure events reach its main counterpart automatically. Do not ask the model to poll for the result.
- Preserve captured policy on existing work. Old `record_only` remains no automatic parent inference; old admitted completion links must not be reissued as new inbox work.
- `submitOwnedWork` and the Co-Watching child adapter retain explicit `record_only` and the source owner's result/control callbacks. Feature validation, source retirement, prepared-result publication and finite source validity remain separate.
- New generic final reports remain compatible with one final delayed answer where a real original-request adapter exists. Multiple child interaction events do not each acquire speech rights. Already consumed final report authority does not permanently close the private conversation; later interaction uses currently valid authority.

## Alternatives and tradeoffs

| Approach | Benefit | Cost/failure mode | Recommendation |
| --- | --- | --- | --- |
| Extend only current completion rows/background polling | Smallest diff and existing idempotent admission | Cannot represent nonterminal interaction/batches; loses bindings on restart; starvation under continual primary intent; no per-event handling truth | Reject for this requirement. |
| SQLite inbox with primary-boundary and idle delivery using current Runtime | Meets conversational priority and delivery continuity; reuses Effect/queue/authority ownership | Requires bounded event/receipt records, precise primary context exclusion and a linked batch scope; publication validity changes must be explicit | Recommended. |
| Dedicated agent/mailbox broker or persist an entire second runtime | Framework-supplied orchestration may exist | New dependency/process/recovery/permission boundary, duplicate execution authority; no demonstrated need | Out of scope. |

## Minimal verification gates for implementation

1. **Concurrent foreground delivery:** run repeated foreground requests while child events commit; each finite eligible backlog advances by oldest sequence at actual model-intent boundaries, no active foreground abort, no fake user Timeline/Memory evidence, and rendered byte/count bounds hold.
2. **Atomicity and duplicate race:** crash before/after event acceptance and before/after actual input intent; race idle and primary consumers; one exact event identity, truthful delivered/handled distinction, no duplicate child answer/publication.
3. **Handler failures:** pre-intent capture failure retries only on a meaningful trigger; post-intent provider failure/unknown or completed-tool-then-handler-failure preserves receipts and requires reconciliation/explicit continuation; no invisible drop or automatic effect replay.
4. **Input wait:** async interaction continues independent work; needs-input releases the lane and persists the pending request; addressed reply days later resumes same work; stale reply cannot clear a newer wait; natural no-final stop is not shown as task complete.
5. **User Stop race:** stop before final collector commit, after message acceptance, during provider failure and before restart classification; Stop and derived terminal notifications do not wake main; explicit inspection shows state; user continuation restores future reports and parent cannot clear latch.
6. **Expiry migration:** old T4 rows keep immutable digests/Run outcomes; new generic work has no lifetime field or execution-wide timer; old generic timestamp no longer blocks explicit new continuation. Keep feature-source expiry, tool/request deadline and unknown-effect reconciliation tests.
7. **Publication:** until-cancelled new original acceptance survives elapsed task time in the same live authority generation; historical expired/lost grant cannot be revived; inbox still handles silently; interaction/no-action does not consume final answer; finite source and finite delivery deadlines retain their authority checks.
8. **Production restart:** restart actual Core over an isolated DB containing pending events, pending inputs, user-stop, completed child and unknown handler Effects; no old child action auto-resumes, accepted event routing restores, source-owned binding absence is explicit, no model/provider calls except the scripted local server.
9. **Legacy feature regression:** `record_only` preparation still causes zero automatic main inference; no duplicate parent admissions for already admitted legacy results; ordinary main memory/tool authority and private child exclusions remain unchanged.

Useful existing test seams: `subagent-service.test.ts`, `subagent-completion.test.ts`, `subagent-recovery.test.ts`, `subagent-materials.test.ts`, `delegation-tools.test.ts`, `direct-request-report.test.ts`, `subagent-methods.test.ts`, plus existing source/publication/production-restart fixtures. Update old expiry tests to assert the newly authorized task semantics while retaining independent real source-expiry expectations; do not simply delete them.

## Related specs and external references

- `.trellis/spec/backend/shared-agent-delegation.md`: existing frozen owner boundaries; its task-expiry, exactly-one-completion and no automatic failed-handler replay sections need precise follow-up updates after implementation approval.
- `.trellis/spec/backend/database-guidelines.md`: single-writer transactions, linked admission/terminal participants and immutable evidence.
- `.trellis/spec/backend/agent-runtime.md`: full native tool evidence, cancellation, source rendering and Memory exclusions.
- `.trellis/tasks/08-22-t4-agent-architecture-observability/research/phase-c-persistence-recovery.md:19-75`: durable state versus post-commit hints and no unsafe Effect replay.
- Existing official Codex/Claude messaging precedents and their API/product distinctions are retained in `docs/AGENT-DELEGATION-RESEARCH.md:61-80`; no new external documentation claims were needed for the local owner mapping.

## Caveats / Not Found

- The semantic search index reported revision `06a8090118a4` and returned mainly older planning documents. Findings above use current direct file reads; indexed research was a pointer, not proof of current code.
- Only the TurnQueue primitive experiment was executed. No feature tests, production runtime, real provider/model, native UI, Hindsight or main/T4 migration convergence were exercised here.
- T4/main SQLite history convergence remains outside this task. The new migration must be validated on the authorized T4 lineage; choosing a migration number is not evidence of compatibility with main.
- There is no existing generic durable inbox, wait-request state, per-event handling receipt, restart routing restore or until-cancelled original-report validity to reuse unchanged. These are bounded additions to existing owners, not claims of built-in SDK support.
- Child research sessions do not inherit the root Trellis session pointer. The explicit assigned task path governed this output; the stale legacy `.trellis/.current-task` Avatar pointer was not modified.
