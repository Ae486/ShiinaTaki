# Research: Idle Motion scheduler + mouse-proximity engine facts (1a / D17)

- **Query**: Motion-finish detection, idle-group reality, one-shot freeze sites, idle-pool scheduler + proximity design.
- **Scope**: internal (engine dist/types + renderer + BANDORI reference) 
- **Date**: 2026-07-18

## Engine API facts (verified in the INSTALLED engine — quoted)

Package: `untitled-pixi-live2d-engine` @ `node_modules/.pnpm/untitled-pixi-live2d-engine_e15fe1caba4790ee3e06e492e62223ad/...`

| Fact | Evidence |
| --- | --- |
| **A `motionFinish` event IS emitted** on completion | `dist/cubism.es.js:4152-4158`: `update(){ if(this.isFinished()){ if(this.playing){ this.playing=false; this.emit("motionFinish"); }` |
| **…but it is NOT in the typed `MotionManagerEvents`** | `types/index.d.ts:3712-3732` declares only `motionLoaded` / `motionLoadError` / `destroy`. Listening needs a cast: `(model.internalModel.motionManager as unknown as EventEmitter).on("motionFinish", cb)` |
| **Engine auto-plays idle on finish** | `cubism.es.js:4162-4165`: `this.state.complete(); if(this.state.shouldRequestIdleMotion()){ void this.startRandomMotion(this.groups.idle, MotionPriority.IDLE); }` |
| `shouldRequestIdleMotion()` = nothing playing/reserved | `cubism.es.js:3448-3450`: `return this.currentGroup===void 0 && this.reservedIdleGroup===void 0` |
| `groups.idle` default | `types/index.d.ts:3334` "`\"idle\"` in Cubism 2 and `\"Idle\"` in Cubism 4"; C3 `CubismMotionManager.groups.idle="Idle"` (`:6132`), C2 `="idle"` (`:5010`); settable via `Live2DModelOptions.idleMotionGroup` (`:3336`, applied `cubism.es.js:3778`) |
| `startMotion`/`model.motion` resolves on **START not finish** | `types/index.d.ts:788` "resolves with true if the motion is successfully **started**". Not a completion signal. |
| Poll-based finish detection | `motionManager.isFinished()` (`:55/:84`) and `MotionState.currentPriority` = `MotionPriority.NONE` when nothing plays (`:631-633`) |
| `MotionPriority` | enum `NONE=0` (can't be applied), `IDLE=1`, `NORMAL=2`, `FORCE=3` (`:608`; `shouldOverrideExpression` uses `currentPriority>1`, `cubism.es.js:3455`) |

## Idle-group reality per model — the freeze root cause (empirical)

Read `models/extracted/taki/live_01/adv_live2d_taki_005_live_01.model3.json` (Cubism 3): the motion group names are
`mtn_angry01_C/L/R`, `mtn_bye01_*`, `mtn_idle01_C/L/R`, `mtn_look01_*`, `mtn_nod01/02_*`, `mtn_smile01/02_*`,
`mtn_thinking01_*`, … (`:13-329`). **There is NO group named `Idle`.** The idle-flavoured motions exist but are named
`mtn_idle01_C/L/R` (`:149-163`).

Consequence chain (why it freezes today):
1. `startIdleAnimation` (`renderer/live2d/idle-behavior.ts:14-16`) checks `definitions[groups.idle="Idle"]?.length` →
   `undefined` → `{started:false}` → **no baseline idle loop plays**.
2. When a one-shot finishes, the engine's auto-idle fires `startRandomMotion("Idle", IDLE)` → group `Idle` absent →
   plays nothing → **the model freezes on the finished one-shot's last frame** (matches CONTEXT.md "today: freeze").

⇒ The engine's built-in idle is dead for these models because the pool must come from the actual group names, not the
convention name. The C2 dev fallback (arbeit) idle group is unverified here (git-ignored self-contained costume); the
scheduler must not assume any convention group exists — derive the pool from the manifest.

## Current one-shot sites (where "motion ended" goes nowhere)

| Site | Call | Priority / loop | On finish |
| --- | --- | --- | --- |
| Click reaction | `renderer/live2d/click-reactions.ts:38` `model.motion(motion, undefined, NORMAL, {loop:false})` | NORMAL, one-shot | freeze (nothing) |
| LLM avatar command | `renderer/live2d/avatar-commands.ts:26` `model.motion(name, undefined, priority, {loop: loop ?? false})` | usually NORMAL, one-shot | freeze (nothing) |
| Baseline idle | `renderer/live2d/idle-behavior.ts:20` `model.motion(groups.idle, 0, IDLE, {loop:true})` | IDLE, loop | no-op for taki (absent group) |

Both foreground one-shots (`{loop:false}` C3-Meta.Loop discipline preserved) are the consumers the Idle Motion reflex
must catch: motion-finish → return to idle.

## (5a) Idle Motion scheduler design

New module `apps/desktop/src/renderer/live2d/idle-motion.ts` (framework-free, ZERO React; the first Hook consumer per
CONTEXT.md — but NO generic hook bus yet, YAGNI; write internals extraction-friendly). Module-contract header required.

**Pool derivation (deterministic, v1)**: from the model's motion group names (`Object.keys(motionManager.definitions)`
= the same source as `readVocabulary`), select the idle pool by heuristic: names matching `/idle/i`
(taki → `mtn_idle01_C/L/R`). If none match, pool = `[]` and the scheduler stays dormant (logs like idle-behavior does)
— no regression vs today's freeze, and model-absence is the same dormant path. (Operator-configurable pool is deferred
to settings #24/#26 — defer the UI, not this mechanism; the pool is injectable so #24 swaps the source.)

