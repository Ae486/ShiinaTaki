# S8-S10 independent integration advice — 2026-10-30

## Scope and conclusion

Read-only architecture review of the current T4 source, task PRD requirements 1-14, design, implementation plan,
maturity assessment and the delivered private-inbox/private-worker-context, database and migration contracts.
The owner now authorizes implementation and real-model/E2E checks with configurable defaults N=50 and K=3.
The session-bound task supplied by the coordinator is authoritative; the unrelated legacy `.current-task` is not changed.
No production code, database or spec changed; no provider calls or tests were run for this report.

The existing owners are adequate. Keep one Runtime, existing Run/Attempt/Effect authority, addressed-input acceptance,
inbox and private conversation. Add durable work progress and a typed check-in sidecar; do not implement a second loop,
reuse user Stop as a check-in latch, reset counters on Run admission, or trust a model-authored user-origin assertion.
S8/S9 can proceed independently after reserving the Shared wait/progress interfaces below for the S10 owner.

## Verified source facts

| Evidence | Consequence |
| --- | --- |
| `agents/agent-attempt.ts:42-50,114-124,136-154,183-211` maps segment-local steps with `segmentOffset`, records completed steps and releases segment references. | Existing ordinals span segments within one Attempt only. Counts must persist per work across later Runs/Attempts. |
| `agents/run-message-store.ts:109-119` records native output and collector acceptance in the supplied synchronous transaction, but skips message insertion for an empty message array. | Count at the completed-step port, not by counting transcript rows or tools. Empty completed SDK steps still need their own fact. |
| `harness/subagent-execution.ts:129,137,150-155` orders final collector commit before interaction commit; one combined work stop predicate already exists. | Extend that coordinator with ordered final/input/check-in decisions. |
| Installed `ai@7.0.148`, `src/generate-text/stream-text.ts:1762-1781,3218-3230`, awaits completed-step processing before continuation, but calls stop conditions only for tool/deferred continuation. `stop-condition.ts:64-80` evaluates predicates with `Promise.all`. | Independent stop predicates do not establish precedence. Also handle natural text-only termination after drain; never infer task completion from it. |
| `agents/agent-attempt.ts:156-163` latches callback failures because SDK notification swallows exceptions. | New step/progress persistence errors must use the same failure latch and prevent next dispatch/report success/release. |
| `db/subagent-input-repo.ts:40-82` provides operation-key idempotency, exact request resolution and a user-only Stop continuation check. `harness/subagent-service.ts:274-275` blocks open waits. | Reuse these transactions and scheduler fences, adding a distinct check-in authority check. |
| `db/subagent-event-repo.ts:20-31,91-104` deduplicates producer keys and checks real completed interaction witnesses. `db/subagent-terminal.ts:52-56` suppresses an extra terminal event for an accepted input wait. | Runtime check-in needs a real completed-step witness, not a fabricated `interact_parent` call; existing wait terminal suppression is reusable. |
| `server/methods/subagent-methods.ts:58-60` binds authenticated child controls to `sender.kind='user'`. | This is a trustworthy user reset seam. A parent tool invoked during ordinary primary chat remains parent-originated. |
| `agents/model-observability.ts:126-187` and `agents/model-effect-middleware.ts:175-231` persist provider usage via Effect settlement; `db/migrations/026-run-effects.ts:42-60` makes usage unique by Effect. | Aggregate these facts, including Utility compaction/report Effects under child Runs. Do not introduce cumulative token counters or use only the last SDK segment. |
| `config/knob-registry.ts`, `config/config-source.ts`, and `main.ts:193,233,472` already support live readers with env > stored > default precedence. | Add two registered integer knobs and inject a policy reader; do not add another settings store. |

Paths above are relative to `packages/core/src/` except the explicit installed SDK reference.

## S8/S9 decisions that can be implemented now

- Idle tool restriction belongs in `harness/subagent-inbox-execution.ts:126` or its `subagent-composition.ts:24`
  factory. Omit `delegate_subagent` from both executable/disclosed tools. Keep existing child send/Stop/inspection and
  intrinsic inbox handling. Filtering only a prompt or initial tool disclosure leaves an executable creation path.
