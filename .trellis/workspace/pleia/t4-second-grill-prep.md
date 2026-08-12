# T4 Second Grill Preparation — Proactivity, Scheduling, and the Memory Boundary

> **Status:** second owner grill in progress. This document records verified inputs, question order, and owner rulings
> as they crystallise. It is not a PRD and authorizes no implementation.
>
> **Prepared:** 2026-08-09, after T5 landed, ADR 0009 was drafted, and D59/D61 passed their single formal check.
> **Owner rulings updated:** 2026-08-10.

## 1. Scope and non-goals

This pass exists because the original T4 research was completed before three material changes:

1. T5 removed automatic per-turn retrieval and changed the Replay View and memory surfaces.
2. The Core-owned operator config store and Home settings family now exist.
3. ADR 0009 replaces the file-first memory target with one Memory Authority, Canonical Memory Records, a provider-neutral
   Memory Tool Contract, a local Memory Replica, and Pending Memory during Hindsight outages.

The second grill therefore does **not** re-litigate T4 R1–R12. It only resolves new cross-boundary questions or old
research recommendations whose premises no longer match the repository.

Out of scope for this preparation pass:

- creating a T4 Trellis task;
- installing `croner`;
- changing T4/T5 production code, schemas, migrations, config, or prompts; glossary and decision documents may be
  updated only when the owner resolves a term or design branch during the grill;
- repeating the D59/D61 formal `trellis-check`;
- choosing implementation values that the owner has not yet ratified.

## 2. Authority order

Use these sources in this order when they disagree:

| Priority | Source | What it governs |
| --- | --- | --- |
| 1 | `CONTEXT.md` | Canonical domain terminology and concept boundaries |
| 2 | `docs/adr/0008-replay-view-context-seam.md` and `docs/adr/0009-single-memory-authority-with-local-replica.md` | Hard architectural decisions |
| 3 | `.trellis/workspace/pleia/t4-decisions.md` and `t5-decisions.md` | Owner-ratified product and runtime decisions |
| 4 | `.trellis/spec/backend/*` and `.trellis/spec/frontend/*` | Executable engineering contracts |
| 5 | Current production code and tests | What the repository actually does today |
| 6 | T4/T5 research banks | Evidence and recommendations; historical proposals are not decisions |

`docs/MEMORY-DESIGN.md` explicitly distinguishes the current Markdown runtime from ADR 0009's target. Code that still
implements the current file-first engine is runtime truth today, but not permission to couple new T4 design to that
substrate.

For the remaining owner grill, prefer evidence in this order: Taki's ratified documents and current contracts; the
existing OpenClaw/Hermes research documents in this workspace; the checked-out implementations under `references/`
when the documents do not establish the behavior; and external MCP research only when the local evidence remains
insufficient. Do not ask the owner to decide a question that those sources can answer as an engineering fact.

## 3. Verified current state

### 3.1 Reliability closeout and transport liveness

- D59/D61 production code and one formal check are complete, but the active task remains open for owner manual
  acceptance and commit (`docs/HANDOFF.md` §1 and §4).
- Pet, Home, and Chat now own independent authenticated/restored WebSocket generations. D59 recovers after an observed
  close or active request failure.
- Passive half-open detection and sleep/resume detection are explicitly left to T4
  (`.trellis/spec/frontend/operator-connection-recovery.md` §1).
- `CONTEXT.md` reserves **Heartbeat** for an LLM proactivity turn and explicitly rejects keepalive/ping/networking
  liveness as that term. The D59 residual must therefore be named **transport liveness probe** (or an equally precise
  networking term), never Heartbeat.

### 3.2 T5 and the current memory runtime

- T5 R6 shipped: no search-driven memory block is injected every turn. Deterministic push contains persona, Memory
  Blocks, pinned rows, and at most one message-matched intention; searchable memory is pulled through `memory_search`.
- `packages/core/src/agents/chat-agent.ts::composeInstructions` still depends on the concrete current
  `MemoryEngine.assemble({ characterId, currentMessage })` surface.
- `packages/core/src/memory/auto-memory.ts` already declares
  `TurnOrigin = primary | heartbeat | flush | subagent` and accepts it in `onTurnCompleted`, but the origin currently
  changes only log fields. Episodic, flush, tidy, and compaction behavior still runs identically for every origin.
- `packages/core/src/memory/entry.ts::MemoryOrigin = self | observed` describes **content provenance/trust**, not the
  initiator of a turn. It cannot be reused for T4 execution provenance.
- Current `intentions` rows have an optional expiry but no first-class due-time/commitment contract. The agent-facing
  `memory_write` tool cannot set `expires`, and the current assembler only surfaces an intention when its disclosure
  text matches a user message. A no-user-message Heartbeat therefore cannot consume a real "due commitment" surface
  from current code.
- ADR 0009's Canonical Memory Record, provider adapters, replica, pending outbox, change cursor, and provider-neutral
  Memory Tool Contract are target design, not implemented production paths yet.

### 3.3 Current autonomous-turn seam

- `chat-agent.ts` still unconditionally persists a user row before each turn, consumes the one-shot costume-change
  notice, builds a user-message-specific Replay View tail, and fires detached auto-memory afterward.
- The model loop, persistence core, overflow retry, abort behavior, and approval gate remain D1-frozen. T4 must use
  additive pre-loop/construction/post-loop seams rather than fork or rewrite that machinery.
- `TurnQueue` exposes blocking `acquire` only. `TurnRegistry` exposes `begin/end/cancel` only. There is no `tryAcquire`,
  queued-work cancellation, or busy probe.
- Deferred decision D15 becomes relevant when proactivity adds more queued work: a `chat.send` whose socket closes while
  it waits for the turn lock still runs after it eventually acquires the lock.

### 3.4 Delivery and UI

- R3 and R12 are binding: a spoken proactive message uses the ordinary timeline path and appears whole in the Pet
  bubble. No `proactive.*` protocol is allowed.
