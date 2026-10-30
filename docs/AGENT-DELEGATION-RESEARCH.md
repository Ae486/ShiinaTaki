# Agent Delegation Research

Recorded: 2026-10-21. Historical research status: G1-G4b agreed, G4c accepted in principle; question-led grill concluded in favor of package-first technical mapping. This is not the current implementation specification or acceptance report.

Current delivery (2026-10-23): the [before-human acceptance report](../.trellis/tasks/10-21-agent-context-acceptance/research/acceptance-before-human-20261023.md) integrates SDK, shared Runtime delegation, Source and Desktop results, final checks and remaining limitations. Human acceptance, formal native Hindsight behavior and T4/main migration convergence remain separate gates.

## Companion-first follow-up design (2026-10-24)

Recorded from discussion session `01a16d1d-191d-7070-a7e5-3181605428e8`, continuing assessment session `01a16d03-f622-7c11-8fde-1e1f2b5aeadb`. The owner initially declined a new Trellis task, then explicitly authorized creating or continuing a task for planning research and determining the change direction. The [October 25 follow-up task](../.trellis/tasks/10-25-agent-delegation-conversations/prd.md) records that superseding authorization; [context recovery](../.trellis/tasks/10-25-agent-delegation-conversations/research/context-recovery.md) identifies the source messages. The owner subsequently authorized implementation on October 25; the linked PRD and implementation checkpoint own current authority/progress. This section owns the follow-up product direction; the dated research below and the October 23 acceptance report retain their historical evidence boundaries. No runtime fix or human acceptance is claimed here.

### Owner-confirmed direction

- The main Agent is the Companion. It should keep interacting naturally with the user while delegated workers operate independently. Explicit main-agent waiting and repeated status polling are not the normal interaction model; the earlier assistant suggestion of a routine wait/yield tool is not the chosen default.
- The main conversation remains the child's primary interaction/reporting counterpart throughout its lifetime. Direct user interruption, correction or continuation does not transfer that relationship or permanently redirect child reports to the user. The main Agent may proactively inspect a child's working, completed, interrupted or other truthful state; avoiding routine polling does not prohibit useful status queries.
- Children proactively report final results, requests for further interaction/input, unexpected external interruption, and failure. Core accepts these through a persistent queue while foreground chat continues, then supplies them to the main Agent at an appropriate boundary without immediately preempting the user's exchange or silently losing the event.
- Receiving a child event, reasoning about it, and speaking to the user remain distinct. The main Agent can answer the child, retain its result, continue delegation, or communicate an appropriate update; every child event is not automatically a new user-facing utterance.
- Delegation tool responses should be useful to the model and readable to the user. Internal identifiers and bookkeeping must not dominate either surface. Required operational references and truthful outcomes still survive.
- The child page should be a version of the existing chat interface: a continuous conversation, familiar composer and message/tool presentation, and child-specific navigation and controls. Reuse shared components rather than maintain a copied chat implementation.
- Direct user interaction with a child is first-class. Preserve the distinction between input from the user, direction from the main Agent, and system events in both the model context and the UI. Users can interrupt and continue interacting with a child as a normal conversation, without treating it as a read-only execution log.
- Children are task workers, closer to coding/research agents than to a second role-playing Companion. Their compaction should be simple: at a context-pressure threshold, summarize older context and keep recent complete action rounds. Reuse mature agent patterns and suitable existing primitives; do not inherit companionship-specific summary requirements.
- Do not impose a fixed number of child conversation turns or internal action/tool-loop steps. Work can continue across as many rounds as needed, using compaction for context pressure and explicit result/interaction/control semantics for execution boundaries. This does not change the main conversation's policy by implication.
- The owner explicitly removed the delegated task's validity period in the focused grill. A child task does not expire because time passes, an answer arrives on another day, or its notification waits behind foreground chat. Remove the task-lifetime requirement, not merely increase its maximum or make the old limit a hidden default.
- Prefer existing SDK/package capabilities and project owners. Add a dependency or abstraction only for a demonstrated gap; this direction does not select a new agent framework, message broker, or persistent runtime.

### Verified baseline and concrete gaps

The following are source findings on the current T4 dirty worktree, supplemented only where the evidence column says so. They are not a fresh end-to-end acceptance campaign.

| Concern | Evidence and boundary |
| --- | --- |
| Real Agent execution | Children use the shared `ChatAgent` / `ToolLoopAgent`, with private context, independent execution lanes, scoped tools and existing Run/Attempt/Effect governance. Lack of recursive delegation does not invalidate this architecture. |
| Child history retrieval | [`run-message-store.ts`](../packages/core/src/agents/run-message-store.ts) tells a child with omitted history to use `inspect_subagent`, but [`subagent-execution.ts`](../packages/core/src/harness/subagent-execution.ts) supplies only its result collector as work-specific tools. The inspector exists for the main Agent; it is not wired into the child's own tool set. The preceding assessment retained a deterministic reproduction; this continuation rechecked the source. |
| Inspector pagination | [`subagent-inspect-tool.ts`](../packages/core/src/agents/subagent-inspect-tool.ts) forwards the message cursor, hardcodes `inputAfterSeq: 0`, and exposes neither the completion-page nor worker-list cursor. [`subagent-queries.ts`](../packages/core/src/harness/subagent-queries.ts) returns all those cursor families. Message paging can repeat the first input/result pages; listing cannot advance through the model tool. |
| Return payloads | [`subagent-delegate-tool.ts`](../packages/core/src/agents/subagent-delegate-tool.ts) returns the service's full conversation/input acknowledgement. An [October 23 synthetic real-model request](../.trellis/tasks/10-21-agent-context-acceptance/research/live-r1-r3-20261023-100158/r1-selected-addressed-reuse-P1IjW5/request-5.json) contains a 1,150-character acknowledgement with six UUID occurrences, echoed task text, request digest and operation key. These counts describe retained evidence, not a new live run. |
| Existing completion queue | [`subagent-completion.ts`](../packages/core/src/harness/subagent-completion.ts) already consumes durable terminal-result notifications, defers while the Character foreground lane is busy, and admits a separately captured parent Run idempotently. This is a reuse base, not proof of a general child-event inbox, batched handling, or guaranteed replay after every failure. |
| Current child compaction | Child replay uses a bounded private-message window with `summaryTokens: 0`. Shared request reduction can reduce an outgoing request, but does not supply a private rolling summary. The existing [`compaction-coordinator.ts`](../packages/core/src/agents/compaction-coordinator.ts) operates on the relationship Timeline and includes a pre-summary Memory flush. |
| Existing child UI | [`subagent-detail.tsx`](../apps/desktop/src/features/subagents/subagent-detail.tsx) already reuses individual Chat messages, but separates control forms, input records, transcript and results. [`tool-result-display.ts`](../apps/desktop/src/windows/home/pages/chat/tool-result-display.ts) has no delegation formatter; expanded canonical details use generic JSON. The owner's usability complaint is not resolved by this partial component reuse. |
| Sender identity | [`subagent-methods.ts`](../packages/core/src/server/methods/subagent-methods.ts) binds authenticated direct input to `user`; [`subagent-message-tool.ts`](../packages/core/src/agents/subagent-message-tool.ts) binds main-Agent input to `parent`. The private input renderer tells the model which sender originated it, and the current input panel labels user/main/system separately. The redesigned continuous transcript must retain this distinction. |
| Stop versus permanent closure | The current conversation schema/repository and RPC methods support retained conversations, Stop and Continue, but no per-child permanent `closed` state or close operation. `SubagentService.close()` shuts down the service; it is not permanent closure of one conversation. A terminal Run, a completed report, and work expiry likewise do not close the private conversation. |
| Existing step limit | [`chat-agent.ts`](../packages/core/src/agents/chat-agent.ts) applies the same `isStepCount(maxSteps)` to child work. The configured Core default is 10, with a 1-50 configuration range; these are source defaults, not a measurement of the running process. Installed AI SDK `7.0.148` has its own fallback of 20 when `stopWhen` is omitted, and supplies `isLoopFinished()` for natural termination without a count cap. Its bundled API docs and source were inspected; no behavior change or runtime test is claimed. |
| Existing task expiry, to remove | [`subagent-tool-schema.ts`](../packages/shared/src/subagent-tool-schema.ts) currently requires `lifetimeMinutes` between 5 and 720. [`subagent-input-repo.ts`](../packages/core/src/db/subagent-input-repo.ts) keeps the original `workExpiresAt` across follow-ups and refuses expired continuation; the service skips expired pending work. This implementation contradicts the newly settled no-task-expiry direction and has not yet been changed. |

