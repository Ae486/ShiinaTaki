# Private Agent Inbox and Continuing Conversations

## 1. Scope / Trigger

Use this contract when changing child-to-main events, input dependencies, main consumer admission/recovery,
or the continuous private conversation/activity API. The companion Runtime, SQLite and SDK remain the owners.
Private task context compaction is covered by `private-worker-context.md`; publication retains its existing owners.

## 2. Signatures

- `SubagentService.prepareInbox` supplies foreground intrinsic bindings and a lazy first nonempty claim at an actual
  safe model-preparation boundary. Idle handling claims eagerly through the existing Character background lane.
- `subagent_events` stores immutable accepted evidence. `subagent_inbox_consumers`, members and deliveries bind exact
  event membership to a real main Run/Attempt/model Effect; actions establish explicit per-event handling.
- `interact_parent({kind:'message'|'needs_input',text})` and `complete_subagent` require matching completed SDK results.
  Addressed input uses the existing exact target plus `replyToEventId` to resolve a specific question.
- `subagent.conversation` has newest/older/newer child-scoped cursors. Message/event presentation references retain real
  item IDs, while `batch.entrySeqs` names every visible conversation entry required for the completed-step handoff.
- `subagent.conversation.body` returns exact JSON in bounded character pages with a digest fence. A preview's
  `body.nextOffset=0` explicitly means full reconstruction begins at the first page, not after the displayed preview.
- `subagent.activity.read/subscribe/unsubscribe` serves one selected child per current operator connection.
- `subagent.inbox.recovery` exposes exact consumer IDs and reasons; `subagent.inbox.resume` accepts a stable explicit
  operation key and returns the original admission on repeat. These are operator controls, not automatic retries.

## 3. Contracts

### Acceptance, delivery and handling

- Store canonical child results/events, pointer release and conversation order references inside the existing Run
  terminal transaction. Interaction events join completed private message persistence in its transaction.
- `accepted` means persisted. `delivered` means the exact batch was included at an actual model Effect intent, not
  confirmed remote receipt. `handled` requires a durable disposition/action; ordinary model termination acknowledges none.
- Claims without any actual intent may be released. No timeout or restart returns delivered events to the automatic pool.
  FIFO claims contain at most eight events and a 16 KiB rendered envelope with bounded previews and explicit detail tools.
- An idle failure before any actual inbox intent defers that Character until a meaningful fresh opportunity: a newly
  accepted work/addressed input, eligible interaction/final event, successful primary terminal commit, or an explicit
  owner authority-change signal. Ordinary queue-release hints never clear that deferral. A fresh opportunity arriving
  during the failing capture is retained for the next capture. No timer or task-age policy is introduced.
- After actual inbox intent, the durable delivered membership fences that batch from automatic replay; a handler
  failure must not latch unrelated later eligible events. Only missing dispositions require explicit reconciliation.
- One main Attempt owns at most one immutable batch. Before the first nonempty claim, foreground preparation may try
  again at subsequent SDK request boundaries. After claiming, its members and projection identity do not change.
- `answered_child` commits addressed acceptance and its action/result receipt together. Repeated identical operation and
  action digest reads that receipt; conflicting repeats refuse. Speech disposition is separate from actual publication.

### Input dependency, Stop and recovery

- A question is a work dependency, not a successful task result or an open Run. Accept the exact answer transactionally;
  an answer arriving before terminal pointer release remains answered and is scheduled only after release.
- A user Stop latch blocks parent resumption and suppresses Stop-derived terminal notifications. Already accepted earlier
  events remain evidence. Explicit user continuation restores future reporting and never rewrites historical eligibility.
- Generic work defaults to `until_cancelled`; finite source-owned validity, individual request deadlines and unknown-effect
  reconciliation remain independent. Historical expired/cancelled executions never reopen.
- Restart restores only inert generic routing and settles orphan execution evidence. It does not restore executable source
  bindings, publication handles or run interrupted child actions automatically.
- Explicit inbox recovery captures fresh normal Run authority. Its new consumer/member/resume-key link participates in
  existing linked admission atomically; original intents/actions remain unchanged. An old target with a successor refuses.
  Unknown non-model Effects refuse; a busy Character lane changes no state. Prior accepted actions/results are supplied
  as evidence, with exact paged detail available, and only missing dispositions need execution.

