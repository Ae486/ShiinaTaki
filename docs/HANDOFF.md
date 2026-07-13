# TakiAgent — Development Handoff (Leader Bootstrap)

**You are the incoming session. Read this document fully, then the required docs in §2, then act as the Leader (主脑) of a trellis master/worker development flow.** This file is your bootstrap program — what exists, what to read, how to behave, how to drive implementation.

> **Updated 2026-07-13**, at the close of the **agent-core + hardening phase** (M1–M3 shipped and the agent runtime hardened). The next phase is **M4 — Pet UI & Live2D (frontend)**. The original design+scaffold handoff (2026-07-08) has been folded in. Everything below is verified fact, not plan.

---

## 0. What TakiAgent is (one paragraph)

A Windows-native desktop companion whose core is a headless local LLM agent runtime. Three processes (ADR 0001): a TypeScript **Agent Core** (Node 24, AI SDK 7, headless, single DB owner, WS JSON-RPC hub), a Rust **Shell** (Tauri 2 — window, system Capabilities, Permission Gate), and a WebView **Pet UI** (React 19 + PixiJS 8 + Live2D). Agent first, pet shell second. The v1 Character is Shiina Taki (taki). Converse with the user in 简体中文; all code/comments/commits/docs in English.

---

## 0.5 THIS handoff — phase transition + backend on-call (read carefully)

This is not a cold start. The Agent Core, the WS protocol, the Rust Permission Gate, the timeline, and the memory engine are **built, tested, and hardened**. You are picking up the **frontend**.

- **You (incoming session) = the M4 Pet-UI Leader.** Your domain is `apps/desktop/src` (React Pet UI + settings window), the Live2D renderer, UI state, and M4 issues #13–#18 — plus the *client-side* wiring to the Core (WS) and Shell (Tauri `invoke`/events).
- **The Agent Core / backend base is owned by the previous (backend) session, which stays on-call.** It carries deep invariants (§3.4) and hard-won lessons (the D1 hallucination). Do **not** silently deep-modify it.

**Route these to the backend on-call owner — do not hack around them in the frontend:**
- `@taki/shared` protocol **schema** changes (chat / timeline / capability / approval zod shapes) — invariant 3.
- Agent **runtime behaviour**: turn lifecycle, tool-loop, cancellation, base system prompt, hallucination, `responseMessages` persistence.
- Rust **Permission Gate** / capabilities / target classification (`src-tauri`).
- **Timeline persistence model** / memory engine / DB schema / migrations.
- **WS method contracts** (adding/altering a method).

**You own autonomously:** Pet-UI components, Live2D rendering, UI state (Zustand), and pure client wiring that *consumes* existing `@taki/shared` types + WS methods + Tauri commands. If you find you need a new WS method, a new capability, or a protocol field the base doesn't expose → **write the requirement down and hand it to the backend owner** (they implement the contract + Rust side); you consume the client stub. This keeps the DAG and the invariants honest.

---

## 1. What is already done (do NOT redo)

