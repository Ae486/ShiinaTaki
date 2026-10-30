# Agent Runtime — turn persistence & anti-hallucination

Hard-won from D1 (the tool-call hallucination that shipped). These are invariants for the chat loop, not style.

## Model tool visibility

Follow [Skill and MCP tool disclosure](./tool-disclosure.md). The complete governed registry remains available to
execution owners; the disclosure part of `ToolLoopAgent.prepareStep` selects `activeTools` from current-generation
completed results. Shared delegation WorkContext may also compose its addressed message projection in that callback;
disclosure itself does not rewrite messages or weaken full-turn persistence. Dedicated Skill/MCP schemas are initially hidden;
ordinary request measurement uses the same initial visible subset. D70 message reduction remains deferred.

## A turn's tool records MUST be persisted, not just its text

The agent acts only through tools; if a turn's **tool-call and tool-result** messages are dropped from the timeline,
the next turn replays a transcript where the action never happened — and the model, primed by episodic memory that
references the outcome, **fabricates that it already acted**. This surfaces only across multiple turns.

- Persist the full turn tail (`await result.responseMessages` in AI SDK v7 — assistant-with-tool-calls + tool-result
  messages + text), never text-only. The store's `content` string may stay a readable projection, but structured
  `parts` (tool-call identity/name and tool-result output) must survive the DB round-trip for faithful model replay.
  Raw tool-call input is privacy-excluded from durable Timeline rows and replays as `{}`; never weaken the identity,
  ordering, or result fidelity to achieve that minimization.
- The foreground private inbox is a deliberate storage boundary: registered private call/result pairs persist in
  the associated private Run transcript, while public text and ordinary tools persist in Timeline. Keep the complete
  combined native history within the live SDK turn. A private Effect or delivered inbox intent still fences whole-turn
  automatic retry even when the public projection is empty. See [Shared Agent Delegation](shared-agent-delegation.md).
- `history()` reconstructs the full multi-part `ModelMessage[]`. A window cut that strands a leading `tool` row
  (its assistant tool-call fell outside the window) is invalid replay input — drop leading orphan tool rows.
- Token-window selection treats one assistant call group and every matching result row as an atomic unit. Multiple
  calls, split result rows, and overlapping call/result spans stay together; orphan, duplicate, reversed, or
  name-mismatched tool evidence never enters provider replay.
- Any storage model that can't hold tool messages is a latent hallucination bug. If you defer tool fidelity, it goes
  in `docs/deferred-decisions.md` with a trigger — a bare code comment is exactly how D1 became a permanent defect.

## The base system prompt carries a truthfulness floor

The stable base prompt (before per-turn memory context) must state, explicitly, that the model may **never claim a
tool ran / a result was obtained unless a matching tool-result is present in the transcript** — earlier text is not
proof. This is the direct behavioural guard; persistence is the structural one. Ship both.

## Source meaning across shared execution and replay

- `SourceContext` separates known generation identity from optional material descriptions. `source-context.ts` renders
  those facts beside their associated model content through the existing untrusted-data fence; labels never grant
  authority or prove that an external first-person experience belongs to the user.
- Preserve native roles, tool call/result identity and complete output/error status. `retainStepToolSources` matches
  converted messages to actual completed tool call IDs/names, restoring producer metadata that SDK conversion discards.
  Persist that metadata as `sourceMaterials`; never recover trusted sidecars by parsing model-authored tool text.
- `turn-mapping.ts` rebuilds source-aware model messages from retained sidecars without changing canonical speech or
  sending the replay header to UI/TTS. Unknown historical sources stay absent; corrupt stored source data is an error.
- Compose `SOURCE_INTERPRETATION_RULE` into response/description prompts and the shared Memory writing conventions.
  Keep explicit self-reports, quotations, generated material and corrections distinct. Private work eligibility and
  executable tool authority remain governed by [Shared Agent Delegation](./shared-agent-delegation.md).