- The Home chat already subscribes to and reconciles the ordinary timeline. The Pet bubble still renders only the
  `chat.delta` stream belonging to a bubble-initiated request; it does not yet subscribe to timeline appends.
- A silent or avatar-only Heartbeat must not create a fake user row or a visible empty conversation turn.
- The timeline schema currently has no initiator, delivery class, run identity, or hidden/internal-lane metadata.

### 3.5 Config and scheduling

- The Core-owned sparse config store now exists. Operator-visible proactivity knobs must use the registry and the same
  persisted authority the Home panel edits; old env-only/JSON-store suggestions are superseded.
- `croner` remains absent from dependencies. Research verified that it is a pattern evaluator and in-process timer,
  not persistence, startup catch-up, or a run ledger.
- `renderWallClock` already exists as the T4-reserved prompt renderer, but scheduling currently has no explicit global
  IANA timezone setting. `core/time` uses the Core process's local timezone. That is unsafe as the final authority in
  the supported VPS topology, where Core-local time may differ from the user's wall clock.

## 4. Terminology that must remain separate

| Concept | Recommended canonical shape | Must not be confused with |
| --- | --- | --- |
| Agent Heartbeat | Approximate, no-user-message LLM turn; Class B judgment; silence normal | WebSocket ping/pong, transport keepalive, scheduler tick |
| Transport liveness probe | Deterministic connection health detection for half-open/sleep-resume recovery | Agent Heartbeat |
| Scheduled Task | Persisted exact-time/interval intent whose fire starts a `scheduled` Agent run; normally Class A | Alarm/literal-message timer, Heartbeat checklist item, Memory Replica sync job |
| Hook | Deterministic event-to-action binding; zero LLM by default | Scheduled Task, Heartbeat |
| Turn initiator | Why an agent turn exists: proposed `primary | heartbeat | scheduled | flush | subagent` | Delivery class, content provenance |
| Delivery class | `A` expected/deterministic-trigger vs `B` autonomous judgment | Turn initiator |
| Content provenance | Where remembered content came from and how it should be trusted/fenced | Turn initiator |
| Authority state | Local/Hindsight authority, replica state, Pending Memory state | Delivery class or turn initiator |

The original four-value `TurnOrigin` is incomplete for T4 because it has no `scheduled` value. Treating scheduled work
as `heartbeat` would erase R4's Class A/Class B distinction in exactly the place where memory provenance and delivery
policy need it most.

## 5. Premises in the old T4 research that are now obsolete or incomplete

| Old premise or conflict | Current correction |
| --- | --- |
| Add `proactive.*` schemas and a third subscription registry | Superseded by R3. Reuse ordinary timeline delivery; Pet subscribes to the relevant timeline path. |
| Persist turn context in Markdown frontmatter and then mirror it into the derived DB | ADR 0009 retires Markdown as active memory storage. Turn initiator belongs in provider-neutral operation provenance / Canonical Records, not a file-only patch. |
| Use `origin` for `primary | heartbeat | flush | subagent` | `origin` already means `self | observed` content provenance. Use separate fields/types. |
| Four turn origins are sufficient | Scheduled agent turns need their own initiator. |
| Passing an origin into `autoMemory` prevents pollution | False today. It only changes logs; non-primary policy is not enforced. |
| Heartbeat can pass `""` into the old assembler and still obtain useful recall | T5 R6 removed automatic retrieval, and current intentions require a user-message disclosure match. T4 needs a dedicated provider-neutral context/commitment surface. |
| A plain `workspace/heartbeat.md` is automatically the right authority | It conflicts with the already-ratified "panel authority, dual entry, one storage" rule and the structured-condition checklist design in `docs/devlog/m5.md`. This needs a fresh owner ruling. |
| Proactivity config may be env-only or a private JSON file | Superseded by the Core config store and Home panel contract. |
| Heartbeat engine defaults are `2/hour, 10/day, 10 min gap` | R9 later ratified `2/hour, 8/day`, approximately 15-minute beats, and 23:00–08:00 quiet hours. The research's 4 LLM beats/hour and 60-second pre-check are separate engine budgets, not utterance limits. |
| One-shot catch-up cutoff is two hours | Superseded by R1: 24 hours for one-shots; half-period for recurring entries; one coalesced late run with a `late` marker. |
| Privacy Pause is obviously a speech mute | G2-04 closes Sampling-backed event sources without muting unrelated Heartbeat sources. |
| Runtime-local timezone is sufficient | G2-05 makes the Core-owned User Timezone follow one designated authority device or remain fixed; VPS local time is never the user authority. |
| `heartbeat_respond` can simply join generic presentation-tool stopping | The existing presentation stop requires prior spoken text. A silent terminal response needs its own terminal stop rule; otherwise it can consume the step budget. |
| All background turns can share the visible conversation timeline | Silent/tool-only autonomous runs conflict with the user-facing relationship stream and auto-memory watermarks; spoken utterances still need ordinary timeline continuity. |
| D59's remaining "heartbeat" is the same T4 Heartbeat | It is transport liveness, a deterministic networking concern with no model, memory, or timeline side effects. |

## 6. Dependency map after ADR 0009

```text
Shared clock / persistence primitives
├── User Scheduled Tasks
│   ├── exact/interval pattern evaluation
│   ├── catch-up + late marker
│   ├── Class A policy
│   └── mandatory `scheduled` Agent-turn execution
├── Agent Heartbeat
│   ├── deterministic pre-checks
│   ├── thin provider-neutral context
│   ├── Class B policy
│   └── heartbeat_respond terminal outcome
└── Memory Replica synchronization
    ├── internal fixed-interval poll
    ├── ADR-defined catch-up/retry state
    └── no agent turn, no schedule_task row, no delivery class

Autonomous agent-turn runner
├── shared D1-frozen model/tool/persist machinery
├── explicit turn initiator
├── restricted tool set
├── provider-neutral memory context/tools
└── result routing
    ├── silent/internal run record
    ├── avatar-only presentation
    └── spoken ordinary timeline entry -> Home chat + Pet bubble
```

