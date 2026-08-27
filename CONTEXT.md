# TakiAgent

A Windows-native, companion-oriented desktop pet whose core is a local LLM agent runtime. The pet is a presentation layer; the agent runtime is the product.

## Language

### Product

**Companion**:
The product persona — a desktop pet that passively senses the user's activity and proactively engages within configured limits. Companion-oriented means sensing is mostly read-only; write/operate capabilities are minimal and gated. Referred to as **taki** (lowercase) in discussion; v1 Character is Shiina Taki.
_Avoid_: assistant, chatbot

**Sampling**:
Periodic background capture of user-activity signals (window titles, process names, optionally screenshots) that feeds the Companion's short-term awareness. All sampling parameters (interval, randomness, action-based triggers) are user-tunable configuration.
_Avoid_: monitoring, surveillance, watching

**Sensitivity Tier**:
The classification of a sampled signal. Low tier (window title, process name) is enabled by default; high tier (full screenshot) is off by default and must be explicitly enabled in settings.

**Privacy Pause**:
A one-click switch that halts all Sampling immediately and closes Sampling-backed trigger sources. Sampling-driven
Heartbeat actions therefore cease to become eligible naturally; triggers that require no Sampling are not globally
muted. Visibly reflected in the pet as a "sleeping" state.
_Avoid_: mute, do-not-disturb

**Proactive Utterance**:
A Companion-initiated message to the user, driven by Heartbeat, subject to rate limits and quiet hours.
_Avoid_: notification, push

**Heartbeat**:
A no-user-message Agent Core judgment opportunity (OpenClaw-style), armed either by an approximate cadence or by a
meaningful normalized Signal. Every source still passes deterministic Wake Policy before a model call; raw activity
changes never invoke the Agent directly. The Agent receives thin Character-aware context and stays silent by default.
When something genuinely needs attention it may produce a Proactive Utterance or a silent act such as choosing an
avatar expression. It is a full LLM turn — conscious action, never a transport keepalive or renderer reflex.
_Avoid_: keepalive, ping, polling (networking liveness senses); idle animation driver

**Heartbeat Signal**:
A typed, bounded observation that may arm Heartbeat evaluation, such as a meaningful activity transition, due
commitment, completed background work, or Privacy Pause release. A Signal is normalized, freshness-checked,
deduplicated, debounced/coalesced, and budgeted before it may produce a Heartbeat Run; it never calls the model or
grants permission by itself.
_Avoid_: Heartbeat Run, raw event, trigger that directly invokes the Agent

**Heartbeat Wake Policy**:
The deterministic Core policy that decides whether current Signals and due conditions justify admitting one Heartbeat
Run. It applies freshness, eligibility, cooldown, optional deterministic chance, quiet-hours, busy-yield, privacy, and
Class B budget rules before the model is invoked.
_Avoid_: gate model, prompt instruction, scheduler loop

**Interaction Pattern**:
A Character-scoped, typed and versioned rule describing when Heartbeat may consider an interaction, its purpose,
eligible context, allowed outcomes, cooldown/chance/expiry, provenance, evidence, and lifecycle. It contains no fixed
dialogue. Shipped, user-authored, and Agent-proposed Patterns share one Core authority and can be paused, revised, or
retired; a Pattern never grants permission or bypasses Wake Policy.
_Avoid_: response template, Skill, Soul Prompt, intention

**Companion State**:
A bounded, evolvable projection of the Character's current affective and relationship posture used when deciding how
to interact. It may evolve from relationship evidence but is not the stable Character Persona, a permission source, or
an unrestricted self-rewritten prompt.
_Avoid_: Persona, mood string, Long-term Memory, system prompt

**Scheduled Task**:
A persisted user intent whose deterministic time trigger starts a `scheduled` Agent run. Even a simple reminder wakes
the Companion to respond through its normal judgment and voice; it is not a literal-message alarm timer.
_Avoid_: alarm, cron message, notification timer

