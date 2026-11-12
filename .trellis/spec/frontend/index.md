# Frontend Development Guidelines

> Frontend = the Pet UI (`apps/desktop/src`): React 19 + Vite 8 + Tailwind CSS 4 + PixiJS 8 + Live2D, running in WebView2.

## Pre-Development Checklist

1. Read `CLAUDE.md` (root) — naming (kebab-case files), size/responsibility guidance, and anti-sprawl rules.
2. Read `CONTEXT.md` — Pet UI is a disposable WS client; it owns rendering, not state of record.
3. Talking to the Agent Core? Types come from `@taki/shared`; talking to the Shell? `@tauri-apps/api` `invoke`/events only.
4. Three windows exist (pet overlay, home, the legacy `main` pairing panel) with separate Tauri capability files — know which one you are in.

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Feature folders, window entries, renderer isolation |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition |
| [Explicit Co-Watching](../backend/co-watching.md) | Operator acceptance card, producer revisions, hidden/read/command lifetimes and actual-delivery evidence |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, WS subscription patterns |
| [State Management](./state-management.md) | Zustand stores, state ownership, guarded SWR page snapshots |
| [Reactive Read-Models](./reactive-read-models.md) | Event/demand policy, coherent target commits, grouped model drafts/application, dependency-scoped Chat, stable editing, generation retirement and truthful recovery |
| [Home Memory Transitions](./memory-transitions.md) | Core-derived preview/cancel/recovery, separate offline confirmation, original operation observation and bounded RPC outcomes |
| [Foreground Chat Feedback](./foreground-chat-feedback.md) | Shared ordered activity, complete Timeline handoff, segmented Pet tools/text, reading anchors and CSS geometry continuity |
| [User Presence and Presentation Feedback](./user-presence-feedback.md) | Socket-bound Home/Chat/Pet sources, trusted input age, actual committed-text exposure and designated Home User Timezone reporting |
| [Interaction Pattern Authoring and Review](./interaction-patterns.md) | Exact immutable review, preserved CAS drafts/history, explicit Skill/example setup, same-Monitor policy/backoff controls and semantic follow-up tool results |
| [Type Safety](./type-safety.md) | zod boundaries, no-any policy |
| [Quality Guidelines](./quality-guidelines.md) | Size/responsibility guard, perf rules (this window is always-on), tests |
| [Operator Connection Recovery & Request Deadlines](./operator-connection-recovery.md) | Independent Pet/Home/Chat generations, native JSON-RPC deadlines, restoration ordering, timing policy, and honest reconnect UX |
| [Costume Operation Lifecycle](./costume-operation-lifecycle.md) | Total attempt budget, cancellation, renderer attachment commit, report recovery, and Home result truth |
| [Live2D Renderer Contract](./live2d-renderer.md) | Locked renderer stack, load order, generation-split param API, BanG Dream model facts |
| [Home Window, Pages & Streaming Timeline](./home-window.md) | Window topology, runtime-created windows + per-window capability, result-bearing cross-window commands, useful field selection, secure MCP management, ordered activity/batch handoff, media.get render path, markdown default-safe |
| [Command Approval Display](../backend/command-approval-disclosure.md) | Typed full-command reconstruction, operator support echo, literal accessible rendering and unchanged approval/focus authority |
| [Packaged-Build Defect Classes](./packaged-build.md) | CSP packaged-only, WebView2 silent quirks (dialogs/glyphs), boot-silence invariants, CDP debugging recipe |

## Quality Check (run before handing off)

- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` green
- Pet overlay idle CPU ~0% (render loop pauses when idle — perf is a feature, see quality guidelines)

**Language**: All documentation in **English**.
