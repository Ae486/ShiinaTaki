# TakiAgent — Development Handoff (Leader Bootstrap)

**You are the incoming session. Read this document fully, then the required docs in §2, then act as the Leader (主脑) of a trellis master/worker development flow.** This file is your bootstrap program — it tells you what exists, what to read, how to behave, and how to drive implementation. It is authored at the close of the design+scaffold phase (2026-07-08); everything below is verified fact, not plan.

---

## 0. What TakiAgent is (one paragraph)

A Windows-native desktop companion whose core is a headless local LLM agent runtime. Three processes (ADR 0001): a TypeScript **Agent Core** (Node 24, AI SDK, headless, single DB owner, WS JSON-RPC hub), a Rust **Shell** (Tauri 2 — window, system Capabilities, Permission Gate), and a WebView **Pet UI** (React 19 + PixiJS 8 + Live2D). Agent first, pet shell second. The v1 Character is Shiina Taki (taki). Converse with the user in 简体中文; all code/comments/commits/docs in English.

---

## 1. What is already done (do NOT redo)

### Design phase — COMPLETE, committed
- **Requirements + tech selection**: fully grilled and settled. Product definition, memory design, permission model, deployment topologies, TTS contract — all documented.
- **6 ADRs** (`docs/adr/0001`–`0006`), **CONTEXT.md** glossary (~20 terms), **PRODUCT.md**, **TECH-STACK.md**, **MEMORY-DESIGN.md**, **TTS-INTERFACE.md**.
- **7 research reports** archived under `.trellis/tasks/archive/2026-07/*/research/` (Live2D presentation, nocturne memory, memory-framework survey, ATRI deep-dive, renderer comparison, ecosystem scan, CLAUDE.md/anti-monolith practices). Consult before re-researching a settled question.
- **12 trellis spec files** (`.trellis/spec/backend/*`, `.trellis/spec/frontend/*`) — auto-injected into implement/check sub-agents.

### Roadmap — PUBLISHED to GitHub `Ae486/ShiinaTaki`
- **Issue #1** = the PRD (46 user stories).
- **Issues #2–#26** = 25 v1 implementation slices (`ready-for-agent`), organized into 5 milestones M1–M5. Each is a vertical tracer-bullet with acceptance criteria and correct `Blocked by` refs (verified: the dependency graph is a clean DAG, numeric order = topological order).
- **Issues #27–#34** = 8 deferred trackers (`deferred` label, v1.5/v2 milestones). Do NOT implement these; they exist so deferred seams aren't silently shelved.
- Milestones: M1 Agent Core skeleton (4), M2 Memory & extensibility (4), M3 Shell & Permission Gate (3), M4 Pet UI & Live2D (6), M5 Sensing/proactivity/settings (8).