### Private read/activity boundary

- Conversation order stores source references, never another transcript. Inputs render once; their model inclusion receipts
  remain canonical evidence. Accepted report events replace their matched report tool pair in the read projection.
- Legacy backfill order is explicitly historical. New source inserts establish actual commit order. Cross-child cursors and
  wrong-character reads refuse; missing source or changed body digest is an error, never an empty successful history.
- Activity comes from actual SDK/invocation observations. Private activity uses a separate producer/projection from main/Pet.
  Durable references map the same item IDs to original native parts. Clients retire live items only after loading the whole
  referenced batch, not merely after seeing `coveredThroughStep` or the first row.
- Actual SDK completed-step persistence can precede public finish-step item mapping. While that Run is active, continuous
  conversation reads withhold unmapped output/interaction rows; raw history/event APIs still expose canonical evidence.
  After mapping persists, emit the existing child changed invalidation immediately. Do not advertise a fallback native
  row alongside its still-live item during that gap. The actual-SDK conversation test must observe both boundaries.
- Closing/unsubscribing a view never stops work. Reconnect recovers reads and subscriptions; it never resends a mutation.
- T4 migrations 058/060/061/062 are forward-only. Preserve applied SQL, historical row/digest/receipt bytes, and sequence
  watermarks. Unknown schema attachments refuse atomically; migration itself emits no wake or model/tool execution.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Event transaction or deferred model Effect insertion fails | No event/delivery/input-consumption half-commit |
| Rendering succeeds but request never reaches intent | Event remains accepted; pre-intent claim may release |
| Delivered handler fails or naturally omits a disposition | Reconciliation remains visible; no fresh automatic handling |
| Explicit resume repeats after response loss/completion | Original Run/consumer receipt returned; no replay |
| Resume member/link/receipt insert fails | Fresh Run admission, consumer and membership all roll back |
| Host/tool Effect remains unknown | Explicit resume refuses, including on a stale predecessor target |
| Reply arrives before question Run releases its pointer | Preserve the answered request; later settlement cannot reopen it |
| User Stop or a parent tries clearing the user latch | No automatic main wake; parent continuation refuses |
| History page splits a native tool step | Full-batch references keep remaining pages reachable |
| Body changes or cursor belongs to another child | Explicit changed-body/scope refusal; no mismatched concatenation |
| Connection is copied, retired, unauthenticated or a Node | Refuse private reads/controls and stop private pushes |

## 5. Good / Base / Bad Cases

- Good: child asks, Runtime persists the question, the main handles it silently, an exact answer resumes the same work,
  and both the old request and action receipts remain readable across a later explicit continuation.
- Base: an unstructured child stop retains real output and an interruption event; it is not called task success.
- Bad: clear an inbox on model termination, resume unknown tool work automatically, treat a speech proposal as sent,
  use task age to expire generic work, or clear all live activity on receipt of a single history row.

## 6. Tests Required

- Actual SDK + SQLite: `subagent-interactive.test.ts`, `subagent-completion.test.ts`, `subagent-materials.test.ts`,
  `subagent-inbox-recovery.test.ts`, `subagent-inbox-retry.test.ts`, `subagent-conversation.test.ts`, and the foreground mixed/lazy inbox tests.
- Atomicity/receipt/legacy/recovery: `subagent-inbox.test.ts`, `subagent-repo.test.ts`, `subagent-recovery.test.ts`,
  migrations `056-subagent-conversations.test.ts` and `058-agent-inbox.test.ts`.
- Authenticated method registration, exact conflicts, body/activity reads and unsubscribe cleanup:
  `server/methods/subagent-methods.test.ts`; Shared schema/typecheck and scoped/root lint remain required.
- These deterministic tests establish their exercised Runtime/SDK/SQLite/WS contracts. They do not establish native
  WebView2 usability, paid provider behavior, human acceptance, native Hindsight or T4/main migration convergence.

## 7. Wrong vs Correct

Wrong: after a delivery timeout, delete the claim and call the model again with fresh event IDs.

Correct: retain the actual intent and missing disposition, expose the exact recovery target, and require an explicit
operation-keyed successor admission that carries historical receipts without recreating source/publication authority.
