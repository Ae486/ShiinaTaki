# CLAUDE.md — TakiAgent (ShiinaTaki)

Windows-native desktop pet whose core is a local LLM agent runtime: headless TS Agent Core + Rust Shell (Tauri 2) + Live2D Pet UI. Agent first, pet shell second.

**Language protocol**: converse with the user in 简体中文; code, comments, commits, and docs in English.

**Read before designing anything**: `docs/index.md` (documentation index) → `CONTEXT.md` (domain glossary — use these terms exactly) → `docs/TECH-STACK.md` → `docs/adr/`. Layer-specific coding rules live in `.trellis/spec/` and are auto-injected into implement/check sub-agents.

## Toolchain prerequisites

| Tool | Required | Note |
| --- | --- | --- |
| Node | **>= 24 LTS** | Machine currently has 22.13.1 — MUST upgrade before scaffolding; `node:sqlite` needs >= 23.4 unflagged |
| pnpm | >= 10 | Only package manager. Never npm/yarn/bun install |
| Rust | >= 1.88 stable, msvc | `rustup update stable` |
| Python | 3.12 | Only for `.trellis/scripts/` |

## Pinned stack (verified 2026-07-07; minor/patch drift is fine, major bumps need an ADR check)

**npm** (workspace root manages versions):

| Package | Version | Role |
| --- | --- | --- |
| `ai` + `@ai-sdk/openai-compatible` + `@ai-sdk/mcp` | ^7.0 / ^3.0 / ^2.0 | Agent engine (ADR 0003; written against SDK 6 — v7 is current, verify API names against installed docs, do not code from memory) |
| `typescript` | ^6.0 | |
| `zod` | ^4.4 | All runtime validation + protocol schemas |
| `ws` | ^8.21 | Agent Core WS server |
| `croner` | ^10 | Scheduler |
| `react` / `vite` / `tailwindcss` | ^19.2 / ^8.1 / ^4.3 | Pet UI |
| `pixi.js` | ^8.19 | Renderer (Live2D lib decided by spike — see TECH-STACK) |
| `vitest` | ^4.1 | All TS tests |
| `@tauri-apps/cli` / `@tauri-apps/api` | ^2.11 | |

**crates**: `tauri` 2.11, `tokio-tungstenite` 0.29, `xcap` 0.9, `sysinfo` 0.39, `arboard` 3.6, `keyring` 4.1.

Before using any external library API, verify against current docs (context7/deepwiki/web) — never code from training memory.

## Repository map

```
packages/shared      @taki/shared — WS protocol: zod schemas + JSON-RPC types (single source of truth)
packages/core        @taki/core — Agent Core: agents/, tools/, capabilities/, mcp/, skills/, memory/, scheduler/, server/, db/, config/
apps/desktop         Tauri app: src/ (Pet UI React) + src-tauri/ (Rust Shell)
docs/                Design docs + ADRs (see docs/index.md)
.trellis/            Workflow: tasks, per-layer specs, scripts
models/              Live2D dev assets — git-ignored, copyrighted; NEVER commit or bundle
references/          Third-party study material — git-ignored; licenses vary (BANDORI-PET-REV is GPLv3, nocturne_memory is MIT). Default stance: learn patterns, never copy code; porting MIT code still goes through clean-room rewrite to our conventions
```

## Architecture invariants (violating any of these is a design regression, not a style issue)