- Verify the actual SDK/provider-bound message, source-aware reduction and durable replay. Scripted source carriage
  does not establish semantic model accuracy; [Compaction](./compaction-harness.md) and
  [Local Memory](./canonical-local-memory-runtime.md) preserve their separate source/authority contracts.

## Test the deterministic root cause, not the probabilistic symptom

Behavioural hallucination (the model skipping a tool call) is **probabilistic** — you cannot pin it in a green/red
test. The *root cause* is deterministic: a pre-fix store drops the `tool` record every time. So a hallucination
reproduction test (a real-agent L2 seeded with a transcript polluted by verbal "success" but no tool records) must
hinge its red→green on the **persisted tool record**, not on the model's behaviour that run. A single-turn empty-DB
test cannot catch this — see [E2E Harness](./e2e-harness.md). The test must be RED against pre-fix code (prove it by
reverting the fix) or it proves nothing.

## Multimodal turns: two model slots, in-flight bytes, text-authoritative memory (#17)

Image attachments landed in #17 as **additive seams** on the D1-frozen turn — the stream loop, `persistTurn`, abort
wiring, and `toolApproval` stay byte-identical; only the pre-loop guard/save, the `appendUser` call-site, the `model:`
pick, the in-flight `messages` tail swap, and the detached memory fire are new. When you extend the turn, preserve that
discipline: the frozen regions are off-limits.

- **Two parallel user-adjustable model slots**: the required text slot (`TAKI_PROVIDER_*`) and an OPTIONAL vision slot
  (`TAKI_VLM_*`), which may hold identical values. A turn routes to the vision slot **iff the current message carries
  attachments**, else the text slot. Attachments with no vision slot configured are **rejected before any persistence**
  (structured error) — the text model never receives an image. Config load is all-or-nothing fail-closed (partial names
  the missing var), matching the P3-flag parse discipline.
- **Image bytes are in-flight only; TEXT is authoritative across turns.** The image reaches the model only on the turn
  it is sent (AI SDK v7 `FilePart` = `{type:"file", mediaType, data:<RAW base64>}` — NOT the deprecated `ImagePart`, and
  never a `data:` URL, which throws at the provider boundary). The persisted user row keeps the image for DISPLAY (an
  `image` part with a content-addressed ref) but its model projection is text (`[image]`+caption). History replay never
  re-sends bytes → no byte reader in the conversation store, no forcing later text turns onto the vision model, no
  choking a text-only model on an image part. Cross-turn recall comes from a **detached post-turn writer** that has the
  vision slot describe the image and stores that description as an ordinary episodic memory (thin, deletable module on
  the EXISTING memory write path — the memory engine is untouched, its redesign deferred to D28).
- **Binary refs are a closed content-addressed namespace**: `attachments/<sha256hex>.<ext>`, filename derived ONLY from
  the content hash, never from caller input. Read-side confinement is a strict whole-ref regex checked BEFORE any fs call
  (traversal is not even expressible), single-sourced in the store; the `media.*` WS methods are thin delegations and
  operator-only (no Rust mirror — see [Server-Push & Connection Auth](./server-push-and-connection-auth.md)). Retained
  bytes are swept on a configurable TTL; the description memory is never swept.

## Cancellation: Core owns post-turn callback eligibility (approved 2026-10-22)

Historical SDK 7.0.17 behavior had two endings: a resolving/AbortError-shaped body ended gracefully, while a real
Node fetch body rejected a string cancellation reason through the iterator. Core formerly inferred whether to run
post-turn callbacks from that transport-dependent throw. SDK 7.0.148 immediately cancels its internal reader and
rejects aggregate promises; it may finish gracefully before a physical fetch failure crosses provider transforms.
Its raw provider also wraps body failures in APICallError. Do not recreate the old ending with timers, polling,
synthetic throws or an outer physical-failure observer: those observations do not reliably survive cancellation.

