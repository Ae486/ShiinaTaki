# Research: Costume-switch TIMEOUT diagnosis (phase 0 for T1 item 1f)

- **Query**: On a costume that times out (roaming C3 wedge, 30s `SWITCH_TIMEOUT_MS`): (Q1) why does the panel go unclickable, (Q2) can costume identity wrongly become the timed-out costume, (Q3) what does the late-completing load do.
- **Scope**: internal (static trace + logical proof; no GUI repro — repo has no React-hook test infra)
- **Date**: 2026-07-19

## Executive verdict

- **Q1 (panel unclickable): CONFIRMED — pure 30s `isSwitching` window, NOT a leaked timer / parallel signal.** UX defect.
- **Q2 (identity corruption to timed-out costume): NO for the reported wedge (resources never finish).** All three identity stores stay pre-switch. Owner's worry #2 is unfounded for the never-completes case.
- **Q3 (late-model side effect): a LATENT defect exists** — if the load is merely SLOW (finishes after 30s) and no newer switch happened, the late model ATTACHES and silently changes the on-screen costume while all three identity stores stay pre-switch → visual/vocab drift. For a truly-wedged (never-finishes) load this never fires. Safety is incidental (relies on "never"), so it must be hardened before 1f threads a `costume` id.

## Findings

### Files Found

| File Path | Role in the bug |
|---|---|
| `apps/desktop/src/features/character-import/use-costume-switch.ts` | `switchTo` — owns `isSwitching`; writes front `current` + `last-costume` (both success-only) |
| `apps/desktop/src/features/character-import/character-panel.tsx` | `CostumeRow` `disabled={costume.isSwitching}` (line 82) — the unclickable surface |
| `apps/desktop/src/windows/pet/pet-stage.tsx` | `{panelOpen && <CharacterPanel .../>}` (line 62) — close = unmount = fresh state |
| `apps/desktop/src/lib/resolve-switch-report.ts` | The shared switch+report dance; the ONLY switch-path `reportAvatar` (line 33) |
| `apps/desktop/src/lib/promise-timeout.ts` | `withTimeout` — rejects at 30s, does NOT cancel the source promise |
| `apps/desktop/src/renderer/pet-scene.ts` | `switchCostume` + `seq` ticket + `attachModel` (lines 122-143) |
| `apps/desktop/src/renderer/live2d/costume-switch.ts` | `reloadModel` + `isStale` discard (lines 41-58) |
| `apps/desktop/src/windows/pet/use-initial-costume.ts` | boot promotion caller of `resolveSwitchReport` |
| `apps/desktop/src/windows/pet/use-core-connection.ts` | drift-self-heal `reportAvatar` caller (line 64) |
| `packages/core/src/server/methods/avatar-report.ts` | Core `avatarVocabulary.set` — ONLY writer of Core vocab (line 22) |

### Q1 — Panel-unclickable root cause: CONFIRMED (prime suspect correct)

Code path:
- `use-costume-switch.ts:88` `setSwitching(true)` → `:91` `await resolveSwitchReport({ ..., timeoutMs: SWITCH_TIMEOUT_MS })` → `:97` `finally { setSwitching(false) }`.
- `SWITCH_TIMEOUT_MS = 30_000` (`:60`). `resolveSwitchReport` awaits `withTimeout(scene.switchCostume(source), 30s)` (`resolve-switch-report.ts:32`); on a wedge this rejects only at 30s. So `isSwitching` is `true` for the full 30s.
- `character-panel.tsx:82` `disabled={costume.isSwitching}` disables EVERY selectable `CostumeRow` for that whole window. (The `×` close button `:114` and import button are NOT gated, so they stay live.)
- Close/reopen "fixes" it because `pet-stage.tsx:62` renders the panel as `{panelOpen && <CharacterPanel/>}`; `onClose` → `setPanelOpen(false)` UNMOUNTS `CharacterPanel` → `useCostumeSwitch`'s `useState` is discarded → reopening remounts with `useState(false)`.