**Idle Motion**:
A motion the Pet UI plays on its own while the Companion is idle — drawn at random intervals from a preset pool — plus the automatic return to the idle state after any one-shot motion finishes. A renderer reflex: deterministic, zero-LLM, zero-cost, works offline. The conscious counterpart (the agent choosing an expression because of context) is a Heartbeat outcome, not an Idle Motion.
_Avoid_: idle animation (the engine's built-in breathing/blinking), screensaver

### Architecture

**Agent Core**:
The headless TypeScript runtime that thinks and owns canonical runtime state: providers, agent loop, tools, MCP,
Skills, memory, schedules, and the global capability-governance policy. It does not execute Host-owned OS actions;
those are routed to the owning Execution Host. Core-local capabilities and operator-configured MCP transports remain
inside the Core boundary under the same canonical governance model.
_Avoid_: backend, server, brain

**Core Authority**:
The one Agent Core instance that currently owns a user's runtime state, durable global Permission Level/common policy,
canonical Approval authority, and active connection profile. A profile has exactly one active Core Authority at a
time; switching between local and remote Core is an explicit rebind, never an automatic fallback or data merge.
_Avoid_: primary host, execution host, server

**Shell**:
The Rust (Tauri) Execution Host process that acts: window management, system capabilities, trusted argument
classification, final Host-local enforcement, and audit. It is the only desktop component allowed to execute those OS
actions, but it is not the global policy writer and may only preserve or tighten the Core projection.
_Avoid_: host, native layer

**Pet UI**:
The WebView presentation layer rendering the pet. Just one client of the Agent Core; closing it does not stop the agent.

**User Timezone**:
The Core-owned IANA timezone used to interpret user-relative wall-clock behavior such as quiet hours and local-time
schedules. It may be fixed or follow one designated Timezone Authority Device; individual clients still render their
own UI using their device-local timezone.
_Avoid_: Core timezone, server timezone, UTC offset

**Timezone Authority Device**:
The one authenticated user device whose reported IANA timezone may update the User Timezone while follow-device mode is
enabled. Other connected devices cannot overwrite it merely by connecting or reporting more recently.
_Avoid_: last active client, VPS host

**Hook**:
A configuration-defined, deterministic event-to-action binding executed by the runtime itself (Claude Code sense): "when X happens, run the preset Y" — no LLM judgment, no token cost, e.g. a finished motion triggering the idle return. Hooks can exist at any layer that emits events (renderer, Agent Core, Shell).
_Avoid_: React hook (`use-*.ts` UI code), webhook

**Replay View**:
What the model actually sees each turn: derived fresh from the stored timeline (window, summary substitution, folds) plus ephemeral in-flight additions that are never persisted. Recomputed every turn, never accumulated; the stored timeline is never rewritten for context reasons (ADR 0008).
_Avoid_: context window (the model-side size limit), compaction (one operation within the view), transcript (that's the stored timeline)

**Autonomous Run**:
A Core-owned Agent execution initiated without a live user message, such as a Heartbeat or Scheduled Task run. It has a stable identity and durable outcome independent of whether anything is shown to the user.
_Avoid_: hidden conversation, background chat

**Run Receipt**:
A durable, non-conversational projection of a user-expected Autonomous Run outcome into the Home conversation surface. It links back to the run evidence but is not a Companion utterance and does not enter the default Replay View.
_Avoid_: assistant message, notification, Tool Card

**Utility Slot**:
The separate model slot for background work (memory writes, tidy passes, compaction), falling back to the main model when unconfigured — isomorphic with the vision slot. Background token spend is reportable; multiple background tasks in one trigger run serially.
_Avoid_: worker model, background LLM

### Skills & Procedures

**Skill**:
A portable, lazily loaded open-standard `SKILL.md` instruction package for a reusable class of work, optionally accompanied by references, templates, scripts, assets, or other standard support files. It guides procedure and tool choice but grants no permission.
_Avoid_: Task Archetype, tool profile, permission bundle

**Procedural Knowledge**:
Durable know-how about how to execute a task reliably, carried by the applicable Skill, Scheduled Task, or capability guidance and loaded only when relevant. It is separate from Long-term Memory and relationship context.
_Avoid_: memory, always-on context, user profile

**Experience Review**:
A gated post-run examination that may distil verified recovery, correction, or non-trivial successful procedure into a proposed Procedural Knowledge change. Routine execution only leaves run evidence, and an eligible review may still abstain.
_Avoid_: per-call reflection, automatic memory write, model training

**Learning Proposal**:
An inactive, reviewable change to a Scheduled Task, Skill, or capability guidance produced by Experience Review. In v1 it cannot alter live Procedural Knowledge until the owner approves it.
_Avoid_: learned memory, automatic Skill update, applied instruction

### Capabilities & Permissions

**Capability**:
A typed canonical action resolved before execution, whether it is Core-local, standard MCP-backed, Skill-mediated, or
owned by an Execution Host (for example screenshot, process list, clipboard, shell-open, Workspace file RW, or exec).
Its authority identity is not a display name, model-facing tool key, path, or extension annotation.
_Avoid_: permission (that's the grant, not the action), feature

**Permission Gate**:
The deterministic capability-governance path: Core resolves canonical identity and durable policy, and an owning
Execution Host additionally performs trusted local classification, stricter-only enforcement, execution, and audit.
Core-local and MCP actions use the same canonical evaluator without pretending to cross Rust; Host-owned OS actions
must still cross the Host's final boundary. No adapter may bypass the common policy or create a second global store.
_Avoid_: firewall, guard

**Approval**:
A Core-mediated user decision on a specific governed request, with an explicit scope such as once, this session,
always, or deny. Approval never originates from Skill metadata, MCP annotations, conversation text, or a Host-local
second dialog. Until the canonical lifecycle is installed, an effective `ask` returns `APPROVAL_REQUIRED` and does not
execute.
_Avoid_: confirmation, prompt

**Permission Level**:
A Core-owned durable preset that selects factory posture across the canonical registry (`strict | standard | relaxed`),
combined with sparse per-cell operator overrides under one optimistic `policyGeneration`. It is a convenience view,
not a second enforcement path. The most permissive level cannot lift immutable Core floors or stricter Host-local or
managed constraints. Conversation text grants nothing; it can only lead to the ordinary canonical Approval flow.
_Avoid_: permission mode (that's a per-Capability policy, e.g. Exec's), bypass (colloquial — no level bypasses audit)

**Exec**:
The general-purpose shell Capability. Governed by `deny | allowlist | full` policy modes, default allowlist.
_Avoid_: bash tool, terminal, run command

**Workspace**:
The Companion's own directory (`%USERPROFILE%\.takiagent\workspace`) — the default scope for its file activity, memory, and skills.
_Avoid_: home, sandbox

**Node**:
A paired device or process that connects to the Agent Core declaring the Capabilities it provides (the desktop Shell, a future Android phone). Distinct from an operator client, which only converses and configures.
_Avoid_: device, client (ambiguous — operators are also clients)

**Execution Host**:
An authenticated runtime environment where a Run's local Workspace, Skills, MCP integrations, credentials, and OS capabilities actually reside and execute. It may be the Agent Core host or a paired Node; it is distinct from the model provider and from a presentation/operator client.
_Avoid_: model host, frontend, backend (all ambiguous)

**Primary Host**:
The Execution Host selected for a Run's default Workspace and unqualified local operations. A Run may explicitly use capabilities on other Execution Hosts, but paths and artifacts never cross hosts implicitly.
_Avoid_: current device, active client

**Host Availability**:
The per-Execution-Host runtime signal that says whether the Core can start a new operation on that Host. `connected`
means the authenticated connection and current capability catalog are usable; `reconnecting` means no new
side-effecting operation should start; `disconnected` means Host-owned capabilities are unavailable; and
`revoked`/`unauthorized` is a security state, not a network state. Availability never grants permission: the common
Core policy, Approval, and the Host's stricter local floors still apply. A last-known catalog is display-only and never
proves that a disconnected Host can execute.

When a Node is unavailable, Core may continue Core-owned autonomous work that the current policy and user configuration
permit, but it cannot silently substitute another Host, queue a new Node mutation, or replay an old request after
reconnection. A request already in flight when the connection is lost may have an unknown side-effect outcome; it must
be bounded/cancelled where possible, recorded as unresolved when necessary, and never replayed automatically. Node
sampling stops with the Node, so Sampling-driven Heartbeat actions naturally become ineligible. User-visible results
created while a presentation Node is offline are durable Run evidence/Run Receipts and are surfaced on reconnect rather
than being delivered as stale speech or animation.

**Host-Bound Operation**:
A Core-tracked operation whose capability, Workspace, Skill resource, MCP instance, or side effect belongs to one
Execution Host. It is distinct from a Core-only operation and from a presentation/operator interaction.
_Avoid_: remote task, device command, background chat

### Character & Voice

**Agent Context**:
The complete per-turn input assembled from system and Character instructions, live or replayed conversation, Memory Blocks, retrieved long-term memory, current state, and relevant tool results. It provides immediate continuity but is transient and is not itself a durable memory authority.
_Avoid_: memory (only one component), context window (the capacity limit rather than the assembled content)

**Long-term Memory**:
Durable learned facts, observations, user-specific experiences, and relationship history that compress the Companion's longitudinal experience for use across sessions. Task-execution know-how is Procedural Knowledge, not Long-term Memory.
_Avoid_: chat transcript, conversation window, system prompt

**Automatic Memory Recall**:
The bounded per-turn retrieval that projects relevant long-term memory from the Global Memory Bank and active Character Memory Bank into Agent Context before a response. It is a transient read path, not automatic retention, and explicit recall or reflection remains available for deeper investigation.
_Avoid_: memory preload (only relevant results are projected), recall gate (the Agent does not decide whether the baseline lookup happens), auto-retain

**Memory Layer**:
A declaratively-registered Taki policy scope applied regardless of the active memory provider: ownership (global vs per-character), write eligibility, recall/visibility behavior, and retention. It is neither a Hindsight fact type nor a physical storage partition.
_Avoid_: memory type (layers carry policy, not just a type tag), category

**Canonical Memory Record**:
The provider-neutral, Hindsight-aligned structured representation of memory sources, extracted facts, derived observations, provenance, lifecycle, and Taki policy labels used by both Local and Hindsight providers.
_Avoid_: Markdown entry (an import/export representation), Hindsight database row (a provider-private implementation detail)

**Memory Migration Ledger**:
The durable, idempotent mapping and status record for every legacy memory source as it is normalized into a Canonical Memory Record, imported as a Hindsight document, and expanded into resulting fact identities. It proves source-complete migration even when one source produces many facts and allows safe resume without duplicate imports.
_Avoid_: count comparison (one source need not equal one fact), import log (the ledger is executable migration state, not only diagnostics)

**Global Memory Bank**:
The authoritative memory scope shared by every Character belonging to one user, containing user-wide facts and experiences that should not be isolated to a particular relationship.
_Avoid_: global layer (a Memory Layer is policy, not a bank), shared character bank

**Character Memory Bank**:
The authoritative memory scope belonging to exactly one Character-user relationship, containing that Character's private shared history and evolving relationship with the user.
_Avoid_: character layer (a Memory Layer is policy, not a bank), persona (static Character configuration)

**Taki Bank Template**:
A versioned Global- or Character-bank profile that keeps Hindsight's native memory behavior as the base and adds Taki-specific extraction focus, Memory Layer labels, relationship perspective, observation policy, reflection framing, directives, and mental-model definitions. User customization is a separate override above the template and is never silently replaced by a Taki upgrade.
_Avoid_: replacement prompt (the Hindsight base remains authoritative), forked default prompt (copying upstream prompt text would drift across Hindsight upgrades)

**Memory Authority**:
The one provider whose confirmed state determines durable searchable memory at a given time. Hindsight is the Memory Authority when enabled; otherwise the Local Memory Provider is, and an outage never transfers authority automatically.
_Avoid_: primary database, active-active memory, source of truth (ambiguous about policy vs content)

**Authority Epoch**:
A contiguous history governed by one declared Memory Authority. An explicit disaster takeover starts a new epoch so a recovered former authority cannot merge or overwrite the new history automatically.
_Avoid_: sync session, provider version

**Memory Replica**:
The structured local logical copy of the Memory Authority's last confirmed memory state, including provider-stable identity, provenance, lifecycle, and policy metadata, with independently rebuildable local search indexes. It supports degraded recall and recovery without gaining write authority.
_Avoid_: backup (it remains queryable), secondary authority

**Replica Checkpoint**:
The per-bank change-journal position through which every authoritative memory change has been applied successfully and transactionally to the Memory Replica.
_Avoid_: last sync attempt (an attempt may fail), timestamp cursor (ordering must be unambiguous)

**Pending Memory**:
A durably stored local memory state created while the Memory Authority is unavailable. It remains usable by degraded recall and normal Agent behavior across restarts, with its pending confirmation state preserved, but it is not proof that the authority has accepted the change. After recovery it becomes confirmed authoritative memory when accepted; a mutation also records its target revision, and if that authoritative revision changed before replay, the pending state is retained for audit as superseded rather than forced or merged.
_Avoid_: local authority (the provider did not change), unavailable memory, confirmed memory

**Unclassified Memory**:
A durable memory whose bank ownership is known but whose Taki Memory Layer is not yet trusted. It remains searchable under a safe neutral policy until classification maintenance assigns a normal layer.
_Avoid_: Pending Memory (the authority has already accepted this memory), orphan memory

**Memory Policy Curator**:
The Taki-owned maintenance role that enforces Memory Layer, visibility, retention, and prompt-projection policies without duplicating the active provider's semantic consolidation. In Hindsight mode it changes durable memory only through the Memory Authority.
_Avoid_: memory consolidator (provider-native semantic maintenance), second memory engine

**Memory Tool Contract**:
The provider-independent agent-facing schema and semantics for memory operations, intentionally aligned with Hindsight's public API. Provider adapters implement the contract; prompts, capability metadata, and structured errors explain runtime differences without changing the contract's core meaning.
_Avoid_: provider toolset (would make switching change the Agent's interface), prompt convention (the schema and error fields are authoritative)

**Memory Mutation**:
An edit, invalidation, restoration, or reclassification of one durable memory. The Companion may autonomously mutate individual memories regardless of authorship, Memory Layer, or interaction importance; memory is revisable internal context, and later user correction may revise it again. Invalidation is reversible by default. Bank-wide clearing and permanent deletion are administrative data-lifecycle operations rather than ordinary Memory Mutation.
_Avoid_: protected memory (ordinary memory importance does not create a confirmation gate), permission grant (memory mutation is an Agent Core policy, not a Shell Capability grant)

**Memory Block**:
An always-in-context memory document rewritten as a whole, never appended to — distinct from searchable memory held by the Memory Authority. Each block declares its writer: the user, a background pass, or the agent.
_Avoid_: memory entry (that's a searchable row), note

**Identity Card**:
The user-owned Memory Block of identity facts (name, form of address, timezone, hard preferences). The agent reads it every turn and never writes it; on conflict with agent-written memory, the card wins.
_Avoid_: profile (the agent-written Memory Layer), user settings

**Write Gate**:
The behaviour-change test every automatic memory write must pass: retain only source material likely to change future behaviour in a similar situation. Silence is the normal outcome and every skip is logged; the user's explicit "remember this" always passes. In Hindsight mode the same gate decision also routes an eligible source span to the Global Memory Bank, the active Character Memory Bank, or both according to Taki ownership policy. It does not summarize, extract facts, classify layers within a bank, deduplicate, or otherwise pre-empt Hindsight's memory processing. Replaces any fixed writing quota.
_Avoid_: importance filter (importance grades what passes; the gate decides whether anything is written), quota

**Visibility Ladder**:
The four rungs a memory can occupy: (1) always in the prompt, (2) named in an always-visible index, (3) present only in the search index, (4) archived out of every index. Decay moves entries down; promotion up is deliberate (the user's card, the agent's own pin, the tidy pass) — the automatic writer can never mint rung-1 visibility.
_Avoid_: memory tier (vague — name the rung), hot/cold storage

**Character**:
A user-selectable identity for the Companion: a Live2D model + a persona prompt + a voice profile, three decoupled parts. Any generic Cubism model can be bound to any persona. v1 ships exactly one: Shiina Taki (椎名立希).
_Avoid_: model (that's just the visual part), pet, avatar

**Voice Profile**:
The per-Character TTS settings (voice id plus backend-specific extras) resolved when synthesizing a Proactive Utterance or reply.
_Avoid_: voice config, speaker
