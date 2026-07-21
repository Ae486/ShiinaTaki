# Research: T3a codebase front-load — new gated capability + new Core module (exact wiring map)

- **Query**: map end-to-end wiring for adding a new gated capability (`foreground-window` sampler) + a new Core `activity/` module, with file:line citations
- **Scope**: internal (local codebase only)
- **Date**: 2026-07-21
- **Repo state**: main @ a9eca30 with uncommitted T2b governance changes (governance.rs etc. are the CURRENT on-disk versions cited below)

> Capability name used throughout: `foreground-window` (PRD leaves the name as an owner ruling; every site below is name-keyed, so a rename is mechanical).

---

## 0. TL;DR for the impl agent

- A new fixed-risk-style capability = **6 additive edits + 2 new files**, zero changes to the channel schema, broker, gate engine, or WS routing.
- Core CAN invoke a capability without the LLM: `routeCapability(deps, name, input)` (`packages/core/src/capabilities/route-capability.ts:30`) has **no dependency on a chat turn** — deps are just `{ registry, broker, logger }`, all constructed in `main.ts` before any agent exists. The dev `capability.trigger` method proves LLM-free invocation end-to-end. There is **no production precedent yet** for a Core-owned loop calling a capability (T3a creates the first), but the seam is fully load-bearing today.
- Periodic-loop precedent in Core: the attachment GC `setInterval(...).unref()` in `main.ts:339-344`. No `scheduler/` module exists (croner pinned but unused — D5 OPEN, `docs/deferred-decisions.md:33`).
- Prompt seam: `composeInstructions` in `chat-agent.ts:246-258` is the single join point; per module-boundary ruling 10 (comment at `chat-agent.ts:244-245`), non-memory sections enter via `instructionsExtra` (wired in `main.ts:307-308`), never through the memory assembler. **No fence/sanitization helper exists anywhere in core today** (verified by grep) — T3a creates the first.

---

## 1. New capability end-to-end (model: `process-list` + `screenshot`, the fixed-risk cells)

### 1.1 `packages/shared/src/` — schemas + method tables + fixtures

**Existing pattern**

- The capability channel is capability-agnostic: `CapabilityRequestSchema` carries `capability: z.string().min(1)` and `input: z.unknown()` (`capability-schema.ts:17-21`); the respond union carries an **opaque** `output: z.unknown()` (`capability-schema.ts:37-40`, "Option A"). Comment at `capability-schema.ts:36`: "adding a capability never touches this channel schema (invariant 7)".
- Method names live in `CAPABILITY_METHODS` (`capability-schema.ts:8-13`) — `capability.request` (core→node notification) / `capability.respond` (node→core request). **Unchanged for a new capability.**
- Per-capability output schemas live in `capability-outputs.ts` — one `XOutputSchema` + `type X = z.infer<...>` per capability (`ProcessListOutputSchema` at `capability-outputs.ts:29-33`, `ProcessInfoSchema` at `:20-27`, `ScreenshotOutputSchema` at `:10-16`). All `z.strictObject`. Header (`:1-5`) says each is "mirrored by that capability's Rust serde struct (invariant 3)".
- Public exports: named re-exports only in `packages/shared/src/index.ts` (capability outputs block at `index.ts:213-230`).
- Fixture convention (`packages/shared/fixtures/protocol/`): filename `<prefix>.<label>.<valid|invalid>.json`; the vitest sweep `protocol-fixtures.test.ts` maps prefix→schema in `SCHEMA_BY_PREFIX` (`protocol-fixtures.test.ts:44-63`, e.g. `"process-list-output": ProcessListOutputSchema` at `:54`) and asserts parse/reject per the filename tag. Existing pairs: `process-list-output.snapshot.valid.json` + `process-list-output.bad-memory.invalid.json`.
- The **same files** are re-parsed by cargo: `apps/desktop/src-tauri/src/protocol.rs` has a prefix→serde-type parse map (`protocol.rs:301-314`, e.g. `"process-list-output" => ... ProcessListOutput` at `:308`) and the golden test `golden_fixtures_parse_reject_and_round_trip` (`protocol.rs:326`) reading `packages/shared/fixtures/protocol` (`protocol.rs:291-294`).

**What T3a adds**