The scheduler may share low-level clock, persistence, catch-up, retry, and single-flight primitives with Memory Replica
sync. It must not make replica sync look like a user Scheduled Task or expose it through `schedule_task`.

## 7. What can proceed in parallel with the memory redesign

| May proceed after T4 PRD | Must wait for a provider-neutral memory contract | Shared hotspots requiring sequencing |
| --- | --- | --- |
| Schedule pattern parser/evaluator | Heartbeat Memory Block/index projection | `packages/core/src/agents/chat-agent.ts` |
| Schedule repository and catch-up engine | Due commitment query | `packages/core/src/main.ts` or its extracted composition helpers |
| Rate/quiet/backoff policy | Memory write/mutation tools and provenance | Config registry and migrations |
| Wake queue, debounce, coalescing | Pending Memory overlay policy | Memory bootstrap/provider selection |
| Busy-yield primitives and D15 queued cancellation | Provider-specific maintenance hook | Shared protocol/index exports |
| `heartbeat_respond` schema and terminal stop | Hindsight/Local capability metadata | Any timeline metadata or autonomous-run ledger migration |
| Pet timeline subscription and whole-message bubble | Replica sync status integration | Settings page rows shared by both efforts |
| Transport liveness probe and sleep/resume recovery | Canonical Record identifiers/authority epochs | — |

The key integration strategy is contract-first: T4 consumes narrow provider-neutral reads/tools and never imports the
current Markdown store, `MemoryRepo`, or Local-only tidy internals.

## 8. Decisions already fixed — do not ask again

1. **Catch-up:** R1's 24-hour one-shot cutoff, half-period recurring cutoff, one coalesced late run, and `late` marker.
2. **Delivery path:** ordinary timeline only; no `proactive.*` protocol (R3).
3. **Class split:** Class A and Class B have separate budgets and quiet-hour behavior (R4).
4. **Silence scope:** silence guidance is Heartbeat-turn-only (R5).
5. **Primary response contract:** structural `heartbeat_respond`; sentinel is at most a defensive fallback (R6).
6. **Ambient placement:** fenced/scrubbed observation remains in the sanctioned system/Replay View path (R7 + ADR 0008).
7. **Correctness strategy:** deterministic pre-checks and thin context; no second gate model in v1 (R8).
8. **Factory posture:** conservative, configurable defaults; no pure-companionship no-reason utterances in v1;
   ignore-backoff exists (R9–R11).
9. **Bubble behavior:** a proactive message appears whole, not streamed (R12).
10. **Memory authority:** no automatic failover, no active-active Local/Hindsight pair, no direct mutation of a replica
    (ADR 0009).
11. **Memory retrieval:** no automatic retrieved block; Heartbeat may use deterministic Memory Blocks/index and explicit
    provider-neutral pull, not resurrect the removed assembler retrieval path (T5 R6).
12. **Config authority:** Core-owned persisted config and panel parity; no UI-owned or private duplicate settings store.
13. **Transport recovery:** no periodic blind avatar re-subscription as a substitute for connection health; D59
    generation restoration remains the recovery mechanism after liveness detects failure.

## 9. Second grill: owner decisions, in recommended order

The live grill must ask **one item at a time**. Each question below includes the leader recommendation; it is a prepared
queue, not a request to answer all at once.

### G2-01 — What is the authoritative Heartbeat checklist representation? — RESOLVED

**Why owner input is required:** two prior decisions conflict. The research recommends a tiny user-owned
`heartbeat.md`; the M5 customization ruling requires agent-learned habits to be structured configuration rows that are
visible/editable/deletable in the panel and share one Core store.

**Owner ruling (2026-08-09):** typed Core-owned checklist rows are the only authority, with explicit
condition/silence criteria, enabled state, source, optional cadence/expiry, and panel parity. T4 does not implement
`heartbeat.md`, Markdown import/export, an advanced Markdown editor, or synchronization with a file representation.
Extensibility comes from the structured schema, shared Core API, and agent/panel parity rather than an additional
storage format. This preserves skip-when-empty determinism and prevents vague self-written prose from becoming an
unbounded spam source without creating speculative compatibility work.

### G2-02 — What is the final turn-initiator taxonomy? — RESOLVED

**Why owner input is required:** current T5 code has four values but T4 introduces exact Scheduled Task turns that are
not Heartbeats.

**Owner ruling (2026-08-09, accepted in principle):** preserve the five distinct semantic initiators
`primary | heartbeat | scheduled | flush | subagent`. Keep `DeliveryClass = A | B` and content provenance separate. A
`scheduled` Agent run is normally Class A and a `heartbeat` run is Class B. G2-06 later established that every
Scheduled Task fire starts a `scheduled` Agent run. Exact enum spelling may be normalized while drafting the PRD, but the
categories must not be collapsed into `heartbeat`, `background`, or another generic fallback. Missing initiator must
fail closed at code boundaries, while legacy stored data may remain optional during migration.

G2-06 later fixed every Scheduled Task fire as a `scheduled` Agent run, so no product ambiguity remains. Exact enum and
wire spelling are PRD/implementation normalization, not an owner question.

### G2-03 — Where are silent/tool-only autonomous runs persisted? — RESOLVED

**Why owner input is required:** R3 requires spoken output in the ordinary timeline, but the relationship timeline
must not receive fake user rows or silent beats. At the same time, D1 established that losing tool-call/result evidence
causes later false claims.

**Reference evidence:** OpenClaw separates run from delivery: Scheduled Tasks have durable run history, while ordinary
Heartbeat checks do not create task records. Hermes creates a durable execution attempt before cron dispatch, runs the
Agent in a separate persisted cron session containing message and tool evidence, and saves the run output before
`[SILENT]` suppresses delivery. Both designs reject treating delivery visibility as proof that an execution did or did
not occur.

