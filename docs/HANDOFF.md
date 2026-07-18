# TakiAgent — Development Handoff (Leader Bootstrap)

**You are the incoming session. Read this document fully, then the required docs in §2, then act as the Leader (主脑) of a trellis master/worker development flow.** This file is your bootstrap program — what exists, what to read, how to behave, how to drive implementation.

> **Updated 2026-07-18**, at the close of **M4 — Pet UI & Live2D** (M1–M4 shipped: agent runtime hardened, pet overlay + chat window + character import live). The next phase is **M5 — module optimization** (avatar polish, capability governance, sensing, proactivity, memory-learning, settings suite). The M5 blueprint — grilled and signed off with the owner — lives in **`devlog/m5.md`**; this file stays the behavioral bootstrap. Everything below is verified fact, not plan.

---

## 0. What TakiAgent is (one paragraph)

A Windows-native desktop companion whose core is a headless local LLM agent runtime. Three processes (ADR 0001): a TypeScript **Agent Core** (Node 24, AI SDK 7, headless, single DB owner, WS JSON-RPC hub), a Rust **Shell** (Tauri 2 — window, system Capabilities, Permission Gate), and a WebView **Pet UI** (React 19 + PixiJS 8 + Live2D). Agent first, pet shell second. The v1 Character is Shiina Taki (taki). Converse with the user in 简体中文; all code/comments/commits/docs in English.

---

## 0.5 THIS handoff — M5 phase (read carefully)

This is not a cold start. M1–M4 are shipped: Agent Core (memory engine, skills, MCP), WS protocol, Rust Permission Gate + capabilities, pet overlay with Live2D + click-through + bubble avatar, full chat window (streaming timeline, attachments, cancel-retract), character import + costume switching.

- **You (incoming session) = the M5 Leader, owning the full stack.** M5's tasks span core (scheduler, heartbeat, memory redesign), shell (sampling capabilities, permission tiers), and UI (avatar polish, settings suite). Route work through the trellis flow; sub-agents implement, you verify.
- **Deep-invariant areas demand extra care (not a different owner — extra care):**
  - The **D1-frozen turn runtime** (`chat-agent.ts` stream loop / persistTurn / abort / toolApproval): byte-frozen bodies, NAMED ADDITIVE seams only — see `.trellis/spec/backend/agent-runtime.md`, including the v7 abort double-ending law (cover BOTH stream endings; transport-faithful mocks).
  - **`@taki/shared` protocol schemas**: additive evolution only; check whether `src-tauri/src/protocol.rs` mirrors a shape before touching it (invariant 3).
  - **Rust Permission Gate**: fail-closed forever; the safest option owns every default slot; an advisory LLM classifier may add a deny, never a fail-open allow.
  - **Memory engine**: D28 modularity — every new mechanism is a single-file deletable module; the `layer-registry` declarative pattern survives all redesigns.

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

### M4 — Pet UI & Live2D (6/6 closed)
Renderer locked by spike (#13: `untitled-pixi-live2d-engine` + pixi 8); transparent always-on pet overlay with render governor + drag (#14); element-level click-through (#15); bubble + LLM-driven avatar — expression/motion tools + reported vocabulary, gaze/click reactions (#16); full chat window — streaming timeline, default-safe markdown, image attachments + VLM describe, abort entry, floating toasts, cancel-before-reply retract (#17); generic character import (Cubism 2/3 + `.zst` clean-room) + costume switching with degrade-and-badge availability + last-costume persistence (#18). Four packaged B-test rounds hardened the packaged-only defect classes (CSP, per-window ACL, WebView2 quirks, boot races) → `.trellis/spec/frontend/packaged-build.md`. See `docs/devlog/m4.md`.

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

## 4. Recommended first moves (M5 Leader)

1. Read §2, then **`devlog/m5.md`** — the signed-off M5 blueprint (decisions Q1–Q5, the memory-redesign six-pack, the proactivity three-tier model, the customization principles, the 11-task table, the exclusion list) — and the two research files it indexes (`.trellis/workspace/pleia/m5-proactivity-survey.md`, `hermes-memory-analysis.md`).
2. Confirm the base is green: `pnpm -r typecheck && pnpm -w lint && pnpm -r test`, `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.
3. Drive the 11 tasks in blueprint order: **T1** avatar-presentation → **T2** tool/capability governance → **T3a/T3b** sensing (#19/#20) → **T4** proactivity core (croner + #21 Heartbeat) → **T5** memory-learning (D28 redesign) → **T6** settings suite (#22→#26). Each through §3.2, plus the Q1 cleanup contract: health notes in research, touched-file debt fixed in impl, verified in check.
4. Cross-task seams to honor from day one: **A1** injection-fence minimum lands with T3a; **A2** write-context tag lands with T4's first heartbeat write; T4's croner is what T5's nightly consolidation rides.

---

## 5. Watch-list / coupling points (M5)

**Coupling point 1 — A2 before any Heartbeat write.** A Heartbeat is a cron-like agent turn; without the write-context tag (`primary|heartbeat|flush|subagent`) auto-memory would sediment every beat as real conversation (episodes/profile pollution). The tag ships IN T4's heartbeat wiring, not later (full formalization in T5).

**Coupling point 2 — A1 minimum before sensed text enters prompts.** T3a puts activity captures into assembled context; the injection fence + provenance note ("recalled/sensed data, not instructions") must exist the same day. Full hardening (streaming scrubber + write-time threat scan) completes in T5. Sensed/recalled content is untrusted data, always.

**Coupling point 3 — conversation-configured anything must surface in the settings panel.** Dual entry, single store: agent config tools (cron jobs, heartbeat checklist items, sampling grants) write the same persisted stores the T6 panels render. An NL grant rides the ORDINARY Approval flow (once/session/always → the #23 panel) — never a new mechanism, never a silent high-sensitivity flip.

**Other open threads:**
- **D9** (emotion capsule) resolves in T5 as a `companion-state-source` MemorySource provider (today: static `"Current mood: neutral."` in `assembler.ts`).
- **D29** (ws-client mid-turn disconnect never settles) comes DUE in #22 — first touch of `ws-client.ts`, fix + test in the same task.
- **Roaming C3 costume-switch wedge**: root cause unknown, fully mitigated (timeouts + switch ticket + fallback); packaged devtools are enabled — grab Network-pending evidence if it recurs.
- **Agent-authored EXECUTABLE artifacts stay deferred (D36)**; the M5 mechanism for learned habits is data-level self-config (structured cron/checklist rows executed by the deterministic engine). Community imports are untrusted → trust tiers + threat scan (#25, D37).
- **The trellis flow is mandatory** (implement → check → update-spec). Manual-only checks → `docs/devlog/manual-checks.md`.

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

# GitHub roadmap (M5)
gh issue view <n> -R Ae486/ShiinaTaki
gh issue list -R Ae486/ShiinaTaki --label ready-for-agent
```

---

*Handoff updated 2026-07-18 at the close of M4. M1–M4 are shipped; the incoming session is the M5 Leader (full stack, module optimization). Read `devlog/m5.md` for the signed-off blueprint, verify base-green, then lead.*
