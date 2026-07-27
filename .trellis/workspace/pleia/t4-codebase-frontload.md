# T4 Codebase Front-Load — proactivity core (scheduler + heartbeat + delivery + config tools)

- **Query**: map every seam T4 (croner scheduler, heartbeat engine, proactive utterance delivery, config tool family, A2 write-context tag) must touch, with `file:line` + exactly what T4 adds.
- **Scope**: internal only (local codebase mapping, no web).
- **Date**: 2026-07-26
- **Tree state**: T3a (activity layer) + time module are **committed** (`d1e8ca3`, `b5cc566`, `e10adec`). **T3b batch A is landed but UNCOMMITTED** — `git status` shows `?? packages/core/src/perception/` (privacy-pause, pii-scrub, sensitive-processes, perception-layer + tests) plus modified `activity/*`, `main.ts`, `media/attachment-gc.ts` (untracked). Everything below reflects the working tree, not `HEAD`. An implementer must NOT `git stash`/`checkout` those paths.

---

## 0. Answer first — the critical seam

**An autonomous turn CAN reuse `chat-agent.ts` without forking the runtime, but only if four hard-coded user-message assumptions are parameterized.** The runtime itself (ToolLoopAgent construction, stream loop, `persistTurn`, abort wiring, `toolApproval`) is turn-shape agnostic. What is NOT agnostic:

1. `store.appendUser(characterId, message, images)` fires **unconditionally** at `chat-agent.ts:89` — a heartbeat would write a fake user row to `timeline_messages`.
2. `buildOutgoing` (`chat-agent.ts:114`, `:201-212`) returns `history` verbatim for a text turn — with no user row appended, the message list ends on an `assistant` role.
3. `composeInstructions` (`chat-agent.ts:250-269`) takes `message` as `currentMessage` for memory retrieval — a heartbeat has no query text.
4. `fireDetachedTurnWrites` (`chat-agent.ts:156-162`) fires `autoMemory.onTurnCompleted` on every committed turn — this is exactly the A2 pollution HANDOFF coupling point 1 warns about.

Plus two silent hazards: `deps.costumeChanged?.(characterId)` is **consumed** at `chat-agent.ts:114` (a heartbeat would steal the one-shot costume notice from the next real user turn), and `retractIfCancelledSilent` (`chat-agent.ts:180-186`) deletes `userEntry.seq` on an aborted-with-nothing turn — meaningless (and wrong-row-deleting) without a user row.