**Owner ruling (2026-08-09):** use dual persistence with a shared presentation surface and on-demand context recovery:

- actual Companion speech persists through the ordinary relationship timeline and participates in normal Replay View;
- every claimed Scheduled execution and every eligible Heartbeat Agent run writes an internal Autonomous Run History
  record containing initiator, trigger/run identity, timing, terminal outcome, delivery class, linked timeline sequence
  when spoken, and bounded tool-result evidence/audit;
- silent and avatar-only Heartbeats create neither a relationship-timeline row nor a Run Receipt;
- user-expected background work, such as a Scheduled Task or delegated long-running task, normally projects a durable
  structured Run Receipt into the Home conversation surface when it completes. The receipt is sourced from the run
  record, carries a stable `runId`, contains a useful bounded summary and status, and does not become an assistant
  utterance or enter the default Replay View;
- the Companion can query the receipt's linked run evidence when the user asks about it, so raw execution context stays
  isolated without semantic amnesia;
- deterministic pre-check ticks that do not start an Agent run update bounded status/metrics with their named skip
  reason rather than appending an unbounded durable row every minute;
- no synthetic user row is ever stored, and the existing conversational Tool Card is not reused as a Run Receipt.

**Owner clarification (2026-08-10):** keep the product free of a user-visible session list while making the internal
boundaries explicit. `characterId` owns the continuous relationship timeline, `taskId` owns one persisted Scheduled
Task definition, `runId` owns one isolated Autonomous Run and is its resume/query key, and `attemptId` distinguishes
retries inside that run. A recurring task starts a fresh `runId` on each fire rather than accumulating an unbounded
task transcript; a paused approval or recoverable interruption resumes the same `runId`. If an SDK adapter requires a
field named `sessionId`, it maps internally to the existing relationship or run identity and must not introduce a
second history authority or user-facing chat session. The exact ledger/receipt schema and retention period remain PRD
and implementation work. ADR 0010 records the durable boundary.

### G2-04 — Does Privacy Pause suppress proactive output, and which classes? — RESOLVED

**Why owner input is required:** the glossary promises a halt to Sampling, not a global mute. T4 research used Privacy
Pause as a broad pre-check, while R4 says explicit Class A work has different delivery semantics.

**Reference evidence:** OpenClaw's active-hours/quiet-hours controls govern delivery independently from trigger and
message class; Hermes has no equivalent Privacy Pause or quiet-hours mechanism. Neither provides a basis for treating a
sensing control as global mute. Taki's glossary explicitly defines Privacy Pause as stopping Sampling and rejects
`mute`/`do-not-disturb` as synonyms.

**Owner ruling (2026-08-10):** treat acquisition and delivery as separate axes, using source-driven eligibility rather
than per-action Privacy Pause modes. Sampling-derived Heartbeat work is armed by meaningful typed events from its
declared `sampling.*` source; raw sampling ticks never call the Agent directly. Privacy Pause closes those event
sources, invalidates the prior observation generation, and discards unconsumed sampling wake reasons. With no fresh
sampling event, the corresponding checklist rows never become eligible and make no model call. Resume does not replay
the old backlog; only a fresh post-resume observation may produce a new event.

This centralized source boundary supersedes the old research draft's blanket `privacy-paused` Heartbeat pre-check and
does not add `required | optional | none` pause labels or scattered action-level conditionals. Clock-, memory-, and
known-completion sources remain independently eligible under their ordinary quiet-hours/rate policy. An explicit Class
A job that itself requires Sampling reports or retains an honest `blocked/paused` state rather than fabricating a
result. If a future full mute/DND control is wanted, give it a separate name and setting rather than overloading
Privacy Pause.

### G2-05 — What is the authoritative timezone model? — RESOLVED

**Why owner input is required:** schedules, quiet hours, catch-up, and "until tomorrow" need a wall-clock authority.
Core process local time is not reliable in VPS mode, and the prose Identity Card is not a machine-readable config
authority.

**Owner ruling (2026-08-10):** the Core owns one persisted IANA **User Timezone** with two explicit modes: `fixed` and
`follow_device`. In `follow_device` mode, exactly one authenticated **Timezone Authority Device** may update it from
that device's reported IANA timezone. Other desktop/mobile clients may report and use their own timezone for local UI
rendering, but cannot compete through arbitrary last-writer-wins updates. The authority device is user-selectable; while
it is offline, the Core retains the last confirmed User Timezone.

The VPS/Core execution clock remains UTC and never trusts a client clock as the timer. Quiet hours and user-relative
wall-clock rules use the User Timezone. A schedule may instead pin an explicit IANA timezone; an absolute instant stays
an absolute UTC instant. Persist the originating wall-clock pattern and timezone policy, treat `next_run_at` as derived
state, and recompute it when the User Timezone changes or the Core restarts. A timezone update does not replay an old
backlog blindly; any genuinely missed occurrence still follows R1 catch-up/coalescing policy.

### G2-06 — Are simple reminders literal delivery or always agent turns? — RESOLVED

**Why owner input is required:** the old scheduler design sends every fire through an LLM turn, although many Class A
reminders need neither judgment nor tools.

**Owner ruling (2026-08-10):** every Scheduled Task fire starts a restricted Autonomous Run with initiator
`scheduled`; T4 does not provide a literal-message/alarm payload mode. The product value is the Companion waking at the
promised time to interpret and act on the stored user intent, even for a simple reminder, rather than duplicating an OS
alarm clock. The deterministic scheduler owns trigger accuracy, catch-up, and the `late` fact; the Agent owns wording,
contextual judgment, permitted actions, and the visible Companion response.

A provider outage, unavailable model, or exhausted retry deadline must never be recorded as delivered and must not
fall back silently to a literal reminder. The run remains truthfully pending/failed/late under the Class A retry and
catch-up contract, with a visible Run Receipt when user action or awareness is required. Simple reminders use a thin
context and restricted tool profile so Agent mediation does not imply a full conversational replay or unrestricted
tool bag.

