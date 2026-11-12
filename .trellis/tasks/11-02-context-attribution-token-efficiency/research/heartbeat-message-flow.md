# Research: Heartbeat message flow

- Query: Does Heartbeat/proactive interaction share the user-conversation flow? Trace actual producers, deterministic wake, Run/Attempt admission, model input/tools, history, publication, memory and usage. Include current image-to-text seams affected by the owner's requirement that all images enter the Main Model natively.
- Scope: internal; static inspection of the current T4 worktree. No production change or live experiment.
- Date: 2026-11-02

## Findings

### Decisive answer

Heartbeat shares the **Character queue, Run/Attempt ledger, ChatAgent, ToolLoopAgent, governed tools, model Effect/usage settlement and ordinary public Timeline** with user conversation. It has different admission, context and publication semantics: no real user input, no ordinary relationship replay in its judgment request, and no automatic retention of its model transcript. Only an approved structural `speak` decision produces an ordinary assistant Timeline row. `silent` and `express` produce no conversation row.

This is production composition, not only an intended architecture: `packages/core/src/main.ts:642` composes InitiativeRuntime with the existing agent/controls/store; `main.ts:709` supplies that runtime to PatternRuntime; `main.ts:756` starts MemoryRuntime and `main.ts:757` starts PatternRuntime. `packages/core/src/initiative/initiative-composition.ts:33` binds the existing ConversationStore and TimelineSubscriptions to DeliveryCoordinator, and `initiative-composition.ts:38` binds the same agent, queue, RunService and Effect service to InitiativeRuntime.

### Actual data chain