- Extend existing Core recovery read projections with outstanding `needs_user_input` actions and check-in user requirements.
  Do not clear these merely because the originating inbox event is handled. A handled escalation is still unresolved
  user attention until the exact work/request receives accepted user direction. Use after-commit child/Character invalidation
  and a Home-visible attention entry/badge; the collapsed `features/subagents/subagent-inbox-recovery.tsx:19` is insufficient.
  Refetch on reconnect and on existing notifications. Attention is runtime status, not unauthorized Companion speech.
- Add one bounded retry timer per refused Character in `subagent-inbox-execution.ts:19-54`, using the existing active map,
  refused state and retryRequested race protection. On expiry recheck eligible backlog and lane availability; timer expiry
  is only a fresh opportunity. Never release a delivered consumer or replay its batch. Clear timers on success/close and
  coalesce timer/fresh-opportunity races. Bounded backoff with one outstanding timer is sufficient; no new task lifetime.
- `authorityChanged()` has no production caller. Wire it to a concrete existing authority transition if useful, or remove
  the uncalled promise. Do not invent a global authority bus. Fresh opportunities plus timer already solve pre-intent retry.
- Model-facing ordinary send should take child ID and optional work ID; Core chooses the actual active/latest work only
  when work was omitted. An explicit historical work ID remains explicit, never silently retargeted. The same work starting
  or finishing a Run must not reject an ordinary message merely because controlVersion changed.
- Preserve exact version/run checks for Stop/Continue and exact event checks for answering a question/check-in. Build the
  resolved target inside the acceptance transaction. Return readable current state and the next valid action on refusal.
- Slim only model projections: preserve canonical internal digests/receipts. `subagent-inbox-context.ts:58-66` can return
  compact event/action projections; full result/details stay bounded and paged with explicit omission/failure states.

## Proposed S10 persistent contract

Use an additive migration after the current last version 062; reserve the number with the coordinator immediately
before editing `db/migrations/index-list.ts`. Preserve all prior migration SQL and existing receipt/digest bytes.
The following names are recommendations, not additional public product concepts:

1. `subagent_work_progress`: one row per root work input; monotonic completed task-step count, current interval start
   count, captured N/K, consecutive parent check-in approvals, last accepted user-reset input ID. Configuration capture
   and progress are work facts. Control versions and Run terminal outcomes remain in their existing owners.
2. `subagent_task_steps`: unique `(run_id, attempt_id, step_number)` plus unique actual task-model Effect ID, work ID and
   monotonic work step ordinal. Capture Effect association at task model intent; mark completion with the completed-step
   transaction, incrementing work progress only for a newly completed fact. Utility calls do not create task-step facts.
   A rejected/pre-intent request does not count; a provider failure without a completed SDK step does not count. Count a
   completed step once even if no native messages were produced. Never count individual tools or provider retry requests.
3. `subagent_checkins`: one stable check-in identity per `(work_input_id, interval_start_count)`; completed frontier,
   captured N/K, approval count, `requiredActor: parent_or_user | user`, report provenance and accepted event ID.
   Reuse `subagent_input_waits` as the canonical open/answered and answer-input linkage; do not duplicate resolution state.
   A partial unique open-wait constraint already exists. A separate report-pending state is needed only if choosing the
   optional model-generated report path below.

Keep stored event kind `needs_input` and add a typed `reason: check_in` projection through the sidecar. This avoids
rebuilding immutable `subagent_events` merely to widen its SQL CHECK. Ordinary `needs_input` remains a worker question;
check-in reason is Runtime-owned, visible in model context and UI. Shared schemas should expose a discriminated pending
request reason plus current interval progress/required actor; no raw receipts/digests belong in ordinary model output.
Runtime check-in acceptance has its own completed-step witness validation and must never pretend a collector was called.

The step fact, counter increment, threshold decision, check-in event/wait/sidecar and conversation ordering reference can
commit in the existing completed-step transaction for a synchronous report. Notify only after commit. Stable producer key
`checkin:<interval identity>` and the sidecar uniqueness prevent duplicate events on repeated callbacks. Run terminal
settlement must preserve the open or already answered check-in and suppress a second unstructured terminal notification.
Run `completed` still describes execution settlement; task state is `needs_input/check_in`, never a fabricated final result.