### G2-07 — Which tools may an unattended autonomous turn use? — RESOLVED

**Why owner input is required:** MCP approval correctly fails closed without an operator sink, but Shell Capabilities
can still raise a node-side dialog. A 03:00 Heartbeat must not surprise the user with an Approval dialog.

**Owner rulings (2026-08-10):** do not introduce a parallel `Task Archetype` abstraction. Scheduled Tasks may reference
ordinary Skills. A Skill is procedural guidance — instructions, recommended workflow, and suggested tools — and never
grants permission or rigidly dictates which tool the Agent must use. The Agent remains free to choose among tools inside
the run's effective authority envelope.

Skills are an open extension surface, not a Taki-private content type. The live artifact must remain an
ecosystem-portable `SKILL.md` package compatible with the Agent Skills convention used by Claude Code, OpenClaw, and
Hermes: standard YAML frontmatter, Markdown instructions, progressive disclosure, and standard support directories such
as `references/`, `templates/`, `scripts/`, and `assets/`. Taki-specific source provenance, trust, quarantine/scanning,
enable state, content hash, Learning Proposal history, approval, and rollback are governance sidecars around that
package. They must not require rewriting an upstream Skill into a private format. A genuinely necessary extension must
be optional and namespaced so another conforming runtime can ignore it and still use the base Skill. External hubs and
marketplaces attach through source adapters; Taki does not clone their distribution model into a proprietary store.
This follows the locally checked-out Hermes implementation's explicitly agentskills.io-compatible package and
progressive-disclosure contract (`references/hermes-agent-main/tools/skills_tool.py:5-66`) and its multi-source Hub
adapter model (`references/hermes-agent-main/tools/skills_hub.py:130-155`).

This is a compatibility invariant, not a claim that the current loader is complete. Production currently implements a
minimal subset: `<dataDir>/skills/<name>/SKILL.md`, required `name` and `description`, metadata listing, lazy body load,
and a read-only enable/disable sidecar. Its flat-scalar frontmatter parser, lack of on-demand support-file loading,
absence of external directory precedence, and lack of Hub/Marketplace, provenance, trust, scanning, and curator flows
remain staged gaps. Deferred decision D37 may still stage the depth of compatibility, but it cannot authorize a private
replacement format or a lossy import conversion (`packages/core/src/skills/skill-scanner.ts`, `skills-loader.ts`, and
`load-skill-tool.ts`).

Tool availability uses progressive discovery instead of exposing every schema in every prompt. The Agent may begin with
the small built-in surface, load relevant Skills on demand, discover eligible MCP/tool capabilities when needed, and use
`exec` as the general escape hatch when no narrower tool fits. Discovery and fallback never expand authority: a task or
sub-run cannot receive more permission than the creating turn and current Tool Policy allow, and `exec` remains subject
to the Permission Gate and unattended-run rules.

The repository already has part of the global permission substrate. Shared protocol and Rust Gate code define
`strict | standard | relaxed`, project each governed Capability cell to `auto | ask | deny`, apply the stricter result
when policies overlap, preserve deny-by-default floors, and load `permission-level.json` once when the desktop node is
built (missing or malformed data fails safely to `standard`). This is not yet a complete operator feature:
`permission.levelGet/levelSet/cellsGet/cellSet` have schemas but no production handlers, no code writes the level file,
and there is no settings surface or hot application. MCP tools continue through the Core Approval Gate rather than the
Rust Permission Level projection, so the two enforcement surfaces must be composed explicitly for autonomous runs
(`packages/shared/src/permission-level-schema.ts`, `apps/desktop/src-tauri/src/gate/{level,governance}.rs`, and
`.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-mcp-and-llm-config.md:244-311,393-404,511-567`).

Effective authority is one small intersection, never a new grant source:

```text
effective unattended authority
= discovered and currently available tools
  INTERSECT current Core Permission Level, governance cells, floors, and Approval decisions
  INTERSECT current node capabilities and stricter local/managed floors
```

There is no per-task tool profile, creation-time permission snapshot, separate Heartbeat permission table, or fourth
"autonomous" Permission Level. Every run evaluates the current Core authority at execution time, so one settings change
has one predictable effect everywhere. Progressive discovery, a loaded Skill, a Learning Proposal, and `exec` fallback
never widen the intersection. `relaxed` is therefore not unrestricted full access: audit and hard floors still apply.

**Owner clarification (2026-08-10):** prefer one registry-driven authorization model that covers Shell Capabilities,
MCP tools, and effectful Core tools. Tool families must not invent independent level names, decision scopes, persistence
rules, or user-management surfaces merely because they execute through different transports. A narrow specialist may
classify arguments, validate domain invariants, render safe approval detail, or enforce at the final trusted boundary,
but its result must feed the same governance-cell vocabulary and stricter-wins composition. In short: one policy model,
with explicit adapters and classifiers for the few cases whose risk genuinely depends on their execution substrate.

The current repository has not reached that target:

| Surface | Current authorization path | Convergence requirement |
| --- | --- | --- |
| Shell-backed Capability | Rust Permission Gate; Level projection, risk classes, floors, once/session/always, audit | Remains the final OS-boundary enforcer but consumes the common policy vocabulary and operator-managed projection. |
| MCP tool | Core-only MCP Approval Gate; key is currently server + tool; internal tools are `not-applicable` | Move onto common postures/scopes/floors; an argument-sensitive MCP adapter derives a stable risk/target class, while unknown metadata cannot grant authority. |
| Pure or confined Core tool | Usually executes directly; confinement and domain validation live inside the tool | Register an explicit `auto` governance cell when no approval is needed, so absence of a prompt is a policy result rather than an untracked bypass. Effectful Core mutations receive normal cells. |
| Skill | `load_skill` reads instructions directly; Skill scripts eventually call another tool | The Skill itself grants nothing. Loading trusted installed instructions may remain `auto`; install/update/delete and every action or script it requests are governed as ordinary actions. Standard `allowed-tools` metadata is at most a requested ceiling or informational hint, never a grant. |

