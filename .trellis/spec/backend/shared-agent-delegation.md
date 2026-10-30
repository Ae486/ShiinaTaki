# Shared Agent delegation

Use this contract for `SubagentService`, private child context, event handling, child conversation RPCs,
and the original-request report adapter. Source rendering and Co-Watching publication keep their existing owners.
Detailed current contracts: [Private Agent Inbox](private-agent-inbox.md),
[Private Worker Context](private-worker-context.md), and [Accepted Work Lifecycle](accepted-work-lifecycle.md).

## Identity, storage and execution

- A Subagent Conversation is reusable private work context. It is not a Character relationship Timeline or Memory.
  Every execution has a new Run/Attempt and a newly captured authority/tool/Memory snapshot. Terminal Runs never reopen.
- `subagent_conversations`, `subagent_inputs`, `run_messages`, and `subagent_executions` are the durable owners.
  Install `executions.linkedState` into `RunRepo` before admission and recovery. Admission and canonical terminal
  participation commit child linkage/results/pointer changes with Run/Attempt/Receipt/events, or roll back together.
- Address inputs with `subagentId`, `workInputId`, `expectedControlVersion`, and optional `expectedRunId`.
  Explicit `expectedRunId: null` means the displayed child was idle. Omission remains compatible with existing callers.
  Global `inputSeq` is display order; only that work's `workSeq` determines its result/currentness. Unrelated B cannot supersede A.
- Child lanes use `subagent:<id>` in the existing TurnQueue/TurnRegistry. Do not pass these keys to Character callbacks.
  Children never inherit the parent's AbortSignal. Parent stop changes neither child lifetime nor captured completion policy.
- User stop writes a durable child latch. Parent continuation cannot clear it. Parent-origin interruption can be explicitly
  continued by the parent. Trusted owner yield cancels/quiesces the exact Run without setting either latch.
- Generic work has `{ kind: "until_cancelled" }` validity. Elapsed time, including historical generic deadlines, cannot
  prevent explicit continuation. Finite feature-owned work retains `{ kind: "expires_at", expiresAt }` and its genuine
  source WorkCurrentness. Validate that distinction before the exact control/quiescence/origin transaction; a source or
  authority refusal preserves the latch, control version, accepted-input count and execution count. Historical terminal
  Runs, deadline bytes and receipts remain unchanged; migration never resumes work or replays an Effect.
- Process-local active slots, callbacks, timer handles, notifications and bindings are disposable. Durable rows remain truth.
  Do not retry a failed authority capture on the same work's own queue-release notification. `released()` hints scheduling;
  `authorityChanged()` retries a previously refused capture after an actual authority/source change. Addressed input or explicit
  owner resumption clears only that work's deferral.

## Private context and actual model input

- `WorkContext` supplies the same ChatAgent/ToolLoopAgent with fresh or selected initial context, bounded private replay,
  and explicitly addressed same-work inputs. Parent conversation after creation is never automatically mirrored.
- `prepareStep` alone does not consume input. The model Effect's intent transaction records its exact Run/Attempt/Effect,
  step and exact raw input IDs. First receipts remain immutable; repeated actual intents retain separate receipt evidence.
  Summary coverage has a separate witness and never creates another raw-input receipt. Every pending input through the
  captured watermark must fit the actual request or fail explicitly without consumption.
- Only child scope removes fixed step limits. Pressure rollover keeps the same Run/Attempt, monotonic step identity,
  cancellation and captured tools. Commit complete raw rounds and summary/source/owner CAS before releasing retained
  SDK/material/recording references. Summarization uses the existing governed Utility Slot, never relationship Memory.
  Mandatory `read_self_history` retrieval remains available even with no inherited external tools.
- Record completed native assistant/tool messages before the next request. Stage only uncovered partial text for canonical
  terminal settlement. Preserve complete tagged tool results, errors, cancellation and unknown states; never reduce an
  inspect result to bare text or claim missing/failed work was an empty successful result.
- Actual completed tool results may carry producer-owned non-serialized source metadata. `read_file` identifies the
  confined Workspace path after successful reading. Tool text is never parsed as program-known speaker/user attribution.
  Unknown producers remain unknown. Selecting a MaterialRef copies only its retained material and its available source facts.
- `delegate_subagent` and `send_subagent_message` accept selected MaterialRef arrays. A current primary execution may select
  its actual completed tool output; durable child input/tool/result references are scope checked against the Character and
  child records. Current primary ephemeral references are not reconstructed after process loss.

## Executable tools and Memory

- Tool selection is an immutable executable lookup, not prompt wording or `activeTools` disclosure. An allow list narrows
  the trusted parent's available names; inherited exclusions remove names. Empty external selection stays empty; intrinsic
  task reporting, input-request and self-history capabilities remain independently owned by the Runtime.
- Child work removes Memory mutations using existing canonical operation/capability metadata, including aliases. It can
  retrieve Memory and propose changes as result data. Private transcripts do not enter automatic Memory ingestion.
- Snapshot capture records the exact fixed-excluded names as process-local `memoryToolExclusions` before removing their
  executable closures. Later allow-list validation checks real parent membership and recognizes these captured fixed
  exclusions, then applies the exclusion again. A mixed allow-list containing legitimate parent mutation names must still
  execute its permitted reads; the projection must not misclassify already-removed writes as unknown tools. Unknown names
  remain refused. This metadata never changes the provider capability snapshot or its digest.