**State shape**:
```ts
interface IdleMotionScheduler { dispose(): void }
// internal: { model, pool: string[], timer, lastPlayAt, isStale: () => boolean }
```

**Loop (recommended: a dedicated low-freq timer, NOT the render-governed ticker)** — a `setInterval(~700ms)` tick:
1. if `isStale()` or model destroyed → `dispose()` and return (costume-switch / teardown safety).
2. if `motionManager.isFinished()` (or `state.currentPriority === NONE`) AND `now - lastPlayAt >= nextInterval`:
   play `model.motion(pick(pool), undefined, MotionPriority.IDLE, {loop:false})`; set `lastPlayAt = now`; draw a fresh
   `nextInterval` = random in `[MIN_IDLE_GAP_MS, MAX_IDLE_GAP_MS]` (recommend 4000-12000). Between gaps the engine's
   eyeBlink+breath keep the model alive.
This UNIFIES return-to-idle and random-idle: a foreground one-shot ending makes `isFinished()` true, so the next tick
resumes idle within the gap; while idle, pool motions cycle at random intervals. IDLE priority means a click/avatar
NORMAL/FORCE motion always overrides an idle motion (no fighting; `avatar-commands`/`click-reactions` unaffected).

Why timer over the `motionFinish` event: the event is untyped (cast) AND the engine's own auto-idle also fires on it —
the poll avoids both the typing hack and any double-trigger, and is trivially testable with fake timers. (If immediate
return-to-idle latency matters, the event can supplement, but it is not required.)

Why a dedicated timer over `app.ticker`: the render governor throttles/pauses the ticker on the idle avatar state
(`render-governor`), which is exactly when idle motions should fire — a governed-ticker scheduler would starve itself.
Impl MUST confirm the governed ticker still ADVANCES the playing idle motion's animation (motions need ticker updates);
if the governor pauses updates while "idle", the idle state may need to count as light activity. Flag for verification.

**Wiring**: `pet-scene.ts` `attachModel` (`:127-130`) currently does `createAvatarController` + `startIdleAnimation`.
Store an `IdleMotionScheduler` on `SceneModel` and `dispose()` the previous one at the top of `attachModel` (before
replacing `slot.current`) so a costume switch tears down the old scheduler. Pass `isStale: () => ctx.seq.current !==
ticket` — reuse the existing switch ticket (`ctx.seq`, `pet-scene.ts:66/116`). `startIdleAnimation` can stay for models
that DO have a real `Idle` group, or be subsumed — recommend the scheduler replaces it (the pool covers both).

## (5b) Mouse-proximity reaction design (D17)

**Cursor source — reuse, add zero IPC**: `use-click-through.ts:38-46` already runs ONE ~40Hz global-cursor poll and
calls `ctx.scene.focusAt(x,y)` each tick (`:46`). Add `ctx.scene.handleProximity(x, y)` right after it — same
canvas-local `(x,y)`, no second poll (the header already brags gaze "rides this same cursor read — zero IPC").

