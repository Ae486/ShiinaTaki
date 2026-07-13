# Frontend Development Guidelines

> Frontend = the Pet UI (`apps/desktop/src`): React 19 + Vite 8 + Tailwind CSS 4 + PixiJS 8 + Live2D, running in WebView2.

## Pre-Development Checklist

1. Read `CLAUDE.md` (root) — naming (kebab-case files), size caps, anti-sprawl rules.
2. Read `CONTEXT.md` — Pet UI is a disposable WS client; it owns rendering, not state of record.
3. Talking to the Agent Core? Types come from `@taki/shared`; talking to the Shell? `@tauri-apps/api` `invoke`/events only.
4. Two windows exist (pet overlay, settings) with separate Tauri capability files — know which one you are in.

## Guidelines Index

| Guide | Description |
|-------|-------------|
| [Directory Structure](./directory-structure.md) | Feature folders, window entries, renderer isolation |
| [Component Guidelines](./component-guidelines.md) | Component patterns, props, composition |
| [Hook Guidelines](./hook-guidelines.md) | Custom hooks, WS subscription patterns |
| [State Management](./state-management.md) | Zustand stores, what state lives where |
| [Type Safety](./type-safety.md) | zod boundaries, no-any policy |
| [Quality Guidelines](./quality-guidelines.md) | Size caps, perf rules (this window is always-on), tests |
| [Live2D Renderer Contract](./live2d-renderer.md) | Locked renderer stack, load order, generation-split param API, BanG Dream model facts |

## Quality Check (run before handing off)

- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` green
- Pet overlay idle CPU ~0% (render loop pauses when idle — perf is a feature, see quality guidelines)

**Language**: All documentation in **English**.
