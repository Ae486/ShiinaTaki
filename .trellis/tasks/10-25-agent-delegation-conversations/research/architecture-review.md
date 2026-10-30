# Independent architecture review — 2026-10-25

Scope: planning-only challenge of the original [PRD](../prd.md), [recovered authority](context-recovery.md),
[design](../design.md) and [execution plan](../implement.md), with targeted current-code verification.
Worktree/branch verified as `H:/TakiAgent-worktrees/t4` / `task/t4-skills-mcp-productization`;
`task.json` remains `planning`. No production code, dependencies, paid calls, database or Git state was changed.

## Verdict

The selected direction is coherent and practical: extend current Runtime/SQLite owners, preserve SDK tool execution,
add durable private event/summary/order-reference contracts, and share Chat presentation with separate controllers.
There is no evidence-backed need for a broker, new agent framework, separate executor or copied Chat page.
The original requirements do not contain a newly discovered product conflict requiring another grill.

One required planning correction was the foreground private-output/Memory boundary identified below. The coordinator
resolution is recorded at the end of this report and in [foreground boundary verification](foreground-private-boundary.md).
The SDK, migration and UI experiments listed below remain implementation gates, not
reasons to leave an otherwise explicit plan in indefinite research. This review does not approve implementation.

## Required correction: foreground private consumption

Attaching inbox evidence only to the outgoing model request does not by itself keep derived private handling output
out of the relationship transcript. Current `chat-agent.ts:372` captures native completed SDK messages;
`finishRecordedTurn` at `:294-300` commits the whole primary batch and passes its committed rows to
`onPrimaryCommitted`; detached primary Memory maintenance remains at `:433`. Thus an ephemeral input envelope
plus a prompt saying private events stay private is insufficient.

The plan must explicitly give private handling calls/results/dispositions a private durable owner and exclude them
from primary Timeline, exposure and automatic Memory evidence. It must define which user-visible primary output
is committed under the actual primary speech/source contract, rather than treating every native SDK message in a
mixed request as eligible primary content. Source attribution and action receipts must survive that projection.
Primary user content and ordinary primary output/Memory behavior must remain intact. Required tests capture both
actual model input and the resulting private/primary durable rows, Memory witnesses and activity/exposure targets.
This is a correction to the proposed seam, not a finding that child-only persistence currently leaks to Timeline.

## Critical decisions checked

| Decision | Current evidence and assessment |
| --- | --- |
| Explicit accepted-source validity rather than missing dates | `prepared-publication-schema.ts:19-30` and `prepared-publication-authorization.ts:35-43` currently require/compare finite expiry. `delivery/direct-request-report.ts:43-51,85-128` ties acceptance, held root, authorization and candidate to task expiry. The plan correctly proposes a discriminated finite/until-cancelled accepted-source scope registered only by the trusted original-request adapter; candidate/delivery freshness remains finite. JSON cannot restore the WeakMap authorization handle. This is a shared authorization change with targeted finite-source regression gates, not merely a nullable database column. |
| No-expiry migration preserves history | Migration `056-subagent-conversations.ts:41,122-135` makes expiry non-null and input/results/receipts immutable; `subagent-input-repo.ts:38,67-84` actively rejects old-deadline Continue and propagates the timestamp. The new forward migration must preserve old bytes/digests and terminal outcomes while disabling generic age checks on explicit new continuation. Only eligible pending/deferred legacy events bridge once. Old withheld/expired/admitted work and lost publication grants are not resurrected. The plan states these constraints; no planning blocker remains here. |
| Accepted, delivered, handled and publication remain distinct | Existing `run-message-repo.ts:24-45` commits input receipts at actual model Effect intent; preparation proves no dispatch. Existing `subagent-completion.ts:25-30` depends on `tryAcquireBackground`, which can starve behind continuous foreground requests. Shared exact batch claims at real foreground requests plus idle opportunities address that actual gap. Explicit durable dispositions, stable action identities, pre-intent-only automatic retry and inspectable post-intent reconciliation protect against duplicate fresh processing. FIFO is conditional on eligible finite backlog and successful opportunities; the plan does not promise success through provider outage. |
| Interaction does not consume final-answer rights | `subagent-completion.ts:79-83` currently closes the report scope on any non-reply parent decision. The proposed replacement reserves final-scope closure for the relevant final report disposition/cancellation and keeps ordinary/silent interaction independent. This is necessary to implement the requirement and is already recorded in runtime research and S3. |
| Same live Run/Attempt SDK segmentation | `chat-agent.ts:347-410` owns the SDK, completed-step recording and settled-text callback; `subagent-execution.ts:53-62` owns outer Run settlement. `turn-recording.ts:28-39` keys completed steps by number; `subagent-tool-materials.ts:28-29,60-72` retains caches and keys material by Attempt/tool-call ID; `tool-disclosure.ts:50-66` rebuilds activation from SDK-local completed steps. The plan correctly requires monotonic Attempt step ordinals, unique actual Effects/material associations, same cancellation/lane/authority, final-callback suppression, disclosure continuity and post-durability cache release. These are real production gates. The SDK probe proves feasible call boundaries only, which the artifacts state accurately. |
| Shared Chat/private order and live handoff | Private input sequence in migration 056 and output `run_messages.seq` do not provide common commit order. `subagent-reads.ts:28-44` currently assembles separately paged source arrays in the browser. The narrow transactionally written source-reference order index is justified; it is not a second content store. `chat-activity-projection.ts:28-43` is latest-per-Character, so concurrent child streaming requires its own child/Run/Attempt projection, while reusing pure mechanics. Newest/older/gap cursors, complete-batch handoff and explicit legacy ordering preserve truth without invented chronology. |