**Scene surface**: add `handleProximity(x, y): void` to `PetScene`, delegating to the avatar controller (mirrors
`focusAt`/`handleClick`). Logic in a new `renderer/live2d/proximity-reaction.ts` (framework-free):
- distance = `Math.hypot(x - center.x, y - center.y)` (scene has `center`, `pet-scene.ts:77`).
- if `distance <= NEAR_PX` (recommend ~140; smaller than gaze `maxReachPx=600`, `gaze.ts:23`) AND
  `now - lastReactAt >= COOLDOWN_MS` (recommend 8000-15000, "never spams" per PRD) AND no foreground motion playing
  (`state.currentPriority <= IDLE`): play a preset reaction — a NORMAL one-shot (`{loop:false}`) drawn from a small
  proximity preset resolved against the live vocabulary via the existing `emotion-resolver.resolveByTag` +
  `click-presets` machinery (reuse, don't duplicate). Set `lastReactAt = now`.
- Leaving and re-entering the NEAR zone re-arms only after the cooldown (track `wasNear` to fire on ENTER, not every
  tick inside the zone).
- Agent-chosen expressions are Heartbeat (T4), explicitly OUT of scope here — this is a deterministic renderer reflex.

The reaction is a foreground one-shot, so when it finishes the Idle Motion scheduler returns to idle (composes cleanly).
Click-through/gaze are untouched (proximity only READS the same poll's coords).

## BANDORI reference (GPLv3 — patterns only, NEVER copy)

`references/BANDORI-PET-REV-main` is a PySide6/Qt app. `live2d_widget.py` drives gaze via a `_head_track_timer` QTimer
+ `_gaze_target` from `QCursor` (`:177-229`) — the same "one timer polls the cursor, points the head" pattern our
`use-click-through` poll already implements. Idle/emotion scheduling is timer-based (`QTimer`, `random.choice`,
e.g. `alarm_manager.py:330`). No code is portable (Qt/Python); the transferable pattern is only: single cursor timer,
distance/threshold gate, cooldown between fires — all already reflected in the design above.

## Tests

1. **Scheduler unit** `idle-motion.test.ts` — fake model (`{motionManager:{definitions, isFinished, state}}`) + fake
   timers (`vi.useFakeTimers`):
   - pool derivation: definitions `{mtn_idle01_C:[], mtn_smile01_C:[]}` → pool `["mtn_idle01_C"]`.
   - `isFinished()==true` + interval elapsed → calls `model.motion(idleName, _, IDLE, {loop:false})`.
   - `isFinished()==false` (foreground motion playing) → does NOT play idle.
   - `isStale()==true` → `dispose()`, no further `model.motion`.
   - empty pool → dormant, never calls `model.motion`.
2. **Proximity unit** `proximity-reaction.test.ts` — fake model + center: cursor within `NEAR_PX` fires ONE reaction;
   staying inside does not re-fire; re-enter before cooldown does not fire; after cooldown re-fires; a foreground
   motion (`currentPriority=NORMAL`) suppresses it.
3. **Wiring** (`pet-scene` test extension): `switchCostume` disposes the previous scheduler (ticket goes stale) — assert
   the old fake scheduler's `dispose` ran and the old model gets no further idle `motion` calls.

## Files (for the impl agent)

| File | Action |
| --- | --- |
| `apps/desktop/src/renderer/live2d/idle-motion.ts` | NEW — scheduler (pool + timer + isStale + dispose) |
| `apps/desktop/src/renderer/live2d/proximity-reaction.ts` | NEW — distance+cooldown reaction (reuse resolveByTag/presets) |
| `apps/desktop/src/renderer/pet-scene.ts` | store+dispose scheduler in `attachModel`; add `handleProximity`; pass `isStale` from `ctx.seq` |
| `apps/desktop/src/renderer/live2d/avatar-controller.ts` | expose `handleProximity` (mirrors `focusAt`) |
| `apps/desktop/src/windows/pet/use-click-through.ts` | call `scene.handleProximity(x,y)` after `focusAt` (~line 46) |
| `apps/desktop/src/renderer/live2d/index.md` | add the two new files |

## Caveats

- `motionFinish` is emitted but untyped — the recommended poll design avoids depending on it; if used, cast + verify at
  runtime.
- The render-governor × idle-motion interaction (does a throttled/paused ticker still animate an idle motion?) is the
  one thing I could not verify statically — impl must smoke-test it (`pnpm tauri dev`, watch an idle cycle).
- C2 dev model (arbeit) idle-group presence unverified (git-ignored); the pool heuristic degrades safely if absent.
- Idle pool `/idle/i` heuristic is a v1 convenience; a costume with no idle-named motions stays dormant (no regression).
  If a richer default is wanted, a curated calm-subset fallback is a follow-up, not required for AC #3.
</content>