1. **The Agent Core never touches the OS.** No `child_process`, no `fs` outside the Workspace, no screenshots. Every system action crosses the WS boundary to the Rust Permission Gate (ADR 0002).
2. **The database has one writer**: Agent Core. All other processes query/subscribe over WS (ADR 0004).
3. **Protocol types are defined once** in `@taki/shared` (zod) and mirrored in Rust via serde. Never hand-declare a message shape elsewhere.
4. **Pet UI is a disposable client.** Closing it must not affect agent sessions, cron, or memory.
5. **Secrets live in Windows Credential Manager** (keyring), never in config files or env-committed files.
6. `main.rs` stays a thin shim; app logic goes in `lib.rs` and modules (Tauri mobile-entry requirement).

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| TS files/dirs | **kebab-case, always** (enforce with `unicorn/filename-case`) | `permission-gate.ts`, `use-avatar-state.ts` |
| TS identifiers | camelCase; types/components PascalCase; constants CONSTANT_CASE; no `I` prefix | |
| React hooks | `use-x.ts` file, `useX` export | |
| Zod | `XSchema` const + `type X = z.infer<typeof XSchema>` — never hand-write a parallel interface | `ExecRequestSchema` → `ExecRequest` |
| AI SDK tools | one tool per file, `x-tool.ts`, exports `xTool` | `screenshot-tool.ts` |
| Rust | RFC 430: snake_case modules/fns, PascalCase types; `foo.rs` + `foo/` dir, **no `mod.rs`** | |
| Tauri commands | snake_case fn, thin controller delegating to `services/` | `capture_screen` |
| Packages | `@taki/kebab-case`, dir matches unscoped name | `packages/core` → `@taki/core` |
| Tests | `*.test.ts` colocated next to the source file | |

## Anti-sprawl rules (the point: AI assistants default to appending — don't)

- **Do not append new functionality to an existing file by default.** Before adding code, ask: is this a distinct concern? Then it gets its own colocated file.
- Size caps (enforced via ESLint/clippy once configured; treat as hard now): **TS file <= 300 lines, function <= 50 lines, params <= 3. Rust function <= 100 lines (clippy `too_many_lines`), file soft cap 500.** Exemptions: generated code, test files.
- A new cluster of state + handlers + calls for one feature = extract it (hook / child component / service module) immediately, not "later".
- **No barrel files inside packages.** `index.ts` exists only as a package's public entry, with named re-exports (never `export *`). Internal code uses direct imports.
- No god-buckets: no catch-all `types.ts` / `utils.ts` growing without bound — split by responsibility.
- Commands/tools are thin: Tauri commands delegate to `services/`; AI SDK tool `execute` delegates to a capability client — business logic is never inline in the handler.

## Working rules

- **Think before coding**: state assumptions; if multiple interpretations exist, present them — don't pick silently; push back on wrong approaches.
- **Start from the problem, not the code**: decompose into independently solvable units; sequence is understand → simple design → tests → small iterations.
- **Make it work → make it right → make it fast** — in that order; no premature optimization, and no stopping at "works".
- **Simplicity first**: minimum code that solves the problem; no speculative abstraction/configurability; would a senior engineer call it overcomplicated?
- **Surgical changes**: touch only what the task requires; match existing style; remove only orphans your own change created.
- **Verify, don't declare**: define the check before coding (test, lint, `pnpm tauri dev` smoke); loop until it passes. Trellis flow: implement → check → update-spec; do not skip `trellis-check`.
- Comments explain **why** (constraints, invariants), never what/how — and only when the code cannot say it.
- Error handling on every capability path: a failing tool call must degrade into a structured error the LLM can read, never a crash or a silent swallow.

## Git

- Conventional Commits (`feat(core): ...`, `fix(shell): ...`); scopes: `core`, `shell`, `ui`, `shared`, `docs`, `trellis`.
- No AI signature lines in commits. Never force-push `main`. Commit/push only when the user asks.
- `models/`, `references/`, `.env*` are ignored — if `git status` ever shows them, stop and fix `.gitignore` first.

## Gotchas (learned so far)

- Tauri `generate_handler!` is called **exactly once** with all commands; commands defined in `lib.rs` must not be `pub`, commands in submodules must be `pub`.
- Every Tauri command/plugin needs a matching permission in `src-tauri/capabilities/*.json` — forgetting compiles fine and fails at runtime. Pet window and settings window get separate capability files.
- BanG Dream models mix Cubism 2 (`.model.json`) and Cubism 3 (`.model3.json`) — both must stay supported (see TECH-STACK spike criteria).
- AI SDK major versions move fast (6 → 7 within months): check `node_modules` types or official docs for exact API names (`ToolLoopAgent` etc.) before writing agent code.