- The main-Companion continuation has a separate trusted `parent-continuation` scope. The shared `subagent` initiator alone
  does not classify Memory authority. Main continuation retains its normally permitted Memory mutations.
- Do not rewrite provider capability flags, capability digests, permission policy or captured provider identity to implement
  child restrictions. Existing Core/MCP/Host governance still authorizes every remaining executable operation.
- Forward the final selected membership through actual tool options to `extension_call`; resolve the captured MCP direct
  name or declared Skill/Host alias before dispatch. Excluded aliases cannot reach the old captured closure indirectly.
  A target without a mapped selected executable alias is unavailable in the restricted work context. Never silently fall back
  to another Host or discover a fresh closure behind the captured Run.

## Results, inference and publication

- Every canonical child terminal outcome retains an inspectable result, including failed/cancelled/deadline/unknown/no-output.
  A typed `SubagentValidationError(proposal)` may retain a domain failure explanation; it never changes terminal failure to success.
- `record_only` creates no automatic parent inference. Interactive `request_parent` work accepts immutable message,
  input-request, final and interruption events. A natural model stop without a validated final report remains partial.
  User Stop suppresses Stop-derived automatic events; explicit reads still show it and explicit user continuation restores
  subsequent normal reporting. Parent input alone never clears the user latch.
- Foreground and idle handlers share durable claims. Only actual model Effect intent marks delivery; explicit committed
  per-event actions mark handling. No-action, retaining evidence, answering the child and proposing speech are distinct.
  Pre-intent claims can be released; delivered events never return to automatic fresh handling after failure or restart.
- Idle admission uses the existing Character background lane and yields cooperatively to foreground reservation. Empty
  relationship history still receives an explicit private Core control input. Private handler text is internal evidence;
  inference itself never publishes a Timeline utterance. Eligible legacy outbox rows bridge once by stable identity.
- Mixed primary steps partition registered private tool call/result pairs before both activity and persistence. Public
  text and ordinary tools keep their order/identity and complete current SDK history remains intact. Supplied-event source
  sidecars attach only to public assistant rows; the user row is unchanged. Private actions remain in Run/inbox evidence,
  outside main/Pet activity, relationship replay, exposure targets and both Memory primary-source witness paths.
- `speech_proposed` is not speech. Foreground fulfillment needs an actual committed primary text witness; idle publication
  needs the existing live trusted reply adapter. A model-written class/root/acceptance grants nothing. Retained/no-action
  handling does not consume the independent original-request final-answer right.
- `DirectRequestReports.capturePrimary` receives the actual primary tool binding and committed user row, captures its exact
  witness and explicit finite/until-cancelled validity, then creates an independently held accepted report root under existing Class A authority.
  Once independent acceptance commits, the primary turn's cancellation/retract guard must preserve that original request.
- `stageReply` retains legacy result support; `stageEventReply` joins the exact canonical delivered event/consumer/action.
  Both use a stable candidate and the existing PreparedPublication/Delivery owners. Candidate freshness starts at the
  durable proposal time, not delayed first staging. Release the parent lane before the publisher acquires it.
  Keep the report root alive through staged/held delivery and close only on actual final outcome or genuine cancellation/expiry.
  A repeated already-recorded reply is an idempotent read, including after the root closes.

## Restart, API and verification

- The existing RecoveryCoordinator classifies linked child/parent executions before general last-Effect repair.
  A completed last model Effect cannot prove a complete child result or parent decision. Unfinished dispatched Effects stay
  unknown; they are not replayed automatically. Linked terminal recovery preserves original evidence and releases the exact child pointer.
- A generic explicit user continuation may capture fresh authority and admit a new Run. Unknown non-model effects refuse
  continuation pending reconciliation. A lost trusted domain/source binding refuses generic reconstruction. A serialized
  acceptance/result/token cannot recreate the accepted publication handle after restart.
- Public list/history/conversation/body/activity/result/send/stop/continue/inbox-recovery methods require the actual current authenticated operator connection.
  Node, unauthenticated, copied and retired connections are rejected. Pushes contain only child/Character IDs and revisions.
  Clients refetch durable truth; mutations are never replayed after unknown outcome or reconnect.
- Targeted evidence: `chat-agent-inbox-memory.test.ts`, `chat-agent-inbox.test.ts`, `subagent-inbox.test.ts`,
  `chat-agent-worker-context.test.ts`, `chat-agent-worker-retention.test.ts`,
  `subagent-service.test.ts`, `subagent-completion.test.ts`, `subagent-recovery.test.ts`,
  `subagent-materials.test.ts`, `delegation-tools.test.ts`, `direct-request-report.test.ts`, and `subagent-methods.test.ts`.
  These use actual SDK execution and SQLite where relevant. Test data and scripted providers do not establish live semantics
  or manual usability. Production-main/WS and real-model acceptance remain separately labelled evidence.
- Run Core/Shared typechecks, scoped/root lint as appropriate, relevant runtime/SDK/governance/recovery tests, and the
  production-main/WS integration gate. The coordinator owns the final whole-worktree gate while other slices are editing.