| Stage | Actual producer/consumer and evidence |
| --- | --- |
| Source facts and invalidations | Perception changes (`main.ts:393`), browser playback (`main.ts:399`), Presence (`main.ts:405`), committed user rows (`main.ts:239`), Pattern/Intention changes (`main.ts:499`, `main.ts:502`), config changes (`main.ts:183`) and Character-lane release (`main.ts:468`) notify PatternRuntime. `initiative/pattern-composition.ts:145` reads current target/readiness, policy/timezone/primary versions, privacy, accepted foreground, Presence return, due Intentions, background completions and viewing facts. |
| Background completion source | `db/initiative-completion-source.ts:11` reads **completed** scheduled/subagent/webhook Runs from the last day and actual Class A publication facts. `initiative/pattern-composition.ts:127` wakes evaluation when these Run kinds settle. `initiative/wake/wake-matcher.ts:107` excludes already Class A delivered or stale completions. A completion fact is not itself an LLM call. |
| Cadence/event evaluation | `initiative/wake/wake-engine.ts:43` starts timers; `wake-engine.ts:44` accepts source/policy/release notifications; `wake-engine.ts:61` arms periodic checks, due Intention timing and bounded busy waits. `wake-engine.ts:74` evaluates a current snapshot. These paths use no model. |
| Deterministic eligibility | `initiative/wake/wake-eligibility.ts:14` checks enablement, source modes, target, quiet hours, backoff and quotas. `wake/wake-candidates.ts:10` combines accepted Pattern matches, finite due Intentions and media invitations. `wake/wake-matcher.ts:63` matches clock, completion, Presence and accepted activity conditions. `wake-engine.ts:118` filters duplicate/cooldown/chance failures, groups at most four candidates sharing one source, and captures expiry. Busy work remains bounded pending state before a Run (`wake-engine.ts:88`). |
| Selected context capture | `wake-engine.ts:143` calls ContextBuilder before runtime dispatch. `initiative-context-builder.ts:36` captures the current Memory authority under expiry/cancellation; `initiative-context-builder.ts:80` assembles selected Persona/Global/Character projections. `initiative-context-builder.ts:85` constructs instructions, fenced candidate purposes, user time, permitted observations, candidate IDs, permitted tools, and an `initiative-context.v1` manifest. Its `accountingQuality` is currently `unknown` (`:106`), not exact token attribution. |
| Admission | `initiative-runtime.ts:63` uses atomic `tryAcquireBackground`, and `:69` reserves model-opportunity capacity before awaited admission. `initiative-runtime.ts:100` calls the existing RunService with `initiator: heartbeat`, `deliveryClass: class_b`, `contextMode: autonomous`, expiry and captured selected context. RunService captures an immutable snapshot then admits through RunRepo (`harness/run-service.ts:103`). Snapshot capture requires selected context for Heartbeat, retains Memory/extension authority, and prepares a bounded selected-recall wrapper (`harness/run-snapshot-capture.ts:54`, `:68`, `:72`). |
| Start and optional evidence preparation | `initiative-runtime.ts:116` starts the existing Attempt. `initiative-runtime.ts:151` builds a non-primary TurnContext and charges model-opportunity consumption at actual model Effect intent. `initiative-runtime.ts:162` optionally obtains evidence under captured governed tools and the same Run/Attempt, appending its returned text to `turn.controlInput`. A media invitation can perform a separate VLM call **before** the Main judgment; see the image section. |
| Shared model turn | `initiative-runtime.ts:172` drains `agent.stream({ characterId, message: "Initiative judgment" }, turn)` while keeping free-form deltas private. `agents/chat-agent.ts:225` treats it as non-primary and skips `beginPrimary`. `agents/agent-attempt.ts:57` builds ephemeral selected control input, `:59` selects empty initiative replay, `:63` skips ordinary Memory assembly, and `:68` chooses the Main Model because this call has no attachments. |
| Tools and multiple requests | `agents/agent-tool-assembly.ts:15` retains ordinary governance/captured closures and then narrows initiative membership. `agents/initiative-context.ts:12` intersects explicitly selected names with a fixed read registry plus `heartbeat_respond`; the builder currently offers time, Skill/resource reads and optionally bounded related-memory recall (`initiative-context-builder.ts:108`). `agents/agent-attempt.ts:93` uses the normal ToolLoopAgent; `:101` applies captured Skill disclosure at each step, so legitimate tool results feed subsequent model requests in the same Attempt. One judgment is not necessarily one provider request. |
| Structural decision and settlement | `agents/heartbeat-respond-tool.ts:24` stages one validated `silent`, `express` or `speak` decision; it does not deliver. Stream consumption and observer health finish first (`agents/agent-attempt.ts:202`, `:213`), then InitiativeRuntime checks currentness/unfinished Effects and stages the durable decision (`initiative-runtime.ts:173`, `:176`). Missing/invalid/conflicting decisions fail (`heartbeat-respond-tool.ts:43`, `initiative-runtime.ts:183`); they are not successful silent outcomes. |
| Delivery and public persistence | `delivery/delivery-coordinator.ts:77` settles silent without publication; `:112` executes optional governed presentation in the same Attempt, and `:125` returns without a Timeline row for express. Speak uses `:132` to atomically append through `db/run-delivery-repo.ts:124`: exact active Attempt/Character/class/source validity, Class B quota, assistant row, delivery linkage/charge and dispatch event commit together. `agents/conversation-store.ts:153` is the assistant-row writer. Post-commit `publishObserved` sends the ordinary Timeline append (`delivery-coordinator.ts:148`) and records sent/unknown/no_target. |

Two minimal seams show the shared engine and different request history:

```ts
// packages/core/src/initiative/initiative-runtime.ts:101
initiator: "heartbeat", provenance: { provider: "initiative", sourceRef: id },
deliveryClass: "class_b", contextMode: "autonomous"

// packages/core/src/agents/agent-attempt.ts:59
const replay = work ? work.project(turn!.attemptId!) : selected ? initiativeReplay() : store.project(characterId);
```

### Conversation history and Memory are separate