Migration must not emit events, wake children, replay tools or resume interrupted Runs. Exact past task-step counts cannot
be reconstructed from old transcripts: empty steps were not recorded and model Effects include Utility requests. Record an
explicit tracking baseline for legacy work and begin its tracked interval on explicit post-upgrade continuation. Do not
present reconstructed partial counts as exact history. This compatibility limitation needs to be stated in delivered specs.

## Ordered boundary and report generation

At every completed task step, first durably record source/material/native evidence and count. Then check in order:

1. Cancellation/failed checkpoint or unsafe unresolved effects: preserve current failure/Stop behavior; no success report.
2. Current, accepted final collector/domain result: finish normally, including step N.
3. Accepted ordinary input request: preserve that wait. Its later answer does not reset the periodic counter, so if the
   count is already N, produce the check-in before any next task-model dispatch.
4. Due threshold with safe completed frontier: pause for the single check-in. Otherwise consider pressure rollover.

Use one ordered coordinator, not sibling `stopWhen` predicates. Check due state before every new task-model dispatch and
after stream drain. A natural unstructured end at N remains unstructured rather than successful completion, but its work
must retain the due check-in fence before any continuation can execute another task step. Pending ordinary corrections do
not defer the N fence indefinitely: report their existence as unprocessed and leave their actual input receipts untouched.
Check-in does not consume inputs or retire summary coverage.

**Smallest report option:** synchronously assemble a clearly labelled Core progress snapshot from committed worker
evidence: label/purpose, exact completed-step count, latest worker-authored progress text, existing task summary labelled
with its older coverage, bounded recent completed tool outcomes/references, pending-input count and required next actor.
If evidence does not establish remaining work, say that explicitly. Do not equate tool count with percent complete or invent
successful outcomes. This meets factual progress reporting with no extra inference/loop/crash phase; its limitation is that
freshly reasoned next steps may be absent. The report must call itself a Core snapshot, not a new worker-authored statement.

**If fresh worker prose is required:** use exactly one separately governed, tool-free report request after draining the task
SDK segment, patterned after `agents/private-task-summarizer.ts:19-29`. Read the committed checkpoint/summary plus bounded
recent evidence; no pending-input consumption, action tools, collectors or recursive loop. Bound input, output, retries and
request deadline. Persist a pending check-in reservation before this await so scheduling/intent remains fenced. On successful
report, atomically accept the one event/wait with its report Effect witness. On report failure use the same factual fallback,
explicitly marked synthesis-unavailable. Restart must not reissue an unknown report request; recover the pending reservation
using the stored frontier and fallback, preserving actual orphan Run/Effect outcomes. User Stop during this phase still
suppresses Stop-derived notification and prevents parent resumption. Report/compaction model tokens count in child usage,
but these calls do not count as task steps. A synthetic report `interact_parent` tool call is never acceptable.

The coordinator selected the factual Core snapshot during this review. Implement the synchronous path, with no extra
synthesized model request and no report-pending state machine. Retain the alternative above only to explain the tradeoff:
the report gives actual progress evidence, but may lack freshly reasoned next steps; full evidence remains pageable.

## Continue, K escalation and trusted reset

- A check-in is resolved only by an explicit continue/redirect for its exact event/work, atomically accepted with input and
  action receipt. Add a narrowly typed check-in continuation intent to inbox actions or a `continue_child` action; ordinary
  `answered_child` messages must not implicitly increment K. The existing inbox adapter always passes `continuation:false`
  (`subagent-service.ts:34-35`); route the new intent through an explicit wait-resolution service port.
- Parent approval increments K once, at accepted continuation, not at tool proposal, ordinary message, retry or next Run.
  Set the next interval start to the current completed count. Capture next-interval config without erasing the approval
  count. Duplicate operation/action IDs return the original receipt without a second increment/reset.
- Initially approvals=0. With K=3, check-ins 1/2/3 may receive parent approvals; check-in 4 requires the user. K=0 means
  the first check-in requires the user. Ordinary parent messages, child updates, unrelated foreground chat and automatic
  handling do not reset this count. An ordinary needs-input answer is not a check-in approval.
- Authenticated direct user guidance to this exact work resets approvals, even when sent while running. It does not reset
  N by itself and does not clear a check-in wait without an explicit addressed continue/redirect. A user resolving a
  check-in resets approvals and starts the next interval. Keep the accepted input as the reset witness.
