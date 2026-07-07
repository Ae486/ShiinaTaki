# Headless TS agent core + Rust shell + WebView pet UI

TakiAgent is an agent runtime first and a desktop pet second. We split it into three parts: a headless TypeScript Agent Core (LLM providers, agent loop, MCP, skills, memory, heartbeat) exposing a localhost WS API; a Tauri 2 Rust Shell owning the window, all system capabilities, and the Permission Gate; and a WebView Pet UI that is just one WS client of the core.

Why: the agent ecosystem (MCP SDK, provider SDKs, SKILL.md conventions) lives in TypeScript and moves fast, while window management, system access, and security boundaries belong in native code. The pet UI being a mere client means the agent, sessions, and cron keep running when the pet is closed, and future channels (CLI, chat platforms) attach without touching the core.

Considered and rejected:
- Rust-only agent core: best memory footprint, but the MCP/provider ecosystem in Rust is too young; agent-layer iteration speed is the product's lifeline.
- Embedding OpenClaw as backend: Windows support is second-class (WSL2 recommended), it carries 18+ channel adapters we do not need, and its Node process holds full user privileges — our design requires system actions to pass a native permission boundary.

Consequence: we accept a Node sidecar's baseline memory (~60-100MB) in exchange for ecosystem velocity. Overall target stays 150-250MB with rendering active.