This unification does not mean one physical Gate process. In the VPS/multi-node topology the Core can enforce Core/MCP
actions, while a Shell or future phone node must still enforce its local OS action at the last trusted boundary. Those
enforcers share policy shape, keying, precedence, decision scopes, and audit semantics; a node may impose a stricter
local or managed floor but cannot loosen the Core-issued ceiling. This is the same mature separation seen in OpenClaw's
tool policy + sandbox + exec approvals and Hermes's common human-approval primitives plus specialist command/edit
classifiers: execution substrates differ, while effective authority is composed deny-first rather than independently
granted by each subsystem.

**Owner ruling (2026-08-10):** the Core is the single authority for the global Permission Level, common governance
policy, and durable user Approval records. A Node owns only the Capabilities it actually exposes, its local/managed hard
floors, and the final enforcement needed to protect that device. A Node may make a Core-authorized request stricter or
unavailable but can never widen it. Operator clients edit the Core authority rather than maintaining independent policy
stores per UI. The current desktop-owned `permission-level.json` and Shell decision store are therefore implementation
state to migrate or project from the Core authority, not the target source of truth.

Necessary special handling stays narrow and declarative:

- `exec` parses command structure, resolves the executable, carries the exact command on the audit line, and defaults
  risky classes to non-persistable decisions;
- ambient/polled actions apply one-ask-per-loop etiquette so a denial does not create repeated dialogs;
- an interactive `ask` opens the ordinary Approval dialog; a Heartbeat `ask` skips the action and records why, while a
  Scheduled Task `ask` leaves one resumable waiting-for-authorization Run Receipt instead of opening a surprise dialog;
- self-escalation, catastrophic operations, and managed policy restrictions remain floors below every convenience
  level;