- Repeated primary chat or a model-authored `userApproved` flag is not trusted reset evidence. The proven current path is
  authenticated child send/Continue. Supporting prose such as “continue worker A” through main Chat as trusted user reset
  requires an actual Core-bound user-entry/work action witness; absent that witness it is a parent approval. Do not silently
  treat every primary tool call as user direction. State this behavior in the UI/contract.
- `requiredActor=user` is persisted with the check-in. Parent messages/answers/continue cannot bypass it. Direct user guidance
  may reset K but must still resolve the exact wait before execution. Configuration changes do not downgrade an existing wait.
- User Stop is independent and wins. Parent-origin actions cannot clear it even when resolving a check-in. User Continue may
  atomically clear Stop and resolve the exact current check-in under existing quiescence/version/reconciliation fences.
- An answer may arrive before the producer Run releases its pointer; preserve accepted resolution and schedule only after
  release. Do not require a still-running producer to be quiescent merely to accept an otherwise valid explicit wait answer.

## Config and cumulative usage

Suggested knobs: `TAKI_SUBAGENT_CHECKIN_STEPS` (positive safe integer, default 50) and
`TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS` (nonnegative safe integer, default 3). Use existing registry validation and config
source precedence. `z.int()`/registered integer inputs support zero for K; no arbitrary product cap or disable sentinel is
needed. Add a small `config/subagent-config.ts` reader and inject it through `SubagentDependencies` at `main.ts:617-620`.
Mark apply `live`, with description “captured for the next work/check-in interval.” Persist current interval values so
editing Settings cannot move an active threshold or revoke/downgrade an existing user-required wait. Start a new work or
resolve a check-in to capture new values. Add Chinese labels in `settings/config-groups.ts`; generic Settings rendering
already exposes unknown knobs, but friendly labels avoid raw identifiers as the primary UI.

Read cumulative child usage from `run_effects LEFT JOIN run_usage`, scoped by child-owned `subagent_executions.run_id`.
Include all child Runs/Attempts and their task, compaction and optional report Effects. Exclude main/idle parent consumer
Runs unless separately presented as parent overhead; shared inbox batches cannot truthfully be attributed entirely to one
child. Count every unique Effect once. Reuse the completeness principle from `db/run-observability-aggregate.ts:52-69`,
but count missing usage rows and in-flight model Effects too: summing only existing usage rows masks missing contributors.

Expose each complete aggregate field only if every relevant settled contributor supplied it. An optional known subtotal
must be labelled partial with missing count; never display an unknown field as zero. Distinguish no calls yet, reported
zero, partial/missing usage and active calls not yet settled. Cache/read/write or reasoning subdivisions are not extra tokens
to add on top of aggregate input/output. A directly relevant existing pitfall is `model-effect-middleware.ts:229-231`:
`sumKnown` produces a total when only input or output is known. Do not display that synthetic partial sum as complete child
usage; require both components or a genuine provider-reported total, and fix/cover this normalization if the new projection
relies on it. Existing historical totals with ambiguous completeness need an explicit conservative projection.

## Ownership and recommended verification slices

One S10 owner should own Shared schemas/barrel, `agent-attempt.ts`, `work-context.ts`, `run-message-store.ts`, new progress
repo/migration, `subagent-execution.ts`, event/input/terminal/service integration and `main.ts`. Delegate Desktop only after
freezing read/control/config fields. S8/S9 owners must coordinate edits to inbox context/service/Shared schemas rather than
independently adding parallel acceptance paths. No new dependency is necessary.

1. Real SQLite fixture: unique completed-step count, empty-message step, transaction failure/duplicate callback, migration
   fresh/current/legacy reopen, no wake, unchanged historical receipts; Counter survives Run/Attempt and process restart.
2. Scripted actual SDK: N-1 final, final on N, N tool loop pause, natural unstructured N, needs-input at N, pending correction
   on N, multiple pressure rollovers, no report/tool replay and unchanged primary/inbox caps. Verify event/wait cardinality,
   persisted sources and exact next model request rather than only final text.
3. Explicit continuation: K=0 and K=3; ordinary messages/chat do not count/reset; parent check-in approval counts once;
   direct-user guidance resets only its addressed work; existing user Stop cannot be cleared; stale/duplicate request and
   answer-before-terminal races; configuration captured per interval and persistent required actor.