### Scaffold — COMPLETE, committed (`b873a56`), VERIFIED
This satisfies the deliverable of **issue #2** (Monorepo scaffold). pnpm workspaces monorepo:
- `packages/shared` (@taki/shared) — zod protocol, example `ping-schema.ts`.
- `packages/core` (@taki/core) — example `hello.ts`, depends on shared via `workspace:*`.
- `apps/desktop` (@taki/desktop) — React 19 + Vite 8 + Tailwind 4 frontend + Tauri 2 Rust shell (`src-tauri`, thin `main.rs` + `lib.rs` with a `ping` command).
- TS 6 strict, path alias `@/*`, ESLint size caps (file 300 / fn 50 / params 3) + `unicorn/filename-case` kebab, vitest. Cross-platform CI (`windows-latest` + `ubuntu-latest`) in `.github/workflows/ci.yml`.
- **Verified green**: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` (3 tests), `cargo build`, `cargo clippy -- -D warnings`, `vite build`. The size-cap + kebab lint rules were proven to fail on a deliberate violation.
- **One unverified item**: live IPC smoke (`pnpm desktop:dev` → click "Check IPC" → see reply). Not run because it opens a GUI window. Do this manual smoke early.

### Environment
- Node **24.18.0**, pnpm **10.22.0**, Rust **1.88.0** msvc, WebView2 149 — all present and correct.
- npm/pnpm caches already moved to `G:\Roaming\*`. The Node **binary** is still at `C:\Program Files\nodejs`; a one-off `scripts/migrate-node-to-g.ps1` (git-ignored) migrates it to `G:\nodejs` — the user runs it after closing sessions. Binary location does not affect development.
- `gh` CLI authenticated as `Ae486`. Git user `PLeiA`. Remote `origin` → github.com/Ae486/ShiinaTaki, `main` pushed.

---

## 2. Required reading before you write any code (in order)

1. **`CLAUDE.md`** (repo root) — the law. Toolchain versions (pinned), architecture invariants 1–8, naming, anti-sprawl caps, git rules. Non-negotiable.
2. **`CONTEXT.md`** — domain glossary. Use these exact terms (Companion, Sampling, Capability, Permission Gate, Approval, Node, Character, Memory Layer, Workspace…). Terminology drift is a review-blocker.
3. **`docs/index.md`** — doc map + ADR table.
4. **`docs/PRODUCT.md`** — what v1 is, scope decisions, settings-panel scope, roadmap.
5. **`docs/TECH-STACK.md`** — full selection table, renderer decision tree, deployment topologies.
6. **`docs/MEMORY-DESIGN.md`** — layer registry, files-as-truth + SQLite index, assembly, activity capture. (Read when touching M2.)
7. **`docs/adr/0001`–`0006`** — the six load-bearing decisions and their rationale.
8. **`.trellis/workflow.md`** — the trellis phase model and skill routing (this governs how you drive work).
9. **The target issue** on GitHub (`gh issue view <n> -R Ae486/ShiinaTaki`) — its acceptance criteria are the definition of done.
10. Layer specs: `.trellis/spec/backend/index.md` or `.trellis/spec/frontend/index.md` (these are auto-injected into sub-agents, but read them yourself too).

---

## 3. Leader (主脑) rules

You are the orchestrator, not the primary typist. Your job: sequence issues, spawn trellis sub-agents, verify their output against specs and acceptance criteria, keep the DAG honest, and report to the user.

### 3.1 Interaction contract
- Converse with the user in **简体中文**; write code/comments/commits/docs in **English**.
- Tools/models interaction in English; **ultrathink in English**.
- The user is the product owner. Surface trade-offs, push back on wrong approaches, never silently pick between interpretations. Ask when genuinely blocked on a user-only decision; otherwise proceed.
- **Never commit or push unless the user explicitly asks.** (This is a hard rule from CLAUDE.md.) You may stage and propose.

### 3.2 The trellis master/worker loop (per issue)
For each GitHub issue you pick up (lowest unblocked issue number first, respecting `Blocked by`):
1. **Create a trellis task**: `python ./.trellis/scripts/task.py create "<issue title>" --slug <name>` then `task.py start <dir>`. One trellis task ↔ one GitHub issue. Put the issue number in the task's prd.
2. **Write prd.md** in the task dir from the issue body + acceptance criteria. Link the GitHub issue number.
3. **Configure context**: curate `implement.jsonl` / `check.jsonl` with the relevant `.trellis/spec/*` and research files (Phase 1.3).
4. **Implement**: spawn the `trellis-implement` sub-agent (do NOT write feature code in the main thread — sub-agents get spec injection you don't). It implements per prd, runs lint + typecheck.
5. **Check**: spawn the `trellis-check` sub-agent — reviews against spec + acceptance criteria, self-fixes, verifies lint/typecheck/tests. **Never skip this.**
6. **Verify** the acceptance criteria yourself (run the checks; drive the real flow when there's a runtime surface).
7. **Update spec** (`trellis-update-spec`) if the work produced a reusable convention or a hard-won lesson.
8. Report to the user; on their go-ahead, they commit (or ask you to). Then `task.py finish` + `archive`, and pick the next issue.

### 3.3 TDD (the user wants test-first for feature work)
- Use the `tdd` skill's red-green-refactor loop inside step 4/5. Write the failing test first (from the acceptance criterion), make it pass minimally, refactor.
- Test **external behavior at the highest existing seam**, never implementation details. Seams already identified: WS JSON-RPC API (primary), `@taki/shared` schema round-trips, memory store API, Permission Gate policy (table-driven, mandatory per new Capability), exec parser (table-driven), agent loop via AI SDK **mock model** (no real tokens), renderer state machine (framework-free).
- Security boundaries (Permission Gate, exec allowlist/blocklist parser) ship **no branch without a test**.

### 3.4 Non-negotiable invariants to enforce on every sub-agent's output
(Full list in CLAUDE.md §Architecture invariants — these are the ones most easily violated:)
1. Agent Core never touches the OS on the agent's initiative — no `child_process`/`fs`-outside-Workspace/screenshots in `packages/core`. The **only** sanctioned spawn site is the MCP stdio transport in `packages/core/src/mcp/` (ADR 0006). Everything else crosses WS → Rust Permission Gate.
2. DB has one writer (Agent Core); others query/subscribe over WS.
3. Protocol types defined once in `@taki/shared` (zod), mirrored in Rust via serde. Never hand-declare a message shape elsewhere.
4. Secrets → Windows Credential Manager (keyring), never config/env files.
5. `packages/core` + `packages/shared` are **OS-neutral** (Windows + Ubuntu; CI-enforced). Windows-only code lives only in `apps/desktop`. Paths via `os.homedir()`+`path.join`, never hardcoded separators.
6. Features are pluggable modules wired through a registry (tools, capabilities, skills, WS methods, memory layers) — add = new module + one registry entry.
7. `characterId` threaded through every layer (memory, protocol, model). v1 UI is single-character but nothing may hardcode a single character — multi-character is reserved (issue #33), not excluded.
8. Preserve v2 seams the deferred trackers depend on: the `Retriever` interface (#30 vector search), the `SpeechProvider` interface + playback path (#31 TTS), layer-registry `status` field (#27 consolidation).

### 3.5 Anti-sprawl (AI's default failure mode)
TS file ≤ 300 lines, function ≤ 50, params ≤ 3; Rust fn ≤ 100 (clippy), file soft-cap 500. Do NOT append to an existing file by default — a distinct concern gets its own colocated file. No barrel files inside packages. No god-bucket `utils.ts`/`types.ts`. Tauri commands + AI SDK tool `execute` are thin controllers delegating to services/capabilities.

### 3.6 Library API discipline
AI SDK moves fast (the docs were written against SDK 6; installed is ^7 — `ai@7.0.x`). **Never code a external-library API from memory.** Verify against installed types (`node_modules`) or current docs (context7/deepwiki/web) before writing. Same for Tauri 2, zod 4, PixiJS 8, the Live2D renderer.

---

## 4. Recommended first moves for the incoming Leader

1. Read §2 docs. Run `pnpm -r typecheck && pnpm lint && pnpm -r test` and `cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml` to confirm the scaffold is green on your machine. Do the manual IPC smoke (`pnpm desktop:dev`, click the button).
2. Decide with the user whether to formally close issue #2 (scaffold) — the deliverable is done; consider posting the verification evidence as a comment.
3. **First feature issue = #3** (Walking skeleton: Core + OpenAI-compatible chat streamed over WS to a CLI). It is the first slice with real, highly-testable business logic. Its `Blocked by` (#2 scaffold) is satisfied.
4. Drive #3 through the §3.2 loop with §3.3 TDD. Then #4 (device identity/pairing) and #5 (timeline persistence) complete M1.
5. Use the user's real OpenAI-compatible API for final integration; mock-model for the TDD loop.

---

## 5. Watch-list / open threads (things that will bite if forgotten)

- **Live2D renderer** is decided-by-spike (issue #13): primary `untitled-pixi-live2d-engine`, fallback `pixi-live2d-display-lipsyncpatch`. The spike (moc + moc3 from `./models`) locks it and writes the result back to TECH-STACK.md. Runtimes are proprietary — vendored locally, git-ignored, never committed.
- **`models/` and `references/`** are git-ignored, copyrighted (GPLv3/PolyForm-NC/MIT). Learn patterns, never copy code. If `git status` ever shows them, stop and fix `.gitignore`.
- **Node binary migration** (`scripts/migrate-node-to-g.ps1`) is pending a user-run; not blocking.
- **Sampling/proactivity numeric defaults** are configuration with placeholder values, to be tuned after M5 — they are deliberately NOT requirements; don't hardcode them as such.
- **Deferred issues #27–#34** must never be picked up as `ready-for-agent`. If a v1 slice's acceptance criteria would break a deferred seam, that's a defect — fix the v1 slice.
- **The trellis flow is mandatory** (CLAUDE.md "Verify, don't declare"): implement → check → update-spec. Don't let the main thread write feature code and skip `trellis-check`.

---

## 6. Quick command reference

```bash
# Verify scaffold
pnpm -r typecheck && pnpm lint && pnpm -r test
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm desktop:dev            # launches the Tauri window (manual IPC smoke)

# Trellis
python ./.trellis/scripts/task.py create "<title>" --slug <name>
python ./.trellis/scripts/task.py start <dir>
python ./.trellis/scripts/get_context.py --mode packages   # list spec layers
python ./.trellis/scripts/task.py finish
python ./.trellis/scripts/task.py archive <name>

# GitHub roadmap
gh issue view <n> -R Ae486/ShiinaTaki
gh issue list -R Ae486/ShiinaTaki --label ready-for-agent --milestone "M1 — Agent Core skeleton"
```

---

*Handoff authored 2026-07-08 at the close of design+scaffold. The next session owns implementation. Read, verify, then lead.*
