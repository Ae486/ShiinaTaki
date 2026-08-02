# TakiAgent — Development Handoff (Leader Bootstrap)

**You are the incoming session. Read this document fully, then the required docs in §2, then act as the Leader (主脑) of a trellis master/worker development flow.** This file is your bootstrap program — what exists, what to read, how to behave, how to drive implementation.

> **Updated 2026-08-02 (fourth pass, T5 close)**. M1–M4 shipped and pushed. M5 is **mid-flight with T1/T2/T3a/T3b + time-awareness + T5 DONE** (see §1). **T5 (memory redesign + context management) is COMPLETE and archived** — 7 batches, all owner-approved and committed; `t5-decisions.md` (R0–R22) served as the binding contract and is now historical record. Next work, owner-sequenced: the settings-panel task (owner plan B, 2026-08-02 — see §4) and **T4 proactivity** (`t4-decisions.md` R1–R12 ready). Everything below is verified fact, not plan.

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

### M5 — mid-flight (T1/T2/T3a/T3b + time-awareness + T5 DONE; next = settings-panel task + T4, then T6)
- The blueprint (`devlog/m5.md`, signed off) remains the plan of record; the task table's T4/T5 ORDER was swapped by owner ruling 2026-07-27 (T5 first). Do not re-litigate settled rulings.
- **T1 avatar presentation** — DONE, archived (`.trellis/tasks/archive/2026-07/`). Same-step expression/motion discipline (1c), costume-change notice (1f), presentation-tail stop.
- **T2 governance** — DONE, archived. Permission Level projection (strict/standard/relaxed over per-cell postures), `describePrompt` seam (T2b §3.6: caller focus APPENDED to base guardrails), approval etiquette.
- **T3a perception activity layer** — DONE, archived. Foreground-window capability (Rust) → activity sampler → coalescing `ActivityState` → fenced activity block via `instructionsExtra`. The A1 minimal fence (`agents/untrusted-fence.ts`) ships here.
- **Time awareness** — DONE, archived (e10adec). Day-date line early + current-time line last in `composeInstructions` (stable-early/volatile-late), `get_current_time` tool, code-computed memory ages.
- **T3b perception privacy** — DONE (commit 0133874, task dir committed, NOT yet archived — see §4). `packages/core/src/perception/`: ambient screenshot sampling (own `screenshot-ambient` cell, DEFAULT OFF, silent off-state), TWO privacy layers (deterministic transmission-blocking: sensitive-skip + `seal()` + pre-capture fresh foreground screen; semantic retention-blocking: `SENSITIVE_SCREEN` VLM verdict, fail-closed), PII scrub (scrub-then-fence at the sense seam), Privacy Pause (DB-persisted, single production writer RED-proved), frame retention GC, operator-only `perception.*` WS methods, D44 closed on the tool path. Manual checks 76–83 owner-verified 2026-07-27 (79 deferred to #26, 83 ongoing material collection).
- **Prompt guidance pass** — DONE (commit 9f41646). BASE_SYSTEM_PROMPT teaches the fence contract, the two time lines, anti-recitation; behavior norms in `prompt/system/assistant-layer.md`.
- **T5 memory redesign + context management** — DONE, archived (`.trellis/tasks/archive/2026-08/07-28-memory-context`), 7 batches each committed as a feat(core)+docs(trellis) pair (last: b944263/c925e59). What shipped: (1) three-tier memory — user-authored identity card (read-only to the agent, wins conflicts) / tidy-maintained blocks (user-model, memory-index) / searchable rows behind a write gate (R15 behaviour-change test, restricted auto writer, R9 dedupe→reinforce, R10 first-person voice, origin fencing); (2) CJK retrieval — unicode61 + `Intl.Segmenter` search_terms column (D53 seam), re-derived bm25 weights, disclosure as a recall channel not an AND gate; (3) R6 removal — no per-turn retrieved block, pull via `memory_search` only, memory prompt procedures (R12/R16–R19); (4) maintenance — model-led tidy pass, retention sweeper, Utility Slot (background LLM calls routable to a cheap model via `TAKI_UTILITY_*`); (5) replay view (ADR 0008) — volatile context in a `<turn-context>` in-flight tail (system prompt day-stable), token-measured window (declared → EMA-calibrated by real usage → estimator fallback; overflow self-heal, migration 011), conversation compaction (rolling per-character summary, migration 012, external async compactor on the utility slot, retire-all-but-newest-40, NO summary truncation, date-anchored summary prompt). Detail: notes.md closure blocks in the archived task dir; manual checks 84–95 queued for owner; research banks rd-prompt-philosophy.md + re-compaction-prompts.md feed T4.
- **Research banks (committed, e5a0c49)**: `t4-decisions.md` (R1–R12, T4 立项-ready), 4 T4 research docs, **`t5-decisions.md` (R0–R22, BINDING for T5)**, `t5-context-management-survey.md`, `t5-memory-systems-survey.md` (§11 covers promotion/archived-tier/write-restraint + the Nocturne system prompt read in full). Earlier banks: `m5-proactivity-survey.md`, `hermes-memory-analysis.md`. Local references: `references/hermes-agent-main` (MIT), `references/nocturne_memory-main` (MIT — its `docs/system_prompt_en.md` is the closest prior art for T5's R12 prompt; clean-room only).
- **Deferred-decisions register**: D44 CLOSED; D47 (memory-path fence → T5/A1), D48 (residual one-round-trip blind window), D49/D50 (audit volume / dwell fallback — unruled tuning), OPEN; D51 DONE. T5 also owns: D4 (context compaction, SCHEDULED(T5)), D9 (emotion capsule).

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

**Frontend-specific (read before touching Pet UI):**
7. **`.trellis/spec/frontend/index.md`** + its guides (directory-structure, component, hook, state-management, type-safety, quality). Auto-injected into sub-agents, but read them yourself. Key stances: **Pet UI is a disposable WS client (invariant 4)** — it owns rendering, never state-of-record; talk to Core via `@taki/shared` types, to Shell via `@tauri-apps/api` only; two windows (pet overlay + settings) have **separate Tauri capability files**.
8. **`docs/TECH-STACK.md`** — renderer decision tree (the #13 spike writes back here), PixiJS/Live2D choices.
9. **ADR 0005** (continuous timeline) — the model behind #17's chat window.
10. **`docs/MEMORY-DESIGN.md`** — read when a UI surfaces memory/activity.

**The backend contracts you CONSUME (know their shape, don't redefine them):**
11. **`packages/shared/src/chat-schema.ts`** — `chat.send/delta/complete/error/cancel`. **`packages/shared/src/timeline-schema.ts`** — `TimelineEntry` incl. structured `parts` (tool-call/tool-result), `timeline.history/subscribe/appended`. These are how the Pet UI drives conversation and renders the timeline.
12. **`docs/deferred-decisions.md`** — the debt register; §5 below names the entries that come due in M5 (D9, D29).

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

### 3.7 Sub-agent operations (hard rules, owner-directed)
- **Web research tools**: you and every sub-agent use `mcp__exa__*` / `mcp__tavily-remote__*` ONLY — native WebSearch/WebFetch are **forbidden** for research (owner directive 2026-07-18). Sub-agents do not inherit this preference: NAME the allowed tools verbatim in every dispatch prompt.
- **Model routing**: pass `model` EXPLICITLY on every Agent dispatch — never let it silently inherit the session default (a default switch once sent work to an unavailable tier). Route by complexity: heavier tier for research/implement on hard slices; the check tier per the owner's current directive.
- **Never TaskStop a running sub-agent** unless the owner explicitly says so — killing it burns its context and tokens.
- **Idle without a report = demand it.** Agents sometimes go idle without delivering their final report (happened twice in M4). SendMessage: "Reply now with the report per your original instructions", and meanwhile verify their work independently (git status/diff + re-run gates yourself). Trust but verify — one M4 impl agent's "never throws" claim was mock-derived and wrong; leader verification against SDK source caught it.
- Agents interrupted before delivering die with their session — re-dispatch fresh from the persisted brief; never wait on them.

---

## 4. Recommended first moves (post-T5 Leader)

1. Read §2, then: `t4-decisions.md` (R1–R12, 立项-ready), the T5 outcome pointers (archived task `notes.md` closure blocks — the batch 5/6/7 blocks carry the T4 handoff items), `docs/MEMORY-DESIGN.md` (current), ADR 0008.
2. Confirm the base is green: `pnpm -r typecheck && pnpm -w lint && pnpm -r test`, cargo test. Expected: **core 1101 / shared 199 / desktop 143 / cli 18+ / cargo 141**, e2e 26 (real key), boot migrations `[1..12]`.
3. **Owner plan B (2026-08-02) — settings panel advanced, runs BEFORE T4 (owner-ruled same day)**: step 1 = a generic operator WS invoker in `apps/cli` (`/call` REPL command + `--call` one-shot; the permanent scriptable surface, NOT a throwaway — owner constraint) shipped in the T5 close-out window (task `08-02-cli-operator-call`); step 2 = the panel task (trimmed #22+#26 core: config store + settings window + R13 knob surfaces + operator triggers + perception surfaces). Entry design (owner 2026-08-02): right-click on the Live2D character summons an **operation wheel** (icons: chat / settings / costume / home — home opens the full page nav, the others are shortcuts to specific pages); costume switching MIGRATES from the current raw right-click into the wheel; the wheel ships WITH the panel task and must be registry-driven (add a page/action = one entry) so later pages slot in without rework. Panel UI style may reference BANDORI (`references/BANDORI-PET-REV`) — **GPLv3: patterns/style only, never copy code; clean-room applies**.
4. **T4 立项 notes from T5**: `main.ts` is at 298/300 counted lines — extraction REQUIRED before any next touch; truthfulness bullet cross-surface drift, observation-tool non-triggers, skills decision procedure, prompt snapshot tests (batch-5 closure); owner signal 2026-08-02: **time-sense is an important part of this agent** — keep time information consistent across prompt surfaces (day line, turn-context, memory ages, summary date anchor); compaction cost note: reasoning models burn ~15k thinking tokens per pass — a cheap non-reasoning `TAKI_UTILITY_*` model is worth configuring; D56/D57 triggers live in `docs/deferred-decisions.md`.
5. After the panel task + T4 → **T6 settings suite remainder** (#22→#26 — whatever the panel task did not consume; #26 still owns manual check 79).
6. Push cadence unchanged: push at milestone close or on owner request.

---

## 5. Watch-list / coupling points (T5 and after)

**Coupling point 1 — T5's R6 SHIPPED; T4 designs against the new shape.** The per-turn retrieved block is GONE (batch 5): memory reaches the model via deterministic push (identity card + blocks + pinned) or the agent's own `memory_search` call. A T4 heartbeat turn has NO user input and NO `<turn-context>` tail (that rides the outgoing user message) — T4 picks its own injection point for both memory and volatile context.

**Coupling point 2 — RESOLVED (T5 batch 6).** The flush boundary is no longer coupled to the 200-message constant: flush and the token-measured window read the SAME select closure (`conversation-store.ts`), and batch 7's compaction watermark rides the same discipline (`through_seq <= lastFlushSeq` asserted). Nothing to re-couple.

**Coupling point 3 — A2 before any Heartbeat write (unchanged, now T4).** The turn-origin tag (`primary|heartbeat|flush|subagent`) ships IN T4's heartbeat wiring; `autoMemory.onTurnCompleted` currently does not discriminate turn kinds (t4-decisions "newly discovered problems").

**Coupling point 4 — conversation-configured anything must surface in the settings panel (T6/panel task).** Dual entry, single store. Owner plan B (2026-08-02): the `apps/cli` generic invoker is the PERMANENT scriptable surface — the panel is the GUI surface over the SAME operator WS methods; neither replaces the other, and R13 knobs stay env-based until the panel task ships the config store (every exposed value keeps validation + a fail-closed default in Core — T5 delivered that exposure).

**Other open threads:**
- **R15's skip log is mandatory** — once "write nothing" is the write gate's normal outcome, an unlogged skip is indistinguishable from a broken writer (mem0 issue #3009 precedent; recorded in t5-decisions).
- **VLM-failure has no backoff in the ambient sampler** (leader-found during manual testing, unregistered): describe failures don't count toward backoff — under `keep` retention this accumulates undescribed frames at the refresh cadence. Low urgency (default is drop + ambient default-off); register a D-number if ambient goes always-on.
- **croner is still NOT installed** despite the CLAUDE.md stack table (t4-decisions); it is a pattern evaluator, not a scheduler — the tick loop/persistence/catch-up are ours (T4).
- **D29** (ws-client mid-turn disconnect never settles) comes DUE in #22 — first touch of `ws-client.ts`.
- **D48 residual**: the ambient pre-capture screen narrows the blind window to one WS round-trip but is NOT atomic; true closure = Shell-side same-instant sampling, trigger recorded in the register.
- **Roaming C3 costume-switch wedge**: root cause unknown, fully mitigated; grab Network-pending evidence if it recurs.
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

*Handoff updated 2026-08-02 at the close of T5. M1–M4 shipped; M5's T1/T2/T3a/T3b + time-awareness + T5 are done, committed, archived. Next order (owner-ruled): the settings-panel task (plan B step 2, BEFORE T4; right-click operation-wheel entry) → T4 proactivity (`t4-decisions.md` binding, R1–R12) → T6 remainder. Verify base green first (core 1101 / shared 199 / desktop 143 / cli 32 / cargo 141 / e2e 26 / boot [1..12]).*