4. Synchronous report: absent/older summary, no worker text, large recent tool output, pending input, crash before/after
   event commit and cancellation at the boundary. Every case stays fenced and preserves actual evidence; no extra model call.
5. Usage: full reported values, reported zero, only one component, missing usage row, failed/unknown model, ongoing call,
   compaction and next Run included, parent consumer excluded. Core projection and rendered UI must agree on unknown states.
6. S8 timer/fresh opportunity/foreground lane races, delivered batch refusal to auto-retry, exact user-attention recovery;
   S9 stale ordinary send with preserved historical work, paged large body and actionable exact-control refusals.

After these focused gates, one integrated S11 pass and S12 goal-only real-model campaign remain necessary. This advisory is
source evidence and proposed engineering contracts, not deterministic/live/UI acceptance. No unresolved issue requires
changing framework, adding a broker, or relaxing the original requirements.

## Follow-up: uniform Co-Watching compatibility (owner clarified)

The owner explicitly confirmed that Co-Watching shares this child mechanism and must receive the same periodic
check-in. There is no source-owned or finite-work exemption. Earlier advisory discussion of such an exception is
superseded. Adapting the existing caller is required compatibility work, not a change to the user's requirements.
External video analysis remains its separate existing operation; the child prepares the validated reaction plan.

The smallest compatible contract uses existing bindings, source validators and owner callbacks:

- Runtime check-in inbox delivery is independent of final `record_only`. Co-Watching final artifacts remain owner-validated
  and `record_only`; the checkpoint never installs or publishes a plan. Generic `record_only` cannot bypass the fence either.
- Existing domain completion is natural SDK end plus successful owner validation. At step N a continuing tool frontier,
  including a write of a valid-looking artifact, is not yet accepted domain completion, so check-in is legitimate. At a
  natural text-only end on N, drain first and run the existing validator before accepting any check-in; validated completion
  wins, while invalid natural final output preserves the established domain failure behavior. No eager file probe, final
  marker tool or extra model call is necessary.
- Add a narrow immutable read `events.checkInForRun(runId)` over the check-in sidecar/event. It classifies the producer
  Run regardless of whether the wait is now open or answered. `executeSubagent` skips post-stream final artifact validation
  when this Run ended at a check-in. Existing `onCommittedResult(completionId)` remains the notification callback.
- In `co-watching/child-adapter.ts`, `acceptCommittedResult` checks the producer Run's checkpoint fact before its
  nonvalidated-result -> `plan_invalid` branch. Preserve the session, edit, source, artifact and private context. Do not
  rely only on current `summary.pendingRequest`: an exact answer can arrive before terminal pointer release/callback.
- Display a paused state only while the current exact work still has an open checkpoint; an already answered wait or a
  newer active Run must not be overwritten with stale paused status. A callback from an older artifact/Run still respects
  the existing scope guards and cannot install or retire newer work.
- A check-in continuation retains subagent/work IDs and creates a fresh governed Run with existing private history.
  `prepareExecution` may reuse the prior artifact revision/path when the preceding Run was a checkpoint, the edit and
  committed-candidate digest still match, and no new owner revision is pending; bind its producer Run ID to the new Run.
  A genuine owner revision keeps the existing new-artifact behavior. Never discard the prior unfinished artifact merely
  because the execution Run changed.
- `resumeCoWatchingChild`/ordinary queue release must not append a core resume input or clear the owner-yield flag while
  an open check-in exists. Clear obsolete owner-yield intent when settling the checkpoint; only an explicit accepted
  check-in answer resumes it. Runtime's open-wait and pre-model threshold fences remain authoritative even if the feature
  callback is delayed or omitted. Owner revision input may queue but cannot silently resolve a check-in.
- Every continuation still rechecks finite source validity, actual source/currentness, uncertainty and user Stop. Neither
  shared checkpoint reporting nor a parent approval restores a lost source binding or clears user Stop. Existing process
  restart limitations on source-owned executable bindings remain truthful.

Focused actual-SDK tests should include N-step artifact-write checkpoint, natural validated final on N, invalid natural
final, exact answer before producer terminal/callback, preserved artifact/edit on continuation, true owner revision,
queue release/owner-yield races, finite-source retirement and user Stop. These are compatibility regression cases within
the current task. This addendum is source-reviewed advice; the implementation owner retains production/test ownership.
