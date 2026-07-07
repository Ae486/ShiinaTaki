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

### Architecture

**Agent Core**:
The headless TypeScript runtime that thinks: providers, agent loop, tools, MCP, skills, memory, heartbeat. It never touches the system directly.
_Avoid_: backend, server, brain

**Shell**:
The Rust (Tauri) process that acts: window management, system capabilities, and the Permission Gate. The only component allowed to touch the OS.
_Avoid_: host, native layer

**Pet UI**:
The WebView presentation layer rendering the pet. Just one client of the Agent Core; closing it does not stop the agent.

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

**Character**:
A user-selectable identity for the Companion: a Live2D model + a persona prompt + a voice profile, three decoupled parts. Any generic Cubism model can be bound to any persona. v1 ships exactly one: Shiina Taki (椎名立希).
_Avoid_: model (that's just the visual part), pet, avatar

**Voice Profile**:
The per-Character TTS settings (voice id plus backend-specific extras) resolved when synthesizing a Proactive Utterance or reply.
_Avoid_: voice config, speaker
