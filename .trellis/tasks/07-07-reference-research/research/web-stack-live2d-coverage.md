# Research: Web Live2D Renderer Candidate Coverage (untitled-pixi-live2d-engine vs @naari3/pixi-live2d-display)

- **Query**: For each BandoriPet presentation feature, do the two PixiJS 8 renderer candidates provide it out of the box? What are the Cubism-version and feature caveats?
- **Scope**: external (renderer READMEs, npm, API docs)
- **Date**: 2026-07-07

> Companion to `live2d-presentation-analysis.md` (feature inventory + 连/造 verdicts). This file records the renderer-side evidence with URLs.

---

## Candidate A — `untitled-pixi-live2d-engine`

- Repo: https://github.com/Untitled-Story/untitled-pixi-live2d-engine
- README: https://github.com/Untitled-Story/untitled-pixi-live2d-engine/blob/master/README.md
- npm: https://npmx.dev/package/untitled-pixi-live2d-engine ("PixiJS v8 Live2D Engine | Supports Cubism 2–5 SDK | Lip-sync & Parallel Motion")
- Lineage: a major refactor of `pixi-live2d-display-mulmotion`, adapted for **PixiJS v8 + Cubism 5.4 SDK**. Related PixiJS-v7 sibling: https://github.com/Untitled-Story/pixi-live2d-display-advanced

**Advertised feature list (from README / npm):**
- **Cubism 2 / 3 / 4 / 5 model support** — via **separate bundle entries** (this is the decisive point for our mixed moc/moc3 asset set).
- Native PixiJS v8 rendering pipeline (Filter / RenderTexture / Render Pipe).
- **Texture LOD and automatic high-precision mask detection** (covers our AA/quality needs).
- **Mouse tracking** (= head/eye focus) and **hit area detection** (= named tap areas).
- **Real-time lip sync** (`model.speak` / lipsync lineage).
- Parallel motion playback + last-frame freeze; improved motion reservation/priority scheduling.
- PixiJS-style transforms (`position/scale/rotation/skew/anchor`); strict TypeScript types; configurable Cubism work-memory size.

**Requirements**: PixiJS 8.x; Cubism runtime `2.1` or `5`; browser with WebGL + ES6. Integrated via `extensions.add(Live2DPlugin)`.

**API shape** (README examples): `model.motion('group', index)`, `model.parallelMotion(...)`, `model.expression('id')`, lip sync via the `pixi-live2d-display-lipsync` lineage.

---

## Candidate B — `@naari3/pixi-live2d-display`

- Repo: https://github.com/naari3/pixi-live2d-display ("A PixiJS(v8) plugin to display Live2D **(Cubism v5)** models")
- npm: https://www.npmjs.com/package/@naari3/pixi-live2d-display (published 2025-11-24)
- Base project (upstream): https://github.com/guansss/pixi-live2d-display
- Related Cubism-5-only fork: https://github.com/omniwaifu/pixi-live2d5

**Advertised feature list:**
- **Supports Cubism 5 models** — the README feature list names **only Cubism 5**; ships `cubism5.*` and `extra.*` bundles.
- PIXI.RenderTexture / PIXI.Filter; Pixi-style transforms.
- **Automatic interactions: focusing (head tracking) + hit-testing** (inherited from guansss base).
- Enhanced motion reserving logic; loading from files/zip (experimental); fully typed.

**Requirements**: PixiJS 8.x; **Cubism core: 5**; WebGL + ES6.

**⚠️ Cubism 2 caveat (decisive)**: The naari3 fork's advertised scope is **Cubism 5 only**. The sibling Cubism-5 fork `omniwaifu/pixi-live2d5` states explicitly: *"Cubism 2 `.model.json` / `.moc` assets are **not supported** by this fork"* and *"Legacy cubism2 / cubism4 subpaths are not part of this fork."* naari3's README likewise does not list Cubism 2. This directly conflicts with TECH-STACK's **hard requirement** that the renderer must load Cubism 2 (`.model.json`/moc) AND Cubism 3+ (`.model3.json`/moc3), because the BanG Dream set (ModelScope `HELPMEEADICE/BanG-Dream-Live2D`) mixes both. TECH-STACK already flags "the naari3 fork ... its Cubism 2 path is unverified" — the external evidence trends toward **unsupported**, not merely unverified.

---

## Upstream base API (guansss/pixi-live2d-display) — the primitives both forks inherit