Paths above are under `packages/core/src/` unless qualified; publication schemas are under `packages/shared/src/`,
and `subagent-reads.ts` is under `apps/desktop/src/features/subagents/`.

## Clarify S4's input frontier gate

Bounded SDK retention alone is insufficient. `run-message-store.ts:35-61` retains `carried` input IDs and prepared
requests, and `workInputs` at `:104-113` rereads/collects every input for a work on each preparation.
`run-message-repo.ts:24-45` then records the supplied input ID set against each actual intent. Across compaction,
an old input represented only by summary must not keep receiving receipts claiming raw exact inclusion.

Use durable receipt/summary frontiers and bounded paged selection of pending input plus exact retained tail;
release covered historical input/preparation references only after durable evidence and inclusion semantics agree.
Do not add a separate service or weaken the existing complete-pending-input/currentness check. Extend S4's actual
payload/receipt/resource test to many addressed corrections and rollover boundaries, rather than testing only tools.
This is a concrete requirement for the already proposed private checkpoint owner, not an additional architecture.

## Remaining implementation gates

- Isolated fresh/current/legacy T4 SQLite fixtures: atomic terminal event/order commit, stable bridging, immutable
  bytes, no wake/replay, explicit continuation after old deadlines and unchanged real source/permission expiry.
- Production ChatAgent with deterministic transport: exceed both old caps; multiple pressure rollovers; unique
  Effects/steps/materials; exact retained rounds and raw retrieval; bounded caches/frontiers; Stop/unknown/deferred
  tool boundaries; no interim settlement, callback, parent event, Companion processing or loader replay.
- Foreground/idle race and restart: exact durable accepted/delivered/handled facts, silent handling without lost
  publication authority, no duplicate child answers or speech, user-stop suppression and explicit user continuation.
- Actual private Core/WS/UI path: mixed trusted origins, newest/older/gap pages, complete live batch handoff,
  independent main/two-child streams, draft revisions/targets, scroll/selection and unknown mutation recovery.
  Native scripted evidence and owner usability acceptance remain separate.

All are already in the implementation acceptance matrix or the clarification above. No application tests were run
for this read-only review, and no historical acceptance was promoted to a fresh observation or human approval.

## Coordinator resolution in continuation session

Session `01a17186-8409-7073-b737-845377a5e84f` read the saved independent review and rechecked its two correction
paths against current source. This section is the coordinator's resolution, not an additional independent verdict.

- **Foreground boundary:** design now binds intrinsic inbox actions to a real delivered batch/primary consumer,
  stores their complete private pairs under the Run transcript owner, and excludes private activity and records
  before primary publication. Ordinary primary public text and unrelated tools remain intact. Actual public answers
  may use attributed child evidence; private child answers/notes use structured actions. Partial/error/retry,
  presentation references, source sidecars, replay and both Memory witness paths are explicit. See the linked
  verification for exact source evidence and later tests.
- **Existing Memory protection:** `canonical-ingestion-source.ts:111-120` already filters tool roles and tool parts.
  The required correction concerns the new mixed-request routing; the original review is not evidence that current
  child-only records or raw tool payloads are being ingested. Do not add a duplicate Memory filtering service.
- **Input frontier:** design and SDK research now distinguish immutable first consumption, exact raw inclusion and
  summary coverage, preserve the complete pending batch/currentness check, and require actual payload/receipt tests
  with many corrections. Summary-only historical inputs cannot receive new raw-inclusion receipts.

The saved challenge is addressed at planning level. A new 6.1 review failed twice with upstream rejection, and an
Astra review failed with a cross-resource error; no successful fresh independent check is claimed. Implementation
still needs the S0 interface review and the later production evidence listed above. Task status remains `planning`.