The owner explicitly approved these contracts for the coordinated SDK upgrade:

- Keep the original signal and the SDK's supported immediate cancellation. A public graceful end remains graceful;
  a genuine surfaced error still propagates. Never change the reason into a synthetic AbortError or delay cancellation
  to recover a hypothetical physical failure. Tool cancellation and aggregate settlement retain their existing owners.
- Always finish the existing capture/commit `finally`. Delivered partial text and completed tool evidence survive;
  completed Effects are never replayed. Cancel with nothing produced retracts the exact user row and emits
  `chat.error{retracted:true}` so the client can restore the draft. Retraction remains identical for both endings.
- After persistence, retraction and surfaced failure handling, the outer turn owner calls `state.afterCommit` only if
  its signal is not aborted. This gates the existing bundle: request-pressure remeasurement, auto-memory/compaction
  maintenance, optional image-description maintenance and the detached turn-usage callback. An aborted turn starts
  none of that bundle, including a previously graceful partial cancellation.
- This is **not a ban on all memory ingestion**. `finishRecordedTurn` still calls `onPrimaryCommitted` with the exact
  eligible retained primary rows before the callback guard. Source witnessing, later extraction/maintenance policy,
  authority, eligibility, transcript identity and raw-input minimization remain unchanged.
- For partial real-fetch cancellation, `chat-send` normally emits `chat.complete` on the SDK's graceful return;
  Run, Attempt, Receipt and activity outcome remain `cancelled` through the existing signal checks. A genuine provider
  failure still emits `chat.error` and settles failed. A notification name is not the Run outcome.
- Ordinary success continues invoking the existing callback bundle. Observer/storage failures never justify replaying
  an already completed provider/tool action; model/tool Effects retain exactly-once terminal settlement.

`server/methods/chat-send-sdk-transport.test.ts` exercises actual Node fetch + local HTTP SSE, authenticated real
WebSocket send/cancel, SQLite/ConversationStore, Run/Receipt/activity, and model/tool Effect settlement. Cover prefill,
partial text/image, completed-tool-then-partial cancellation, resolving/rejecting model fixtures, ordinary success and
real provider failure. Assert notification, canonical rows, exact primary witness, callback counts and no effect replay.
`abortRejectingModel` is a scripted rejecting body, not proof of modern fetch transformation behavior. Keep direct
error/retraction tests as well; mocks and Vitest transformation do not replace the real Node boot/transport evidence.

## Classify every tool: presentation (fire-and-forget) vs informational (T1 1c)

