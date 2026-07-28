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
A one-click switch that halts all Sampling immediately. Visibly reflected in the pet as a "sleeping" state.
_Avoid_: mute, do-not-disturb

**Proactive Utterance**:
A Companion-initiated message to the user, driven by Heartbeat, subject to rate limits and quiet hours.
_Avoid_: notification, push

**Heartbeat**:
A scheduled Agent Core turn with no user message (OpenClaw-style): the agent reviews a small stable checklist plus current signals and stays silent by default — the "all quiet" ack is never shown to the user. When something genuinely needs attention it acts: a Proactive Utterance, or a silent act such as choosing an avatar expression. Skipped when there is nothing to check, deferred while a real conversation turn is in flight, restricted to active hours. It is a full LLM turn — conscious action, never a reflex.
_Avoid_: keepalive, ping, polling (networking liveness senses); idle animation driver

**Idle Motion**:
A motion the Pet UI plays on its own while the Companion is idle — drawn at random intervals from a preset pool — plus the automatic return to the idle state after any one-shot motion finishes. A renderer reflex: deterministic, zero-LLM, zero-cost, works offline. The conscious counterpart (the agent choosing an expression because of context) is a Heartbeat outcome, not an Idle Motion.
_Avoid_: idle animation (the engine's built-in breathing/blinking), screensaver

### Architecture

**Agent Core**:
The headless TypeScript runtime that thinks: providers, agent loop, tools, MCP, skills, memory, heartbeat. It never touches the system directly.
_Avoid_: backend, server, brain

**Shell**:
The Rust (Tauri) process that acts: window management, system capabilities, and the Permission Gate. The only component allowed to touch the OS.
_Avoid_: host, native layer

**Pet UI**:
The WebView presentation layer rendering the pet. Just one client of the Agent Core; closing it does not stop the agent.

**Hook**:
A configuration-defined, deterministic event-to-action binding executed by the runtime itself (Claude Code sense): "when X happens, run the preset Y" — no LLM judgment, no token cost, e.g. a finished motion triggering the idle return. Hooks can exist at any layer that emits events (renderer, Agent Core, Shell).
_Avoid_: React hook (`use-*.ts` UI code), webhook

**Replay View**:
What the model actually sees each turn: derived fresh from the stored timeline (window, summary substitution, folds) plus ephemeral in-flight additions that are never persisted. Recomputed every turn, never accumulated; the stored timeline is never rewritten for context reasons (ADR 0008).
_Avoid_: context window (the model-side size limit), compaction (one operation within the view), transcript (that's the stored timeline)

**Utility Slot**:
The separate model slot for background work (memory writes, tidy passes, compaction), falling back to the main model when unconfigured — isomorphic with the vision slot. Background token spend is reportable; multiple background tasks in one trigger run serially.
_Avoid_: worker model, background LLM

### Capabilities & Permissions

**Capability**:
A typed action the Agent Core can request from the Shell (screenshot, process list, clipboard, shell-open, workspace file RW, exec). Each has its own permission switch and Sensitivity Tier.
_Avoid_: permission (that's the grant, not the action), feature

**Permission Gate**:
The Shell-side enforcement point every Capability request must cross: policy check, optional Approval, execution, audit log. The Agent Core has no path around it.
_Avoid_: firewall, guard

**Approval**:
A user decision on a Capability request via dialog: once / this session / always / deny.
_Avoid_: confirmation, prompt

**Permission Level**:
A global preset that bulk-sets every Capability's policy in one move (a relaxed / standard / strict spectrum); a convenience view over the per-Capability grants, never a second enforcement path — the Permission Gate stays the sole authority. The most permissive level still writes the audit log and cannot lift the hard blocklist. A grant expressed in conversation goes through the ordinary Approval flow and lands in the same store the permissions panel manages.
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

### Character & Voice

**Memory Layer**:
A declaratively-registered scope of memory carrying its own policy: ownership (global vs per-character), write path, recall behavior, retention. The engine is generic over layers; the taxonomy is data, not code.
_Avoid_: memory type (layers carry policy, not just a type tag), category

**Memory Block**:
An always-in-context memory document rewritten as a whole, never appended to — the storage shape of the always-visible tier (searchable memory stays Memory Layer rows). Each block declares its writer: the user, a background pass, or the agent.
_Avoid_: memory entry (that's a searchable row), note

**Identity Card**:
The user-owned Memory Block of identity facts (name, form of address, timezone, hard preferences). The agent reads it every turn and never writes it; on conflict with agent-written memory, the card wins.
_Avoid_: profile (the agent-written Memory Layer), user settings

**Write Gate**:
The behaviour-change test every automatic memory write must pass: save only what is likely to change future behaviour in a similar situation. Silence is the normal outcome and every skip is logged; the user's explicit "remember this" always passes. Replaces any fixed writing quota.
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
