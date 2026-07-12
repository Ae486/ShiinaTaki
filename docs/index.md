# TakiAgent Documentation Index

Start here. Every design decision has exactly one canonical home; nothing is duplicated.

> **New session picking up implementation?** Read **`HANDOFF.md`** first — it is the Leader bootstrap (what's done, what to read, how to drive the trellis master/worker flow).

## Reading order for a new agent/developer

1. **`../CONTEXT.md`** — domain glossary. The project's canonical vocabulary (Companion, Sampling, Capability, Permission Gate, Node, Character...). Read first; all other docs assume these terms.
2. **`PRODUCT.md`** — what the product is, v1 scope decisions, settings panel scope, roadmap.
3. **`TECH-STACK.md`** — the complete v1 technology selection table (Agent Core / Shell / Pet UI / mobile), character & model import design, cross-device data pattern.
4. **`MEMORY-DESIGN.md`** — the memory module design: layer registry, file-based truth + SQLite index, context assembly, write paths, activity capture pipeline, ship schedule.
5. **`adr/`** — why the foundational decisions were made (see below).
6. **`TTS-INTERFACE.md`** — reserved TTS wire contract (v1: interface only).
7. **`deferred-decisions.md`** — the register of every "ship later" decision, with its trigger-to-complete. Consult when planning a task (are you about to defer something? log it) and when picking up a milestone (what debt comes due here?).

## Architecture Decision Records (`adr/`)

| ADR | Decision | One-line summary |
| --- | --- | --- |
| [0001](adr/0001-ts-core-rust-shell-split.md) | Process architecture | Headless TS Agent Core + Rust Shell (Tauri 2) + WebView Pet UI; pet is just one WS client |
| [0002](adr/0002-exec-in-v1-behind-permission-gate.md) | Exec capability | Shell tool ships in v1; TS never spawns processes — all execution crosses the Rust Permission Gate (allowlist + approval + audit) |
| [0003](adr/0003-ai-sdk-6-agent-engine.md) | Agent engine | Vercel AI SDK (ToolLoopAgent, tool approval, stable MCP) instead of hand-rolled loop; decided on 6, amended to `^7` |
| [0004](adr/0004-jsonrpc-ws-protocol-with-pairing.md) | Client protocol | JSON-RPC 2.0 over localhost WS, zod-schema'd, device identity + pairing from day one (mobile-ready) |
| [0005](adr/0005-continuous-timeline-no-sessions.md) | Conversation model | One continuous timeline per character; no session list; bubble + chat window share the stream |
| [0006](adr/0006-mcp-processes-vs-no-os-invariant.md) | MCP boundary | MCP servers are operator-configured processes (single sanctioned spawn site); agent-initiated exec still crosses the Permission Gate |
| [0007](adr/0007-capability-data-locality-split-machine.md) | Deployment locality | One codebase, two topologies (single-machine / VPS split); Stance A — host is the agent's world, VPS is pure compute offload; OS/data capabilities execute Node-side |

ADR conventions: sequential numbering `NNNN-slug.md`, 1-3 paragraph body, only for hard-to-reverse + surprising + real-trade-off decisions.

## Development reports (`devlog/`)

Per-milestone progress reports, the queued manual-verification checklist, and the stop-on-blocked problem file — maintained by the dev leader during autonomous runs, written in Simplified Chinese (it is the owner-review channel, not a design doc). Start at [`devlog/index.md`](devlog/index.md).

## Related locations outside `docs/`

| Location | Content |
| --- | --- |
| `/CONTEXT.md` | Domain glossary (kept at root by convention) |
| `/CLAUDE.md` | AI agent working rules: locked tool versions, engineering conventions, naming, file-size limits |
| `/.trellis/spec/` | Per-layer coding guidelines auto-injected into implement/check sub-agents |
| `/.trellis/tasks/` | Task directories (PRD, research, context manifests) |
| `/models/` | Live2D dev assets (git-ignored, copyrighted — never commit or bundle) |
| `/references/` | Third-party reference projects (git-ignored, GPLv3 — study only, never copy code) |

## Maintenance rules

- New foundational decision → new ADR + row in the table above.
- New domain term → `CONTEXT.md` (glossary only — no implementation details there).
- Stack change → edit `TECH-STACK.md` in place; if the change reverses an ADR, write a superseding ADR rather than editing the old one.
- **Deferring anything at planning time → log it in `deferred-decisions.md` with a trigger-to-complete.** A "TODO: later" in code must cite that file's entry id, never stand alone (a bare deferral note is how a planned delay becomes a permanent defect).