Every tool call ends a ToolLoopAgent step, and the SDK **forces another generation** after tool results ("until there
are no further tool calls or the stopping condition is met"). For a tool whose result carries nothing to read, that
forced step has nothing substantive to say — the model pads (filler "嗯。") and drifts into answering its own last
message (owner evidence 2026-07-18, one user message → 5 assistant segments).

- **Informational** tools (screenshot, files_read, memory recall) return data the model reasons over — the loop MUST
  continue after them. **Presentation / fire-and-forget** tools (`avatar_set_expression`, `avatar_play_motion`) act on
  what the user sees and return only `{ok:true}` — the model must NOT be forced to generate again just because one ran.
- AI SDK v7 `execute` must return a value (no LiveKit-style `None`/`StopResponse` escape), so a presentation tool's
  non-continuation is enforced by a **construction-level `stopWhen` predicate**, never by the tool result shape:
  `presentationTailStop` (`packages/core/src/avatar/presentation-stop.ts`) stops the loop after a step whose tool calls
  are ALL presentation tools once the turn has produced text. The `spoke` guard preserves express-first-then-talk (a
  tool-only leading step does not stop the turn — the reply still comes).
- **Convention for every NEW tool — classify it at birth.** Presentation tool: name added to `PRESENTATION_TOOL_NAMES`,
  execute returns the Presentation Outcome (`tool-design.md` B1a; since D80 no longer a bare `{ok:true}`) or a
  structured error only. An
  informational tool must NEVER enter `PRESENTATION_TOOL_NAMES` — a step co-calling it last would stop the loop with
  its result unread. Mixed-tail steps (presentation + informational together) intentionally do NOT stop (`.every`).
  An INVALID presentation call (SDK `invalid` marker) gets one correction chance per turn (`tool-design.md` B1b).
- Prompt rules alone are unreliable across models (QwenPaw #4838: "only use the tool, don't write text" ignored by
  Qwen/GPT/Claude alike) — ship the structural stop as the guarantee; the avatar-vocabulary usage rules are bias only.
- Tests: the taxonomy edge (mixed tail must not stop) is pinned in `presentation-stop.test.ts`; the turn-level fix is
  pinned by `chat-agent-presentation.test.ts` against the transport-faithful `textTool` mock step (text + tool call in
  ONE step, finish `"tool-calls"`) — the plain two-step mock cannot reproduce the bug shape.
- **Presentation-tool `name` args are a per-turn runtime enum, not free text (T1 1e).** A costume switch changes which
  expression/motion names are playable; a stale name (remembered from a prior costume, or hallucinated) must not reach
  the Pet UI. Each turn the avatar tools build `name` as `z.enum([...current vocabulary])` (`avatar/vocab-name-schema.ts`),
  empty/unknown vocab degrading to `z.string().min(1)` (`z.enum([])` is invalid). This is the SOURCE clamp; the
  renderer's `onVocabularyDrift` re-report (1b) is the FALLBACK — a double net. An out-of-enum arg does NOT crash the
  turn: `parseToolCall` marks the call `invalid:true` and the stream loop enqueues a `tool-error` the model reads next
  step (verified in `ai@7.0.17` dist — parseToolCall catch + the `toolCall.invalid` branch), so the model self-corrects.
  This runtime enum does NOT violate #16's "no baked enum" — that rejected a COMPILE-TIME enum (multi-character /
  multi-costume can't fix names at build time); deriving the enum per turn from the live manifest is the SAME Option-A
  data, moved from the prompt into the schema. Only ever build the enum from the reported (pruned, playable) vocabulary.

## Costume-change notice: a one-shot reminder on a baseline-snapshot diff (T1 1f)

The dynamic enum stops a stale tag from taking EFFECT, but the model — primed by the persisted history of its OWN past
tool calls — may still TRY a prior costume's tag on its first post-switch turn (a wasted invalid round-trip, self-corrected
by the tool-error feedback; the provider treats enum as a hint, so the client zod check is what catches it). A one-shot
notice biases it to switch immediately: when the worn costume changed since the model last saw it, prefix a short
`[System · no reply needed] Costume changed...` note onto the MODEL-FACING last user message (an additive seam at outgoing
construction — the persisted `history` is never mutated; one-shot; not stored).

- **Decide on a baseline SNAPSHOT, not an adjacent diff.** Store the worn costume id + `lastSeen` (what the model saw
  last turn); `set()` updates current but does NOT advance lastSeen; a turn-time `consumeCostumeChanged` returns true
  (and advances lastSeen) iff current ≠ lastSeen. This handles churn (A→B→C→A with no turns between → current==lastSeen
  → no notice) that an adjacent-diff (each set vs the previous) would false-fire on.
- **Baseline at first CONSUME, not first SET** — order-independent, so a boot sequence report(undefined)→report(id)
  snapshots the promoted costume as baseline instead of firing a spurious turn-1 notice.
- **`set(costume=undefined)` keeps the last id** (a drift self-heal re-report carries no costume) — never clobber to
  undefined, or a self-heal fakes a change / the next real switch looks unchanged.
- Identify a costume by its UNIQUE id (arbeit / arbeit_ring_01), NOT by comparing tag-set contents (two costumes can
  share a tag set). The id rides `avatar.report` as an additive optional `costume` field (operator-only, no Rust mirror).