- **Current Heartbeat request:** `initiativeReplay()` returns no messages or summary (`agents/initiative-context.ts:27`). Control input enters the actual request as an ephemeral user-role ModelMessage (`agents/agent-attempt.ts:251`), without creating a fake Timeline user row. Ordinary automatic recall is primary-only (`agent-attempt.ts:272`). Selected Persona/Blocks/index and explicit bounded recall can still supply relationship information.
- **Current Heartbeat transcript:** non-primary `finishRecordedTurn` returns without ordinary turn commit (`agents/chat-agent.ts:287`). Thus model free text and its tool-call/result transcript do not inflate conversation replay. Heartbeat has no worker WorkContext that would retain a private worker transcript through that branch.
- **Delivered proactive speech:** the structural text becomes one ordinary assistant row through `appendDelivery`. Future primary `store.project()` reads the same Timeline (`agents/conversation-store.ts:145`, `agents/replay-source-loader.ts:44`), so eligible speech is available to later user conversations and later ordinary summary selection. It remains a canonical row even if transport is unknown/no_target; those states do not prove rendering or reading.
- **Detached maintenance:** `agents/agent-attempt.ts:228` registers measurement/auto-memory/image-memory hooks only for primary turns. Heartbeat does not directly launch conversational auto-memory or replace the primary request-pressure measurement (`agent-attempt.ts:192`). Later primary maintenance may compact the public Timeline. Canonical Local ingestion separately requires exact proven primary commits (`memory/canonical-local-ingestion.ts:104`, `memory/canonical-ingestion-source.ts:84`), rather than treating every assistant Timeline row as primary evidence. Legacy maintenance instead reads later Timeline ranges (`memory/auto-memory.ts:195`, `:221`); do not claim all provider modes categorically exclude proactive speech from every later maintenance input.
- **Presentation continuation:** a held delivery resumes through the existing background lane and original Attempt without another Agent/model request (`delivery/delivery-coordinator.ts:45`). WakeEngine can resume that retained delivery before selecting a new opportunity (`wake-engine.ts:101`).

### Images: current translators and native-input seams

The owner's new requirement is **all images, including tools and Perception, enter the Main Model natively**, eliminating the separate vision slot and image-to-text translator pipeline/prompts. Current production does not meet that requirement:

1. **Ambient screenshot -> text -> Heartbeat:** `main.ts:350` supplies the auxiliary-meter-wrapped **visionModel** to ScreenshotDescriber, shared with ambient Perception (`main.ts:387`). `perception/ambient-screenshot-sampler.ts:197` routes the screened `screenshot-ambient` capability and validates returned `dataBase64`/`mediaType`; `:223` passes the frame to `observeAmbientFrame`. `perception/ambient-observation.ts:27` saves raw bytes, `:31` invokes the description model with the privacy-focus prompt, `:39` stores only scrubbed description/time in ScreenContext, and `:42` can discard the raw file. `perception/screen-context.ts:45` renders fenced description text. `initiative/pattern-composition.ts:53` supplies that renderer to ContextBuilder; `initiative-context-builder.ts:142` copies this **text** only when an accepted-screen selector and current eligible foreground evidence permit it. No image ref or bytes accompany this selected control input.
2. **Media invitation preparation -> separate same-Run vision call -> text:** `main.ts:700` supplies another ScreenshotDescriber using visionModel. `co-watching/viewing-invitation-evidence.ts:55` captures screened bytes, `:60` binds the original Heartbeat Run/Attempt/Effects to description, and `:70` returns fenced native-access/screen-description text. `co-watching/viewing-invitation-source.ts:152` returns that text to InitiativeRuntime's preparation hook. This VLM call belongs to `run_usage`, not the detached auxiliary ledger. If preparation later refuses, the Run can contain real model usage without ever reaching Main judgment.
3. **Agent screenshot tool today:** `capabilities/screenshot-tool.ts:37` exposes screenshot with optional `describePrompt` and returns stored path/dimensions plus optional fenced description. It has no native image `toModelOutput` carrier. Screenshot is excluded from the current Heartbeat read registry, although trusted media preparation can call captured screenshot-ambient before judgment. `capabilities/screenshot-describe.ts:17` owns the separate description instructions, and `:62` constructs native image FileParts **for its vision call**, returning only text to the caller.
4. **Shared Agent already constructs native image payloads:** `agents/agent-attempt.ts:280` emits `{ type: "file", mediaType, data: dataBase64 }`. Current `agents/chat-agent.ts:213` opens the turn and requires vision dependencies for attachments; `agent-attempt.ts:68` routes image turns to visionModel. InitiativeRuntime currently passes no attachments (`initiative-runtime.ts:172`); its selected context/preparation return is text. The native FilePart helper is a verified carrier shape, not evidence that screenshot refs automatically hydrate into the Main request today. Current ambient retention can remove bytes before a later judgment, so a text-only ScreenContext is insufficient to reconstruct the original image.

