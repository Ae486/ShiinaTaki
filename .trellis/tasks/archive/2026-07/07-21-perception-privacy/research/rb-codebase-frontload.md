# Research: T3b Perception+Privacy — codebase front-load (file:line seam map)

- **Query**: Map exact wiring for every T3b seam so impl can start immediately (ambient screenshot sampling, D44 fence closure, Privacy Pause, sensitive-process skip, governance cell, activity card, tests).
- **Scope**: internal / LOCAL-ONLY (no web tools)
- **Date**: 2026-07-21
- **Tree**: current (T3a landed: commits dd60083..9622906 + e10adec..d1e8ca3)

---

## Sharpest architectural finding (read first)

**The `screenshot` write path and the `#17` TTL/GC path are DISJOINT.** `screenshot-store.ts` writes `workspace/screenshots/<ISO-ts>.png` with a **timestamp filename, NOT content-addressed, NOT swept by anything** (`screenshot-store.ts:19-32`). The `#17` TTL/GC (`attachment-store.ts::sweepExpired` + the 6h interval in `main.ts:357-363`) sweeps **only** `workspace/attachments/<sha256>.<ext>` — chat images, never screenshots. So an AMBIENT screenshot loop reusing `screenshot-store` today would pile PNGs on disk **forever** with no reclaim. Two honest choices for impl: (a) route ambient captures through `attachment-store` (content-addressed + already GC'd, but it's typed to chat-image `IMAGE_MEDIA_TYPES` and its refs land on the timeline), or (b) add a screenshots sweeper mirroring `main.ts:357-363`. This is the one seam most likely to be missed.

Second sharpest: **D44 is currently OPEN on TWO paths, and neither is a prompt-string boundary.** The VLM description is returned as a *structured tool-result field* (`screenshot-tool.ts:56` `{ ...result, description }`) and separately written to episodic memory *un-fenced* (`image-description-writer.ts:54` `content: \`[image] ${description}\``). `fenceUntrusted` is only ever applied inside `render-activity.ts:44` (prompt-assembly). Closing D44 means fencing the description **where the string enters a prompt/memory**, not at capture.

---

## Findings

### Files Found

| File Path | Role for T3b |
|---|---|
| `packages/core/src/capabilities/screenshot-tool.ts` | on-demand agent tool: route→broker→`store.save`→optional `describe`; D44 path #1 (`:56`) |
| `packages/core/src/capabilities/screenshot-describe.ts` | VLM bridge; `DESCRIBE_PROMPT` (`:13`) + caller focus append (`:20-23`); ambient loop reuses this verbatim |
| `packages/core/src/capabilities/screenshot-store.ts` | writes `screenshots/<ts>.png`; **not content-addressed, not GC'd** (`:19-32`) |
| `packages/core/src/media/attachment-store.ts` | the GC'd/content-addressed store; `sweepExpired` (`:74`), `read` REF_RE confinement (`:96-111`) |
| `packages/core/src/memory/image-description-writer.ts` | describe→episodic memory; D44 path #2, un-fenced (`:54`); detached fire-and-forget |
| `packages/core/src/agents/untrusted-fence.ts` | `fenceUntrusted({source,content})` (`:20-25`) — the D44 closure tool |
| `packages/core/src/activity/activity-sampler.ts` | **the model for the ambient screenshot loop**: `setInterval().unref()` self-poll, `tick` (`:88`), DENIED→stop-for-session (`:70-75`), backoff, never-throws, `hasNode` pre-flight (`:95`) |
| `packages/core/src/activity/activity-state.ts` | OS-neutral rolling window; `current()` (`:92-96`) exposes live `processName` — **reusable for the sensitive-process skip** |
| `packages/core/src/activity/activity-layer.ts` | composition + deterministic defaults (`:15-25`, `POLL_MS=30_000`) |
| `packages/core/src/activity/render-activity.ts` | the ONLY current `fenceUntrusted` caller (`:44`) |
| `packages/core/src/main.ts` | composition root: screenshot wiring (`:226-234`), `describe` slot (`:232`), activity layer start (`:257-262`), attachment GC (`:357-363`), `instructionsExtra` join (`:324-327`), imageMemory (`:177-184`, `:305-307`) |
| `packages/core/src/server/method-registry.ts` | WS method table; `MethodDefinition{method,roles,paramsSchema,handler}` (`:31-37`), `register` seam |
| `packages/core/src/server/methods/avatar-subscribe.ts` | subscribe+`ctx.onClose` auto-unsub precedent (`:15-28`) — model for `perception.subscribe` |
| `packages/core/src/server/methods/media-usage.ts` | operator-only READ method precedent (`:11-21`) — model for `perception.state` read |
| `packages/core/src/server/timeline-subscriptions.ts` | fan-out registry (characterId→conn→sink) — model for a perception-state fan-out |
| `packages/shared/src/permission-level-schema.ts` | `PERMISSION_METHODS` naming model (`:11-16`); cell-key regex (`:30`) |
| `apps/desktop/src-tauri/src/gate/governance.rs` | `FIXED_RISK` cells (`:96-110`), `screenshot` cell (`:99`), `factory()` (`:119-121`), count test (`:248-250`) |
| `apps/desktop/src-tauri/src/gate.rs` | `evaluate_by_class` (`:162-189`) — name-keyed, splits on `:`; ambient reuses unchanged |
| `apps/desktop/src-tauri/src/capabilities_impl/foreground_window.rs` | already returns `processName` (`:64-82`); `TITLE_MAX_CHARS=140` (`:16`) |
| `apps/desktop/src-tauri/src/capabilities_impl/exec/policy.rs` | `BLOCKLIST_SEED` deny-list + operator-merge + load-or-degrade (`:25-69`, `:126-143`, `:211-227`) — deny-list precedent |
| `apps/desktop/src-tauri/src/ws_client.rs` | Shell dispatch: gate-evaluate THEN `handlers.respond` (`:180-197`) |