- Docs: https://guansss.github.io/pixi-live2d-display
- Interactions: https://guansss.github.io/pixi-live2d-display/interactions/ — "**Focusing**: character will look at the mouse pointer. **Tapping**: handles `pointertap`, emits a `hit` event when a defined hit area is tapped."
- Motions/Expressions: https://guansss.github.io/pixi-live2d-display/motions_expressions/ — **automatic idle motions** when nothing else is playing; expression API.
- API — `InternalModel`: https://guansss.github.io/pixi-live2d-display/api/classes/index.InternalModel.html — exposes `focusController`, `hitAreas`, `motionManager`, `hitTest(x,y)` → hit-area names, `isHit(area)`.

These confirm the **连** primitives referenced in the analysis doc: `model.focus(x,y)`, `model.on('hit', areas => ...)`, `model.motion(group,i)`, `model.expression(id)`, automatic idle + blink/breath from the Cubism runtime.

---

## Feature-by-feature renderer coverage

| BandoriPet feature | untitled-pixi-live2d-engine | @naari3 fork | Verdict |
|---|---|---|---|
| Cubism 2 (moc) load | **Yes** (separate bundle) | **No / unverified** (Cubism 5 only) | decisive for A |
| Cubism 3+ (moc3) load | Yes | Yes | both |
| Head/eye focus tracking | Yes (mouse tracking) | Yes (focusing) | 连 |
| Named hit-area tap events | Yes (hit area detection) | Yes (hit-testing) | 连 |
| Pixel-alpha hit-test | No (use PixiJS `extract`) | No | 造 |
| Motion play / priority / reserve | Yes (improved) | Yes (enhanced) | 连 |
| Parallel motions + last-frame freeze | Yes | No (not advertised) | A only |
| Expression play | Yes | Yes | 连 |
| Idle motion auto-loop | Yes (base behavior) | Yes | 连 |
| Real-time lip sync (amplitude) | Yes | Not advertised (base has lipsync lineage separately) | A: 连 |
| Text→viseme mouth-form | No | No | 造 |
| AA / mask quality (≈ their SSAA) | Yes (Texture LOD + hi-precision mask) | via PixiJS config | 连 |
| Region→preset click reactions | No (app logic) | No | 造 |
| Emotion inference | No (app logic) | No | 造 |
| Window transparency / click-through | No (Tauri/OS concern) | No | 造 (Tauri) |
| Multi-character | app composition (N models/canvases) | same | 造 |

---

## Recommendation input for the spike (not a decision — reversible, no ADR per TECH-STACK)

- **`untitled-pixi-live2d-engine` is the stronger default**: it is the only candidate with **documented Cubism 2 support**, satisfying TECH-STACK's hard mixed-format requirement, and it additionally bundles real-time lip sync + parallel motion + texture-LOD/mask quality — covering the most 连 features in one package.
- **`@naari3/pixi-live2d-display`** is a clean Cubism-5-only path; only viable if the spike proves it loads the BanG Dream moc (Cubism 2) assets — external evidence (sibling fork docs) suggests it will **not**. Keep it as the fallback for a Cubism-5-only future, not the primary.
- **Spike acceptance (from TECH-STACK)**: one moc + one moc3 model from `HELPMEEADICE/BanG-Dream-Live2D` rendering with motions/expressions. The Cubism-2 load is the make-or-break test; run it first against candidate A.

## Sources
- untitled-pixi-live2d-engine README: https://github.com/Untitled-Story/untitled-pixi-live2d-engine/blob/master/README.md
- untitled npm: https://npmx.dev/package/untitled-pixi-live2d-engine
- untitled v1.0.1 tree (2026-01-23): https://github.com/Untitled-Story/untitled-pixi-live2d-engine/tree/v1.0.1
- pixi-live2d-display-advanced (v7 sibling): https://github.com/Untitled-Story/pixi-live2d-display-advanced
- @naari3/pixi-live2d-display: https://github.com/naari3/pixi-live2d-display + https://www.npmjs.com/package/@naari3/pixi-live2d-display
- omniwaifu/pixi-live2d5 (Cubism-2-unsupported statement): https://github.com/omniwaifu/pixi-live2d5
- guansss base docs (focus/hit/idle primitives): https://guansss.github.io/pixi-live2d-display/interactions/ , https://guansss.github.io/pixi-live2d-display/motions_expressions/ , https://guansss.github.io/pixi-live2d-display/api/classes/index.InternalModel.html