- Narrow edge: a cancel-retract of the first post-change message advances lastSeen anyway → one possibly-skipped notice,
  backstopped by the enum. Accepted.

## Untrusted external content enters a prompt ONLY through the fence (T3a, A1 minimal)

Any string sampled from the outside world — a window title, screen text, a VLM description — is an injection surface
(a title can literally read "ignore previous instructions"). The rule: such content reaches a prompt ONLY wrapped by
`agents/untrusted-fence.ts::fenceUntrusted({source, content})` — an XML `<untrusted-observation source=...>` block whose
label declares the payload DATA-never-INSTRUCTIONS (Hermes smart-review XML-delimiting [H-APR:2585]; survey injection-trap
mandate). Never hand-roll a second fence or paste raw sensed text into a section.

- **Escape-proof by construction**: the fence neutralizes any literal `</untrusted-observation>` inside the content
  (case-insensitive, U+200B wedge) so the payload cannot close the fence early; the `source` attribute strips
  quote/angle chars. Both properties are unit-pinned — extend those tests when touching the fence.
- **Producers fence at render time, not at storage time** — store raw (bounded) data; fence where it joins a prompt
  (the activity block fences in `render-activity.ts`; the join stays in `instructionsExtra`, ruling 10).
- **Scrub-then-fence, once at the sense seam** (T3b): sensed text is minimized by `perception/pii-scrub.ts::scrubPii`
  BEFORE it is fenced and before it is stored, so the prompt path and any store inherit the same string. The fence is a
  *labelling* control, the scrub a *content-minimization* one; they compose in that order, never the reverse.
- The screenshot VLM description is fenced on the TOOL-RESULT path (`screenshot-tool.ts::safeDescription`) and on the
  ambient path (`perception/screen-context.ts`) — D44 CLOSED (T3b). Remaining debt: a description written to episodic
  memory is scrubbed but carries no observed-origin marker for the assembler to fence at render (D47).
- **Ambient context joins via `instructionsExtra`, event notices via the outgoing-message seam** — an always-current
  status block (activity) is a per-turn system-prompt section; a one-shot event (costume change) is a message prefix.
  Pick by shape, don't mix.

## Ambient observation: two privacy layers, fail-closed, silent when off (T3b)

Everything that observes the user *without being asked* composes in ONE place: `perception/perception-layer.ts` builds
the privacy controls (Privacy Pause, sensitive-process skip, PII scrub) once and hands them to every sampler, so adding
a sampler never adds a privacy decision. On-demand chat captures are deliberately NOT part of this layer — they are
explicit in-the-moment consent through the Gate, and the pause never gates them.

- **TWO independent layers over ambient capture; neither replaces the other.** *Layer 1 — deterministic, prevents
  TRANSMISSION*: the exe-name skip (`perception/sensitive-processes.ts`), `ActivityState.seal()` on a sensitive hit,
  and one FRESH `foreground-window` screen taken immediately before every capture (`perception/foreground-screen.ts`)
  — which NARROWS but does not close the gap: foreground and capture are still two WS round-trips, so the residual
  non-atomic window is real and tracked (D48), never described as closed.
  *Layer 2 — semantic, prevents RETENTION/USE*: the mandatory ambient VLM pass doubles as a privacy screen
  (`perception/sensitive-screen.ts` — a structural `SENSITIVE_SCREEN` sentinel whose matcher is deliberately more
  forgiving than the prompt); a sensitive verdict discards the frame whatever the retention config says, publishes
  nothing, and logs neither the description nor the window identity. Layer 2 can NEVER substitute for layer 1: the VLM
  is a REMOTE endpoint, so by the time it can judge a frame the pixels have already left the machine. Layer 1 in turn
  cannot see inside an app (incognito is still `chrome.exe`) — hence both, always.