### 1. Screenshot pipeline today (capture→store→describe→where text goes)

Flow (`screenshot-tool.ts:42-62`): `routeCapability(deps,"screenshot",{})` → `ScreenshotOutputSchema.parse` → `store.save(dataBase64)` (`:49`) → optional `describe({dataBase64,mediaType,prompt:describePrompt})` (`:51-53`) → result `{ok,path,width,height,bytes,description?}`. The **describePrompt (T2b)** is the `inputSchema` field (`:33-40`), APPENDED to the base framing in `composeInstructions` (`screenshot-describe.ts:20-23`) — never replaces it. **Where the description goes today: straight into the tool result the text model reads** (`:56`) — it is NOT written to memory by the screenshot path (unlike chat images, which go through `image-description-writer`). The describe bridge is wired only when the vision slot exists (`main.ts:232`, `visionModel ? ... : undefined`).

**Ambient loop — reuse vs duplicate**: model it *exactly* on `activity-sampler.ts` (self-scheduling `setInterval().unref()`, `hasNode` pre-flight, DENIED→stop-for-session, backoff, never-throws). It should REUSE: `routeCapability` for capture, `screenshot-describe.ts::describe` for text, and `fenceUntrusted` for output. It should NOT reuse `activity-sampler` code directly (distinct concern → own file per anti-sprawl); it's a *sibling* module. Cadence default lives beside the others in `activity-layer.ts:15-25` (or a new `perception-layer.ts` composition).

### 2. D44 closure point (exact lines)

`fenceUntrusted` (`untrusted-fence.ts:20`) must wrap the VLM description on **both** producer paths:
- **Tool-result path**: `screenshot-tool.ts:56`. But a tool result is a structured object, not a prompt string — the model receives `description` as JSON. Impl must decide: fence the string value here, or (cleaner) have the AMBIENT loop — which emits a *prompt section* like `render-activity.ts` does — be the fenced surface, and separately fence the on-demand tool's `description` field value.
- **Memory-write path**: `image-description-writer.ts:54` writes `[image] ${description}` un-fenced into episodic memory. If ambient descriptions ride a memory-write (they need not — activity today is prompt-only, `render-activity.ts`, never persisted), that write must be fenced too. **Finding: ambient descriptions can follow the activity precedent (prompt-only, in-memory, fenced at render) and avoid the memory path entirely**, which sidesteps the un-fenced `image-description-writer` path. If impl chooses to persist ambient descriptions, D44 forces fencing at the write.

### 3. Privacy Pause plumbing