- `packages/shared/src/capability-outputs.ts` — append `ForegroundWindowOutputSchema` (strictObject; shape per design, e.g. `{ processName, windowTitle, ... }`) + inferred type. (This file is the established home for ALL capability outputs — 6 today, 67 lines; adding here IS the pattern, not sprawl.)
- `packages/shared/fixtures/protocol/foreground-window-output.<label>.valid.json` + at least one `.invalid.json` (e.g. extra-key or missing-field, mirroring `process-list-output.bad-memory.invalid.json`).
- `packages/shared/src/protocol-fixtures.test.ts` — one row in `SCHEMA_BY_PREFIX` (`:53-58` block).
- `packages/shared/src/index.ts` — export schema + type in the `capability-outputs` block (`:213-230`).
- `packages/shared/src/index.md` — no new file row needed unless a new schema FILE is created (capability-outputs.ts row already exists; update its role line if the one-liner enumerates capabilities).
- NOTE: no PERMISSION/method-table change — governance cells are Shell-side only (`governance.rs`); the `permission-level-schema.ts` surface (`PermissionCellKeySchema` etc.) is key-string-generic and needs nothing.

### 1.2 `packages/core/src/capabilities/` — the Core-side client pattern

**Existing pattern**

- Every Shell-backed tool is thin over `routeCapability` → `CapabilityBroker` → node notify:
  - `route-capability.ts:30-48` — `routeCapability(deps, capability, input)`: `registry.findNodeForCapability(capability)` (`connection-registry.ts:72-79` matches on the node's advertised `state.capabilities.includes(capability)`), then `broker.request(...)`; returns `{ ok:true, output:unknown } | { ok:false, code, message }` with closed code union incl. `NO_NODE` (`route-capability.ts:17`). Never throws.
  - `capability-broker.ts:61-79` — `request()` generates a `requestId`, pushes a `capability.request` notification, awaits `capability.respond` correlated by id; 90s backstop (`:37`), `denyAll` on node disconnect (wired in `main.ts:216-220`).
- The LLM tool wrapper is one file per tool: `process-list-tool.ts:15-38` — `createProcessListTool(deps: CapabilityRouteDeps): ToolSet`, `execute` = route → `ProcessListOutputSchema.parse(routed.output)` (`:27`) → structured `{ ok, ... }`; catch → `{ ok:false, code:"INTERNAL_ERROR" }` (`:30-34`). Same shape in `screenshot-tool.ts:42-62` (adds store.save + optional VLM describe).
- Registry entry point for tools: `main.ts:231-248` — `shellCapabilityDeps = { registry: connectionRegistry, broker: capabilityBroker, logger }` (`:231`), each `createXTool(...)`, all spread into the `capabilityTools: ToolSet` bag (`:241-248`), which feeds the chat agent's `extraTools` (`:295-301`) and the dev trigger (`:352`).

**What T3a adds**

- **The sampler is NOT an LLM tool** (system-initiated). It should call `routeCapability` directly from the new activity module (see §2) — no `foreground-window-tool.ts` is required by the PRD (T4 consumes the activity layer internally; an LLM-facing "what is the user doing" read, if wanted, reads the activity STATE, not the raw capability).
- If (and only if) design later wants an agent-facing tool, the file is `packages/core/src/capabilities/foreground-window-tool.ts` cloned from `process-list-tool.ts` + a `main.ts` bag entry + an `index.md` row.
- `packages/core/src/capabilities/index.md` — add a row only if a file is added in this dir.

### 1.3 `apps/desktop/src-tauri/src/capabilities_impl/` — the handler pattern

**Existing pattern**

- Trait + registry, not macros: `CapabilityExec` trait (`capabilities_impl.rs:33-41`) — `capability(&self) -> &str`, `run(&self, input: &Value) -> Result<Value, ExecError>` (blocking; caller runs it off-reactor), optional `detail(&self, input) -> Option<String>` (default `None`, `:38-40`) which is the approval-dialog detail line ("dialog-only — NEVER logged").
- `CapabilityRegistry` (`capabilities_impl.rs:44-77`): `register(Arc<dyn CapabilityExec>)` keyed by name (`:54-56`); `respond()` runs the handler and shapes the wire frame — unknown name → `UNSUPPORTED_CAPABILITY` (`:64-76`); `detail()` lookup at `:59-61`.
- Concrete model handler: `process_list.rs` — `ProcessListExec` (stateless struct, `:15`), `run` builds a `sysinfo::System`, maps to the serde `ProcessListOutput` mirror, `serde_json::to_value` (`:22-41`). `#[cfg(test)] mod tests` colocated in-file (`:44-60`).
- Registration site: `node.rs::build_node` — `handlers.register(Arc::new(ProcessListExec));` etc. (`node.rs:72-78`). Comment at `node.rs:47`: "One entry here + one register call in build_node per capability (invariant 7)".
- Serde mirrors live in `protocol.rs` (`ProcessListOutput` at `protocol.rs:146-151`, `ProcessInfo` at `:140-144` with `#[serde(rename)]` camelCase; `ScreenshotOutput` at `:122-130`).

**What T3a adds**

- `apps/desktop/src-tauri/src/capabilities_impl/foreground_window.rs` — NEW: `ForegroundWindowExec` implementing `CapabilityExec` (`capability() -> "foreground-window"`; `run` = Win32 GetForegroundWindow-family call → `ForegroundWindowOutput` mirror → Value; input ignored like screenshot/process-list). Win32 API shape MUST be doc-verified per PRD (`prd.md:43-45`, `:111`) — not covered by this local-only research. `detail()` can stay default `None` (name-only dialog, like screenshot — `gate.rs` test at `:459-472` documents "screenshot asks with no detail").
- `apps/desktop/src-tauri/src/capabilities_impl.rs` — add `pub mod foreground_window;` (`:5-9` block).
- `apps/desktop/src-tauri/src/protocol.rs` — add the `ForegroundWindowOutput` serde mirror (near `:122-151`) + one parse-map arm (`:307-312` block) so the golden fixtures cover it.
- `apps/desktop/src-tauri/src/node.rs` — one name in `default_capabilities()` (`:47-52`) + one `handlers.register(Arc::new(ForegroundWindowExec));` (`:72-78`).
- `apps/desktop/src-tauri/src/capabilities_impl/index.md` — one row.

### 1.4 `gate/governance.rs` — the descriptor

**Existing pattern**

- `GovernanceCell { key, strict, standard, relaxed, persist }` (`governance.rs:11-17`); `CapabilityGovernance { name, cells, floor_classes }` (`:33-37`); registry rows listed in `GovernanceRegistry::factory()` (`:114-116`: `&[&SHELL_OPEN, &EXEC, &FS_WRITE, &FIXED_RISK]`).
- Fixed-risk capabilities are **name-keyed cells inside the shared `FIXED_RISK` descriptor** (`:96-105`): single-segment key = the bare capability name; factory posture `{strict:Ask, standard:Ask, relaxed:Auto}, persist:true` (owner-ratified 2026-07-21, comment `:90-95`); `floor_classes: &[]` ("fixed-risk has no catastrophic sub-target", `:104`).
- Comment at `:107-108`: "Adding a capability = declare its descriptor above (or beside its policy module) and list it in `factory()` — invariant 7; evaluate_by_class is untouched."
- Governance tests to extend: `the_fixed_risk_projection_matches_the_factory_default` iterates the four names (`governance.rs:223-236`); `project_level_folds_over_the_whole_registry...` hard-asserts the row count `19` (`:239-251`) — **adding any cell changes this number** (→ 20 if one name-keyed cell).

**What T3a adds — two shapes, owner/research ruling picks one (PRD open question, `prd.md:63-66`)**

- Shape 1 (minimal, closest to model): one line in `FIXED_RISK.cells` — `GovernanceCell { key: "foreground-window", strict: Ask, standard: Ask, relaxed: Auto, persist: true }`. Zero other gate code. `persist:true` + the once/**session/always** ask flow (`gate.rs:242-258`) is what makes CONTINUOUS polling livable: one `Always`/`Session` grant silences subsequent ticks at standard (`gate.rs` test `fixed_risk_ask_then_remember_survives_at_standard`, `:418-433`).
- Shape 2 (own descriptor): `const FOREGROUND_WINDOW: CapabilityGovernance { name: "foreground-window", cells: &[GovernanceCell{ key: "foreground-window", ... }], floor_classes: &[] }` + add to `factory()` (`:115`). Behaviorally identical for a single name-keyed cell (both resolve via `find_exact` on the cell key, `:131-133`); Shape 2 only buys a place for future sampling-specific cells/floors (T3b sensitive-skip could become a floor row).
- Either way: update the `19`→`20` count assertion (`:245`) and (Shape 1) the name loop at `:228`.

### 1.5 `ws_client.rs` routing — ZERO changes needed (confirmed)

- `authorize_and_run` (`ws_client.rs:170-208`) branches: `capability == "exec"` → `evaluate_exec` (`:180-184`); `== "shell-open"` → `evaluate_shell_open` (`:185-189`); **everything else** falls to the default arm `gate.evaluate_by_class(&request_id, &capability, detail)` (`:190-197`) — the comment names the fixed-risk set riding "their BARE name as the cell key". A new name-keyed capability lands here automatically.
- `evaluate_by_class` (`gate.rs:162-189`) is fully registry-driven: enable switch → floor set → `governance.cell(key)` → posture; an unregistered key is a **fail-closed deny with a warn** (`gate.rs:172-175`) — i.e. registering the handler but forgetting the governance cell = every request denied loudly, not a bypass.
- Dispatch path for the notification itself: `dispatch` (`ws_client.rs:138-167`) filters `method != "capability.request"`, parses the serde `CapabilityRequest` (deny_unknown_fields, `protocol.rs:112-120`), runs authorize+execute on `spawn_blocking` (`:176`).

### 1.6 `node.rs` — the advertised capability list

- `default_capabilities()` (`node.rs:47-52`) is the list sent in the connect frame (`ws_client.rs:210-219` → `ConnectParams.capabilities`); Core's `connection-registry.findNodeForCapability` matches against it (`connection-registry.ts:72-79`). **Forgetting this entry = Core-side `NO_NODE`**, not a Shell error.
- Both composition roots (Tauri `lib.rs` + headless `bin/taki-node`) call `build_node` (header `node.rs:3`), so one edit covers both.

### 1.7 Test conventions per layer

| Layer | Convention | Model to clone |
|---|---|---|
| shared | colocated `*.test.ts` per schema file + the fixture sweep | `capability-outputs.test.ts`, fixture pairs + `protocol-fixtures.test.ts:44-63` |
| core | colocated `*.test.ts`; mock model/deps from `testing/` | `process-list-tool.test.ts`, `capability-broker.test.ts` |
| shell (Rust) | in-file `#[cfg(test)] mod tests` (convention is load-bearing: `decision_memory_has_exactly_one_production_writer` splits files on `"\nmod tests"`, `gate.rs:832-852`) | `process_list.rs:44-60`; gate harness pattern `gate.rs:341-367` (tempdir + FakeApprover + MemoryAuditor) |
| protocol anti-drift | same golden files asserted by vitest AND cargo | `protocol.rs:291-345` |
| e2e | dev `capability.trigger` drive (see §2) + `.trellis/spec/backend/e2e-harness.md` | `server/methods/capability-trigger.ts` |

Caveat: a real `ForegroundWindowExec.run` unit test is environment-dependent (a headless CI has no foreground window). `process_list.rs`'s test runs against the live system (`:49-59`); screenshot's exec has the same exposure. Pattern-consistent approach: test the output *shaping* (serde round-trip, absent-window → structured `ExecError::failed`, never panic) and keep any live-capture assert tolerant.

---

## 2. Activity-layer home in Core (the critical architectural seam)

### 2.1 Module layout + where `activity/` fits

`packages/core/src/` today (from `index.md`): `agents/ approval/ avatar/ capabilities/ characters/ config/ db/ devices/ logging/ media/ mcp/ memory/ server/ skills/ testing/ workspace/` + `main.ts`. **No `scheduler/` exists** (CLAUDE.md's repo map lists it aspirationally; D5 croner deferral is OPEN — `docs/deferred-decisions.md:33`).

Per inv.7, `activity/` is a new sibling module: its own directory + `index.md` + one wiring block in `main.ts` (the "registry" for non-tool modules IS the composition root — see how avatar (`main.ts:127-128`), skills (`:187-194`), attachment GC (`:337-344`) are each one contiguous wired block). Suggested files (all kebab-case, <=300 lines each):

- `packages/core/src/activity/activity-state.ts` — rolling bounded window of samples; dwell debounce + same-window coalescing; pure/deterministic (unit-testable with synthetic samples, no OS dep — AC `prd.md:84-85`).
- `packages/core/src/activity/activity-sampler.ts` — the polling loop: interval → `routeCapability(deps, "foreground-window", {})` → `ForegroundWindowOutputSchema.parse` → `state.push(sample)`; structured-error degradation (NO_NODE / DENIED / TIMEOUT → skip tick + backoff, never crash).
- `packages/core/src/activity/fence.ts` (or a more neutral home — §3) — the A1 fence helper.
- `packages/core/src/activity/index.md`.

### 2.2 Periodic-loop precedent

- **The precedent**: attachment GC, `main.ts:337-344` — boot-time sweep + `setInterval(sweepAttachments, 6h).unref()`; the comment explicitly notes "(NOT the croner scheduler — D5 is M5)". `.unref()` so the timer never holds the process open on shutdown.
- Rust-side loop precedent (shape reference only): the ws reconnect loop with exponential backoff, `ws_client.rs:48-60`.
- No croner usage anywhere in `packages/core/src` yet (grep-confirmed; croner is pinned in the stack table but unimported). A fixed-cadence sampler matches the `setInterval` precedent; adopting croner for it would be the first use and is NOT required.

### 2.3 Core-initiated capability invocation — precedent answer

**Is there a precedent for Core invoking a capability outside a chat turn? Structurally YES; as a production feature, NO (T3a is the first).** Evidence:

1. `routeCapability` (`route-capability.ts:30-48`) and `CapabilityBroker.request` (`capability-broker.ts:61-79`) have **zero coupling to the chat turn**: deps are `{ registry: ConnectionRegistry, broker: CapabilityBroker, logger }` — all created in `main.ts` at `:184` (connectionRegistry) and `:215` (capabilityBroker), *before* the chat agent. Nothing in the path reads a turn, a ToolCallOptions, or the LLM.
2. The **dev `capability.trigger`** method (`server/methods/capability-trigger.ts:36-63`, registered under `TAKI_DEV_TRIGGER=1` at `main.ts:349-354`) already invokes real capability tools' `execute` "WITHOUT the LLM" (header `:4-7`) — proving the WS→Gate→handler pipeline works when nothing conversational initiated it. It is operator-triggered and dev-only, not a loop, but it settles the architectural question: the Shell gate authorizes by `capability.request` content alone; it neither knows nor cares whether an LLM asked.
3. Other system-initiated (non-turn) actors in Core for shape reference: attachment GC (`main.ts:339-344`, interval), `autoMemory` + `imageDescriptionWriter` (detached post-turn writes, fired `void` at `chat-agent.ts:155-161` — *turn-adjacent* but not turn-blocking).
4. Approval UX consequence: a SYSTEM-initiated `capability.request` still produces the same Shell approval dialog on an Ask posture (the gate has no "who initiated" channel — `ws_client.rs:190-197`). At the factory `standard: Ask` posture the FIRST sample tick prompts; the user's `session`/`always` answer then persists under the bare name (`gate.rs:418-433`) and later ticks auto-allow. A `Deny`/timeout tick surfaces to the sampler as `{ ok:false, code:"DENIED" }` (`capability-broker.ts:80-84`) — the sampler must back off rather than re-prompt every tick (design point, see §6).

So the sampler calls `routeCapability` **directly** (never wraps itself in `tool()` and never goes through `capabilityTools`) with the same `shellCapabilityDeps` bag from `main.ts:231`.

### 2.4 T4 seam

The PRD (`prd.md:54-57`) fixes this: T4 consumes via an internal Core seam. `activity-state.ts` should expose a bounded read (`current(): ActivityEntry[]` / `summary()`) — the exact interface is T4's to finalize; T3a only guarantees a readable, bounded state.

---

## 3. A1 fence seam — where activity content enters a prompt

**Prompt assembly today (all sites):**

1. `composeInstructions` (`chat-agent.ts:246-258`) — THE single join point: `[BASE_SYSTEM_PROMPT, memory.assemble(...), instructionsExtra?.(characterId)].filter(len>0).join("\n\n")`. Comment (`:244-245`): "The skills list enters HERE, never through the memory assembler (module boundary, ruling 10)."
2. `memory.assemble` → `assembler.ts:44-65` — sections array: persona layers + emotion capsule (`:48`), pinned block (`:50-51`), retrieved block (`:54-58`), intention (`:60-61`). This is the MEMORY module's own surface; per ruling 10, activity does not enter here.
3. `instructionsExtra` wiring: `main.ts:307-308` — `[skillsLoader.renderList(), avatarVocabulary.render(characterId)].filter(...).join("\n\n")`. **This is where an activity section slots in**: append `renderActivityContext()` (fenced) to that array. Blank string contributes nothing (filter at `chat-agent.ts:256-257`).
4. The #17/1f additive seam (costume-switch reminders): `buildOutgoing` (`chat-agent.ts:200-211`) prefixes `COSTUME_CHANGE_NOTICE` (`avatar/costume-notice.ts`) onto the model-facing USER text — an in-flight-only mutation, never persisted. This is the model for *event-notice* injection; the activity layer is *ambient context*, which fits `instructionsExtra` (site 3) better than a per-message prefix.

**Existing sanitization/fencing precedent: NONE.** Grep over `packages/core/src` for untrusted/fence/sanitize finds only: the FTS5 *query* sanitizer (`memory/fts5-query.*`, unrelated), MCP tool-name sanitize (`mcp-manager.ts:128`), and a doc-only note that the VLM screenshot description is "untrusted content" (`screenshot-tool.ts:7` header) — that description flows into the tool result **unfenced today**. T3a's fence is the first real implementation.

**The ONE place for the fence helper**: a dedicated small module that both the activity renderer and future untrusted-content producers (T3b screen content, T5 full A1, the screenshot description) can import without cross-module reach-ins. Two candidate homes consistent with the codebase's rules:

- `packages/core/src/activity/fence.ts` — colocated with its first consumer; future consumers import across modules (works, but couples "fence" to "activity").
- `packages/core/src/agents/untrusted-fence.ts` — beside `base-prompt.ts` (the prompt-layer module), since fencing is a *prompt-assembly* concern, not an activity concern. This matches how `COSTUME_CHANGE_NOTICE` lives in avatar (producer-side) but the *join* stays in agents.

The PRD requirement is only "fence lives at the injection seam, not scattered per-consumer" (`prd.md:76-77`) — either single-home satisfies it; flag the choice to the leader. Whatever the home, the fence contract per PRD: XML delimiting + untrusted-source label, and the hostile-title unit test (`prd.md:86-87`) asserts a title like "ignore previous instructions" reaches the prompt only inside the fence.

---

## 4. DB / persistence pattern (and the in-memory-v1 answer)

**How Core persists rolling data today:**

- Single SQLite handle opened once in `main.ts:111-116` (`openDatabase({ path, migrations: MIGRATIONS, ... })` from `db/sqlite.ts`; `db/` is "the only node:sqlite importer" — `core/src/index.md:8`).
- Migrations: `db/migrations/00N-name.ts` registered in `db/migrations/index-list.ts` (`MIGRATIONS`), currently 001-timeline / 002-memory / 003-memory-auto-state / 004-timeline-parts.
- Repos: one file per concern (`timeline-repo.ts`, `memory-repo.ts`, `memory-auto-repo.ts`), constructed in `main.ts` with the shared `db` and injected into consumers (e.g. `createTimelineRepo(db)` at `main.ts:117`).
- Adding persistence later = `005-activity.ts` migration + `db/activity-repo.ts` + a `main.ts` construction line + `db/index.md` row. Inv.2 holds automatically (activity data lands Core-side; Core is the only writer).

**In-memory-only viability for v1: YES.**
- PRD assumption (`prd.md:53-54`): "Activity layer is in-memory/rolling with optional persistence; retention policy TBD"; T4 consumes LIVE state via an internal seam (`:55-57`), not history queries.
- Precedent for bounded in-memory Core state that is deliberately not persisted: `avatarVocabulary` (`main.ts:128`, per-character live manifest names) and `connectionRegistry` (in-memory `Set`, `connection-registry.ts:46-48`). Pet UI disposability (inv.4) is unaffected either way.
- If "optional persistence" is deferred, log it in `docs/deferred-decisions.md` with a trigger (project rule; `prd.md:95-96`).

---

## 5. Size/naming constraints checklist for the impl agent

- **Naming**: TS files kebab-case (`activity-state.ts`); Rust snake_case module `foreground_window.rs`, no `mod.rs`; zod `XSchema` + `z.infer` type, never a parallel interface; capability name string is kebab (`foreground-window`) matching `process-list`.
- **Size caps**: TS file <= 300 lines, function <= 50, params <= 3 (bundle deps in one object like `CapabilityRouteDeps`); Rust fn <= 100 (clippy `too_many_lines`), file soft 500. Tests exempt.
- **Module-contract headers**: every new production file opens with the 3-6 line `INPUT:/OUTPUT:/POS:` header (TS `/** */`, Rust `//!`) — every file cited above has one to copy the register from.
- **No barrel files**: internal imports are direct (`../capabilities/route-capability.ts`); `@taki/shared` exports go through its `index.ts` (the sanctioned public entry) with named re-exports.
- **index.md rows required** (touch-a-folder ⇒ update its index.md, same change):
  - `packages/core/src/activity/index.md` — NEW file, all rows.
  - `packages/core/src/index.md` — add the `activity/` module line; update the `main.ts` line if its wiring summary enumerates modules (it does — `:3`).
  - `packages/core/src/capabilities/index.md` — only if a file is added there.
  - `packages/core/src/agents/index.md` — only if the fence lands in `agents/`.
  - `packages/shared/src/index.md` — only if a new schema file is created (an append to `capability-outputs.ts` may still warrant updating that row's enumeration).
  - `apps/desktop/src-tauri/src/capabilities_impl/index.md` — `foreground_window.rs` row.
  - `apps/desktop/src-tauri/src/index.md` — only if the `node.rs`/`protocol.rs` one-liners enumerate capabilities (check on touch).
  - `apps/desktop/src-tauri/src/gate/index.md` — no new file expected (governance.rs edit only), so likely no row change.
- **Error handling**: every capability path degrades to a structured, model/loop-readable error (`route-capability.ts` codes; `ExecError::failed`); execute/sampler never throws/panics.
- **Verification gate** (AC `prd.md:89`): `cargo test` + `cargo clippy -D warnings` + `pnpm typecheck` + `pnpm lint` + `pnpm test`. Remember the governance row-count test (`governance.rs:245`, `19` → new total) goes red until updated — that is the intended RED-proof, update the comment with the new arithmetic.

---

## 6. §Risks / unknowns an impl agent would trip on

1. **Capability name + governance posture are OWNER RULINGS, not code decisions** (`prd.md:51-52`, `:63-66`). Do not silently pick `{ask,ask,auto}` vs something looser; the continuous-observation UX (30s poll cannot prompt per tick) is an open question the research/owner must settle *before* the governance cell is written. What the codebase gives you today: session/always decision memory under the bare name is the only built-in "toggle-style grant" (`gate.rs:242-258`); there is no per-capability "granted-until-revoked" primitive besides `Always`.
2. **Deny/backoff loop hazard**: at `standard: Ask`, a system-initiated tick with no user answer lands `DeniedTimeout` after the Shell dialog's 60s deny (broker backstop 90s — `capability-broker.ts:36-38`). A naive fixed-interval sampler would re-prompt forever. The sampler needs deny-aware backoff / stop-until-state-change; nothing existing implements this.
3. **Sampling loop lifecycle**: `main.ts` has no shutdown hook for module timers beyond `.unref()` (`:344`) — mirror that; also skip ticks while `findNodeForCapability` returns undefined to avoid NO_NODE log spam (route logs a warn per failure, `route-capability.ts:39-41`).
4. **Fence home ambiguity**: §3 gives two defensible homes (`activity/fence.ts` vs `agents/untrusted-fence.ts`); pick with the leader — the PRD only forbids scattering per-consumer.
5. **Rust test environment-dependence**: a foreground-window capture test needs a foreground window; CI/headless runs may get none. Shape the exec so "no foreground window" is a structured `ExecError`/`null`-field success (design ruling needed), and keep live asserts tolerant (see `process_list.rs:49-59` style).
6. **Win32 API + any new crate must be doc-verified** (`prd.md:43-45`, `:111`) — out of scope for this local research; `sysinfo` 0.39 is already in-tree (process name from pid is available via `system.process(Pid)`; whether title comes from Win32 directly is the research ruling).
7. **Uncommitted-baseline hazard**: `governance.rs`, `ws_client.rs`, `node.rs`, `permission-level-schema.ts` and the permission fixtures are **modified-but-uncommitted** T2b work (git status). All line numbers above are the on-disk (post-T2b) versions; if T2b lands/rebases first, re-verify `governance.rs` line refs.
8. **OS-neutrality of core** (inv.8 / AC `prd.md:88`): the activity module must contain zero Windows references — window/process semantics arrive as parsed WS payloads only; test with synthetic samples.
9. **Advertise-list drift**: three name sites must agree exactly — `default_capabilities()` (`node.rs:48`), the handler's `capability()` string, and the governance cell key. A mismatch fails soft-but-confusing (NO_NODE, or fail-closed gate deny with a warn), not loudly at compile time.