```ts
// packages/core/src/agents/agent-attempt.ts:68 -- current routing
const selectedModel = vision ? vision.model : deps.model;

// packages/core/src/agents/agent-attempt.ts:280 -- existing native carrier
const fileParts = attachments.map((a) => ({ type: "file" as const, mediaType: a.mediaType, data: a.dataBase64 }));
```

These are affected producer/consumer points only. This research does not change capture consent, source/currentness, retention, publication or Memory semantics.

### Usage and the current summary-window cache metric

- Heartbeat uses the same Run model observer as primary conversation (`agents/agent-attempt.ts:69`). `agents/model-effect-middleware.ts:52` commits a model Effect before each actual provider invocation; `:79` binds provider/model, request digest and `replayPosture: never`. `agents/model-observability.ts:95` settles request-specific usage through the authoritative Effect lifecycle. Every real loop request, failure or cancellation with known usage remains its own observed usage record. Silence after a model decision still consumes model usage.
- Utility maintenance is a separate task flow with its own prompts and serialized UtilitySlot, using its configured model or Main fallback (`memory/runtime-composition.ts:58`, `memory/utility-slot.ts:41`). It is not a Heartbeat and does not replay through ChatAgent merely because it can use the same model. Primary auto-memory can independently queue maintenance and compaction (`memory/auto-memory.ts:119`).
- Detached Utility/image-description/shared screenshot-description provider invocations use `auxiliary_model_calls` (`main.ts:191`, `:263`, `:282`, `:351`). `observability/auxiliary-usage-meter.ts:91` skips auxiliary recording when the call already has Run ownership; `agents/model-effect-middleware.ts:56` supplies that ownership. No-model checks/tasks create no provider usage observation.
- **Scope:** the selected primary Character chooses the latest successful primary-summary boundary, while the population is **all observed Core model requests**, including every Character's Run requests and settled auxiliary calls. Run-list filters and Heartbeat silence do not narrow this population. `db/cache-usage-repo.ts:96` performs `run_usage UNION ALL auxiliary_model_calls WHERE status <> 'started'`, without an initiator/Character filter.
- **Formula:** `sum(cacheReadTokens) / sum(inputTokens)` over identical eligible pairs; positive exact input, observed exact cache-read in `[0,input]`. Unknown cache is unpaired, not a zero hit (`db/cache-usage-repo.ts:101`). Explicit observed zero is valid; ambiguous legacy zero is not. This is input weighted, not an average of request percentages and not a cost-saving ratio.
- **Boundary:** successful primary `commitSummary` captures cumulative totals transactionally against summary revision/operation (`db/compaction-operation-repo.ts:224`, `:257`; `db/cache-usage-repo.ts:35`). Current totals subtract that baseline (`cache-usage-repo.ts:76`). Requests settled before the commit belong to the old window, including the summary request; requests settling afterwards belong to the new window even if started earlier. Failed/duplicate/private summaries and tidy do not reset it. Missing/inconsistent metadata yields unavailable; an empty paired population has null ratio.
- **Updates:** Run `usage.settled`, auxiliary settlement and successful summary commit notify the existing cache service (`main.ts:191`, `:208`, `:264`). This is actual completed accounting, not a timer-derived tick count. Native-image work preserves this metric and ordinary request input/occupancy accounting. Per the owner, images get no separate token category or meter; any component estimate must state its coverage.

### Files found and code patterns