- **Fail-closed is the rule for any observation we cannot screen.** Route failure, schema miss, no focused window, no
  process name, a foreground sample older than the freshness tolerance — all collapse into ONE refusal: the correct
  reaction to each is identical, and distinguishing them tempts a log line that discloses more than "we did not look".
  A capture we cannot screen is exactly the one to refuse, and a refusal never names what it refused to look at.
- **Seal, do not merely drop.** A sensitive foreground makes the activity sampler call `state.seal()` — argument-less
  and data-free (no name, no title, no timestamp) — ending the live stretch so a sibling sampler's unknown-foreground
  guard refuses instead of acting on the last non-sensitive entry. It self-clears by construction: the next ordinary
  sample opens a fresh entry and observation resumes on the very next tick, so no reset and no permanent block exists.
- **Off by default means SILENT, not merely denied.** Without an explicit enable the ambient sampler is not scheduled
  at all: zero captures, zero dialogs — and deliberately no log line either, because a boot-time "ambient sampling
  disabled" line advertises a feature the user never enabled (Recall's off-state).
- **A pause is a withdrawal of consent, so it survives a restart.** The flag is DB-persisted (`db/privacy-pause-repo.ts`
  — one row, an ABSOLUTE deadline that settles on read, so boot needs no "was that yesterday" special case) and
  hydrated through the FACTORY, never through a mutator: restoring must not look like a mutation, because the mutators
  have exactly ONE production caller — the operator-only `perception.pauseSet`. That single-writer property is the
  proof the agent cannot un-pause its own observation; it is source-swept by `privacy-pause-writer.test.ts`.