**NOT a leaked/parallel signal.** `withTimeout` clears its `setTimeout` on both settle branches (`promise-timeout.ts:13,17`); the one-shot timer, once fired, needs no clearing. The late `.then` on the source runs `resolve/reject` on an already-settled promise (no-op). The only genuinely "parallel" artifact is the still-running underlying `switchCostume` load — that is the Q3/Defect-A concern, not the panel disable.

**Re-entrancy:** `switchTo`'s `useCallback` deps are `[client, scene, state.files, state.availability]` (`:100`) — they omit `isSwitching`, and the guard `:87` does not check `isSwitching`. Through the UI this can't re-enter (all rows disabled), but there is no in-function guard: if `switchTo` were ever invoked during an in-flight switch, two `resolveSwitchReport`/`withTimeout` runs would overlap and each `finally` would flip `isSwitching`, so a fast 2nd switch could clear the disable while a wedged 1st is still pending. Latent only.

### Q2 — Does costume identity change on timeout? NO (all three stores gated on success)

1. **Front-end `current`** (`use-costume-switch.ts`): the only writers are `:73` `toState(result, prev.current)` (refresh — preserves current), `:75` `EMPTY` (refresh catch = no character), `:93` `setState({ ..., current: costume })` (success, INSIDE `try` after `resolveSwitchReport` resolves). On timeout `resolveSwitchReport` throws → jumps to `catch :94` (sets `error` only) → `current` untouched. **No corruption.**
2. **Core `avatarVocabulary`**: written ONLY by `avatar-report.ts:22` `vocabulary.set(...)`, reachable only via the `avatar.report` WS method. The only switch-path caller is `resolve-switch-report.ts:33` `client.reportAvatar(...)`, which runs ONLY after `withTimeout` (`:32`) RESOLVES. On timeout, `:32` throws → `:33` never runs. `pet-scene.switchCostume` itself NEVER calls `reportAvatar`. **No corruption.**
3. **`last-costume` persistence**: `saveLastCostume` has ONE caller, `use-costume-switch.ts:92`, after `resolveSwitchReport` resolves. On timeout it never runs. **No corruption.**

**Direct answer to owner:** the timeout signal is NOT "parallel" in a way that corrupts identity for the reported wedge. `withTimeout` only stops awaiting; every identity write is gated behind the switch resolving. Since a never-finishing load never resolves, nothing attaches and nothing reports — the pre-switch costume stays on screen and in all three stores.

### Q3 — The late-model side-effect (the subtle one)

`withTimeout(scene.switchCostume(source), 30s)` stops awaiting at 30s but does NOT cancel the underlying `switchCostume` (`promise-timeout.ts` has no abort). `pet-scene.switchCostume` (`:122`) bumped `ticket = ++ctx.seq.current` at START and awaits `reloadModel` with `isStale: () => ticket !== ctx.seq.current`.

