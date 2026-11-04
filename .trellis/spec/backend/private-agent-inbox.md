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
- The model-facing handler is `handle_agent_event({eventId,intent,text,target})`, where intent is
  `record | ask_user | reply | answer_child | continue_child`. The first three require `target=null`;
  child actions require the complete exact target. Core derives operation identity and the addressed
  question/check-in event; models do not supply an operation key or a nested internal action.
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
- A useful unstructured worker response is provisional evidence, not accepted delegated completion. Idle state and no
  pending question do not change this. Parent instructions distinguish normal unstructured output from failure/cancellation;
  when the original report is still required, reuse existing analysis and continue the same work for its normal final
  submission. Explicit interrupted-work continuation with no pending request uses the exact current target,
  `continue=true` and `replyToEventId=null`. This is a model-selected existing action, not a new Runtime retry loop.
  User Stop, unknown Effects, permission/source refusals and explicit abandonment remain separate facts and barriers.
- Claims without any actual intent may be released. No timeout or restart returns delivered events to the automatic pool.
  FIFO claims contain at most eight events and a 16 KiB rendered envelope with bounded previews and explicit detail tools.
- Foreground/idle guidance separates a completed reply/handler from completion of the original task. Handle available
  events and end when only other notified results remain pending; later events resume work without a new user message.
  Retained earlier evidence can be inspected when needed for integration. Deliver the integrated answer when the
  requested results are sufficient, using foreground text or the existing idle `speech_proposed` publication path.
  Dynamic guidance does not rewrite an existing claim's frozen instructions, membership or projection digest.
- An idle batch contains newly delivered events, not earlier handlers' reports/dispositions. When integration requires
  a worker report absent from current context, inspect that worker's retained results once before concluding it is
  pending. A report missing from this batch is not evidence it has not arrived. No extra persistent coordinator or
  automatic history copy is needed; the existing scoped inspection supplies the missing evidence.
- A proven pre-intent idle failure retries on one bounded timer (1s, 5s, 15s), as well as fresh accepted work/input,
  eligible events and successful primary completion. Ordinary queue-release hints do not clear deferral. Fresh
  opportunities during capture are retained. Exhaustion is persisted and shown in `subagent.attention`; an explicit
  `subagent.inbox.retry` offers fresh authority capture without releasing/replaying any delivered batch. Close clears timers.
- Idle handlers structurally exclude `delegate_subagent` from executable and disclosed tools. Existing child
  inspection/answer/Stop and exact check-in continuation remain available. Actual model instructions disclose this boundary.
- `needs_user_input` attention persists beyond a handled disposition until trusted user guidance to the exact work/request.
  Reconciliation and exhausted pre-intent retries have separate actionable attention entries, visible through Home reads
  and existing child invalidations. Runtime status does not publish Companion speech.
- After actual inbox intent, the durable delivered membership fences that batch from automatic replay; a handler
  failure must not latch unrelated later eligible events. Failed or naturally omitted dispositions require explicit
  reconciliation. The narrow successful foreground-yield continuation below preserves the existing delivered batch.
- A live idle handler may automatically continue the same batch after a proven cooperative foreground yield: the actual
  recorded safe tool boundary caused the stop, the stream drained and Run settled successfully, every Effect completed,
  and actual non-model operations were only `core.subagent.read`, with no accepted event actions. Finite step caps win
  before yield certification. A flag observed only at final settlement, unknown outcome, mutation, natural stop, recording
  failure or cancellation cannot authorize this path.
- The process-local certificate schedules existing linked resume only when the lane is free, with a stable operation key
  and fresh normal authority. Preserve old deliveries/actions and successor CAS; never release events to the fresh pool.
  Capture failures consume the opportunity. Only a proven new foreground reservation with atomic zero-admission rollback
  defers the same certificate until a fresh lane opportunity. No timer retry or restart reconstruction is introduced.
  Shutdown discards certificates; unresolved durable consumers remain explicitly recoverable.
- A successor sees the latest public conversation. If the foreground already supplied the requested result it can retain
  the event; unrelated foreground chat does not suppress an outstanding answer. Existing publication authority remains
  mandatory. This establishes exactly-once accepted dispositions, not deterministic semantic deduplication of public prose.
- One main Attempt owns at most one immutable batch. Before the first nonempty claim, foreground preparation may try
  again at subsequent SDK request boundaries. After claiming, its members and projection identity do not change.
- `answered_child` commits addressed acceptance and its action/result receipt together. Repeated identical operation and
  action digest reads that receipt; conflicting repeats refuse. Speech disposition is separate from actual publication.

### Model interface and historical compatibility

- Normalize `record`, `ask_user`, and `reply` into `retained`, `needs_user_input`, and `speech_proposed`.
  `answer_child` and `continue_child` retain the existing private atomic action owners and exact controls.
  Derive an answer's `replyToEventId` from the selected immutable event: its ID for `needs_input`, null
  for a nonblocking message/report. Private responses to ordinary progress messages remain supported;
  do not reinterpret every answer as resolving a question. Check-in continuation still addresses its exact event.
  Keep all six internal action variants and operator recovery schemas; the five-intent model interface
  does not rewrite historical `no_action` records or make `record` an alias for them.