**No pause flag exists anywhere today.** The sampler has `start()/stop()` (`activity-sampler.ts:137-143`) but stop is terminal (clears the timer). Design implication:
- A new Core-side pause state (a tiny `perception/` or `activity/` module, e.g. `createPerceptionState()` holding a boolean + getter) must gate at the tick guard. For T3a's sampler that's a check at `activity-sampler.ts:89` (`if (rt.stopped || rt.inflight) return;` → add `|| rt.paused()`). For the new ambient loop, the same guard. Whether it gates the **agent's on-demand `screenshot` tool** is an owner ruling (prd open Q line 33): the tool's `execute` (`screenshot-tool.ts:42`) would consult the same flag and return a structured `{ok:false,code:"PAUSED"}`.
- **WS method surface**: there is **no Core-registered `permission.*` method today** — `PERMISSION_METHODS` (`permission-level-schema.ts:11-16`) exists in shared but the Level is Shell-file-driven (`gate/level.rs` reads `permission-level.json`; the panel is #23). So the Pause toggle is the **first perception operator method registered Core-side**. Model it on: `media-clear.ts`/`media-usage.ts` (operator-only mutation/read, `roles:["operator"]`) for the toggle+read, and `avatar-subscribe.ts:15-28` (+`ctx.onClose`) if the UI needs a live pause-state push. Registration is one `registry.register(...)` call in `main.ts` beside `:344-346`. Naming model: `PERMISSION_METHODS` object-literal in shared → add a `PERCEPTION_METHODS = { pauseGet, pauseSet, state, subscribe }` const in a new `packages/shared/src/perception-schema.ts`, re-exported from `index.ts` (the `_METHODS` cluster at `index.ts:44-198`). The registry itself: `method-registry.ts` — zod-validated params, role-gated, one file per method under `server/methods/`.

### 4. Sensitive-process skip seam (both placements, honestly)

`foreground_window.rs:64-82` already resolves `processName` (xcap `app_name` → sysinfo fallback). Two placements:
- **Core-side (recommended, inv.8-clean)**: before an ambient capture, read `activity.state.current()?.processName` (`activity-state.ts:92-96`) — **T3a is ALREADY sampling the foreground every 30s**, so the skip needs NO new foreground read; the ambient loop consults the last activity sample, matches against a skip list, and returns without capturing. Match logic (exe-name compare) is pure/OS-neutral → belongs in Core (inv.8). Skip-list source: a Core config. **No Core list-config precedent exists yet** (configs are env-based, e.g. `vision-config.ts`); closest editable-list precedents are Shell-side JSON (see below). Impl likely adds a small JSON or env-list loader (built-in defaults + user-editable at #26).
- **Shell-side (ships-fewer-pixels)**: the Shell could refuse capture when a sensitive app is foreground, avoiding transmitting the PNG at all. But: (a) the Shell node doesn't distinguish ambient vs on-demand — the request is just `capability:"screenshot"` (`ws_client.rs:180-197`); (b) the match logic would live in Rust, which inv.8 says should stay Core-side; (c) it couples the skip to the gate/exec path. Deny-list precedents that DO live Shell-side: `exec/policy.rs` `BLOCKLIST_SEED` (`:25-69`) — operator-editable JSON that ADDS to a built-in seed, load-or-degrade-safe (`:211`); and `governance.rs` `floor_classes` (`:83`, `:109`) — static deny-in-every-tier. **Honest trade**: Core placement is inv.8-correct and reuses T3a's sample for free; Shell placement's only real win is never transmitting pixels for a sensitive app, at the cost of Rust-side match logic and ambient/on-demand ambiguity.

### 5. Governance additions

A second name-keyed cell (e.g. `screenshot-ambient`) is added to the `FIXED_RISK.cells` array (`governance.rs:98-108`), same shape as `screenshot` (`:99`): `{strict:Ask, standard:Ask, relaxed:Auto, persist:true}`. Because it's single-segment, `evaluate_by_class` (`gate.rs:162-189`) handles it **unchanged** (`key.split(':').next()` → the bare name; exact-match `cell()`). Tests to update: the count assertion (`governance.rs:248-250`, currently "16 cells + 4 floor = 20" → becomes 17 cells → 21 rows) and the fixed-risk key loop (`:233`, add `"screenshot-ambient"`). Also the gate's `fixed_risk_auto_runs_at_relaxed` loop (`gate.rs:409`) if it should assert the ambient cell too. **Ambient sampling can reuse `evaluate_by_class` unchanged** — a distinct cell lets a user allow chat screenshots (`screenshot`) but deny ambient (`screenshot-ambient`), exactly the prd open-Q line 40 requirement. The Core-side tool/loop routes with `capability:"screenshot-ambient"` and the Shell needs that name in `SUPPORTED_CAPABILITIES` (`node.rs:49`) + a registered handler — OR the ambient loop reuses the existing `screenshot` exec but the Core routes under the ambient cell key (needs a routing key distinct from the exec capability; verify how `routeCapability` maps capability→node handler, since `node.rs:49` gates on the capability string).

### 6. Activity card surface

Pet UI subscribes to Core state via the fan-out pattern: `timeline-subscriptions.ts` registry (characterId→connection→sink) driven by `avatar.subscribe`/`timeline.subscribe` (`avatar-subscribe.ts:15-28`), auto-torn-down on `ctx.onClose`. A `perception.state` (one-shot read) models on `media-usage.ts:11-21` (operator-only, returns a snapshot). A `perception.subscribe` (live card push) models on `avatar-subscribe.ts` + a new `perception-subscriptions.ts` mirroring `timeline-subscriptions.ts`. The card's data source is the OS-neutral in-memory state (`activity-state.ts::entries()/current()`); the renderer precedent is `render-activity.ts` (already fenced). Note: the activity block ALSO already reaches the *agent* via `instructionsExtra` (`main.ts:324-327`) — the card is the *UI-facing* twin of that.

### 7. Test conventions + size/naming checklist per layer

- **TS (`packages/core`)**: `*.test.ts` colocated next to source (e.g. `activity-sampler.test.ts`), **vitest** (`^4.1`). Sampler tests inject a synthetic clock (`now?` dep, `activity-sampler.ts:31-32`) and a fake `route`/`hasNode` — the ambient loop + pause must be unit-testable the same way (inject clock + a fake capture). Size caps (hard): **file ≤300 lines, fn ≤50, params ≤3**; new feature = new colocated file, NOT an append (anti-sprawl). Every prod `.ts` opens with the 3-tag `INPUT/OUTPUT/POS` header; touching a dir updates its `index.md` (`capabilities/index.md`, `activity/index.md`, `server/methods/index.md`).
- **Shared (`packages/shared`)**: zod schema is the single source; add fixtures under `fixtures/protocol/*.valid.json` / `*.invalid.json` (see the new `permission-level-state.*.json` this branch added) + a `*-schema.test.ts` (`permission-level-schema.test.ts` precedent).
- **Rust (`src-tauri`)**: `#[cfg(test)] mod tests` inline in the same file (`governance.rs:164`, `foreground_window.rs:117`). fn ≤100 lines (clippy `too_many_lines`), file soft-cap 500, no `mod.rs`, snake_case. Gate `cargo clippy -- -D warnings` green. RED-proof style: name the invariant each test guards (see `governance.rs` test names).
- **Quality gate (backend index.md:30-34)**: `pnpm -r typecheck && pnpm lint && pnpm -r test` (lint is the ROOT script) + `cargo clippy` green.

### 8. Risks / unknowns for the impl agent

- **No vision slot → `describe` is `undefined`** (`main.ts:232`). Ambient sampling with no VLM produces a screenshot with no text — pointless and pure cost. Decide the degrade: ambient loop should probably **not start** when `visionModel` is absent (mirror `imageDescriptionWriter` being `undefined` at `:177-184`), or capture-but-skip-describe is explicitly useless.
- **Screenshot PNG accumulation** (the top finding): ambient capture via `screenshot-store` has no GC. Extend the sweeper (`main.ts:357-363`) or route through `attachment-store`.
- **Pause vs in-flight capture race**: `activity-sampler`'s `stop()` clears the timer but does NOT abort an `inflight` tick (`:99-121`); a capture already awaiting the gate/broker completes. Pause has the same race — a paused flag set mid-capture won't un-send an in-flight screenshot. Decide whether "pause is instant" means "no NEW capture starts" (easy, matches the `inflight` guard) or "abort in-flight" (needs an AbortSignal through `routeCapability`).
- **PII scrub ordering vs the A1 fence**: prd open-Q line 37 — scrub sits *before* text enters prompt/memory; the fence wraps at render. Order matters: scrub the raw description string, THEN `fenceUntrusted`. No PII-scrub module exists yet (greenfield).
- **Ambient capability routing**: if the ambient cell key is `screenshot-ambient` but reuses the `screenshot` Shell exec, confirm how `routeCapability`/`findNodeForCapability` maps the routed capability string to a Shell handler (`node.rs:49` gates on the exact capability name) — a new gov cell name may need a matching Shell capability entry or a Core-side key/handler split.
- **`describePrompt` for ambient**: the ambient loop has no LLM caller to supply a focus prompt; it uses the base `DESCRIBE_PROMPT` (`screenshot-describe.ts:13`) — fine, just note the field is optional.

## Caveats / Not Found

- No existing `perception/` module, no pause state, no PII scrubber, no Core-registered `permission.*`/`perception.*` method, and no screenshots-GC — all greenfield for T3b.
- Did not deep-read `node.rs` handler-registration internals for whether a new `screenshot-ambient` capability string needs a distinct Shell handler vs. reusing `ScreenshotExec` — flagged in §5/§8 as the one wiring detail to confirm first.
- No web tools used (LOCAL-ONLY per task).