Recommended shape (keeps D1's "frozen zone" discipline — see §8): extend `ChatSendParams` handling with an optional turn-kind at the **pre-loop** and **post-loop** seams only, exactly the way #17 (images) and 1f (costume notice) were added as *additive seams* around a byte-identical stream loop.

---

## 1. THE CRITICAL SEAM — running a turn with no user message

### 1.1 Full path today

| Step | File:line | What happens |
|---|---|---|
| WS entry | `server/methods/chat-send.ts:32-51` | `chatSendMethod(chatAgent, logger, controls)`; role `["operator"]`; validates `ChatSendParamsSchema`; returns `{messageId}` synchronously, defers the stream via `setImmediate` |
| Serialization | `chat-send.ts:64-74` `runQueued` | `await controls.queue.acquire(params.characterId)` → `controls.turns.begin(characterId)` → `pump` → `finally { turns.end(); release() }` |
| Queue | `agents/turn-queue.ts:15-36` | keyed async mutex; `acquire(key)` resolves a `release` fn once every earlier holder of that key released |
| Cancel registry | `agents/turn-registry.ts:16-35` | per-character `AbortController`; `cancel()` aborts with the plain string `"turn cancelled by operator"` |
| Pump | `chat-send.ts:76-120` | builds `turn = {notify, onClose, signal, onRetract}`; `for await (const delta of chatAgent.stream(params, turn))` → `ctx.notify(chat.delta)`; then `chat.complete` or `chat.error{retracted}` |
| Agent | `agents/chat-agent.ts:76-151` `runTurn` | see below |
| Persist | `chat-agent.ts:230-242` `persistTurn` | `await result.responseMessages` → `store.appendTurn`; plus `store.appendAssistant(pendingStepText)` for interrupted turns |
| Store | `agents/conversation-store.ts:42-73` | `appendUser` / `appendAssistant` / `appendTurn` / `removeEntry` / `history`; every commit fires `onAppend` |
| Mapping | `agents/turn-mapping.ts:22-117` | `toEntryInput` / `toUserEntryInput` / `toModelMessage` |
| Repo | `db/timeline-repo.ts:63-116` | `timeline_messages` SQL; `append` returns the row with its `seq` |
| Fan-out | `main.ts:125-129` → `server/timeline-subscriptions.ts:25-58` | `onAppend → publish(entry)` → every subscribed operator socket gets `timeline.appended` |

### 1.2 `runTurn` line by line — what assumes a user message

```
chat-agent.ts:78   const { characterId, message } = params;         // ChatSendParams requires a non-empty message OR attachments
chat-agent.ts:83   const vision = attachments.length > 0 ? ... : null
chat-agent.ts:89   const userEntry = store.appendUser(characterId, message, images);   // ← ASSUMPTION 1 (unconditional user row)
chat-agent.ts:90   const history = store.history(characterId);
chat-agent.ts:92-101  new ToolLoopAgent({model, instructions: composeInstructions(...), tools, stopWhen, toolApproval})
chat-agent.ts:114  buildOutgoing({history, isImageTurn, message, attachments, changed: deps.costumeChanged?.(...)})  // ← ASSUMPTIONS 2 + 4-bis (costume consume)
chat-agent.ts:117  const result = await agent.stream({messages: outgoing, abortSignal: turn?.signal});
chat-agent.ts:127-141  stream loop + finally persistTurn                 // turn-shape AGNOSTIC — do not touch
chat-agent.ts:145,149 retractIfCancelledSilent(..., userSeq: userEntry.seq)  // ← ASSUMPTION 5
chat-agent.ts:150  fireDetachedTurnWrites(deps, {characterId, imageRefs, message})  // ← ASSUMPTION 3 (auto-memory)
```

**Detail on each:**

- **A1 — user row.** `ChatSendParamsSchema` (`packages/shared/src/chat-schema.ts:31-41`) `.refine`s that a send carries a non-empty `message` OR ≥1 attachment. A heartbeat has neither. Even with a synthetic string, `appendUser` writes a `role:"user"` row that (a) fans out as `timeline.appended` and renders in the chat window as a user bubble, (b) advances `timeline-repo.latestSeq` which drives auto-memory watermarks (`memory/auto-memory.ts:59,67,82`), (c) enters `history()` and is replayed to the model forever.
- **A2 — message list tail.** `buildOutgoing` (`chat-agent.ts:201-212`) returns `args.history` untouched for a plain text turn. Skip the `appendUser` and the outgoing array ends on an `assistant` (or `tool`) message. `conversation-store.history` (`:64-72`) also drops leading orphan `tool` rows but does nothing about a trailing assistant. T4 must construct a heartbeat's outgoing tail explicitly — the natural fit is the **same additive seam 1f uses**: `[...history, {role:"user", content:<heartbeat prompt>}]` where the prompt is a `[System · no reply needed]`-style directive that is **never persisted** (mirrors `avatar/costume-notice.ts` + `chat-agent.ts:208-210`).
- **A3 — memory retrieval.** `composeInstructions` (`:250-269`) calls `deps.memory.assemble({characterId, queryText: recentText(history), currentMessage: turn.message})`. `RECALL_WINDOW = 5` (`:70`). A heartbeat can pass the checklist text or `""` as `currentMessage`; `recentText` already works off history alone.
- **A4 — costume notice consume.** `deps.costumeChanged?.(characterId)` at `:114` advances the `lastSeen` baseline (`avatar/avatar-vocabulary.ts`, contract documented in `.trellis/spec/backend/agent-runtime.md:125-145`). A heartbeat turn consuming it means the next *user* turn never sees the notice. **T4 must pass `changed:false` for heartbeat turns (do not call `costumeChanged`).**
- **A5 — retract.** `retractIfCancelledSilent` (`:180-186`) is only meaningful for a user row. For a heartbeat, skip it entirely (there is nothing to restore, and no operator to notify).
- **A6 — auto-memory.** `:157` `void deps.autoMemory?.onTurnCompleted(characterId)`. See §5 — this is where the A2 write-context tag lands.
- **A7 — approval gate without an operator.** `:100` installs `toolApproval` whenever `approval` is configured, even with `turn === undefined`; `approval.decide(toolCall, turn?.notify)` then **denies unremembered MCP tools fail-closed** (comment at `:97-99`). This is correct-by-design for a heartbeat: an unattended turn cannot pop an approval dialog. Remembered `always` decisions still pass (`approval/decision-store.ts`). Capability tools (screenshot/exec/…) are NOT behind this gate — they route to the Shell Permission Gate, which *can* raise a dialog on the node side.

### 1.3 Minimum call to execute an autonomous turn

Today, literally:

```ts
for await (const _ of chatAgent.stream({ characterId, message: "<synthetic>" })) { /* drain */ }
```

That works (the `turn` param is optional — `chat-agent.ts:32`, `:76`; tests already drive it without one, e.g. `chat-agent.test.ts`), but it pays every assumption above: a fake user row, a costume-notice steal, and an auto-memory fire. **The minimum *correct* call** needs a turn-kind flag threaded to five call-sites (`:89`, `:114`, `:145/:149`, `:150`, plus the outgoing tail). No change to the stream loop, `persistTurn`, or the abort wiring.

### 1.4 What T4 adds (exact paths)

- `packages/core/src/agents/turn-kind.ts` (new, ~20 lines) — `export type TurnKind = "primary" | "heartbeat" | "flush" | "subagent"` + a narrow `AutonomousTurnInput` type. Kept in `agents/` because it is a turn concept, not a memory one; `memory/` imports it (memory already imports from `agents/` — `memory/auto-memory.ts:6` imports `REPLAY_WINDOW`).
- `packages/core/src/agents/chat-agent.ts` — additive-only edits at the five sites above. Keep `runTurn`'s try/finally byte-identical (D1 rule, §8).
- `packages/core/src/heartbeat/heartbeat-runner.ts` (new) — the caller: acquires the queue, builds the synthetic prompt, drives `chatAgent.stream(...)` with no `TurnContext` (or a delivery-only one), drains deltas into the delivery buffer (§2).
- `packages/core/src/heartbeat/heartbeat-prompt.ts` (new) — the `[System · no reply needed]` directive + `renderWallClock(now)` injection (§6) + the checklist body. **Never persisted** (same rule as `avatar/costume-notice.ts`).

### 1.5 Turn queue — per-character? Would a heartbeat serialize? (busy-yield)

**Yes, per-character.** `turn-queue.ts:20` `acquire(key)`; `chat-send.ts:66` passes `params.characterId`. A heartbeat acquiring the same `characterId` **serializes correctly** — it waits for a live user turn to fully commit (append-user → stream → append-turn) before starting, and a user send that lands mid-heartbeat waits for the heartbeat.

**But busy-yield is NOT expressible today.** `TurnQueue` exposes only a blocking `acquire`; there is no `tryAcquire` / `isBusy`. `TurnRegistry` (`turn-registry.ts:7-14`) exposes `begin`/`end`/`cancel` but no `isActive(characterId)` — and `cancel()` returning `false` is not a usable probe (it would abort a live turn if one existed). Queued-but-unstarted turns are invisible in both.

- **What T4 adds:** either `tryAcquire(key): (() => void) | null` in `agents/turn-queue.ts` (preferred — one small pure addition, unit-testable, no new module) **or** `isActive(characterId): boolean` in `agents/turn-registry.ts`. `tryAcquire` is the stronger primitive: it covers "a turn is queued but not yet begun", which `isActive` misses. Survey B7 (`.trellis/workspace/pleia/m5-proactivity-survey.md:303-312`) wants defer-while-busy; OpenClaw bug #8997 (background completion interrupting an active turn) is the failure to design against.
- Second busy source: **in-flight capability calls**. `capabilities/capability-broker.ts` holds pending node requests; a `pendingCount()` probe would be a second small addition if T4 wants "defer while a Capability is in flight" (survey B7 explicitly asks for it).

---

## 2. Proactive utterance delivery

### 2.1 How Core pushes to the Pet UI today — three independent channels

| Channel | Core side | Wire | Client side | Works with no client? |
|---|---|---|---|---|
| **chat stream** | `chat-send.ts:94,108,113` `ctx.notify(...)` | `chat.delta` / `.complete` / `.error` | `lib/ws-client.ts:122-139` routes to `state.current` (the **in-flight request's** handlers) | N/A — requires a live `chat.send` |
| **timeline** | `main.ts:127` `onAppend → timelineSubscriptions.publish` | `timeline.appended` / `.removed` | `ws-client.ts:144-149` → `state.push.timeline`; subscribed by the **chat window** only (`windows/chat/use-chat-timeline.ts:20`) | yes — `publish` no-ops when no sink (`timeline-subscriptions.ts:44-48`); rows persist, client backfills via `timeline.history` |
| **avatar** | `avatar/avatar-tools.ts` execute → `avatar-subscriptions.ts:38-43` `publish` | `avatar.command` | `ws-client.ts:141-143` → `state.push.avatar`; subscribed by the pet window | yes — "No Pet UI subscribed → the emotion simply isn't rendered; never an error" (`avatar-subscriptions.ts:39`) |

### 2.2 The gap

- **A heartbeat's spoken text already reaches the chat window for free**: `persistTurn → store.appendTurn → onAppend → timeline.appended`. No new plumbing.
- **A heartbeat's silent avatar act already works end-to-end for free**: `avatar_set_expression` / `avatar_play_motion` publish directly, independent of any turn context. This is the CONTEXT.md "silent act such as choosing an avatar expression" path — **zero new code**.
- **The pet bubble is the hole.** `features/chat-bubble/use-chat-bubble.ts:17-28` only ever renders deltas of a reply to a `client.chat(...)` it issued. `ws-client.ts:124` is `state.current?.handlers.onDelta(...)` — **with no active turn, `state.current` is `null` and every `chat.delta` is silently dropped**. The bubble does not subscribe to `timeline.appended`. So a Proactive Utterance would be persisted and visible in the chat window but **invisible in the pet bubble**, which is the whole point of the feature.

### 2.3 What T4 adds (exact paths)

- `packages/shared/src/proactive-schema.ts` (new) — `PROACTIVE_METHODS = { subscribe, utterance }` + `ProactiveUtteranceSchema` (`{characterId, messageId, text, reason?, at}`). Invariant 3: shapes are declared once here. Operator-only push, so **no Rust serde mirror needed** (same precedent as `media.*` / `character.*` — `.trellis/spec/backend/agent-runtime.md:55-58`). Register in `packages/shared/src/index.ts`.
- `packages/core/src/proactive/proactive-subscriptions.ts` (new) — a third fan-out registry, a near-copy of `avatar/avatar-subscriptions.ts:19-48` (characterId → connection → sink; idempotent re-subscribe; `count()`).
- `packages/core/src/server/methods/proactive-subscribe.ts` (new) — mirror `server/methods/timeline-subscribe.ts:15-31` exactly (roles `["operator"]`, `ctx.onClose` auto-unsubscribe). Register at `main.ts` beside `:343`.
- **Held/queued when no client is connected**: today nothing queues. Two options, both cheap: (a) rely on persistence — the utterance is already a timeline row, and the chat window backfills; the bubble just misses the live moment; (b) a bounded in-memory pending buffer in `proactive/` drained on the next `proactive.subscribe`. Survey §1.5 (`m5-proactivity-survey.md:93-104`) describes exactly this direct-vs-session-queued split. Recommend (a) for v1 + a `deliverySuppressed` log line; note the decision in `docs/deferred-decisions.md` if (b) is deferred (D-rule, CLAUDE.md "Defer explicitly").
- `apps/desktop/src/lib/ws-client.ts` — add a `proactive` slot to `PushSlots` (`:104-108`) + a route at `:141-149`, and `subscribeProactive` in `requestMethods` (`:184-209`).
- `apps/desktop/src/features/chat-bubble/use-chat-bubble.ts` + `chat-bubble-store.ts` — an `onProactive` entry point that opens the bubble and sets the reply. Route it through `sharedPresentationGate` (`lib/presentation-gate.ts`) like `:23` does, so an utterance surfaces with its avatar command (F3/D21).
- **D29 note**: HANDOFF:157 says `ws-client.ts`'s mid-turn-disconnect defect comes due at first touch of that file. T4 touches it.

---

## 3. Scheduler home + persistence

### 3.1 Confirmed: no `scheduler/` exists

`ls packages/core/src` → activity, agents, approval, avatar, capabilities, characters, config, db, devices, logging, main.ts, mcp, media, memory, perception, server, skills, testing, time, workspace. **No `scheduler/`, no `heartbeat/`, no `proactive/`.** `croner` is **not** in `packages/core/package.json` dependencies (deps today: `@ai-sdk/mcp`, `@ai-sdk/openai-compatible`, `ai`, `fflate`, `json-rpc-2.0`, `pino`, `tar-stream`, `ws`, `zod`). Root `CLAUDE.md` pins `croner ^10`; `.trellis/spec/backend/directory-structure.md:16` already reserves `scheduler/  # croner jobs + heartbeat`. D5 (`docs/deferred-decisions.md:33`) is the open deferral this closes.

### 3.2 DB pattern

- Migrations: numbered TS modules exporting `{version, sql}` — `db/migrations/001-timeline.ts` … `004-timeline-parts.ts`; registry `db/migrations/index-list.ts:12-17` (explicit ordered array, no glob). Next free version = **005**.
- Schema conventions (`.trellis/spec/backend/database-guidelines.md:11-12`): `snake_case` tables/columns, `*_at` ISO-8601 UTC strings, `STRICT` tables (see `002-memory.ts:23`), hand-written SQL in one repo per aggregate.
- Repo shape: `db/memory-auto-repo.ts` is the cleanest small template (prepared statements as module consts, zod-parse rows at the boundary, upsert semantics, no `node:sqlite` import).
- Construction in `main.ts`: `openDatabase({path, migrations: MIGRATIONS, onMigrated})` at `:117-122`, then `createTimelineRepo(db)` `:123`, `createMemoryAutoRepo(db)` `:157`.

### 3.3 Periodic-loop precedents

- **Attachment GC** — `media/attachment-gc.ts:13-21`: one boot sweep + `setInterval(sweep, 6h).unref()`. Its header explicitly says *"Deliberately not the croner scheduler (D5 is M5)"* (`:6`). Started at `main.ts:359`.
- **Activity sampler** — `activity/activity-sampler.ts:172-194`: `setInterval(() => void tick(rt), pollMs)` + `.unref()`, with an `inflight` re-entrancy guard (`:135`), a `stopped` flag, exponential backoff (`:124-131`), and once-per-streak logging. This is the richer template — a heartbeat loop needs the same `inflight` guard and never-throws tick (`:163-169`).
- **`.unref()` is load-bearing**: both timers must not hold the process open past SIGINT (`main.ts:379-388` `shutdown`).

### 3.4 What T4 adds (exact paths)

- `packages/core/package.json` — add `"croner": "^10"` to `dependencies`.
- `packages/core/src/db/migrations/005-schedules.ts` (new) — `CREATE TABLE schedules (id TEXT PRIMARY KEY, character_id TEXT NOT NULL, kind TEXT NOT NULL, cron TEXT, prompt TEXT NOT NULL, enabled INTEGER NOT NULL, last_run_at TEXT, next_run_at TEXT, created_at TEXT NOT NULL) STRICT;` + an index on `(enabled, next_run_at)`. Register in `db/migrations/index-list.ts` (import + array entry).
- `packages/core/src/db/schedule-repo.ts` (new) — `createScheduleRepo(db) -> { list, listDue, insert, update, delete, markRun }`; zod row parse; mirrors `memory-auto-repo.ts`. Persist `last_run_at` so intervals survive restarts (survey B3, `m5-proactivity-survey.md:272-278`).
- `packages/core/src/scheduler/scheduler.ts` (new) — croner `Cron` instances built from repo rows; `start()/stop()/reload()`; each fire delegates to the heartbeat/turn runner. Keep ≤300 lines; if the registry + the job-lifecycle grow, split `scheduler/job-registry.ts`.
- `packages/core/src/scheduler/index.md` + `packages/core/src/heartbeat/index.md` + `packages/core/src/proactive/index.md` (new folder indexes — mandatory, `quality-guidelines.md:34-36`), and one line each added to `packages/core/src/index.md`.
- `main.ts` — construct `scheduleRepo` beside `:123`, `scheduler` + `heartbeatRunner` beside `:359-360`, and `scheduler.stop()` in `shutdown` (`:379-386`). **`main.ts` is already at 389 lines and was noted at the 300-line cap during T3a** (devlog m5: "main.ts 触顶 300 行, 顺手抽出 `media/directory-size.ts`"). T4 adds wiring to a file already over cap — expect to extract a composition helper (e.g. `packages/core/src/proactivity-wiring.ts` or a `scheduler/compose.ts` taking the already-built deps) rather than appending inline.

---

## 4. Tool family plumbing

### 4.1 How tools are declared/registered today

- **One tool per file**, `x-tool.ts`, exporting `createXTool(deps): ToolSet` (`.trellis/spec/backend/tool-design.md` B2). Newest pure-Core example: `time/current-time-tool.ts:10-36` — `tool({description, inputSchema: z.object({}), execute})`, never throws, returns `{ok:true, ...}` / `{ok:false, code, message}`.
- **Three registration lanes into a turn** (`agents/chat-agent.ts:95`):
  1. `memory.createTools(characterId)` — per-turn, characterId-bound (`memory/memory-engine.ts:64`).
  2. `deps.extraTools` — the stable bag assembled at `main.ts:313-320`: `createLoadSkillTool`, `createCurrentTimeTool`, `...capabilityTools`, `readFileTool`, `writeFileTool`, `...mcpManager.tools()`.
  3. `deps.characterTools(characterId)` — per-turn per-character (`main.ts:323-324`, avatar tools).
- **Shell-routed capability tools** are grouped once as `capabilityTools` (`main.ts:247-254`) so the dev `capability.trigger` reuses the exact same objects — never a second execute path.
- **Presentation-vs-informational classification is mandatory at birth**: `avatar/presentation-stop.ts` + `PRESENTATION_TOOL_NAMES`; rules in `.trellis/spec/backend/agent-runtime.md:91-123` and `tool-design.md` B1.

### 4.2 What a `schedule_task` / checklist-edit family needs

- Naming: `verb_object` snake_case, family prefix (`tool-design.md` N1/N2). Suggested family: `schedule_create` / `schedule_list` / `schedule_delete` (or `schedule_*` + `checklist_*`). Names are stable API; ≤32 chars.
- Files: `packages/core/src/scheduler/schedule-create-tool.ts`, `schedule-list-tool.ts`, `schedule-delete-tool.ts` — each thin, delegating to `db/schedule-repo.ts` (no SQL inline, `tool-design.md` B2).
- Classification: **all informational** (they return data the model reasons over). They must NEVER enter `PRESENTATION_TOOL_NAMES`.
- Schema: `z.enum` for finite sets (S1/S2), per-field `.describe()` (S4), ≤3 params (S5 + CLAUDE.md), strict-ready authoring — all-required + `additionalProperties:false`, a genuine optional needs a logged D40-style exemption (S7 + its stack caveat: `.default()` does NOT put a field in `required` under AI SDK 7 + zod 4).
- Errors: never-throw `execute`, `{ok:false, code, message}` with **actionable** messages (R1/R2); codes from the closed union in `@taki/shared` where they cross a boundary (`memory/memory-tools.ts:12-13` shows the core-internal envelope precedent — a core-only tool may keep its codes local).
- Wiring: one line in `main.ts:313-320`'s `extraTools` bag (invariant 7 — add = new module + one registry entry).
- **Dual-entry rule (HANDOFF:154, coupling point 3)**: the tools must write the **same persisted store** the T6 settings panel will render — i.e. `db/schedule-repo.ts`, not a private file. Do not invent a second store.
- **A heartbeat_respond tool** (survey B4, `m5-proactivity-survey.md:280-287`): a structured silent-ack (`notify:false` | `notify:true`+text) is the preferred contract over parsing a `HEARTBEAT_OK` sentinel out of free text. It is a **presentation-shaped** tool (returns `{ok:true}` only) — if you add it to `PRESENTATION_TOOL_NAMES`, note that `presentationTailStop` requires `spoke` before it stops (`avatar/presentation-stop.ts`), so verify the silent path (tool-only, no text) still terminates via the step cap.

### 4.3 Workspace checklist — greenfield?

**Yes, fully greenfield.** There is no checklist/todo file anywhere today.

- `workspace/` contains only `workspace-paths.ts` (path-escape security core), `read-file-tool.ts`, `write-file-tool.ts`, `fs-error.ts` — generic confined RW, no named files.
- `skills/skill-scanner.ts` scans `<dataDir>/skills/<name>/SKILL.md` — a different subtree, not a checklist.
- Workspace root: `join(serverConfig.dataDir, "workspace")` (`main.ts:269`); existing subtrees are `memory/` (`:142`), `attachments/` (`:168`), `characters/` (`:172`), `screenshots/` (`:231`).
- Sanctioned `node:fs` sites (invariant 1) are all Workspace-scoped stores: `memory/store.ts:7` (atomic temp+rename at `:152-157`), `media/attachment-store.ts`, `characters/character-store.ts`, `capabilities/screenshot-store.ts`. **A checklist reader is a new member of that family, and that is an established precedent — not a new violation.**
- **What T4 adds**: `packages/core/src/heartbeat/checklist-store.ts` (new) reading `<dataDir>/workspace/heartbeat.md`; missing file → `""` → the heartbeat **skips without a model call** (survey B3 "skip-when-empty" — the single biggest cost lever). Keep it tiny and user-editable (survey B2, `:264-271`). Anti-pattern to encode in the file's own template: vague items always fire — each line must carry a condition (`m5-proactivity-survey.md:366-369`).

---

## 5. A2 write-context tags — every memory WRITE path

### 5.1 Complete write-path inventory

| # | Path | Entry point | Terminal write |
|---|---|---|---|
| 1 | LLM tool | `memory/memory-tools.ts:36-65` `memory_write` → `ops.writeEntry` | `memory-engine.ts:45-49` |
| 2 | Episodic auto | `memory/auto-memory.ts:64-77` → `episodic-writer.ts:47-54` `deps.writeEpisode` | bound at `main.ts:159-161` to `memory.writeEntry({...,type:"episodes"})` |
| 3 | Flush auto | `memory/auto-memory.ts:79-92` → `flush-writer.ts:31-38` runs a SILENT tool-loop turn whose `memory_write` calls ride `deps.createTools(characterId)` | bound at `main.ts:162` |
| 4 | Image description | `memory/image-description-writer.ts:54` `deps.writeEpisode` | bound at `main.ts:179-184` |
| 5 | Archive | `memory-engine.ts:50-55` `archiveEntry` → `store.archiveAtPath` | not a new-entry write (no tag needed) |

There is **no `.remember` tool** in Core. (`.remember` appears only in Rust Permission-Gate NL-authorization rulings — `apps/desktop/src-tauri/src/gate*`, T2b "`.remember` 单一生产写者" red-line. Unrelated to memory entries.)

### 5.2 The single funnel — and why a tag must go on DISK, not just in the DB

**All five paths funnel through `memory-engine.ts:45-49 → memory/store.ts:53-71 `write()`.** That is the one insertion point that catches everything.

Critical constraint: **files are truth, the DB index is derived and fully rebuilt** (`memory/indexer.ts:26-49` `reconcile`, called at `main.ts:148`). A `context` column added only to `memory_entries` would be **wiped on the next boot reconcile**. So the tag MUST be persisted in the markdown frontmatter first.

### 5.3 Exact insertion points (in dependency order)

1. `packages/core/src/memory/entry.ts:13-22` — add `context: z.enum(["primary","heartbeat","flush","subagent"]).optional()` (optional so pre-existing files still parse — `entryFromFile` at `:30-43` hard-`parse`s and a required field would make every legacy memory "invalid" at reconcile, `store.ts:87-99`).
2. `packages/core/src/memory/entry.ts:30-43` `entryFromFile` — map `data.context`; `:45-58` `entryToFile` — emit it when defined (follow the existing "omit undefined" pattern at `:53-56`).
3. `packages/core/src/memory/store.ts:31-39` `MemoryWriteInput` + `:53-71` `write()` — accept `context` and pass into `MemoryEntrySchema.parse` at `:57-66`.
4. `packages/core/src/memory/memory-engine.ts:27-33` (`MemoryEngine.writeEntry` signature) + `:45-49` (`ops.writeEntry`) — thread `context` through.
5. `packages/core/src/memory/memory-tools.ts:19-26` `MemoryToolOps.writeEntry` + `:28` `createMemoryTools(ops, characterId)` — **bind the context at construction, do NOT expose it to the model** (a model-supplied tag is unreliable and adds prompt budget). i.e. `createMemoryTools(ops, characterId, context)`; `writeTool`'s `execute` (`:58`) passes the closured value. This is the same closure pattern `characterId` already uses.
6. `packages/core/src/memory/memory-engine.ts:64` `createTools: (characterId) => createMemoryTools(ops, characterId)` → add a context param, so:
   - `chat-agent.ts:95` `memory.createTools(characterId)` passes the turn's kind (`primary` or `heartbeat`),
   - `main.ts:162` `createFlushWriter({createTools: (id) => memory.createTools(id, "flush")})` tags path 3 without touching `flush-writer.ts` at all.
7. `packages/core/src/memory/episodic-writer.ts:11-13` `EpisodicWriteOp` signature + `:47-53` call — add `context`; callers `main.ts:160` (episodic) and `main.ts:182` (image description) bind their own.
8. `packages/core/src/memory/auto-memory.ts:26` `onTurnCompleted(characterId)` → `onTurnCompleted(characterId, context)`; thread to `runPass` (`:58-62`) → `maybeEpisodic` (`:64`) → `episodic.summarize` (`:72`). Caller: `chat-agent.ts:157`.
9. `packages/core/src/memory/indexer.ts:51-66` `toUpsert` — add `context: entry.context ?? "primary"`.
10. `packages/core/src/db/memory-repo.ts:9-21` `MemoryUpsert` + `:72-77` `UPSERT_META_SQL` + `:138-150` `toMetaParams` + `:152-163` `RowSchema` + `:63-65` `COLS` + `:165-178` `toRow`.
11. `packages/core/src/db/migrations/006-memory-context.ts` (new, after the 005 schedules migration) — `ALTER TABLE memory_entries ADD COLUMN context TEXT;` (SQLite `STRICT` tables accept `ADD COLUMN` with no default). Register in `index-list.ts`.

**Does the schema have a place for it today? No.** `002-memory.ts:13-23` has no such column; `MemoryEntrySchema` (`entry.ts:13-22`) has `id, layer, importance, disclosure, created, status, emotionalWeight, expires` only.

### 5.4 The behavioural half T4 must also decide

Tagging alone does not stop pollution. `auto-memory.ts:59` reads `timeline.latestSeq(characterId)` and `:67` fires episodic every `EPISODIC_EVERY_N = 20` new rows — **heartbeat rows appended to `timeline_messages` advance that counter regardless of the tag**. So T4 must either (a) not persist heartbeat turns to the shared timeline, or (b) skip `onTurnCompleted` for heartbeat turns, or (c) make the watermark math count only `primary` rows (needs a `context` column on `timeline_messages` too). Decide explicitly; HANDOFF:150 makes this a T4 deliverable, with full formalization in T5.

---

## 6. Constraint integration points

### 6.1 Privacy Pause (T3b — present, uncommitted)

`packages/core/src/perception/privacy-pause.ts:27-63`:
```ts
createPrivacyPause({now?}) -> {
  isPaused(at?): boolean;
  pauseUntilResumed(): void;
  pauseUntil(deadlineMs): void;   // CALLER computes the deadline
  resume(): void;
  state(at?): { paused: boolean; until: number | null };
}
```
Timer-free — a lapsed deadline self-clears on the next read (`:35-41`). Built once in `perception/perception-layer.ts:31` and exposed as `perception.pause`; `main.ts:260-265` holds the layer, `main.ts:265` starts the sampler. Its header (`:4-7`) says it is *"the ONE Core-owned flag every AMBIENT sampler consults"*.

**Open design question for T4** (flag it, do not assume): Privacy Pause today gates **observation**, not **speech**. `privacy-pause.ts:22` says on-demand chat captures are deliberately NOT gated. Whether a Proactive Utterance is suppressed while paused is a product call — CONTEXT.md's Privacy Pause entry says "halts all Sampling immediately", and the survey (`:370-372`) lists pause alongside rate limits + quiet hours as load-bearing anti-spam controls. Ask the owner; both readings are defensible.

There is **no WS surface** for the pause yet (`perception-layer.ts:24` — "its operator WS surface + UI land with #26"). T4 does not have to add it.

### 6.2 Quiet hours — does any config exist? **No.**

Grep across the repo finds "quiet hours" only in prose (`CONTEXT.md:25`, `docs/PRODUCT.md`, `m5-proactivity-survey.md`). Zero code, zero config, zero schema. **Fully greenfield in T4.**

### 6.3 Config surface (D11)

`config/` holds one loader per concern: `agent-config.ts`, `attachment-config.ts`, `provider-config.ts`, `server-config.ts`, `vision-config.ts`. Template — `config/agent-config.ts:8-18`:
```ts
export const AgentConfigSchema = z.object({ maxSteps: z.coerce.number().int().min(1).max(50).default(10) });
export function loadAgentConfig(env) { return AgentConfigSchema.parse({ maxSteps: env.TAKI_MAX_STEPS }); }
```
Loaded fatal-fast at boot, `main.ts:90-96` ("Config parse is fatal-fast at boot; env is supplied by the run script's `--env-file` flag, never read from disk by code"). D11 (`docs/deferred-decisions.md:39`) records `TAKI_MAX_STEPS` as the precedent for config-izing hard-coded defaults; `activity/activity-layer.ts:15-25` is the alternative "deterministic defaults in one const block, config-ize later" pattern.

**What T4 adds**: `packages/core/src/config/proactivity-config.ts` (new) — heartbeat cadence, active/quiet hours, rate limits, skip-when-empty toggle, optional cheap-model slot (survey B6). Env names `TAKI_HEARTBEAT_*` / `TAKI_QUIET_*`. Loaded at `main.ts:90-96`. **Coupling point 3 applies**: whatever the settings panel (#26/T6) will edit must live in a store the panel can render — env-only knobs cannot be edited from a panel, so cadence/quiet-hours likely belong in the DB or a JSON store (precedents: `skills/skills-state.ts` JSON file, `approval/decision-store.ts` JSON file), with env as the boot default.

### 6.4 Time module — the T4-reserved export

`packages/core/src/time/time-context.ts:64-73`:
```ts
/** RESERVED for T4 (heartbeat/cron wall-clock injection) ... NOT wired into any prompt in this task. */
export function renderWallClock(at: number | Date): string   // "Monday, 2026-07-26 14:35"
```
Also available: `renderDayDate` (`:32-35`, stable-early), `renderCurrentTime` (`:38-43`, volatile-late), `formatRelativeAge` (`:49-58`). Assembly order is pinned in `chat-agent.ts:250-269` and specced at `.trellis/spec/backend/agent-runtime.md:166-184` (**stable-early / volatile-late is a universal rule; zero provider-conditional code**).

**T4 wires `renderWallClock` into the heartbeat prompt** (`heartbeat/heartbeat-prompt.ts`), not into `composeInstructions` — the chat turn's time lines stay as they are.

**Also deferred to T4 by owner ruling**: the *awareness-norms prompt wording* (time discipline) — `agent-runtime.md:183-184` "Prompt WORDING about time discipline (awareness norms) is deliberately absent — it lands with T4's prompt-design pass, as one optimization, not piecemeal." Same for **prompt-side semantics for every injected ambient block** (`.trellis/tasks/07-21-perception-privacy/prd.md:83-88`: "Heartbeat consumption of the activity card → T4"; "Prompt-side semantics for every injected ambient block → T4's prompt-design pass"). T4 owns one consolidated prompt-design pass, informed by a Hermes/OpenClaw prompt-design research spike (devlog m5 records this as agreed).

### 6.5 The reason-gate input (T3a, already built)

`activity/activity-state.ts:32-39` — `entries()` (reportable, dwell-filtered, defensive copies) and `current()` (live entry or undefined). Its header (`:5`) says explicitly: *"T4's heartbeat reason-gate reads entries()/current()"*. `activity/render-activity.ts:26-45` renders the fenced prompt block; the fence is `agents/untrusted-fence.ts` and **any sensed text entering a heartbeat prompt must go through it** (`agent-runtime.md:147-164`). Activity is **PUSH-only** — no pull tool; a history-query tool was rejected (perception-privacy prd:88).

---

## 7. Test conventions + size/naming checklist per layer

### Universal (root `CLAUDE.md` + `.trellis/spec/backend/quality-guidelines.md`)

- TS file ≤ **300 lines**; function ≤ **50**; params ≤ **3**. Exempt: migrations, generated, tests.
- kebab-case filenames always; `x-tool.ts` exporting `createXTool`; `XSchema` + `type X = z.infer<...>`.
- No barrel files inside packages; no god-bucket `utils.ts`/`types.ts`; do not append a distinct concern to an existing file.
- Every production file opens with a 3-6 line `INPUT: / OUTPUT: / POS:` header. Every touched directory updates its `index.md` **in the same change**.
- Forbidden in core: `child_process`, `fs` outside the Workspace, `any`, non-null `!` outside tests, `@ts-ignore`, empty catch.
- `erasableSyntaxOnly` is on — no parameter properties, no `enum`, no `namespace` (Node strip-only TS at runtime).

### `packages/core` tests

- `vitest`, colocated `*.test.ts` next to the source.
- Mock models: `testing/mock-language-model.ts` (streaming / slow-streaming abort-window / failing / mid-stream-error / scripted tool-loop / generating / failing-generate / scripted-non-streaming).
- DB fixtures: `testing/memory-store.ts` (`:memory:` sqlite conversation-store), `testing/memory-fixture.ts` (with `reopenDb` for rebuild-equivalence), `testing/companion-fixture.ts` (store + engine over one db, with reopen).
- `testing/capture-logger.ts` for asserting log shape; `testing/capability-tool-harness.ts` for capability-tool doubles; `testing/rm-temp.ts` for Windows sqlite handle-release teardown.
- **Injected clocks, never `Date.now()` inside logic** — `activity-state.ts` takes `at` per call; `activity-sampler.ts:40` takes `now?`; `privacy-pause.ts:27` takes `now?`; `time-context.ts` is pure. A scheduler/heartbeat MUST follow this or its tests become flaky.
- Turn-level tests are split by concern, not piled into one file: `chat-agent.test.ts`, `chat-agent-approval.test.ts`, `-costume`, `-images`, `-lifecycle`, `-presentation`, `-time`, `-tools`. A heartbeat turn gets its own `chat-agent-heartbeat.test.ts`.
- **Mock-green ≠ prod-correct** (`agent-runtime.md:78-84`): `simulateReadableStream` reads always resolve, so mocks only exercise the graceful abort ending. Use `abortRejectingModel` for abort paths.

### `packages/shared`

- One schema file per domain + colocated `*.test.ts`; `protocol-fixtures.test.ts` is the cross-shape round-trip net. Export from `src/index.ts`.

### `apps/desktop` (UI)

- `.trellis/spec/frontend/*` (component-guidelines, hook-guidelines, state-management, type-safety). Hooks `use-x.ts` exporting `useX`; a feature's ONLY WS touchpoint is its hook (`use-chat-bubble.ts:4-5`).

### e2e

- `.trellis/spec/backend/e2e-harness.md`: one scenario per `e2e/src/<name>.e2e.test.ts` via `withStack`. **L1 (deterministic, via the dev-only `capability.trigger`) is mandatory for every capability**; L2 (real LLM) is key-gated with `it.skipIf(!hasKey)`. Assertions read files/audit/structured results, never logged content.

### Gates before handoff

```
pnpm -r typecheck && pnpm lint && pnpm -r test
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml
```
Plus, because T4 touches boot wiring: a **real Core boot smoke** — `TAKI_WS_PORT=<nonstd> TAKI_DATA_DIR=<temp> node --env-file-if-exists=.env.local packages/core/src/main.ts` → confirm `ws server listening`, then kill the tree (`quality-guidelines.md:70-72`). A green test suite does not prove the Core starts.

Baseline as of the last committed devlog entry: core **577** TS tests, shared 187, desktop 143, cargo 138+131, e2e 25/25.

---

## 8. §Risks / unknowns — what an implementer trips on

### 8.1 D1 frozen zone — IS the chat-agent protected? **Yes, partially, and the rule is explicit.**

`.trellis/spec/backend/agent-runtime.md:35-39`:
> "Image attachments landed in #17 as **additive seams** on the D1-frozen turn — the stream loop, `persistTurn`, abort wiring, and `toolApproval` stay byte-identical; only the pre-loop guard/save, the `appendUser` call-site, the `model:` pick, the in-flight `messages` tail swap, and the detached memory fire are new. **When you extend the turn, preserve that discipline: the frozen regions are off-limits.**"

Devlog m5 confirms this is enforced in review, twice: T1 1e — *"D1 冻结区逐行比对**字节不变**(chat-agent 仅三处构造级改动)"*; T1 1f — *"D1 逐行字节不变"*. **Expect the check agent to diff `chat-agent.ts:123-151` line-by-line and reject any change there.**

Frozen (do not touch): the `try { try { for await ... } finally { persistTurn } } catch` block (`:123-147`), `persistTurn` (`:230-242`), the abort/`onClose` wiring (`:102-107`), `toolApproval` (`:100`).
Permitted (additive seams): pre-loop guard/save/append (`:79-90`), `ToolLoopAgent` construction args (`:92-101`), the outgoing-message builder (`:114`, `:201-219`), the post-loop detached fire (`:150`, `:156-162`), and `composeInstructions` (`:250-269`).

### 8.2 Things that break or double-fire under an autonomous turn

| Risk | Where | Effect |
|---|---|---|
| **Costume-notice theft** | `chat-agent.ts:114` `deps.costumeChanged?.(characterId)` | A heartbeat consumes the one-shot notice and advances `lastSeen`; the user's next turn never gets it. The 1e dynamic enum is the backstop, but the wasted round-trip returns. **Pass `changed:false`.** |
| **Auto-memory pollution** | `chat-agent.ts:157` → `auto-memory.ts:67,82` | Heartbeat rows advance `latestSeq`, so `EPISODIC_EVERY_N=20` fires from beats alone and the flush watermark drifts. Tagging alone does not fix the counter — see §5.4. |
| **Fake user row** | `chat-agent.ts:89` | Fans out as `timeline.appended`, renders as a user bubble in the chat window, and replays to the model forever as if the user said it. |
| **Wrong-row retract** | `chat-agent.ts:145,149,180-186` | A cancelled heartbeat with nothing produced deletes `userEntry.seq`. Skip the retract for autonomous turns. |
| **Deltas dropped silently** | `apps/desktop/src/lib/ws-client.ts:124` | `state.current?.handlers.onDelta` — no active turn means every `chat.delta` vanishes. A "working" Core-side heartbeat can look completely broken from the pet UI. |
| **Approval deadlock / silent deny** | `chat-agent.ts:100`, `approval/approval-gate.ts` | With no `turn.notify`, unremembered MCP tools are denied fail-closed (correct, but the model sees denials it cannot resolve). Shell capability tools can still raise a **node-side** dialog from an unattended turn — a heartbeat calling `screenshot` at 3am pops a Windows dialog. Constrain the heartbeat's toolset or rely on the Privacy Pause / permission level. |
| **Turn-queue deadlock** | `turn-queue.ts:21-33` | `acquire` never times out. A heartbeat that awaits the lock behind a wedged user turn waits forever, and croner may stack more fires behind it. Use `tryAcquire` (§1.5) + an `inflight` guard, mirroring `activity-sampler.ts:135`. |
| **Timer holds the process open** | `main.ts:379-388` | croner jobs are not `.unref()`'d timers by default — `scheduler.stop()` must run in `shutdown` or `SIGINT` hangs. |
| **`main.ts` over cap** | `main.ts` is 389 lines | Already over the 300-line rule and flagged during T3a. Adding scheduler+heartbeat+proactive wiring inline will fail review. |
| **Reconcile wipes an index-only tag** | `memory/indexer.ts:26-49` + `main.ts:148` | A `context` column added only to `memory_entries` disappears at the next boot. Frontmatter first (§5.2). |
| **Legacy memory files fail to parse** | `memory/entry.ts:32` hard `parse` | A REQUIRED new frontmatter field makes every pre-existing memory "invalid" at reconcile (`store.ts:94-96`). Make `context` optional. |
| **T3b is uncommitted** | `git status` | `packages/core/src/perception/` is untracked. Any branch/stash/reset operation loses it. Confirm with the leader whether to commit T3b before starting T4. |

### 8.3 Open questions to resolve with the owner before implementing

1. Does Privacy Pause suppress a Proactive Utterance, or only sampling? (§6.1 — both readings are defensible from CONTEXT.md.)
2. Do heartbeat turns persist to the shared `timeline_messages`, or to a separate lane? This decides §5.4 and whether the chat window shows beats.
3. Where does proactivity config live — env-only (D11 style) or a DB/JSON store the T6 panel can edit (coupling point 3)? The panel requirement argues for the latter.
4. `heartbeat_respond` tool vs `HEARTBEAT_OK` sentinel (survey B4 prefers the tool) — and if a tool, its presentation/informational classification and its interaction with `presentationTailStop`'s `spoke` guard.
5. Cheap-model / isolated-context heartbeat runs (survey B6): a third model slot alongside `TAKI_PROVIDER_*` / `TAKI_VLM_*`? That is a `config/provider-config.ts` sibling, not a chat-agent change.

---

## Related specs

- `.trellis/spec/backend/agent-runtime.md` — D1 frozen zone, the two cancel endings, presentation-vs-informational, the A1 untrusted fence, the time-module rule.
- `.trellis/spec/backend/tool-design.md` — 27 sourced rules (N/D/S/R/I/B) every new tool must satisfy.
- `.trellis/spec/backend/database-guidelines.md` — migrations, repos, one-writer, snake_case/`*_at`.
- `.trellis/spec/backend/directory-structure.md:16` — `scheduler/` already reserved.
- `.trellis/spec/backend/quality-guidelines.md` — size caps, headers, `index.md`, gates, the strip-only boot-smoke rule.
- `.trellis/spec/backend/e2e-harness.md`, `error-handling.md`, `logging-guidelines.md`, `server-push-and-connection-auth.md`.
- `docs/HANDOFF.md:150-158` — M5 coupling points (A2 before any heartbeat write; dual-entry config).
- `docs/deferred-decisions.md` — D5 (scheduler, closed by T4), D11 (config-ization), D28 (memory-touch constraint: single-file, deletable, ride existing paths), D29 (ws-client), D40, D44.
- `.trellis/workspace/pleia/m5-proactivity-survey.md` — the T4 survey bank (B1-B11 borrow list, §5 anti-patterns).
- `.trellis/workspace/pleia/time-awareness-survey.md` — the time-module grounding.
- `CONTEXT.md` — canonical definitions of Heartbeat, Proactive Utterance, Hook, Privacy Pause, Idle Motion.

## Caveats / not found

- **Not found**: any `scheduler/`, `heartbeat/`, `proactive/` module; `croner` in any `package.json`; any quiet-hours / active-hours config; any checklist/todo file or reader; any `context`/write-provenance column or frontmatter field; any `.remember` tool in Core (it is a Rust-gate NL-authorization concept only); any non-blocking probe on the turn queue or turn registry; any pet-bubble subscription to server-initiated pushes other than `avatar.command`.
- **Uncertain**: whether the owner wants heartbeat turns on the shared timeline (§8.3 Q2) — this materially changes the §5.4 design. Do not pick silently.
- Line numbers for `perception/*` and the modified `activity/*` reflect the **uncommitted working tree**; they will shift if T3b is amended before T4 starts.