| Files | Responsibility |
| --- | --- |
| `packages/core/src/main.ts`, `initiative/initiative-composition.ts`, `initiative/pattern-composition.ts` | Actual production composition and source invalidations. |
| `initiative/wake/wake-engine.ts`, `wake-candidates.ts`, `wake-matcher.ts`, `wake-eligibility.ts` | No-model timers, finite source matching, busy wait/currentness and wake policy. |
| `initiative/initiative-context-builder.ts`, `memory/initiative-memory-assembly.ts` | Captured thin Persona/Memory/observation input and source manifest. |
| `initiative/initiative-runtime.ts`, `harness/run-service.ts`, `harness/run-snapshot-capture.ts` | Existing admission, same Run/Attempt and immutable authority binding. |
| `agents/chat-agent.ts`, `agent-attempt.ts`, `initiative-context.ts`, `agent-tool-assembly.ts`, `heartbeat-respond-tool.ts` | Shared SDK engine, request/tool narrowing, transcript separation and structural decision. |
| `delivery/delivery-coordinator.ts`, `db/run-delivery-repo.ts`, `agents/conversation-store.ts`, `agents/replay-source-loader.ts` | Atomic ordinary assistant publication and later primary replay. |
| `perception/ambient-screenshot-sampler.ts`, `ambient-observation.ts`, `screen-context.ts`, `capabilities/screenshot-describe.ts`, `screenshot-tool.ts`, `co-watching/viewing-invitation-evidence.ts` | Current image capture, translation, privacy/retention and text consumers. |
| `agents/model-effect-middleware.ts`, `model-observability.ts`, `db/cache-usage-repo.ts`, `db/compaction-operation-repo.ts`, `observability/auxiliary-usage-meter.ts`, `memory/utility-slot.ts` | Actual request usage, auxiliary ownership and primary-summary cache baseline. |

Paths after the first entry in each row are relative to its stated subsystem unless another prefix is shown. The key patterns are additive non-primary turn context, source-bound immutable selection, intent-before-provider-dispatch, structural output staging, and one atomic public Timeline append rather than retaining the private judgment transcript.

### Related specs and versions

- `.trellis/workflow.md:352`: research persistence; this work remains planning research.
- `.trellis/spec/backend/initiative-runtime.md`: initiative admission/context/decision/delivery contracts.
- `.trellis/spec/backend/agent-runtime.md`: complete primary tool-loop retention, ephemeral prompt context and source fencing.
- `.trellis/spec/backend/canonical-local-memory-runtime.md`: exact primary witnesses and separate ingestion/compaction.
- `.trellis/spec/backend/observability-projection.md:112`: primary-summary-bounded global cache population and unknown handling.
- `.trellis/spec/backend/perception-evidence.md`: accepted source/consent fencing. Existing translator rules describe current behavior; the owner's new native-Main image requirement takes precedence for future design.
- Local dependency declarations: `packages/core/package.json:17` pins AI SDK `7.0.148`; `:15` pins `@ai-sdk/openai-compatible` `3.0.75`. The FilePart shape above is verified in project source. No external documentation or provider-native-image experiment was performed in this research.

## Caveats / Not Found

- Checks: verified cwd/HEAD directly, read the task PRD, relevant workflow/specs and actual production producer/consumer files. Used one focused semantic query and one narrowed retry; the index reported revision `06a8090118a4` and mainly historical research hits, so conclusions use direct current source reads. No Git command, tests, paid call, service start, database mutation or task lifecycle action was run.
- This proves code wiring, not current live enablement, active Character/Memory provider, configured Main image support, transport/native rendering, model quality, precise image token cost or historical savings. Those remain unverified here.
- A deterministic tick can finish without a Run or model call; an admitted Run can fail before Main invocation; media preparation can already have spent vision tokens. Keep these separate from a successfully settled silent judgment and from independent background maintenance.
- Spoken proactive rows enter ordinary later conversation replay; raw judgment/tool transcripts do not. Provider-specific long-term Memory eligibility must not be inferred solely from Timeline presence.
- Native-image migration still needs a reviewed carrier/lifetime and actual Main provider capability check. This document identifies exact existing seams without authorizing or designing production changes.