### Notification and interaction design

The behavioral requirements above are settled direction. The following is the recommended mapping, with API and storage details still open:

The owner prefers system instructions for the child's main-conversation relationship and interaction conventions. Use prompts to guide its normal reporting counterpart, useful proactive interaction, and the main Agent's judgment about when to inspect a child; do not turn these choices into a bespoke polling or dialogue state machine. The recommended technical boundary keeps trusted sender attribution, persistent event delivery, user-stop enforcement and suppression of automatic user-stop notifications in Runtime: these facts must remain correct even when no child model request is running.

1. Represent a final report and a request for input/interaction explicitly. These can be tool actions or typed report fields; do not infer control flow from words such as "finished" inside arbitrary report text. Reuse `complete_subagent` for final reporting where appropriate. Runtime failure/interruption facts come from canonical execution outcomes, not from a model claiming that the transport succeeded or failed.
2. Treat the child's report as the primary account of task progress and findings. It should state useful results, evidence/references and outstanding work. A generic task does not require an invented domain validator or mandatory second-model review. The main Agent still decides whether the result satisfies the original request and whether further verification is warranted. Existing `validated` means structurally accepted/current submission, not proven semantic correctness.
3. Persist an accepted event before signalling consumers. Distinguish queue acceptance, actual model-input delivery, and handling disposition. Mere rendering, subscription delivery, or building a prompt must not claim that the model consumed or handled the event. Preserve duplicates, failure, unknown and superseded outcomes truthfully through deduplication/disposition records; do not expire a notification just because its child task or queue entry has aged, and do not claim exactly-once external model execution.
4. Foreground user interaction has priority. Do not abort an active reply to process a child event. A completed foreground turn is the initial safe scheduling boundary. Bounded delivery into a subsequent ordinary request is a candidate for continuous-chat fairness; background handling when idle is another. Their exact choice, delivery receipts and batching must be reconciled with the existing single-lane and publication owners before implementation. Do not allow indefinite invisible backlog or a burst of one model call/user interruption per queued event.
5. Deliver events as attributed internal work evidence, with the latest applicable main-conversation context. They are not new user messages, user approval, automatic relationship Timeline entries, or automatic Memory ingestion. Recheck work/source validity and publication authority when handling them.
6. For interaction that requires an answer, retain the question and pause progress on that work. The recommended mapping ends the current child execution and later starts a new Run in the same private conversation. Whether an informational interaction continues immediately must be explicit; ordinary progress need not always request a new main-model execution.
7. Preserve independent parent/child cancellation and the explicit user-stop latch. Unexpected failure, an individual operation timeout, unknown outcome and unavailable execution capability may need attention. Task age is not a failure or automatic stop condition. A direct user Stop records the real interrupted state but does not proactively notify or wake the main conversation, including through a generic cancellation/failure notification caused by that Stop. State remains available to UI reads and explicit main-Agent inspection. Trusted owner yield also remains distinguishable from unexplained failure.

Compatibility to resolve: Companion-created work should normally notify the main Agent. Existing `record_only` feature-owned/prepared-result work intentionally creates no completion-triggered parent inference. Do not silently redefine it or make all notifications speak. Exact defaults, any separate attention-event policy and backward compatibility remain implementation-design questions, not a reason to discard the owner's asynchronous notification requirement.

The current Character lane is held throughout a primary model stream. A long-running tool that waits for a parent continuation/publication needing that same lane would self-block. Reading a child result in that old parent Run while also leaving its completion outbox active can duplicate processing. Extend the existing scheduling/notification boundary instead of adding a second uncoordinated waiter.

### Messaging and waiting reference check (2026-10-24)

The focused grill asked whether every child `interact` should block for a reply. The owner requested mature implementation evidence before selecting that behavior. The following official pages were retrieved and read; they describe different surfaces and must not be collapsed into one vendor-neutral API:

| Surface | Documented behavior | Evidence boundary |
| --- | --- | --- |
| [Codex subagents](https://developers.openai.com/codex/subagents) | Orchestration covers follow-up instructions, waiting for results and result collection. | This product page does not specify the detailed send/wait wire contract of every Codex CLI release. |
| [OpenAI Responses Multi-agent](https://developers.openai.com/api/docs/guides/responses-multi-agent#how-multi-agent-works) | `send_message` queues a message without starting a turn; `followup_task` starts/resumes work on a non-root recipient; `wait_agent` waits for a mailbox update. A child's final response is delivered to its parent. | These are the hosted collaboration actions also exposed in this discussion environment, not proof that every Codex client has identical tools. Queue acceptance, recipient activation and sender waiting are distinct. |
| [Claude Code ordinary subagents](https://code.claude.com/docs/en/sub-agents#resume-subagents) and [tool reference](https://code.claude.com/docs/en/tools-reference) | `SendMessage` can resume a completed child in the background. An eligible child can message its launcher without redirecting that launcher's results. A user-stopped child does not auto-resume on an agent message. The documented child-to-child resumption case can require the sender to wait for the resumed child's result before finishing its own work. | Do not generalize that specific result dependency into "every message blocks for a reply" or claim a universal `waitForReply` parameter. |
| [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) | Messages are delivered automatically; the lead need not poll. Idle notifications include the final answer, and API-error termination reports failure. | This is the Teams surface, used as an asynchronous-delivery precedent rather than a reason to add Teams to Taki. |

The separate Claude cross-session `notify_when_idle` subscription explicitly excludes subagents/teammates; it is not evidence for their wait contract and its subscription timeout is not a Taki task-expiry requirement.

Assistant recommendation, not an additional owner ruling: keep ordinary child-to-main messaging asynchronous. If the child needs a decision before it can proceed, let it explicitly express `needs_input` and suspend that work until addressed input arrives; progress messages can be sent while independent work continues. System instructions guide that judgment. Queue acceptance is not an answer, and task pause is not task completion. A dependency wait should suspend execution rather than hold a transport request or repeatedly ask the main Agent for an update. Exact tool packaging remains technical design work; the evidence does not require a blocking flag on every `interact` call. Taki's existing completion/inbox owner must still provide idle-main activation under its notification policy: a primitive that only queues a message does not provide that by itself.

### Direct conversation controls and closure boundary

Origin is assigned by the trusted entry point, not accepted as a model-written claim. Direct user corrections and Stop remain distinguishable from main-Agent direction; a parent message cannot impersonate the user or clear a user-stop latch. Show that origin on the actual conversation entries, and preserve it through replay and compaction rather than relying only on colors or an auxiliary input table.

Completion of one task returns the child to an available/idle state. Interrupting an execution preserves conversation history. For familiar chat interaction, the assistant recommends letting a deliberate new user send after Stop act as an explicit "send and continue" operation, with clear UI wording, instead of always requiring a separate Continue click. This is a proposed UX mapping to confirm in the detailed design; it must still be a user-origin continuation and must not let queued parent messages clear the latch.

The owner clarified that user interruption itself is silent to the main conversation. The user may interact privately with the stopped child and explicitly ask it to continue. Once continued, ordinary child-to-main interaction and reporting work normally under the applicable policy; the earlier user Stop does not create a lasting notification mute or switch the report recipient. User intervention also does not require mirroring every private user/child message into the main conversation. Main-Agent inspection may still reveal that the child is interrupted, working or completed even when no proactive Stop notification was sent.

The owner's permanent-closure requirement is conditional: **if** a formal close operation exists or is later introduced, it must be distinct from task completion, Stop, elapsed time, or closing the view. A closed conversation remains readable but refuses new user/main-Agent interaction and continuation with a specific visible reason; delayed or queued work cannot silently reopen it. Backend enforcement is required as well as a disabled/explained composer. Creating a new child is a separate explicit action. Permanent close is not currently implemented, and this conditional rule does not by itself select a new close/archive feature or decide which actors may close a child.

To remove the action-count cap, use the installed SDK's natural/collector-based stop conditions explicitly for child work; merely omitting `stopWhen` activates the SDK fallback cap. Reuse `isLoopFinished()` where appropriate and existing committed report/interaction collectors, rather than adding a second agent loop or raising the cap to an arbitrary large number. A natural loop end without a validated final report still retains its truthful unstructured/partial result; no count limit does not mean an automatic infinite retry policy.

The delegated task has no validity period. Implementation must remove its required `lifetimeMinutes` / `workExpiresAt` policy from model/API contracts and reconcile the associated stored fields, execution timers, admission/currentness/continuation checks and completion handling. An old stored task deadline must not keep silently blocking that same work after the change. Preserve real historical outcomes when adapting existing data; do not automatically restart stopped/failed/unknown work or replay completed effects as a side effect of removing expiry.

Individual model/tool/network request timeouts, cancellation and independently scoped permission/source validity remain separate concerns. Their checks must not become a replacement hidden task deadline, and task continuity must not renew an expired permission automatically. An answer received after the old 12-hour maximum should continue the same task and private conversation, subject to the user's stop state and the actual permissions needed for its next action, without requiring a new task solely because of elapsed time.

### Model returns and human presentation

- Model acknowledgements: accepted/refused state, readable worker/task name, required exact operation target/reference, and whether later notification will occur. Sending an input is not proof it has been consumed; requesting Stop is not proof execution has already stopped.
- Model results: report body or a useful bounded summary, actual execution outcome, unresolved work, relevant source/material references, freshness, and the next operation/reference when needed. Query one requested category/page at a time where possible.
- Avoid routine copies of the complete input, task text, internal receipt/digest/idempotency fields, repeated identity chains and every history array. Keep full evidence in its existing durable owner and expose details on demand. Do not replace a real failure, omission or unknown result with an empty success.
- Keep necessary exact targeting and material references. Current controls require work identity and expected version/Run; a compact preassembled target can hide assembly complexity without weakening stale-target checks. A future opaque reference is an option, not a selected new identity system.
- User presentation: task name, useful progress, report, queued/needs-input/failure state and appropriate controls. Internal audit details belong in an optional diagnostic surface. UI formatting and model-output projection are separate changes; fixing only one leaves the other noisy.

### Minimal task-worker compaction

Owner direction in the latest message, supported by the assistant: use ordinary task-agent compaction, not the main Companion's relationship-memory pipeline. The intended model-facing shape is stable task/instructions plus a compact record of earlier work and recent complete action rounds.

The [Claude SDK agent-loop documentation](https://code.claude.com/docs/en/agent-sdk/agent-loop#automatic-compaction), retrieved on October 24, explicitly describes automatic summarization of older history near the context limit while keeping recent exchanges and key decisions. This supports the proposed simple behavior. The [Codex configuration reference](https://developers.openai.com/codex/config-reference) documents a history-compaction prompt override; it does not establish an identical recent-tail algorithm for this project's providers.

- Measure context pressure before a safe next model request, including the request's non-history cost. At the chosen threshold, summarize an older completed range, keep a bounded recent tail, and continue execution from the new projection. This must work within a long tool loop as well as on later reuse of a child.
- A retained "round" means a coherent action/observation unit, including matching tool calls/results, not an arbitrary number of database rows. Never compact away an unfinished tool interaction or replay completed tool effects to reconstruct context.
- Use a concise task-oriented summary: task and constraints, findings/decisions, changes already made, remaining work, and essential evidence or artifact references. No Character voice, relationship history, emotional-beat preservation, or new product-specific narrative requirements.
- Reuse suitable context measurement, message reduction, summarization and transcript/checkpoint primitives. Do not call the main Character compaction entry unchanged, flush private work into Memory, or require copying its full coordinator/lease/retry apparatus when the existing serialized worker execution already supplies the needed control.
- Keep the minimum summary coverage/checkpoint information needed by the existing private transcript and restart model. Exact storage shape, threshold and recent-tail policy are not frozen. A failed or non-useful summary must not discard the original context or be recorded as successful compression; use a bounded, explicit failure/degradation path.
- Preserve retained raw history under the existing policy and wire self-scoped retrieval. A summary is lossy; precise earlier evidence may still need a read. This is a small retrieval fallback, not a new memory service, semantic index, research agent or provenance framework. If tool selection excludes retrieval, the model must not be instructed to call an unavailable tool.
- Borrow the mature behavior, while verifying the selected SDK/provider's actual support. Claude's documented subagent auto-compaction and Codex's context-management behavior do not prove identical thresholds, tail algorithms, or a portable drop-in component. No OpenAI/Claude-only backend or extra paid acceptance campaign is selected by this discussion.

### Shared chat UI direction

Use the existing Chat page as the visual and interaction reference. Share the applicable conversation view, message/Markdown/tool presentation, composer shell, paging, scroll anchoring and new-content behavior. Adapt their data and actions to private child work; do not copy `chat.send`, relationship Timeline ownership, presence/Memory semantics or unsupported input capabilities blindly.

The child surface should have lightweight worker navigation and a header for name/state, a continuous chronologically meaningful conversation, and a bottom composer with send/Stop/Continue. Identify user input, main-Agent direction and child replies accurately. Integrate final reports and attention messages into that flow without repeatedly displaying the same text as input/transcript/result panels. Prefer real live activity from existing producers; do not simulate progress or treat a successful build as UI acceptance. Keep raw execution associations in optional details. Reuse existing controls' draft, reconnect, stale-target and user-stop behavior.

### Evidence references and remaining design work

Official pages inspected in this discussion: [Codex subagents](https://developers.openai.com/codex/subagents), [Claude subagents and auto-compaction](https://code.claude.com/docs/en/sub-agents), [Claude SDK subagent reports](https://code.claude.com/docs/en/agent-sdk/subagents), and [Claude queued interactive input](https://code.claude.com/docs/en/interactive-mode). The last describes user-input delivery at tool/turn boundaries; it is a scheduling precedent, not proof that Taki or every vendor implements the proposed durable child inbox. The installed Core dependencies read in this session include `ai@7.0.148`, `@ai-sdk/openai-compatible@3.0.75` and `@ai-sdk/mcp@2.0.81`.

Before implementation, resolve only the concrete remaining seams: event/receipt and compatibility mapping; bounded consumption/fairness and duplicate-handling behavior; final/interaction report API; minimal private compaction wiring and tail/threshold policy; usable history cursors; child-specific uncapped loop termination and removal of task expiry including existing-data compatibility; direct-user interruption/continuation UX; and shared Chat component/data adapters. Formal closure remains conditional, not an automatically added feature. Model routing, per-task cost controls, recursive delegation and a general task graph are optional later capabilities, not prerequisites silently added to this scope.

Acceptance should exercise foreground chat with concurrently arriving child events; queued-event restart and duplicate delivery; handling failure/unknown outcomes; input requests answered after the former task deadline and continuation of the same work; distinct user/main-Agent input; user Stop without a proactive main notification while explicit inspection still reports interruption; resumed child-to-main interaction without recipient reassignment; a child continuing beyond the old step caps and across compaction followed by exact-history retrieval; compact model-facing payloads; and the actual child chat UI including scroll/draft/reconnect behavior. If permanent closure is selected later, add direct/queued interaction rejection after close. This remains a future verification outline; the linked October 25 task owns the follow-up planning and later acceptance criteria. Prior automation, human acceptance, native Hindsight and main migration gates retain their separately recorded status.

## Historical research and planning (2026-10-21)

This continues session `01a15d67-80ea-7651-a251-6c7fa3d7962c`. The owner requested reusable delegation with creation, task assignment, interaction during execution, result collection, stopping and later continuation. The owner then requested recording the useful research before using `grill-with-docs` where decisions remain unresolved. At that discussion stage no new Trellis task or production implementation was authorized. The later planning continuation below supersedes the no-task boundary while retaining the implementation gate.

## Planning continuation (2026-10-21)

The owner authorized task organization and research, initially required a wait, and subsequently permitted development after global-rule optimization and preparation. Those entry conditions passed independent review. The [Agent delegation and source-aware context task](../.trellis/tasks/10-21-agent-delegation-source-context/prd.md) coordinates four children: SDK upgrade/baseline, delegation, source context/prompts and integrated acceptance. Its [design](../.trellis/tasks/10-21-agent-delegation-source-context/design.md), [execution plan](../.trellis/tasks/10-21-agent-delegation-source-context/implement.md) and linked acceptance report own the later implementation and verification state. The research below does not itself establish live-model acceptance.

New [SDK upgrade](../.trellis/tasks/10-21-agent-delegation-source-context/research/sdk-upgrade.md), [delegation runtime](../.trellis/tasks/10-21-agent-delegation-source-context/research/delegation-runtime.md) and [source/prompt](../.trellis/tasks/10-21-agent-delegation-source-context/research/source-context-prompts.md) reports extend the installed-7.0.17 evidence below. They verify the current package set and assess WorkflowAgent/HarnessAgent, including genuine experimental steering and adapter-specific source/documentation differences. The recommended next path retains shared ToolLoopAgent/Core ownership; it does not infer missing capability from the old installed API alone. Documentation, pinned source, narrow deterministic probes and unrun live/owner checks are explicitly separated.

## Established goal and existing constraints

- The main Agent retains the Companion's relationship and delegates focused work to children with fresh or inherited context. Both sides should understand the delegation relationship and the origin of returned material.
- Co-Watching preparation is one use case of a general mechanism. The Companion can express delegated work in its own Character voice while internally preserving who generated it and which material informed it.
- Full source content need not be preloaded into the main Agent. Relevant results should retain usable references so the Agent can read details when needed.
- [Agent Context Sources](AGENT-CONTEXT-SOURCES.md) owns the settled source-awareness requirements, including optional material-level descriptions, shared interpretation rules, and preservation through replay, compaction and memory consumers. This research does not reopen them or select a new source schema.
- [Architecture roadmap section 6.10](ARCHITECTURE-ROADMAP.md#610-subagents-tasks-and-lineage) already places delegated Child Runs on the same Runtime, with private child work, bounded results and linked evidence. It leaves one-shot/continuable contracts, context seeding, cancellation and resource limits to later design.
- [ADR 0003](adr/0003-ai-sdk-6-agent-engine.md) retains AI SDK 7 as the engine and Core as the authorization authority. An external framework's capabilities are evidence for reuse, not approval to replace that baseline.
- [ADR 0008](adr/0008-replay-view-context-seam.md) owns the Replay View seam. [ADR 0010](adr/0010-separate-autonomous-run-history-from-relationship-timeline.md) separates Run evidence from actual Companion speech and rejects a second session/history authority.

## Evidence and limits

Claude and AI SDK findings below came from their official documentation retrieved during this continuation on 2026-10-21. Direct HTTP reads returned 403; documentation retrieval tools supplied the official pages instead. Follow-ups additionally inspected the locally installed AI SDK `7.0.17` declarations and `ToolLoopAgent` source, plus the Taki entry points identified below. These are documentation and static-source findings, not runtime tests, inspected Claude runtime internals, or guarantees of arbitrary tool-effect recovery. Individual features have version requirements; implementation must verify the selected release.

The completed [Pi investigation](../codex-session-01a15db7-5a6d-7e72-a4ca-48ddbbfc616e.md) is reused as supplied. It inspected official source at commit `82432219af91c2342fc1b096e179e96df6ed8e7f` and release `v1.3.0`; it did not install or execute the examples. The concise Pi findings below are retained here so the integration argument does not depend solely on a session export.

The original request also named Codex and Hermes. This record adds no claim of a completed lifecycle/API comparison for those systems; earlier source-awareness or media precedents are not such a comparison.

## Claude Code Subagents

Official sources: [custom subagents](https://code.claude.com/docs/en/sub-agents), [resume](https://code.claude.com/docs/en/sub-agents#resume-subagents), [conversation forks](https://code.claude.com/docs/en/sub-agents#fork-the-current-conversation), and [SDK subagents](https://platform.claude.com/docs/en/agent-sdk/subagents).

| Concern | Documented behavior | Reusable distinction |
| --- | --- | --- |
| Creation and delegation | The model invokes `Agent`, choosing a definition/type and supplying a task prompt; instances may have names and IDs. | A reusable role definition is not an already-running or resumable instance. |
| Fresh context | A non-fork child starts without the parent's conversation or tool results, but has its own prompt, task and applicable environment/configuration. | Fresh does not mean without identity, rules or necessary task material. |
| Inherited context | A fork receives the parent's history, system prompt, tools and model at creation. Its private work remains separate and its result returns to the parent. | Snapshot inheritance is not a continuously shared transcript. |
| Interaction | `SendMessage` addresses an agent ID or name. Parent messages can supply mid-task direction. This does not require Agent Teams for ordinary messages. | Separate message addressing and task direction from permission authority. |
| Result return | Foreground work returns an Agent tool result; background work reports completion in a later parent turn. | Recording, delivering and consuming a result are distinct events. |
| Continuation | A completed resumable child can receive `SendMessage` and run again under its existing agent ID. Built-in Explore and Plan are one-shot and do not return a resumable ID. | An agent identity may survive an individual execution; not every role supports continuation. |
| Stop reason | A child stopped by the model's `TaskStop` can auto-resume on a message. An explicit user or SDK `stop_task` cancellation blocks that auto-resume until the user clears it through the documented interaction. | Cooperative stop and explicit cancellation must not collapse into one freely resumable state. |
| Persistence | Child transcripts are separate from parent compaction. Resuming the original session can recover a child after restarting Claude Code, subject to retention. | Transcript restoration is not proof that in-flight external effects can be replayed. |
| Governance | The documented controls include nesting depth, concurrency, turns and query spend, with version-dependent behavior and exceptions. | Resource governance belongs to the runtime, not merely to a prompt. |

Claude also supplies an initial roster to eligible named children with `SendMessage`, and checks certain name reuse cases to avoid silently redirecting a message to a newer agent. Stable addressing and an explicit sender relationship are useful references; names alone should not become durable identity.

## Agent Teams are a separate surface

Official source: [Agent Teams](https://code.claude.com/docs/en/agent-teams).

- Teams add independent teammates, peer communication, shared task assignment/claiming and dependencies for agents with Task tools, and a shutdown request that the teammate may accept or reject.
- Teammates receive project context and a spawn prompt, but do not inherit the lead's conversation history.
- The feature remains experimental. In-process teammates are not restored by `/resume` or `/rewind`; same-session interaction must not be described as restart recovery.
- The documentation explicitly excludes teammate spawning in non-interactive `-p` mode, including Agent SDK sessions. A named child in such a session remains an ordinary subagent even if the Teams environment flag is set.
- Team membership has different constraints from ordinary subagent nesting. Teams do not support nested teams.

Research implication: a focused, parent-managed worker does not require Teams. Team coordination should be justified by actual peer collaboration needs, rather than inferred from the word "subagent".

## Claude Agent SDK: model tools versus host APIs

Official sources: [overview](https://platform.claude.com/docs/en/agent-sdk/overview), [TypeScript reference](https://platform.claude.com/docs/en/agent-sdk/typescript), [streaming input](https://platform.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), and [sessions](https://platform.claude.com/docs/en/agent-sdk/sessions).

| Surface | Documented support | Boundary |
| --- | --- | --- |
| `agents` option | Programmatic child definitions used through the model's Agent tool. | Defining a role is not directly creating a child handle. |
| Streaming input / `streamInput()` | Queued input into a persistent query. | Input to the parent query is not a dedicated host-to-child messaging API. |
| `interrupt()` | Interrupts the query in streaming input mode. | Do not assume it has the same target or continuation semantics as stopping one child. |
| `stopTask(taskId)` | Stops a running background task. | Explicit SDK cancellation has the child auto-resume restriction described above. |
| `close()` | Closes the query and terminates its underlying process. | This is process/resource closure, not a per-child archival operation. |
| `resume` / `forkSession` | Restores a selected conversation or branches its history into another session. | Session persistence covers conversation, not filesystem or arbitrary side-effect rollback. |
| Task messages | `task_started`, `task_progress`, `task_notification` and related events expose task state, correlation and outputs. | Observability does not itself define whether the parent should think or speak. |
| `parent_tool_use_id` | Correlates streamed child activity with a parent tool invocation. | Preserve generation lineage separately from the source of the child's materials. |

The official child-resume example captures `session_id` and the `agentId` returned in tool-result text, resumes that parent session, and asks the parent to resume the child. The inspected public `Query` method list does not present a symmetric direct `spawnChild` / `sendToChild` / `resumeChild` host API. Model-facing `Agent` / `SendMessage` tools and host-facing SDK controls are therefore different integration surfaces.

The current Sessions page says the experimental TypeScript V2 session API was removed in SDK `0.3.142`; older `unstable_v2_createSession` / `send` / `stream` examples should not be used as the current integration contract.

The SDK includes Claude Code's agent loop, tool execution and context management, and the TypeScript interface manages a Claude Code process. Treating it as a complete worker backend requires an explicit boundary for Taki's Run, Approval, Host, tool and delivery owners. Its completeness does not make it a drop-in manager around Taki's existing `ToolLoopAgent`.

## Source identity reaches both code and the model

Official sources: [SDKMessageOrigin](https://platform.claude.com/docs/en/agent-sdk/typescript#sdkmessageorigin) and [SDKTaskNotificationMessage](https://platform.claude.com/docs/en/agent-sdk/typescript#sdktasknotificationmessage).

The SDK distinguishes origins such as `human`, `peer`, `task-notification` and `auto-continuation` independently of a message's API role. Background completion notifications include task identity, outcome, summary and an output-file reference. Except for the separately framed scheduled-trigger case, Claude Code also tells the model that no human input occurred, so a notification is not mistaken for user instruction or approval.

This supports two complementary requirements already discussed for Taki:

1. Program-level correlation identifies which delegation produced the result and where evidence lives.
2. Model-facing framing explains that the input is a delegated result or background event, while retaining the underlying material's source where it matters.

The two origins answer different questions: "which child produced this?" and "what video, document or other material informed it?" Neither replaces the other. Result readiness, actual publication, delivery evidence and the subject of the text are also different facts. No provider-specific `origin` schema, mandatory provenance graph or per-sentence tagging is selected here.

## AI SDK and Pi reuse boundaries

Official AI SDK source: [Subagents](https://ai-sdk.dev/docs/agents/subagents).

AI SDK documents a compositional pattern: a parent tool calls another `ToolLoopAgent`, passes a fresh prompt or explicit history, propagates `abortSignal`, optionally streams preliminary results, and uses `toModelOutput` to limit what the parent model consumes. The basic tool call waits for completion. Streaming UI progress does not turn that call into a durable background child manager.

The documented pattern does not establish a complete retained child registry, addressed inbox, post-completion continuation or restart recovery contract. Its caveats also exclude native subagent tool-approval flows. This is a limitation of that documented composition, not authorization to bypass Taki's Core Approval path or proof that every custom integration is impossible.

| Pi layer | Finding from the completed investigation | Integration implication |
| --- | --- | --- |
| `pi-agent-core` / `pi-coding-agent` | Single-agent prompt, steering, follow-up, abort and session primitives; no complete built-in parent/child manager. | Useful primitives, but a host must own delegation and adapt the Pi model/message loop. |
| Coding-agent subagent example | One-shot subprocess delegation with `--no-session` and ignored stdin. | Results and cancellation exist; the example does not continue the same child through messages. |
| `pi-durable` | Experimental durable runtime with conversations, submissions, inbox/checkpoints and task ownership. | Greater lifecycle support also means greater overlap with Taki's existing execution/persistence owners. |
| Durable background-child example | Named children, `spawn/send/stop/status`, background Anchor ownership and Reporter tasks that return deduplicated follow-ups. | Useful reference for retained identity, explicit background lifetime and result return. It is an example, not a complete stable child-management product. |

Pinned Pi references: [root README](https://github.com/earendil-works/pi/blob/82432219af91c2342fc1b096e179e96df6ed8e7f/README.md), [one-shot subagent example](https://github.com/earendil-works/pi/blob/82432219af91c2342fc1b096e179e96df6ed8e7f/packages/coding-agent/examples/extensions/subagent/index.ts), [durable README](https://github.com/earendil-works/pi/blob/82432219af91c2342fc1b096e179e96df6ed8e7f/packages/durable/README.md), and [background-child example](https://github.com/earendil-works/pi/blob/82432219af91c2342fc1b096e179e96df6ed8e7f/packages/durable/test/examples/23-subagent-background.ts).

Research recommendation, not a new stack decision: retain the existing AI SDK/Runtime baseline, reuse established delegation semantics, and investigate only the integration gaps. Evaluate a complete Claude or Pi backend separately if a concrete requirement justifies it. Agent Teams and a second persistent runtime are not prerequisites for Co-Watching preparation.

## Current Taki evidence and the important mismatch

The [commentary-path investigation](AGENT-CONTEXT-SOURCES.md#commentary-path-investigation-2026-10-20) owns the detailed existing data flow. The following entry points were reread while recording this research:

- [`co-watching/runtime-model.ts`](../packages/core/src/co-watching/runtime-model.ts) uses the same ChatAgent in a private `non-primary` invocation. It validates a plan, holds accepted work in `waiting`, and preserves the semantic request across foreground yield. This is not evidence of a retained child conversation with a general inbox.
- [`co-watching/conversation-context.ts`](../packages/core/src/co-watching/conversation-context.ts) supplies ordinary chat with current work/material references and distinguishes drafts from already-spoken content.
- [`harness/run-prepared-publication.ts`](../packages/core/src/harness/run-prepared-publication.ts) admits linked publication Runs without model admission. A `subagent` initiator and `parentRunId` alone do not prove an Agent was spawned.
- [The media integration plan](MEDIA-AGENT-INTEGRATION-PLAN.md#43-continuous-work-and-agent-input) already describes completion evidence and the existing WakeEngine bridge, but also preserves invitation rules and accepted-Co-Watching behavior. It must not be replaced by a blanket "all completion events wake and speak" policy.

The roadmap explicitly states that terminal Runs never restart. ADR 0010 assigns retries to Attempts and permits resuming an interrupted Run under the same `runId`. Claude's retained agent ID across completed executions therefore cannot be copied directly as "restart a completed Taki Run". Later design must map conversational continuity to existing Run ownership while keeping terminal outcomes final; it must not silently add a second Session authority.

## G1 decision: result availability and parent continuation

On 2026-10-21 the owner agreed to option A: determine parent continuation according to the delegated task's needs. A research result may need further synthesis; a validated Co-Watching plan can already have its next action owned by the publication path.

- A completed result remains recorded, attributable and available to the main Agent through the appropriate context/query projection in either case. The choice does not discard results or make them unknowable to the parent.
- Delegation distinguishes results that should request further parent reasoning from prepared results that can update available state without mandating another model call. A parent continuation is subject to existing admission and foreground coordination; it does not mean reviving a terminal Run.
- Requesting parent reasoning does not automatically authorize speech. A result becoming available, a parent model execution and a user-facing publication are separate actions.
- The behavioral choice can be represented in delegation metadata or a parameter. Its name, type, default and exposure to the model remain implementation decisions; no `reportToParent` boolean or new SDK option is selected. In particular, "report" is too ambiguous if it conflates storing a result with triggering inference.

### SDK support for the G1 distinction

| SDK surface checked | What it provides | What it does not establish |
| --- | --- | --- |
| AI SDK `7.0.17` `ToolLoopAgentSettings`, plus the official [subagent pattern](https://ai-sdk.dev/docs/agents/subagents) | Child execution, returned tool results, `toModelOutput`, `onEnd` callbacks and current-loop `stopWhen` conditions. | No dedicated retained-delegation completion/parent-wake option was found in these surfaces. A callback notifies application code; result conversion changes model-visible content; neither supplies a background continuation policy. |
| AI SDK custom call options | `callOptionsSchema` / `prepareCall`, or a tool's input schema, can carry application-defined choices. | Declaring a parameter does not implement scheduling, persistence or addressed result delivery. Those semantics remain with the host. |
| Claude Agent SDK [`SDKUserMessage.shouldQuery`](https://platform.claude.com/docs/en/agent-sdk/typescript#sdkusermessage) | `false` appends an application-supplied input to the SDK transcript without starting an assistant turn; it is held and merged into the next input that triggers a turn. | This is an input-message primitive, not a documented per-child switch that suppresses automatic built-in subagent completion notifications. It is also not a reason to append internal task reports to Taki's relationship Timeline. |
| Claude Agent SDK `AgentDefinition.background` and task events | Background execution and lifecycle/result observation. | Background placement does not mean silent completion, and filtering an event in the host/UI does not prove that the runtime skipped a parent model call. |

The implementation direction is therefore to express G1 in Taki's delegation contract and reuse existing execution, persistence and scheduling owners. Claude's message-level primitive is useful precedent if that backend is evaluated; it is not an AI SDK parameter. A Taki adapter must preserve the Replay View / Timeline distinction instead of copying Claude's transcript writes literally.

## G2 decision: the parent chooses whether to reuse a child

On 2026-10-21 the owner agreed that a child may be reused after its original task completes and clarified that the main Agent should decide whether to reuse it according to the actual situation.

- The main Agent can explicitly continue work with an existing child or delegate to a new child. Completing one task does not by itself prohibit further use of that child's working context.
- Related follow-up questions and revisions are typical reasons to reuse; unrelated work is a typical reason to start fresh. These are guidance for the main Agent's judgment, not mandatory feature-specific routing or a rule that every task of one kind shares a permanent worker.
- Reuse preserves the child's own working continuity. It does not implicitly synchronize all later parent conversation into that context; relevant new input follows the G3 decision below.
- This decision concerns worker continuity, not a choice of storage identity or permission to reopen a terminal Run. Existing Run/Attempt and history-isolation constraints still apply; lifecycle mapping follows G4 and the package-first guidance below.

The [Subagent glossary entry](../CONTEXT.md#architecture) records this domain meaning without selecting an SDK handle, database schema or lifecycle API.

## G3 decision: the parent organizes input delivered to a child

On 2026-10-21 the owner agreed to selective parent-to-child communication and clarified that the main Agent may organize the content it delivers to the child according to the actual task.

- The main Agent composes the delegated task, relevant requirements and materials, and later follow-up messages. It may select original excerpts, summarize relevant context or supply usable material references; no fixed full-history-forwarding rule is required.
- A child created with inherited context receives the selected starting snapshot. Later parent conversation does not automatically synchronize into that child's context. The fresh/inherited creation choices remain available.
- The same rule applies when reusing a child: it keeps its own working continuity, while the main Agent supplies the new task or relevant updates explicitly. A tone correction relevant to ongoing preparation can be sent to that child; unrelated chat need not be copied.
- Content selection does not remove the established source-awareness requirements. Supplied material remains distinguishable from task direction, and available origins/references must not be replaced by invented explanations.
- This is a communication responsibility, not a replacement for deterministic cancellation, source-validity checks, permissions or publication gates. Safe message-consumption boundaries and stale-result handling still need technical mapping to the existing owners; no queue algorithm or automatic shared transcript is selected here.

The Subagent glossary wording now includes the delegating Agent's responsibility for organizing supplied work and material. No separate terminology, additional summarization Agent or new permission mechanism is introduced.

## G4a decision: stopping the parent does not stop its children

On 2026-10-21 the owner explicitly rejected cascading a stopped primary request to its children: all children continue working. The owner also required a user entry into the child's conversation page with a manual stop control, and reaffirmed that children use the same underlying Agent framework.

- Stopping the current main conversation/request does not automatically cancel any child, including a child delegated specifically for that request. There is no request-bound-child exception to this ruling.
- Each child's own execution remains subject to its existing lifecycle, limits and applicable governance. The ruling changes propagation from the parent's stop; it does not remove independent child stop controls or claim that work survives a Core process shutdown.
- Users must be able to navigate to a particular Subagent Conversation and manually stop that child. This ruling originally left direct user input open; the later package-first baseline below follows the official targeted follow-up pattern. Page layout and navigation placement remain routine design work.
- Main and child execution reuse the same Agent Runtime/framework logic. Child identity, working context, lifecycle and UI targeting differ; no separate per-feature model loop or second runtime is authorized.
- The child conversation is a user-accessible view/control surface for that child's working dialogue and progress. [ADR 0005](adr/0005-continuous-timeline-no-sessions.md) still owns the Character's continuous relationship conversation, and [ADR 0010](adr/0010-separate-autonomous-run-history-from-relationship-timeline.md) still separates work evidence from that Timeline. Showing child work does not automatically copy its private transcript into relationship history or select a second session store.

Integration implication: the AI SDK basic subagent example passes the parent's `abortSignal` into child generation and therefore does not, as written, implement this cancellation contract. Child execution needs independently targeted lifetime/cancellation ownership within the existing Runtime. The Pi durable background-owner pattern is a relevant precedent; the implementation and persistence mapping remain unselected.

The Subagent Conversation glossary entry records the newly requested user-facing concept. Interaction details follow the later package-first baseline; the page does not promise arbitrary side-effect suspension or restart recovery.

## G4b decision: parent stop preserves the child's completion intent

On 2026-10-21 the owner agreed that stopping the current main request does not change the child's existing G1 completion intent.

- A child that was delegated to request further parent reasoning may still request it when the child finishes, even if the user stopped the earlier main execution. A record-only delegation remains record-only; parent stop does not switch either policy.
- The resulting parent work is a subsequent execution subject to the existing admission and foreground coordination. It does not restart a stopped terminal Run, reinterpret the child result as fresh user input, or automatically authorize user-facing publication.
- G4a and G4b together keep the main execution's stop scope separate from the ongoing child's execution and completion intent. A stop directed at the child itself follows G4c.

## G4c baseline: respect a user's explicit child stop

On 2026-10-21 the owner broadly agreed with the distinction between user-directed child stop and parent-directed interruption, then requested that ordinary behavior follow official approaches and available framework/package functionality without unnecessary questions.

- Preserve the child's working context after a user stops it, but do not let a parent message automatically restart that stopped work. A user-directed continuation clears that stop through the normal interaction path.
- A parent-directed interruption may be followed by a parent-directed continuation. Stop, release of active resources and deletion of retained context are separate operations; no new destructive cleanup or archive product is required by this baseline.
- This adopts the documented Claude stop-origin distinction at the behavioral level. Exact UI commands, state fields and Run transitions must use Taki's existing framework contracts; no new permission workflow or terminal-Run restart is selected.

## Package-first continuation rule

The owner's instruction is to base the design on official mechanisms and package-provided functionality, and ask only when necessary. The sequential behavior interview therefore ends here. Resolve ordinary choices through verified current APIs, established examples and existing Taki contracts; reopen a focused question only when a verified gap or material conflict prevents the agreed behavior. This original discussion decision did not itself authorize implementation or unlimited adoption of another product's features. The subsequent conditional development authorization and active SDK slice are recorded above.

Use this order of preference:

1. Reuse the installed AI SDK engine and Taki's existing Runtime, governance, persistence and projection owners.
2. Compose their supported extension points using the official patterns already researched.
3. Add narrowly scoped host integration only for a demonstrated gap, such as addressed child continuity or independent cancellation. Name the gap and its owner before adding code.

Claude's complete runtime and Pi's experimental durable runtime remain reference/integration alternatives, not implicitly selected dependencies. A `shouldQuery` field documented by Claude is not an AI SDK feature; conversely, the AI SDK example's parent-abort propagation cannot override G4a.

### Derived interaction and recovery baseline

These are technical defaults under the owner's package-first instruction, rather than additional individually approved product rulings:

- Follow Claude's [child transcript interaction](https://code.claude.com/docs/en/sub-agents#observe-and-steer-running-forks): the child page can display its work, accept targeted user follow-up and provide stop/continue interaction. User messages target that child's working context; they do not automatically become ordinary main-conversation history. Preserve sender identity when the parent later receives a result. Reuse common rendering and runtime paths where their contracts fit.
- Closing or releasing an active executor is distinct from deleting its retained work. Use existing retention and explicit lifecycle operations; do not introduce a separate archive/deletion mechanism or copy Claude's numerical retention defaults without a Taki need.
- Resume conversation state and recover executable work through existing Core owners. Retained context alone does not authorize replay. Terminal Runs stay terminal; uncertain tool effects stay uncertain until resolved, and missing authority follows the existing recovery path. Full child restart recovery remains an integration validation obligation, not a new question about whether to replay everything.
- Use package callbacks and supported step/input boundaries for interaction. Do not promise to inject text into an already-running provider request or to suspend an arbitrary external tool mid-effect.

### Verified implementation seams

The following static checks establish where to reuse current functionality and where adaptation is actually needed. They are not implemented changes:

| Requirement | Verified foundation | Required integration boundary |
| --- | --- | --- |
| Same model/tool framework | Installed `ai@7.0.17` `src/agent/tool-loop-agent.ts` stores settings, delegates each `generate` / `stream` call to SDK generation, and accepts per-call `messages` and `abortSignal`. [`chat-agent.ts`](../packages/core/src/agents/chat-agent.ts) already creates that agent and wraps tools/observability. | Retain this loop. An SDK agent definition/object by itself is not a durable child transcript or addressed inbox. |
| Fresh/inherited/reused child input | SDK call messages and callbacks are available. `chat-agent.ts` currently selects ordinary replay or the specialized initiative context, and `RunExecutionContext.selectedContext` is typed as initiative context. | Extend the shared context-selection/recording boundary for child work; do not treat every `non-primary` turn as a ready-made fresh child or overload the initiative contract. |
| Independent stop and parallel children | [`turn-registry.ts`](../packages/core/src/agents/turn-registry.ts) stores one active controller per Character; another `begin` for the same Character replaces that entry. [`turn-queue.ts`](../packages/core/src/agents/turn-queue.ts) owns a serial lane per key. | Independent children cannot all be registered under the existing Character-only active entry. Introduce explicit execution-scope targeting within these existing owners, preserve relationship serialization, and give each child its own cancellation lifetime. Exact keys/schema remain design work. |
| Durable admission and lifecycle | [`run-service.ts`](../packages/core/src/harness/run-service.ts) exposes admission, `holdWork`, `resumeWork`, `requestCancel`, settlement and status; [`chat-cancel.ts`](../packages/core/src/server/methods/chat-cancel.ts) already supports an optional exact `runId`. | Reuse durable ownership and exact-target controls; combine them with G4c's stop origin and retained child continuity. A completed Run is not the reusable worker identity. |
| Completion and parent continuation | SDK `onStepEnd` / `onEnd` and tool output conversion are present; Taki already captures completed step messages independently of aggregate success. G1 defines whether a child result should request more parent reasoning. | Record the final outcome once through Core, preserve material/generation references, and dispatch parent continuation only under the captured G1 intent. Do not create another event bus or model loop merely for completion. |
| Restart | [`recovery-coordinator.ts`](../packages/core/src/harness/recovery-coordinator.ts) skips terminal Runs, classifies cancellation/uncertain effects, and leaves accepted work with lost authority waiting for explicit continuation. | Map retained child context to that recovery path and prove it before claiming resumability. The current classifier is not evidence of completed generic child reconstruction. |

Before implementation, the technical mapping must account for exact child addressing, private transcript storage, input delivery/consumption, completion deduplication and the requested view/controls. Verify main-stop isolation, manual-child-stop behavior, policy-preserving completion, targeted message delivery and restart boundaries at those seams. These are engineering follow-through items, not a renewed checklist of owner preference questions or accepted delivery deferrals.

## Decision summary

| Item | Recorded behavior / follow-through | Scope |
| --- | --- | --- |
| G1 — agreed | Result availability is retained; continuation depends on delegated work | See the decision and SDK mapping above. Parameter spelling and integration details are not frozen. |
| G2 — agreed | The main Agent decides whether to reuse an existing child or create a new one | Relatedness guides judgment rather than enforcing feature-specific reuse. Worker continuity does not reopen terminal Runs. |
| G3 — agreed | The main Agent organizes initial task material and relevant follow-up messages | No automatic full-history synchronization. Delivery timing and stale-result enforcement still require technical mapping without weakening existing lifecycle/source gates. |
| G4a — agreed | No child cancellation when the main request stops; expose a child conversation page with manual stop | All children continue; page interaction follows the official pattern through the shared framework. |
| G4b — agreed | Main-request stop preserves the child's original G1 completion intent | Completion can still request a subsequent parent execution; no stopped terminal Run is reopened. |
| G4c — accepted in principle | Distinguish user-directed child stop from parent-directed interruption | Preserve context; a user-stopped child requires user continuation, while the parent may resume its own interruption. |
| Follow-through | Package-first technical mapping | Resolve ordinary interaction/lifecycle choices from official mechanisms and existing owners; ask only about demonstrated material gaps or conflicts. |

G1 uses the existing Agent Context, Replay View and Context Source vocabulary. G2-G3 are reflected in the Subagent entry, and G4a introduces Subagent Conversation as a work-specific interaction/control surface. Runtime identity, storage and queue details remain outside the glossary. No ADR is added: parent-stop propagation was an open contract, and the new page does not replace the continuous relationship conversation. Package-first follow-through preserves the agreed behavior without claiming that every required integration already exists.

## Recording validation

This change records research and links it from the existing source discussion and documentation index. It does not modify production code, installed Skills, runtime settings, memory data, acceptance status or existing ADRs. Documentation checks cover UTF-8 without BOM, local link targets and patch whitespace; no runtime or model test is claimed.