- Pause writes persist successfully before changing live consent or notifying observers. A failed durable resume
  must leave the previous pause effective. The interested-operator projection owns one bounded absolute-deadline
  wake-up through the existing `pause.state(now)` read, including when samplers have stopped; it never becomes
  another writer or calls a resume/capture/model path. See
  [operator resource invalidation](server-push-and-connection-auth.md#scenario-operator-resource-invalidation).
- Perception refresh observes accepted/scrubbed source and scheduled-loop transitions. `current` means the latest
  sampled stretch, including its pre-dwell stage; `recent` still applies the existing dwell filter. A scheduled
  sampler flag does not prove current foreground identity, Host availability or capture progress. Refresh adds no
  faster sampling, raw window listener, stronger in-flight cancellation, or resolution of the D48 timing gap.
- **Retention is enforced by a sweeper, and ambient frames live in their own store.** A retention policy nobody sweeps
  is not a policy: `perception/ambient-shot-gc.ts` sweeps at boot and on an interval regardless of the enable flag
  (frames captured before ambient sensing was switched off must still expire). Ambient frames get their own directory
  AND their own filename prefix (`perception/ambient-shot-store.ts`), so an automatic aggressive sweep is structurally
  unable to address a user-requested capture even if it were pointed at the wrong directory.
- **One identity rule, single-sourced.** The stale pre-filter and the fresh pre-capture screen compare foregrounds with
  the SAME key (`foregroundKey`, over the already-SCRUBBED title) or they drift — and a drift here is a capture taken
  on an assumption nobody re-checked. An ambient observation also carries its age and stops rendering once stale
  (`perception/screen-context.ts`). Successful consent/source retirement clears the cached screen immediately;
  staleness remains a fallback. See [Accepted Perception Evidence](./perception-evidence.md) for post-await checks.

## Time enters prompts from ONE module, stable-early / volatile-late (time-awareness task)

The agent's time sense is assembled, never ambient: `core/time/time-context.ts` is the SINGLE home for prompt-facing
time rendering (day-date line, tail time line, relative ages, the T4-reserved wall-clock) — never scatter `new Date()`
formatting into prompt code. Grounding: Hermes date-only-in-cached-prefix + anti-churn comment; Claude Code day-date
practice; the pull-only shape was rejected on evidence (models never proactively check time — Hermes wall-clock fix PR,
4 Claude Code issues; survey `research/time-awareness-survey.md`).

- **Stable-early / volatile-late is a UNIVERSAL rule, not provider tuning**: the day-granularity date sits right after
  the base prompt (byte-stable for a calendar day → prefix-cache-safe on every exact-prefix-caching provider, harmless
  elsewhere); the minute-granularity time line is the LAST section (the memory sections before it already vary per
  turn). ZERO provider-conditional code, no provider-private cache APIs (owner hard principle 2026-07-21) — provider
  cache docs may be consulted as COST notes only, never as design inputs.
- **Ages are computed by code, never by the model** (models miscompute date arithmetic): memory bullets render
  `(3 days ago)` via `formatRelativeAge`; future/unparseable timestamps degrade to "just now", never negative/NaN.
- **`get_current_time` is an informational pure-Core tool** (no OS crossing → no Gate); its description tells the
  model NOT to call it for the date/rough time (already injected) — pull covers only precision/timezone.
- **User Timezone comes from its existing service**, never the headless Core's process zone. Ordinary ChatAgent
  requests capture the optional live port once per attempt for both day/time lines and label the zone explicitly;
  the exact-time tool reads that same authority once per invocation. A settings update requires no primary cancellation:
  the captured attempt stays coherent and the next attempt/invocation reads the new zone. Omitted ports retain legacy
  behavior. See [User Timezone Authority](user-timezone.md) for composition and regression requirements.
- Prompt WORDING about time discipline (awareness norms) is deliberately absent — it lands with T4's prompt-design
  pass, as one optimization, not piecemeal.

## Provider request prefixes are semantic and canonical

- Fresh Run/Attempt/effect/correlation identities remain in Core state, events, telemetry, governance, approvals, and
  execution closures. They never enter model-visible system instructions or tool schemas solely for correlation.
- ChatAgent assembles one ToolSet per Attempt and supplies a complete provider-facing `toolOrder`, sorted by the
  locale-independent comparator `a < b ? -1 : a > b ? 1 : 0`. Execution lookup continues to use the same captured
  ToolSet and closures.
- Within one tool-loop Run, each continuation strictly append-extends the prior provider messages. Across ordinary
  Turns, the stable prefix reaches the prior plain user text; its old non-persisted `<turn-context>` tail is
  intentionally absent and is an explained boundary, not a persistence target.
- Regression tests compare structured system/tool request values without logging prompt content. Real cache acceptance
  reads provider-neutral normalized usage per request and keeps compaction/window movement outside the fixture.

## Scenario: Scheduled Task Trigger Provider

### 1. Scope / Trigger

Use this contract whenever a durable clock provider (`at`, `every`, or `cron`) starts an Agent turn. A Scheduled Task
is provider policy above the existing Harness; it never owns a second model loop, queue, Run/Attempt store, event
ledger, receipt authority, or recovery coordinator.

### 2. Signatures

```ts
type ScheduledOccurrenceKey = { taskId: string; scheduledFor: string };

interface ScheduledRunAdapter {
  dispatch(taskId: string, occurrence: ScheduleOccurrence): Promise<string>; // existing runId
  reconcile(): void;
}

interface ScheduleEngine {
  start(): Promise<void>;
  rearm(): void;
  stop(): Promise<void>; // resolves only after an in-flight pass settles
  runDue(): Promise<void>;
}
```

The database authority is `scheduled_tasks(task_id)` plus the content-bearing outbox
`schedule_occurrences(task_id, scheduled_for)`. The outbox captures immutable `character_id`, task revision, control
input, fire/late metadata, and the linked `run_id`; terminal reconciliation scrubs control input.

### 3. Contracts

- Each `(taskId, scheduledFor)` admits or reuses exactly one Harness Run with a deterministic idempotency key.
- The Scheduled `TriggerRequest` uses `initiator=scheduled`, `deliveryClass=class_a`, `contextMode=autonomous`,
  `provenance.provider=scheduled-task`, and `provenance.taskId=taskId`.
- Dispatch acquires the existing Character `TurnQueue`, registers the existing `TurnRegistry`, and invokes ChatAgent
  with `turnKind=non-primary`, ephemeral `controlInput`, and the admission-captured Run context.
- `schedule_task` is created for the active primary Character and is absent from non-primary Scheduled turns.
- Croner is imported only by the calendar adapter. Core owns persisted definitions, catch-up, idempotency,
  single-flight execution, shutdown, and recovery.
- Raw schedule/control payloads never enter Pino, Run Events, Receipts, telemetry, or ordinary diagnostics. Bounded
  task/run identities and closed error codes are allowed.
- The persisted User Timezone resolver currently defaults to UTC. Later authority updates call the same resolver/rearm
  seam and do not change task or Run identity.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Invalid `at`/`every`/`cron` or IANA timezone | Refuse before persistence with `SCHEDULE_REFUSED` |
| Stale mutation revision | Return `SCHEDULE_CONFLICT`; do not re-arm or partially mutate |
| Unknown/deleted task | Refuse or settle the pending occurrence as missed; never fabricate a Run |
| Duplicate timer callback or restart retry | Reuse `(taskId, scheduledFor)` and the deterministic Run idempotency key |
| One-shot more than 24 hours late | Mark missed; do not invoke the model |
| Recurring occurrence more than half a period late | Advance from the latest overdue slot and mark missed |
| Run admission/dispatch failure before linkage | Keep the occurrence pending and re-arm a bounded retry |
| Terminal linked Run | Mark occurrence terminal and scrub its control input |
| Core shutdown during a scheduler pass | Stop new timers, await the in-flight pass, then close Run/database resources |

### 5. Good / Base / Bad Cases

- Good: a recurring task wakes after downtime, selects the latest eligible source slot, claims one occurrence, admits
  one Scheduled Run, executes through the Character queue, and scrubs the outbox payload at terminal settlement.
- Base: no enabled or pending tasks means no armed timer and no model call.
- Bad: a timer callback invokes ChatAgent directly, reads the task's current Character after an occurrence was claimed,
  exposes `schedule_task` recursively, logs control input, or closes SQLite before an in-flight pass settles.

### 6. Tests Required

- Shared schema: strict accepted forms, bounded content, invalid timezone/form rejection, closed error-code mirrors.
- Migration/repository: fresh and historical lineage, 029 -> 030 Character backfill, reopen no-op, revision conflicts,
  occurrence uniqueness, payload scrubbing, and immutable Character ownership after task edits.
- Calendar: `at`/anchored `every`/`cron`, DST spring gap and fall ambiguity, latest-overdue selection, 24-hour and
  half-period cutoffs, and backlog coalescing.
- Runtime: canonical TriggerRequest fields, Run idempotency, Character serialization, non-primary Timeline/costume/
  auto-memory behavior, Attempt retry, failure settlement, pending retry, and terminal reconciliation.
- Tool/API: active-Character binding, recursion exclusion, operator-only methods, and structured conflict/refusal errors.
- Lifecycle: single-flight timers, `unref`, re-arm, never-throw callback boundary, isolated boot, and shutdown drain.

### 7. Wrong vs Correct

#### Wrong

```ts
timer.onFire(() => agent.stream({ characterId: task.characterId, message: task.controlInput }));
```

This bypasses durable occurrence identity, immutable Character capture, Run admission, queueing, recovery, receipts,
and privacy boundaries.

#### Correct

```ts
const occurrence = repo.claimOccurrence({ taskId, characterId, scheduledFor, controlInput, ...evidence });
if (occurrence) await scheduledRuns.dispatch(taskId, occurrence);
```

The adapter then admits the canonical TriggerRequest and executes through RunService, TurnQueue, TurnRegistry, and the
ChatAgent non-primary seam.