- **Scenario B — a NEWER switch happened (operator picked another costume / boot promotion):** `ctx.seq.current > ticket` → `reloadModel` `costume-switch.ts:47` `isStale()===true` → removeChild+destroy the late model + throw "superseded". No teardown of the live model, no attach. The rejection hits `withTimeout`'s settled promise (no-op). **Truly harmless** (matches the owner's mental model).
- **Scenario A — NO newer switch (the common reported case: pick the wedge, it times out, operator just closes/waits):** `ctx.seq.current === ticket` → `isStale()===false`. IF the load ever resolves (SLOW, not infinite): `reloadModel` tears down `previous` (the pre-switch model) `:53-55` and returns; `pet-scene.ts:129` `attachModel(ctx, model)` ATTACHES the late model. **The on-screen costume silently becomes the timed-out costume**, but `reportAvatar` is NOT called (the caller already threw; the late `switchCostume` return value is captured by `withTimeout`'s no-op `resolve`), and front `current` + `last-costume` were never updated. Result: on-screen model ≠ front `current` ≠ Core vocab ≠ last-costume → the LLM drives stale (pre-switch) vocab against a different model = dead-name/drift.

For the EXACT reported wedge ("resources never finish loading"), Scenario A's `await deps.load(...)` stays pending forever → no attach, no drift, just a dangling load/model leak. So today's code is safe for the reported case but only incidentally (it depends on "never finishes"), and the design comment `use-costume-switch.ts:58-59` frames "a non-superseded one simply attaches late" as harmless — which is exactly the drift above.

### Related Specs

- `.trellis/spec/backend/agent-runtime.md` — avatar vocabulary / `avatar.report` contract (Option A).
- Existing tests to mirror for regressions: `apps/desktop/src/renderer/pet-scene.test.ts` (injectable `reloadModel`), `apps/desktop/src/lib/resolve-switch-report.test.ts` (fake client/scene spies).

## Fix proposals (ranked)

### FIX 1 — BLOCKING for 1f (identity correctness): make a timed-out switch discard its late model

- **Where**: `apps/desktop/src/renderer/pet-scene.ts` (`switchCostume`/`ctx.seq`) + the timeout path in `apps/desktop/src/lib/resolve-switch-report.ts:32` / `use-costume-switch.ts:94`.
- **Change (minimal)**: expose `scene.abortSwitch()` that bumps `ctx.seq.current` (mark the in-flight ticket stale) and call it when `withTimeout` rejects (in `resolveSwitchReport`'s failure path, or `switchTo`'s `catch`). Then a late `reloadModel` for that ticket sees `isStale()===true` (`costume-switch.ts:47`) and self-discards (removeChild+destroy, no teardown, no attach) — Scenario A collapses into the safe Scenario B. This guarantees the pre-switch model stays and NOTHING attaches/reports late, independent of whether the load is slow or infinite. (Cancelling the underlying fetch is a bonus, not required for correctness.)
- **Regression-test assertion point** (`pet-scene.test.ts` style, inject a controllable `reloadModel` load promise): after timeout+`abortSwitch`, when the load finally resolves assert (a) `slot.current` is still the pre-switch model / `attachModel` not applied, (b) the late model is `destroy`ed, (c) no `reportAvatar`.

### FIX 2 — UX-only (panel clickability): stop disabling the whole list for 30s

- **Where**: `apps/desktop/src/features/character-import/character-panel.tsx:82` + `use-costume-switch.ts`.
- **Change (options)**: (a) disable only the in-flight row (track the switching costume id) instead of `isSwitching` for all rows, and/or show a spinner + Cancel; (b) add an explicit re-entrancy guard `if (isSwitching) return;` in `switchTo` (and drop the whole-list disable) so overlapping switches can't wedge state; (c) optionally lower `SWITCH_TIMEOUT_MS` / add progress feedback.
- **Regression-test assertion point**: no React-hook infra today — note this; if `switchTo` core is extracted, assert `isSwitching` flips true→false around a rejecting `resolveSwitchReport`, and a second `switchTo` during in-flight is a no-op.

### 1f threading note (where the timeout path must NOT report the timed-out id)

`resolve-switch-report.ts:33` is the ONLY switch-path `reportAvatar`. 1f will add `costume` to `AvatarReportParams`; add it here as `costume: deps.costume`. Because `:33` runs ONLY after the timeout-guarded `:32` resolves, a timed-out costume id is never reported — correct by construction. **CRITICAL: do NOT move `reportAvatar` into `pet-scene.switchCostume` (`:122-131`).** If the report lived there, the Scenario-A late attach (Fix 1's target) would report the timed-out `costume` id and corrupt the Core store. The re-report must stay downstream of the `withTimeout` guard, and Fix 1 must land so no late attach happens at all.

## Caveats / Not Found

- No GUI/e2e repro performed (no React-hook test harness in the repo; per task, not expected). All verdicts are from static tracing of the exact code paths cited.
- Whether the roaming-C3 load is truly infinite vs eventually-slow is not determinable from the client code (it depends on `Live2DModel.from` network behavior). Both cases are covered above; Fix 1 makes the distinction irrelevant.
- Uncancelled wedged load = a resource leak (dangling fetch + partial model) even when identity is safe; Fix 1's abort/cancel bonus would also address it.