### Design + scaffold — COMPLETE, committed
- 7 ADRs (`docs/adr/0001`–`0007`), `CONTEXT.md` glossary, `PRODUCT.md`, `TECH-STACK.md`, `MEMORY-DESIGN.md`, `TTS-INTERFACE.md`.
- pnpm-workspaces monorepo (issue #2): `@taki/shared` (zod protocol), `@taki/core`, `@taki/desktop` (React+Vite+Tauri), `@taki/cli`, `@taki/e2e`. TS 6 strict, ESLint size caps + kebab lint, vitest, cross-platform CI.
- Backend + frontend `.trellis/spec/*` layer guides — auto-injected into implement/check sub-agents.

### M1 — Agent Core skeleton (4/4 closed)
Walking skeleton: Core streams OpenAI-compatible chat over WS to a CLI; device identity + pairing (mobile-ready, ADR 0004); the **continuous timeline** persisted per character (ADR 0005, one stream, no sessions). See `docs/devlog/m1.md`.

### M2 — Memory & extensibility (4/4 closed)
Layered memory engine: declarative layer registry (add a layer = one row), files-as-truth markdown + SQLite FTS5 index, context assembler, auto-memory (episodic + flush writers), skills loader, MCP client. See `docs/devlog/m2.md` + `MEMORY-DESIGN.md`.

### M3 — Shell & Permission Gate (3/3 closed)
Rust Shell capabilities (screenshot / process-list / clipboard / shell-open / exec), the **Permission Gate** (name-keyed once/session/always for fixed-risk caps; exec classified by command; shell-open by target class; full audit trail), WS capability protocol (core↔node request/respond). See `docs/devlog/m3.md`.

### Agent-runtime hardening — COMPLETE (roadmap-adjacent, pre-M4 close-out)
Three trellis tasks (archived under `.trellis/tasks/archive/2026-07/`) + a config task, all committed:
- **`e2e-manual-checks-port`** — a headless e2e regression net (`e2e/`, `withStack` fixture): **L1** deterministic (dev-gated `capability.trigger`, no model) + **L2** real-agent (`agentSay`, key-gated). ~16 L1 + L2 per key capability. This net is what verifies backend changes.
- **`shell-open-persist-fix` (defect A1)** — shell-open now authorizes on `(capability, targetClass)`: `url-safe` may persist/silent, `local-exec` is a bypass-immune always-ask floor, `blocked` denied. Principle → `.trellis/spec/backend/permission-authorization.md`.
- **`agent-harness-improve` (D1 — the big one)** — fixed the tool-call **hallucination root cause**: the timeline now persists the **full turn** (assistant tool-call parts + tool-result messages), not text-only, so across turns the agent can't fabricate that it acted. Also: a base system prompt with a truthfulness floor, per-character turn **serialization**, `chat.cancel` **cancellation**, and partial-text persistence on interrupt. Proven by a multi-turn hallucination-reproduction L2 (red pre-fix → green post-fix). Principle → `.trellis/spec/backend/agent-runtime.md`.
- **`TAKI_MAX_STEPS`** — the per-turn tool-loop cap is now config (`config/agent-config.ts`, default 10), not hardcoded.

**Net result — the agent runtime is: multi-turn consistent, tool-truthful (records persisted), cancellable, and configurable.** The timeline stores structured `parts` (tool-call `input` / tool-result `output`) — this is already the data M4 #17's tool-card rendering needs.

### Environment
- Node 24, pnpm 10, Rust 1.88 msvc, WebView2 present. `gh` authed as `Ae486`, git user `PLeiA`, remote → github.com/Ae486/ShiinaTaki. A real OpenAI-compatible key is in `.env.local` (L2 tests + integration).
- `apps/desktop/src-tauri/target` was slimmed to ~13 GiB (deleted stale `incremental/` + `release/`); a `cargo clean` needs one `cargo build --bin taki-node` rebuild before e2e (the fixture hard-depends on `target/debug/taki-node.exe`).

---

## 2. Required reading before you write any code (in order)

**Universal (every session):**
1. **`CLAUDE.md`** (root) — the law. Toolchain (pinned), architecture invariants 1–8, naming, anti-sprawl caps, git rules.
2. **`CONTEXT.md`** — domain glossary. Use these exact terms; drift is a review-blocker.
3. **`docs/index.md`** — doc map + ADR table.
4. **`docs/PRODUCT.md`** — v1 scope, **settings-panel scope**, roadmap.
5. **`.trellis/workflow.md`** — the trellis phase model + skill routing.
6. **The target issue**: `gh issue view <n> -R Ae486/ShiinaTaki` — its acceptance criteria are the definition of done.

**Frontend-specific (M4 — read these before touching Pet UI):**
7. **`.trellis/spec/frontend/index.md`** + its guides (directory-structure, component, hook, state-management, type-safety, quality). Auto-injected into sub-agents, but read them yourself. Key stances: **Pet UI is a disposable WS client (invariant 4)** — it owns rendering, never state-of-record; talk to Core via `@taki/shared` types, to Shell via `@tauri-apps/api` only; two windows (pet overlay + settings) have **separate Tauri capability files**.
8. **`docs/TECH-STACK.md`** — renderer decision tree (the #13 spike writes back here), PixiJS/Live2D choices.
9. **ADR 0005** (continuous timeline) — the model behind #17's chat window.
10. **`docs/MEMORY-DESIGN.md`** — read when a UI surfaces memory/activity.

**The backend contracts you CONSUME (know their shape, don't redefine them):**
11. **`packages/shared/src/chat-schema.ts`** — `chat.send/delta/complete/error/cancel`. **`packages/shared/src/timeline-schema.ts`** — `TimelineEntry` incl. structured `parts` (tool-call/tool-result), `timeline.history/subscribe/appended`. These are how the Pet UI drives conversation and renders the timeline.
12. **`docs/deferred-decisions.md`** — the debt register; §5 below names the two entries that come due in M4.

---

## 3. Leader (主脑) rules

You are the orchestrator, not the primary typist. Sequence issues, spawn trellis sub-agents, verify their output against specs + acceptance criteria, keep the DAG honest, report to the user.

### 3.1 Interaction contract
- Converse with the user in **简体中文**; code/comments/commits/docs in **English**; tools/models in English; **ultrathink in English**.
- The user is the product owner. Surface trade-offs, push back on wrong approaches, never silently pick between interpretations. Proceed on reversible in-scope work; stop only for destructive actions or genuine scope/user-only decisions.
- **Never commit or push unless the user explicitly asks.** (Hard rule.) You may stage and propose a commit plan.

### 3.2 The trellis master/worker loop (per issue)
1. **Create a trellis task**: `python ./.trellis/scripts/task.py create "<title>" --slug <name>` → `task.py start <dir>`. One task ↔ one GitHub issue; put the issue number in the prd.
2. **Write `prd.md`** from the issue body + acceptance criteria.
3. **Configure context**: curate `implement.jsonl` / `check.jsonl` with the relevant `.trellis/spec/*` + research files.
4. **Implement**: spawn `trellis-implement` (do NOT write feature code in the main thread — sub-agents get spec injection you don't).
5. **Check**: spawn `trellis-check` — reviews vs spec + acceptance, self-fixes, verifies gates. **Never skip this.** For a real-agent surface, make it **verify假绿 + prove any red→green claim** (revert the fix, watch the test go red).
6. **Verify** acceptance yourself; drive the real flow when there's a runtime surface (for Pet UI that means `pnpm desktop:dev` and *looking* — see §5 manual items).
7. **Update spec** (`trellis-update-spec`) if the work produced a reusable convention or hard-won lesson.
8. Report; on the user's go-ahead they (or you, if asked) commit. Then `task.py finish` + `archive`; pick the next issue.

Model routing: pick the sub-agent model by task complexity; research/implement/check on hard backend-shaped work benefit from a stronger tier. L2 real-LLM tests are allowed (key in `.env.local`) — they catch model-side failures (hallucination) that deterministic L1 cannot.

### 3.3 TDD (test-first for feature work)
Use the `tdd` skill's red-green-refactor. Test **external behavior at the highest seam**, never implementation details. Frontend seams: the WS JSON-RPC client, `@taki/shared` round-trips, Zustand store behaviour, the renderer state machine (framework-free). For the always-on overlay, **idle CPU ~0%** is an acceptance criterion, not a nicety.

### 3.4 Non-negotiable invariants (enforce on every sub-agent's output)
1. Agent Core never touches the OS on the agent's initiative (only sanctioned spawn: MCP stdio in `packages/core/src/mcp/`). Everything else crosses WS → Rust Permission Gate.
2. DB has one writer (Agent Core); others query/subscribe over WS.
3. **Protocol types defined once in `@taki/shared` (zod), mirrored in Rust via serde. Never hand-declare a message shape elsewhere.** ← the frontend consumes these; a new shape is a backend-owner change.
4. **Pet UI is a disposable client — closing it must not affect agent sessions, cron, or memory.**
5. Secrets → Windows Credential Manager (keyring), never config/env files.
6. Features are pluggable modules wired through a registry (add = new module + one registry entry).
7. `characterId` threaded through every layer; v1 UI is single-character but **nothing may hardcode a single character** (multi-char is reserved #33, not excluded).
8. `packages/core` + `packages/shared` stay OS-neutral (CI-enforced); Windows-only code lives only in `apps/desktop`.

### 3.5 Anti-sprawl (AI's default failure mode)
TS file ≤ 300 lines, function ≤ 50, params ≤ 3; Rust fn ≤ 100. Do NOT append to an existing file by default — a distinct concern gets its own colocated file. No barrel files inside packages. No god-bucket `utils.ts`/`types.ts`. Every production file opens with a 3–6 line INPUT/OUTPUT/POS header; every touched dir updates its `index.md`.

### 3.6 Library API discipline
AI SDK 7, Tauri 2, zod 4, PixiJS 8, the Live2D runtime all move fast. **Never code an external-library API from memory** — verify against installed types (`node_modules`) or current docs (context7/deepwiki/web) first.

---

## 4. Recommended first moves (M4 Leader)

1. Read §2. Confirm the base is green on your machine: `pnpm -r typecheck && pnpm -w lint && pnpm -r test`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, and (backend net) `pnpm --filter @taki/e2e test:e2e`.
2. **First issue = #13 — Live2D renderer selection spike** (`spike` label, the M4 blocker). Drive the moc+moc3 decision tree against assets in `./models` (git-ignored), lock primary vs fallback, **write the result back into `docs/TECH-STACK.md`**. Nothing else in M4 proceeds until the renderer is chosen.
3. Then, in numeric = topological order: **#14** pet overlay (transparent, Live2D idle, state machine, drag) → **#15** per-pixel click-through → **#16** bubble + LLM-driven expressions/motions → **#17** full chat window (timeline, markdown, image attachments) → **#18** character import (Cubism + .zst) + costume switching.
4. Drive each through §3.2 with §3.3 TDD. `#16` and `#17` hit the two coupling points in §5 — read them before starting those two.

---

## 5. Watch-list / coupling points (things that will bite if forgotten)

**Coupling point 1 — #16 (LLM-driven expressions) meets D9 (emotion capsule).** The emotion signal fed to the persona is a **static placeholder** today: `EMOTION_CAPSULE = "Current mood: neutral."` in `packages/core/src/memory/assembler.ts`. #16 wants the avatar's expression/motion driven by taki's actual mood, which needs a real emotion signal. Per the D9 ruling: wire it via **injection** — give the assembler a real `emotion` provider (static impl → real source), **do not change the assembly framework, do not hardcode a character data source**, and do **not** pre-build a provider interface now (YAGNI; introduce it when the real source lands). This is "角色真实感" territory. Since the assembler + memory are **backend base**, any change there goes to the backend on-call owner (§0.5) — the frontend consumes whatever expression signal the contract ends up exposing.

**Coupling point 2 — #17 (chat-window tool cards) meets the timeline `parts`.** Good news: **the data is already there.** The `agent-harness-improve` task made the timeline persist structured `parts` — `tool-call` (with `input`) and `tool-result` (with `output`) — exactly so the chat window can render tool cards. Consume `timeline.history` / `timeline.subscribe` / `timeline.appended` and render off `TimelineEntry.parts` (text-only legacy rows have no `parts` — fall back to `content`). **Limit:** `reasoning` / `file` / `approval` parts are **not** persisted yet (register **D14**). If #17's design needs those (e.g. rendering a chain-of-thought), that's a backend-owner change, not a frontend workaround.

**Other open threads:**
- **Live2D renderer (#13)** is decided-by-spike: primary `untitled-pixi-live2d-engine`, fallback `pixi-live2d-display-lipsyncpatch`. Runtimes are proprietary — vendored locally, git-ignored, never committed.
- **`models/` and `references/`** are git-ignored + copyrighted (GPLv3/PolyForm-NC/MIT). Learn patterns, never copy code. If `git status` shows them, stop and fix `.gitignore`.
- **Deferred register status**: D1 (hallucination) + D2 (shell-open A1) **DONE**; **D9** (emotion — #16 above) OPEN; D14/D15/D16 (agent narrow edges) OPEN; D11 partially closed (`TAKI_MAX_STEPS`). Consult `docs/deferred-decisions.md` when planning — if you defer something, log it.
- **The trellis flow is mandatory** (implement → check → update-spec). Don't let the main thread write feature code and skip `trellis-check`.
- **Manual-only checks** (can't be headless): the settings/chat visual verification, a browser/app actually launching (shell-open #10), and Live2D visual correctness. Track them in `docs/devlog/manual-checks.md`.

---

## 6. Quick command reference

```bash
# Verify base green
pnpm -r typecheck && pnpm -w lint && pnpm -r test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
pnpm --filter @taki/e2e test:e2e          # backend regression net (L2 needs .env.local key)

# Run the app (manual visual verification — the M4 loop)
pnpm desktop:dev                          # Tauri pet window + Vite
pnpm core:dev                             # Agent Core (reads .env.local)
pnpm cli:dev                              # operator chat entry
node scripts/reset-manual-test.mjs        # step-through reset of core/Shell state before a manual test

# Trellis
python ./.trellis/scripts/task.py create "<title>" --slug <name>
python ./.trellis/scripts/task.py start <dir>
python ./.trellis/scripts/task.py finish
python ./.trellis/scripts/task.py archive <name>

# GitHub roadmap (M4)
gh issue view <n> -R Ae486/ShiinaTaki
gh issue list -R Ae486/ShiinaTaki --milestone "M4 — Pet UI & Live2D"
```

---

*Handoff updated 2026-07-13 at the close of the agent-core + hardening phase. The Agent Core base is built and hardened; its owner stays on-call for the contracts in §0.5. The incoming session owns the M4 Pet-UI frontend. Read, verify base-green, then lead.*
