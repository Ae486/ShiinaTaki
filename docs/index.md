# TakiAgent Documentation Index

Start here. Every design decision has exactly one canonical home; nothing is duplicated.

- [Project-wide prompt and tool optimization](PROMPT-AND-TOOL-OPTIMIZATION-2026-11-01.md) — owner-approved requirements, field decisions and role coverage.
- [Implementation evidence](PROMPT-AND-TOOL-IMPLEMENTATION-2026-11-01.md) — current changes, checks, measured request sizes and validation limits.
- [Real-model validation](PROMPT-AND-TOOL-REAL-VALIDATION-2026-11-01.md) — bounded paid observations, verified delayed-batch final delivery, unresolved wait-only commands and acceptance limits.

> **New session picking up implementation?** Read **`HANDOFF.md`** first - it is the durable Leader bootstrap (what
> is done, what to read, and how to drive the Trellis leader/agent flow). For the active ZCODE takeover, start with
> **`ZCODE-HANDOFF.md`** because its dirty-tree warning is time-sensitive, then read `HANDOFF.md` for the durable
> program history and contracts.

## Reading order for a new agent/developer

1. **`../CONTEXT.md`** — domain glossary. The project's canonical vocabulary (Companion, Sampling, Capability, Permission Gate, Node, Character...). Read first; all other docs assume these terms.
2. **`PRODUCT.md`** — what the product is, v1 scope decisions, settings panel scope, roadmap.
3. **`TECH-STACK.md`** — the complete v1 technology selection table (Agent Core / Shell / Pet UI / mobile), character & model import design, cross-device data pattern.
4. **`MEMORY-DESIGN.md`** — historical memory-layer design and context background. Current single-authority/canonical integration follows ADR 0009 and the active Memory task/specs; do not restore file-based authority from the older design.
5. **`adr/`** — why the foundational decisions were made (see below).
6. **`TTS-INTERFACE.md`** — reserved TTS wire contract (v1: interface only).
7. **`deferred-decisions.md`** — the register of every "ship later" decision, including the Slice 4 AI SDK `prepareStep` safety limitation, with its trigger-to-complete. Consult when planning a task (are you about to defer something? log it) and when picking up a milestone (what debt comes due here?).
8. **`ARCHITECTURE-ROADMAP.md`** — the living cross-module architecture plan: stable invariants, reference-design boundaries, adopted baseline, staged delivery, and implementation follow-up.
9. **`AVATAR-PRESENTATION.md`** — the avatar expression/motion layer: the measured three-system naming reality across the imported costumes, what the current tool design gets right, the ranked problems, staged optimization directions (owner ruling: keep the tool-call design), the presentation lessons taken from the AgentAtelierR reference, and the engine/asset feasibility check for layered composition and a speaking state.
10. **[Companion initiative development plan](../.trellis/tasks/09-11-companion-initiative-implementation/prd.md)** — consolidated Heartbeat/initiative requirements, technical design, effective prior decisions and four ordered implementation children; reuses the existing Runtime and Monitor.
11. **[Media services integration discussion](MEDIA-INTEGRATION.md)** — product rulings/direction M01-M59: composable Agent/Skill capabilities, adjustable entry strategy, invitation gates, recommendation pre-analysis, post-consent commentary and native OpenBili browsing/feedback. The 2026-10-09 continuation records the autonomy audit without task creation/binding; historical OpenBili task artifacts require reconciliation.
12. **[Media integration technical plan](MEDIA-AGENT-INTEGRATION-PLAN.md)** — shared Run/Agent capability mapping, current initiative restrictions, same-turn versus linked-task options, execution/notification policy, dated Hermes/OpenClaw precedents and partially exercised validation gates. M51's accepted-Co-Watching quota exemption remains settled; the assistant-proposed R7 is withdrawn. The implementation record distinguishes authorized support changes from remaining integration work.
13. **[Media capability validation — 2026-10-09](MEDIA-VALIDATION-2026-10-09.md)** — supplied five-minute video's native BiliNote analysis (11,805 tokens; cost unavailable), owner-operated Edge observations, 52 Core baseline tests, native defects, source/environment details and explicit remaining integration gates.
14. **[Media contracts and targeted validation — 2026-10-10](MEDIA-CONTRACT-REVIEW-2026-10-10.md)** — existing-owner multiple-publication/Stop/Attempt probes, native offline defect reproduction, Skill/Workspace and historical browser checks, concrete proposed contracts and first production slices; preserves partial gates and the no-task choice.
15. **[Media implementation and Harness change record — 2026-10-10](MEDIA-IMPLEMENTATION-2026-10-10.md)** — delivery, quiescent work, generic authorized prepared publication and reviewed native structured generation; H01-H16 behavior impacts, B2 review corrections, framework/business-policy separation and separate offline gates. Full integration and real Heartbeat acceptance remain open; the current Heartbeat baseline is not considered stable or reliable without real testing.

