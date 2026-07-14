# Research: Gaze Follow + Click Hit-Area Reactions (Topic 6)

- **Query**: `model.focus(x,y)` gaze-follow; the 7-region click→motion/expression personality presets (taki = tsundere/cool). UI-local, no LLM. Verify engine APIs; slot into the framework-free renderer.
- **Scope**: internal + installed engine types + archived reference research
- **Date**: 2026-07-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/renderer/live2d/load-taki-model.ts` | Loads the model; currently `autoFocus:false`, `autoHitTest:false` |
| `apps/desktop/src/renderer/pet-scene.ts` | Framework-free assembly point; owns the model + governor |
| `apps/desktop/src/windows/pet/use-click-through.ts` | Cursor-poll → canvas-local mapping (reuse for gaze poll) |
| `.trellis/tasks/archive/2026-07/07-07-reference-research/research/live2d-presentation-analysis.md` | §1 gaze, §4 click-region presets (the port spec) |
| `node_modules/.../untitled-pixi-live2d-engine/types/index.d.ts` | `Live2DModel.focus/motion/expression` signatures |

### Engine APIs (verified against installed `index.d.ts`)

- **Gaze**: `focus(x: number, y: number, instant?: boolean): void` (`index.d.ts:4562`). "Position in
  world space"; the movement is interpolated, not instant (`:4556-4560`). Drives head/eye/body
  look-at.
- **Motion**: `motion(group: string, index?: number, priority?: MotionPriority, opts?: { loop?, sound?, expression?, ... }): Promise<boolean>` (`index.d.ts:4475-4483`). `MotionPriority` enum
  `NONE=0, IDLE=1, NORMAL=2, FORCE=3` (`:608-617`). (`idle-behavior.ts:20` already calls
  `model.motion(group, 0, MotionPriority.IDLE, { loop: true })`.)
- **Expression**: `expression(id?: number | string): Promise<boolean>` (`index.d.ts:4554`) — accepts
  the expression **name** or index; no arg = random.
- **SDK tap (alternative)**: `tap(x,y)` does a hit-test and emits a `hit` event with hit-area names
  (`index.d.ts:4564-4570`); `hitTest(x,y)` returns hit-area names (`:4571+`). The `arbeit` manifest
  defines only coarse custom areas (`hit_areas_custom`: `body`/`head`, `model.json:8-25`), so the
  richer **7-region scheme below is worth porting** rather than relying on SDK hit areas.

Current load config to change (`load-taki-model.ts:20-26`): `autoHitTest:false`, `autoFocus:false`.
For #16, keep `autoFocus:false` and drive `focus()` manually (so the 600px clamp + delta-gate apply)
rather than flipping `autoFocus:true`.

### Gaze follow (presentation-analysis §1 — 连/built-in + polish)

Mechanism to port: poll the global cursor (the exact machinery `use-click-through.ts:30-49` already
runs — `cursorPosition()` + `win.innerPosition()` + `scaleFactor`), map to the model's world space,
call `model.focus(x, y)` throttled. Polish from the reference (`live2d-presentation-analysis.md:22-25`):
- **600px reach clamp** so an off-screen cursor doesn't peg the head to the edge;
- **min-delta-squared gate** (skip sub-pixel moves) to avoid churn;
- run on a throttled `pointermove`/rAF, or reuse the ~40Hz poll cadence.

This is **UI-local, no LLM, no backend**.

### Click-region → motion/expression presets (presentation-analysis §4 — 造/port)

From `live2d-presentation-analysis.md:45-50`:
- **7 regions** by normalized x/y within the model bounds: `head` (y < 0.38), then
  `upper_body_{left,center,right}` vs `lower_body_{…}` split at y = 0.64, and left/center/right at
  x = 0.38 / 0.62.
- **Personality presets** (7 profiles: `auto`, `genki`, `tsundere`, `shy`, `cool`, `surprised`,
  `random`) each map region → an emotion **tag**. **taki's default = tsundere / cool.**
- **Fuzzy tag → name resolver**: exact → prefix → char-prefixed → regex
  `(^|[_-])tag($|[_-]?\d)`, plus an expression-tag synonym table. This resolves an abstract tag
  (e.g. `angry`, `shy`, `smile`) against the model's **actual** motion/expression names — the same
  `definitions` source as Topic 3. So a tsundere "head poke → 哈？/turn away" maps `angry`/`pui` to
  `arbeit`'s `angry0x` / `pui01`, and "shy" to `shame01/02`.

Because it resolves against the live model's names, the preset survives costume/soul swaps — no
per-model config, matching the "generic Cubism import" requirement.

### Slotting into the framework-free renderer

`renderer/` forbids React imports (`directory-structure.md:33`; `pet-scene.ts` header). Add:
- `renderer/live2d/gaze.ts` — `startGaze(model, opts)`; consumes cursor coords (fed from the pet
  window's poll, like click-through), applies clamp + delta gate, calls `model.focus`.
- `renderer/live2d/click-regions.ts` — pure `regionForPoint(nx, ny) -> Region` bucketing (unit-testable).
- `renderer/live2d/click-presets.ts` — the preset tables (taki=tsundere) + the fuzzy
  `resolveMotionByTag` / `resolveExpressionByTag` against `motionManager.definitions` /
  `expressionManager.definitions`.
- Wire a click handler in `pet-scene.ts` (or a thin `renderer/live2d/click-reactions.ts`) that: on a
  click-without-drag at canvas-local (x,y) → normalize to model bounds → `regionForPoint` →
  preset tag → resolve name → `model.motion(group)` / `model.expression(name)`.
- Expose these off `PetScene` (like `isOpaqueAt`) so the pet window's pointer handler calls them.
  A thin store is optional; the reactions are fire-and-forget renderer calls.

### The click seam shared with the bubble (Topic 5)

A click on an opaque pixel both *could* open the bubble (Topic 5) and *could* fire a region
reaction. Decide precedence — e.g. body-click → bubble, head-poke → reaction; or reaction always +
bubble on a dedicated affordance. Both consume the same `isOpaqueAt` + click-vs-drag guard
(`use-pet-drag.ts` dead-zone). This coordination is the one cross-topic UI detail to nail down.

## Caveats / Not Found

- `model.focus` takes **world-space** coords (`index.d.ts:4558`); the exact mapping from
  canvas-local (what `use-click-through.ts` computes) to world space depends on the model's
  anchor/position/scale (`load-taki-model.ts:33-38` centers + fits). The reference clamps a *delta
  vs the model's on-screen center* (`live2d-presentation-analysis.md:22`), which sidesteps precise
  world coords — port that relative approach.
- The reference's region ratios (0.38 / 0.64 / 0.38-0.62) are tuned to its model framing; taki's
  `arbeit` framing (`model.json` layout + the 0.9-height fit in `load-taki-model.ts:36`) may want
  small retuning — a taste pass, not a blocker.
- The full preset/resolver source is GPLv3 (reference repo) — port **patterns in prose only**,
  clean-room per CLAUDE.md; do not copy code.