- `record` is an explicit handled disposition, not a timer, a retry or an instruction to re-deliver the
  event later. `ask_user` requests operator attention; it does not by itself publish Companion speech.
  `reply` carries the complete intended answer; foreground still requires actual primary text and idle
  publication still uses the existing trusted report adapter.
- Inside the existing action transaction, validate the real invocation and delivered membership before
  reading an earlier receipt. Equivalent normalized actions reuse the original operation key, result and
  consumer Run, including historical arbitrary keys and explicit successor consumers. Changed actions
  refuse. The original consumer/key pair must also address any repeated publication staging.
- Keep ordinary `send_subagent_message` available for guidance, interrupted work and inspected/silent
  work. Delivered-event responses use the private handler. The two scopes intentionally retain separate
  registered tool names because foreground activity and persistence classify private tools by trusted
  registration; do not replace this with model-authored privacy flags or hide all ordinary sends.
- Current descriptions and prefixes explain the model vocabulary. Stored claim text, action JSON,
  digests, raw body pages and receipts remain byte-identical. No migration, additional coordinator,
  automatic acknowledgement on model exit, or end-of-turn tool is part of this interface change.

### Input dependency, Stop and recovery

- A question is a work dependency, not a successful task result or an open Run. Accept the exact answer transactionally;
  an answer arriving before terminal pointer release remains answered and is scheduled only after release.
- Check-in input waits and per-work progress follow [Private worker check-ins](private-worker-checkin.md).
- Ordinary model messages resolve active/latest work only when work is omitted; an explicit work never silently changes.
  Run/control drift alone does not reject ordinary messages. Stop, Continue and exact-question answers stay versioned.
  Model inspection/result pages retain useful evidence while omitting canonical digests/internal receipts. Refusals carry
  current scoped state, exact current target and next valid action; wrong-Character refusals expose no child details.
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

- Compact model views do not alter raw action results, canonical events or body pages. Future teasers may omit the
  work ID duplicated by detailed exact targets; never rewrite stored claim instructions/digests. Foreground guidance
  is a current role prefix around frozen claim text. Foreground replies require committed primary text; idle handling
  keeps the private `speech_proposed` publication contract. Event handling alone does not deliver an answer.
- New claim guidance permits direct use of complete accepted report previews. Interrupted-work recovery guidance
  is included only when the batch contains an interrupted event and is explicitly scoped to that event kind.
  Original stored claims/digests are never rewritten to update these instructions.

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
| Equivalent normalized action uses another tool call or historical operation key | Return the original receipt without another input, counter increment or publication |
| A handled event receives a different action, including old no_action versus new record | Explicit conflict; retain original action bytes |
| A successor retries a historical speech action | Preserve original consumer/key publication join; do not stage under the successor identity |

## 5. Good / Base / Bad Cases

- Good: child asks, Runtime persists the question, the main handles it silently, an exact answer resumes the same work,
  and both the old request and action receipts remain readable across a later explicit continuation.
- Good: a model repeats the same flat event intent after an uncertain response and receives the original
  action receipt, while a different intent is refused instead of silently replacing history.
- Base: an unstructured child stop retains real output and an interruption event; it is not called task success.
- Bad: clear an inbox on model termination, resume unknown tool work automatically, treat a speech proposal as sent,
  use task age to expire generic work, or clear all live activity on receipt of a single history row.

## 6. Tests Required

- Actual SDK + SQLite: `subagent-interactive.test.ts`, `subagent-completion.test.ts`, `subagent-materials.test.ts`,
  `subagent-inbox-recovery.test.ts`, `subagent-inbox-retry.test.ts`, `subagent-conversation.test.ts`, and the foreground mixed/lazy inbox tests.
- Atomicity/receipt/legacy/recovery: `subagent-inbox.test.ts`, `subagent-repo.test.ts`, `subagent-recovery.test.ts`,
  migrations `056-subagent-conversations.test.ts` and `058-agent-inbox.test.ts`.
- Flat model schema and actual governed SDK action flow: `subagent-inbox-schema.test.ts`,
  `subagent-inbox-interface.test.ts`; legacy-key successor publication: `direct-request-inbox.test.ts`.
  Assert complete rollback, changed-call-ID retries, old no_action conflict, user Stop and exactly-once
  check-in accounting. Keep mixed public/private/Memory tests when adjusting model input shapes.
- Authenticated method registration, exact conflicts, body/activity reads and unsubscribe cleanup:
  `server/methods/subagent-methods.test.ts`; Shared schema/typecheck and scoped/root lint remain required.
- These deterministic tests establish their exercised Runtime/SDK/SQLite/WS contracts. They do not establish native
  WebView2 usability, paid provider behavior, human acceptance, native Hindsight or T4/main migration convergence.

## 7. Wrong vs Correct

Wrong: after a delivery timeout, delete the claim and call the model again with fresh event IDs.

Correct: retain the actual intent and missing disposition, expose the exact recovery target, and require an explicit
operation-keyed successor admission that carries historical receipts without recreating source/publication authority.

Wrong: expose internal action JSON and a new model-generated operation key on every retry, or rename a
private event answer to an ordinary public tool without preserving the storage/activity boundary.

Correct: expose the flat event intent, derive/reuse identity transactionally, and leave private responses
under their existing registered private tool. A model input shape is not the persistent action schema.