- domain validation (for example, a memory mutation's authority/revision rules) remains local correctness logic and is
  not duplicated as a second permission system.

**Owner-delegated final design (2026-08-10):** keep the user experience deliberately small. The permissions surface has
one global `strict | standard | relaxed` control and one advanced per-Capability view; it does not add Heartbeat or
Scheduled Task permission pages. The ordinary Approval choices remain once, session, always, and deny. User-facing copy
for `always` must explicitly say that it includes future background runs. A legacy `always` decision captured before
that disclosure cannot silently gain background meaning; it is treated as `ask` until the owner reconfirms it through
an interactive Approval or the settings surface. A session decision is usable only while that approving operator
session is live, not as a substitute for durable background consent.

The difference between the two autonomous initiators is response behavior, not another permission layer:

- Heartbeat v1 may use pure Core reads, relevant Skill loading, already-supplied eligible context, and Companion
  presentation. It does not invoke `exec`, acquire fresh sensor data outside the Sampling eligibility path, or cause
  external side effects. When an action would be `ask`, it skips quietly and leaves run evidence because a Heartbeat is
  Class B and silence is normal. This small fixed safety boundary also holds at `relaxed`.
- Scheduled Task is explicit Class A user intent and receives no fixed tool list. It may choose any discovered tool that
  the current common policy resolves to `auto` or that has a valid durable `always` decision, including `exec` outside
  its floors. An `ask` pauses at that action and exposes a Run Receipt; approval resumes the pending work rather than
  silently marking it delivered or blindly replaying completed effects.

**Owner direction (2026-08-10):** Host availability is planning context for the Agent, not a rigid offline mode stored
on every Scheduled Task. An eligible Agent run receives authenticated Host Context and may choose a Core-only path,
perform Core work before a later Host delivery step, fail a stale Host-dependent action, or request a bounded
waiting-for-user outcome. The per-operation default is fail-closed; waiting must be explicit, expiring, and limited to
user-expected work. This autonomy never replaces the shared runtime preflight or final Node enforcement because Host,
catalog, policy, or connection generation may change after the model planned. Heartbeat keeps its existing Class B
boundary: it may use a Core-only path or skip unavailable Host work, but it does not create waiting-for-Host backlog.

This adapts the mature OpenClaw/Hermes pattern: one current policy with deny-first composition, plus a non-interactive
fallback for `ask`. It deliberately rejects Hermes's separate operator-facing `cron_mode` as unnecessary configuration
for Taki's v1 UI while retaining its fail-closed behavior.

### G2-07A — When does execution experience become Procedural Knowledge? — RESOLVED

**Owner ruling (2026-08-10):** Procedural Knowledge is durable task-execution know-how carried by the applicable Skill,
Scheduled Task, or capability guidance. It is not Long-term Memory, does not enter the relationship Memory Authority,
and is not injected into every Agent turn. Cheap metadata may remain discoverable, while the procedure and its support
files load only when the corresponding task, Skill, tool, or provider becomes relevant.

Every run may record low-cost evidence such as loaded Skill identity/hash, actual tool availability, calls, failures,
retries, provider/model identity, and verification outcome. That evidence does not itself trigger another model call.
An isolated Experience Review becomes eligible only after a high-value signal:

- a failure was followed by a corrected or retried path with verified success;
- a user correction produced an accepted or verified result;
- a loaded Skill was demonstrably wrong, incomplete, or outdated;
- a verified non-trivial procedure would remove meaningful future discovery or tool/model round trips; or
- the same workaround was independently observed more than once.

Routine successful Skill use, unresolved failures, one-off task narratives, unverified success claims, and single
transient provider/network/setup failures do not trigger review. Even an eligible review may abstain and may produce at
most one learning proposal. For unattended Scheduled Task runs, one run does not rewrite its own future behavior: a
proposal additionally requires repeated independently verified evidence or later user confirmation/correction through
the visible run result.

### G2-07B — How does a Learning Proposal become active? — RESOLVED

**Owner ruling (2026-08-10):** v1 Experience Review may automatically create or revise a pending Learning Proposal, but
it never changes live Procedural Knowledge by itself. An owner must review and approve the proposal before it modifies a
Scheduled Task, Skill, or capability guidance. Later support for automatically applying small, mechanically verifiable
patches remains an optional evolution gated by measured manual-trial evidence; it is not part of the v1 contract.

### G2-08 — May Pending Memory cause a Class B utterance? — RESOLVED BY THE AUTHORITY CONTRACT

**Correction after owner challenge (2026-08-10):** the earlier question incorrectly treated `pending` as a weaker class
of usable memory. ADR 0009's degraded runtime is the last verified Memory Replica plus a durable Pending Memory overlay;
chat and ordinary memory use continue during synchronization. Pending content is therefore locally available memory and
may participate in recall, reasoning, and proactivity before Hindsight accepts the replay. Its confirmation state exists
for authority convergence and diagnostics, not as a blanket behavior suppressor.

This does not promote the Local Provider to Memory Authority or run an independent competing consolidation pipeline.
The replica remains the last confirmed Hindsight projection, while locally accepted retains/mutations contribute a
provisional canonical overlay and durable replay operation. On recovery, Hindsight changes are pulled first, compatible
operations replay idempotently, stale revision-bound mutations become `superseded`, and the resulting authoritative
changes replace the provisional projection. That is single-authority convergence, not automatic Local failover.

**Binding T4 rule:** pending/confirmed status by itself neither wakes nor suppresses Heartbeat. Normal eligibility uses
the memory's semantic content, provenance, recency, current Sampling/Privacy state, and the same anti-noise rules as any
other memory. A pending explicit user commitment can therefore contribute to a Class B trigger; an ordinary pending fact
does not cause contact merely because it was stored, just as an ordinary confirmed fact would not. Exact-time reminders
remain Scheduled Tasks because timing intent belongs to the scheduler, independently of which Memory Provider is healthy.

**Owner confirmation (2026-08-10):** accepted after clarifying that local degraded memory remains usable and only the
Memory Authority, not memory availability, stays with Hindsight during the outage.

### G2-09 — Which model runs Heartbeat? — RESOLVED

**Why owner input is required:** T5's Utility Slot is designed for background memory/compaction quality, while Heartbeat
produces user-facing judgments. Research supports isolated/light context and an optional cheaper model but supplies no
calibrated model-quality evidence for this deployment.

**Owner ruling (2026-08-10):** use one global Main Model configuration for Companion Agent reasoning across Characters
and across `primary`, `heartbeat`, `scheduled`, and delegated/subagent work. Do not add Character-, Heartbeat-,
Scheduled Task-, or other scenario-specific main-model slots. Model selection and Agent Context assembly remain
orthogonal: each Character and initiator still receives its own bounded context appropriate to the run, despite using
the same model configuration. The Utility Slot remains limited to internal maintenance such as memory writing, tidy
passes, and compaction; it is not reused for Companion judgment or user-facing autonomous runs. Any future split
requires measured quality/cost evidence and a new owner decision.

### G2-10 — What are the final configurable default values? — RESOLVED FOR DEVELOPMENT CALIBRATION

**Why owner input is required:** the research bank and R9 contain overlapping but non-identical numbers.

**Recommendation:** treat the counters separately:

- deterministic pre-check tick: 60 seconds;
- LLM beat eligibility: approximately 15 minutes with jitter, hard cap 4 beats/hour;
- Class B delivery: maximum 2 utterances/hour and 8/day (R9 wins over the older 10/day draft);
- minimum Class B delivery gap: 10 minutes;
- quiet hours: 23:00–08:00 in the configured user timezone;
- busy deferral max wait: 90 seconds; stale utterance TTL: 10 minutes;
- all visible in the panel during development, then subject to the existing later convergence review.

Backoff still needs a concrete curve. Recommend a small discrete, explainable sequence rather than importing the
Duolingo scoring formula: `1x -> 2x -> 4x -> daily ceiling`, reset by a user reply or explicit operator reset.

**Owner ruling already established:** development values are configuration, visible in the panel, and must not be
treated as final product constants. The values above are implementation starting defaults; manual trials and observed
noise/cost determine later convergence. Selecting the initial backoff curve from this bounded recommendation is an
engineering decision and does not need another Grill question.

### G2-11 — Must D50's activity dwell gap be fixed before Heartbeat ships? — ENGINEERING EVIDENCE GATE

**Why owner input is required:** fast window/title switching can leave no reportable activity entries, but changing the
identity/dwell rule trades task detail for coverage.

**Recommendation:** do not silently weaken the existing privacy/quality filter. Ship a deterministic `no-activity`
skip reason and metrics first, and add an application-level fallback only if manual T4 trials show meaningful false
empties. If the owner wants activity-based care to be a launch requirement, promote D50 into T4 and test both
high-churn coding/browsing and stable-focus scenarios.

No owner decision is required without evidence that false-empty activity materially harms the T4 experience. Keep D50
deferred, instrument the named skip reason, and promote it only from manual-trial evidence rather than weakening the
privacy/quality filter speculatively.

### G2-12 — What must the transport liveness residual prove? — ENGINEERING ACCEPTANCE CONTRACT

**Why owner input is required:** T4 has inherited D59's passive half-open/sleep-resume residual, but this is separate
from proactivity and must have a bounded acceptance contract.

**Recommendation:** a deterministic transport liveness probe detects half-open or clock-resume gaps, retires the
affected generation through the existing D59 controller, and lets normal authentication/restoration re-establish
subscriptions. It never sends avatar commands, never replays mutations, never writes timeline/memory, and never starts
an Agent Heartbeat. Manual acceptance should include long idle, Windows sleep/resume, Core restart, and a server that
accepts TCP but stops answering application traffic.

This is a reliability acceptance item inherited by T4, not a product trade-off. The PRD must carry the bounded proof
above, but it should not consume another owner Grill question unless implementation uncovers a user-visible policy
choice.

## 10. Leader-resolved implementation constraints unless the owner objects

These are supported strongly enough by current contracts that they should not consume grill time unless challenged:

1. Reuse the D1 runtime through additive seams; do not build a second agent loop.
2. A non-primary turn never fires the conversational auto-memory pass or advances its episodic/flush watermarks.
   Explicit memory operations remain allowed and carry initiator/request provenance through the Memory Tool Contract.
3. Heartbeat reads a narrow provider-neutral context: Memory Blocks/index, due commitments, current fenced perception,
   wall clock, last Class B outcome/gist, and remaining budgets. It does not replay the full conversation window.
4. T4 never imports the current Markdown store, Local `MemoryRepo`, or `tidy.maybeRun()` directly. Local/Hindsight
   maintenance differences live behind the memory provider/curator boundary required by ADR 0009.
5. Memory Replica synchronization reuses only low-level scheduling primitives. It is an internal maintenance job, not
   a Scheduled Task, Heartbeat, delivery class, or agent-editable row.
6. `heartbeat_respond` gets a dedicated terminal stop condition. It is not forced into the generic
   `PRESENTATION_TOOL_NAMES` behavior that requires prior text.
7. The Pet subscribes to ordinary timeline appends after installing its guarded handler and filters for new assistant
   utterances. Restoration follows the D59 per-generation contract before Pet claims healthy.
8. A spoken proactive utterance is whole-message delivery. Stream deltas from the private autonomous run are never
   routed to the Pet bubble.
9. `schedule_task` is one compact action-discriminated tool (`create/list/update/delete/pause/resume`) over the same
   schedule store and panel surface. It is excluded from scheduled/heartbeat tool profiles.
10. Schedule parsing accepts canonical `at`, `every`, and cron forms. Natural-language understanding belongs to the
    creating agent, which submits a deterministically validated canonical form; no separate NL date parser is added.
11. R1 overrides the scheduler research's two-hour one-shot draft. Do not reopen it during implementation.
12. D56 and D57 are adjacent opportunities, not T4 prerequisites. Do not refactor the episodic writer or prose folding
    without their own evidence and scope.

## 11. Minimum acceptance matrix to turn into the T4 PRD

### Scheduler / Class A

- exact one-shot, recurring, timezone, DST recomputation, pause/resume/edit/delete;
- restart catch-up coalesces once, applies R1 cutoff, and marks lateness honestly;
- every fire starts a restricted `scheduled` Agent run; no literal delivery bypass exists;
- provider/model failure remains truthful and retryable within the Class A deadline instead of becoming silent success;
- scheduled runs serialize per Character, do not recursively schedule, and leave a structured result;
- panel and agent tool observe the same rows and next-run state.

### Heartbeat / Class B

- empty/no-due/no-new-signal pre-check makes zero model calls with a named skip reason;
- no fake user row; silent and avatar-only outcomes create no visible timeline entry;
- spoken outcome creates one ordinary assistant timeline path and one whole Pet bubble;
- busy user turn wins; deferred output is latest-wins, bounded, and discarded when stale;
- quiet hours, per-hour/day caps, minimum gap, and ignore-backoff are independently testable;
- malformed/no terminal tool call fails quiet and cannot leak private model prose.

### Memory boundary

- initiator and content provenance are distinct and cannot be model-forged;
- non-primary turns do not advance conversational auto-memory watermarks;
- Local and Hindsight adapters expose the same T4-facing context/tool contract;
- provider outage uses replica/pending semantics without silent authority switching;
- Pending Memory behavior matches G2-08;
- Memory Replica sync remains operationally distinct from user schedules.

### Privacy and tools

- Privacy Pause behavior matches G2-04 and stale observations bleed out;
- unattended turns cannot open an unexpected Approval dialog;
- all sensed text is scrubbed/fenced at the sanctioned render seam;
- active/quiet hours use the configured user timezone, not an accidental VPS timezone.

### Reliability and UI

- transport half-open and sleep/resume retire through D59 and restore each required subscription once;
- Pet bubble timeline restoration neither duplicates old messages nor misses the first fresh proactive message;
- Home chat history and Pet bubble agree on the spoken text;
- provider, Core, Pet, or Home absence produces truthful status without replaying user intent.

## 12. Post-grill planning and implementation order

The second owner grill is complete. G2-01 through G2-10 are resolved; G2-11 and G2-12 are engineering evidence and
acceptance gates rather than open product questions. ADR 0010 records the autonomous-run visible/internal persistence
split. No further owner question is required before pre-development documentation and task decomposition begin.

**Owner sequencing ruling (2026-08-10):** productize Skills and MCP first, end to end. The planning-only Trellis task
`.trellis/tasks/08-10-skills-mcp-productization` captures the first initiative. Its scope includes Core lifecycle,
shared governance, secure credentials, Home operator UX, and verification; it is not a rewrite of the shipped M2
loader/client. This moves the corresponding management surfaces forward from the former T6 placeholder. Experience
Review remains later because it depends on Autonomous Run evidence, and D60 remains unchanged.

Execution order:

1. Complete the currently bound Hindsight compatibility task through its remaining implementation, formal check,
   spec update, and finish steps. Close or explicitly isolate the outstanding D59/D61 worktree before another
   implementation task is activated.
2. Converge and owner-confirm the Skills/MCP productization PRD, research, acceptance matrix, child-task boundaries,
   and implementation/check context. Do not start this planning task while the Hindsight child remains current.
3. Implement Skills/MCP productization as vertical, independently checked children: shared governance/discovery;
   secure MCP lifecycle; standard Skill package lifecycle; Approval and Home operator UX; then a converged integration
   check. Exact child boundaries remain evidence-driven during planning.
4. Create the formal T4 task and PRD from R1-R12 plus this second-grill record. Freeze the provider-neutral T4/memory
   contracts before T4 implementation begins.
5. Implement the Autonomous Run/Run Receipt foundation, then Scheduled Task, then Heartbeat, followed by delivery,
   transport-liveness, Procedural Knowledge integration, and manual calibration batches.