16. **[Native live media validation](MEDIA-LIVE-VALIDATION-2026-10-13.md)** — R7's successful original analysis, exact native/MCP result identity, real model usage and retained evidence; separate from Co-Watching product acceptance.
17. **[Browser playback integration and reboot acceptance](MEDIA-PLAYBACK-INTEGRATION-2026-10-15.md)** — authenticated optional source channel, player/document compatibility fixes, delegated real-browser tests and isolated process restoration.
18. **[Real-model prepared playback composition](MEDIA-PREPARED-PLAYBACK-VALIDATION-2026-10-16.md)** — real Agent/file tools and playback around two publications, foreground revision and Stop; controlled acceptance/transport boundaries and measured usage.
19. **[Explicit Co-Watching production slice](MEDIA-CO-WATCHING-PRODUCTION-2026-10-16.md)** — real Home acceptance, governed native read, two timed deliveries, ordinary-chat revision/Stop, privacy/source retirement and measured usage; owner quality acceptance remains separate.
20. **[Co-Watching invitation and failure recovery](MEDIA-CO-WATCHING-INVITATION-2026-10-16.md)** — chat invitations, native request reuse, remembered browser pairing, nullable-end compatibility and actual temporal-citation failures; targeted native correction and new-video delivery acceptance are tracked separately.
21. **[Skill tool progressive disclosure](SKILL-TOOL-DISCLOSURE-2026-10-17.md)** — generic captured Skill bundles and per-tool MCP disclosure via the installed SDK, query-only video inventory, request-body tests and separately attributed live validation.
22. **[Read existing video analysis in conversation](MEDIA-ANALYSIS-READ-2026-10-17.md)** — Skill-disclosed registered-result reading through captured MCP, bounded original-content pages and ordinary answers without accepting watching or requesting analysis.
23. **[URL analysis and detected-viewing entries](MEDIA-ENTRY-IMPLEMENTATION-2026-10-17.md)** — shared native progression, independent accepted results, effective-viewing invitations, configurable timing and separately attributed live verification.
24. **[Recommendation integration and deployment](MEDIA-RECOMMENDATIONS-IMPLEMENTATION-2026-10-18.md)** — native OpenBili peek/profile/feedback, bounded silent preparation, real primary-source identity, Docker deployment and separate business-readiness evidence.
25. **[Agent Context sources](AGENT-CONTEXT-SOURCES.md)** — settled source-awareness requirements and historical investigation; links current implementation and before-human acceptance evidence, including compaction/Memory limitations.
26. **[Agent delegation research](AGENT-DELEGATION-RESEARCH.md)** — dated Claude/AI SDK/Pi findings and agreed delegation/stop behavior; the [October 24 follow-up design](AGENT-DELEGATION-RESEARCH.md#companion-first-follow-up-design-2026-10-24) records asynchronous child notifications, compact tool returns, minimal task-worker compaction and a shared Chat UI. The [integrated delivery record](../.trellis/tasks/10-21-agent-context-acceptance/research/acceptance-before-human-20261023.md) owns prior SDK/Runtime/Source/Desktop checks and the separate human, native Hindsight and main-migration gates; the follow-up is in active implementation; its task checkpoint owns current progress and no final or human acceptance is implied.

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
| [0008](adr/0008-replay-view-context-seam.md) | Context seam | The model sees a per-turn Replay View derived from the stored timeline; all context management (windowing, summaries, folds, ephemeral in-flight additions) happens only there — idempotent, never persisted, cache-shaped |
| [0009](adr/0009-single-memory-authority-with-local-replica.md) | Memory authority | One active authority, canonical Local/Hindsight contracts, explicit replica/pending state and verified migration/cutover |
| [0010](adr/0010-separate-autonomous-run-history-from-relationship-timeline.md) | Autonomous history | Run evidence is distinct from the relationship Timeline; only actual Companion speech becomes ordinary conversation |

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
