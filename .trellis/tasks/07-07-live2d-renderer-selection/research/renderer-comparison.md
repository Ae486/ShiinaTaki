# Research: Live2D Web Renderer Selection — Desktop (Tauri 2 / WebView2) + Mobile (Capacitor / Android System WebView)

- **Query**: Decision-grade comparison of Live2D web rendering options for TakiAgent's Pet UI (PixiJS 8 + React 19 + Vite 8, Tauri 2 desktop now / Capacitor Android later), given the hard requirement to render Cubism 2 (`.model.json`/moc) AND Cubism 3+ (`.model3.json`/moc3) from the BanG Dream set, plus TTS lip-sync (v2), LLM-driven expressions/motions, click hit-areas, and low idle cost.
- **Scope**: external (renderer repos, npm, official Live2D docs, adoption evidence) + builds on prior internal research.
- **Date**: 2026-07-07
- **Builds on** (do not re-read unless needed): `../../../archive/2026-07/07-07-reference-research/research/web-stack-live2d-coverage.md` (Cubism-2 caveat for naari3), `live2d-presentation-analysis.md` (连/造 feature inventory, LuaJIT-core irrelevance).

---

## TL;DR — the central finding

**No single library spans Cubism 2 → 5. Each option drops one end of the range except `untitled-pixi-live2d-engine`.**

| Coverage band | Libraries | Misses |
|---|---|---|
| Cubism **2.1 + 3 + 4** (no 5) | guansss original, RaSan147 lipsyncpatch, pixi-live2d-display-advanced | Cubism 5-authored moc3 |
| Cubism **3 + 4 + 5** (no 2) | @naari3, official Cubism 5 Web SDK | Cubism 2 `.model.json`/moc — **violates hard requirement** |
| Cubism **2 → 5** (full) | **untitled-pixi-live2d-engine** | — (newest / least battle-tested) |

The BanG Dream requirement mixes moc (Cubism 2) and moc3 (Cubism 3+). This makes the choice a two-way race between **(A) untitled-pixi-live2d-engine** (full range, one lib, PixiJS 8) and **(C) RaSan147 lipsyncpatch** (proven 2.1+4, but PixiJS 7 and no Cubism 5). Everything else either fails the Cubism-2 requirement or is stale.

---

## The lineage (matters for adoption + bus-factor)

All Pixi-based candidates are one family tree, which materially de-risks the "solo fork" worry:

```
guansss/pixi-live2d-display  (PixiJS 6, Cubism 2/3/4, ~1380★, npm 10–25K wk dl, LAST PUBLISH 2022-09 — stale)
   └─ RaSan147/pixi-live2d-display  a.k.a. pixi-live2d-display-lipsyncpatch  (PixiJS 7, +model.speak lip-sync)
        └─ ...-mulmotion  (PixiJS 7, +parallel motion)
             └─ Untitled-Story/pixi-live2d-display-advanced  (PixiJS 7, 20★, 7 contributors incl. guansss + RaSan147 + K-bai; v2.0.0-beta.2)
                  └─ Untitled-Story/untitled-pixi-live2d-engine  (PixiJS 8, Cubism 2–5, v1.2.2) ← the v8 head of the same lineage
```

So `untitled-pixi-live2d-engine` is **not a random solo fork** — it is the current PixiJS-v8 continuation of the main community lineage, and the sibling `-advanced` repo lists the original author `guansss` and lip-sync author `RaSan147` among 7 contributors. Adoption in absolute terms is still small (advanced: 20★; untitled: new, low stars), but the maintainer base is the same pool that produced the widely-used lip-sync fork.

Sources: https://github.com/guansss/pixi-live2d-display · https://socket.dev/npm/package/pixi-live2d-display (10K–25K weekly dl, "last updated 04 Sep 2022") · https://www.repoportal.com/en/guansss-pixi-live2d-display (1380★) · https://github.com/Untitled-Story/pixi-live2d-display-advanced (20★, 7 contributors, created 2025-06, last push 2026-01-23) · https://github.com/Untitled-Story/untitled-pixi-live2d-engine (v1.2.2)

---

## Candidates

### A. `untitled-pixi-live2d-engine` (PixiJS 8, Cubism 2–5)

- Repo: https://github.com/Untitled-Story/untitled-pixi-live2d-engine · npm/CDN: https://www.jsdelivr.com/package/npm/untitled-pixi-live2d-engine (v1.2.2, MIT)
- **Coverage**: Cubism 2 / 3 / 4 / 5 via separate bundle entries (only candidate covering the full moc→moc3(5) range). Refactor of `-mulmotion`, PixiJS v8 + Cubism 5.4 SDK.
- **Features**: native PixiJS v8 render pipe (Filter/RenderTexture/Render Pipe), texture LOD + high-precision mask detection, mouse/focus tracking, hit-area detection, real-time lip-sync (`model.speak` lineage), parallel motion + last-frame freeze, strict TS types, configurable Cubism work-memory.
- **Stack fit**: purpose-built for PixiJS 8 → aligns with TECH-STACK's `Renderer: PixiJS v8`. ESM, TS strict, Vite-friendly.
- **Mobile**: inherits PixiJS 8 WebGL2/WebGPU. Texture-LOD/quality knobs are directly useful for BanG Dream's large atlases under Android WebView memory pressure.
- **Risk (honest)**: newest, least battle-tested; smallest star count; docs thinner than upstream. Bus-factor mitigated by shared lineage but still effectively a small team. If it dies, migration path is "down-lineage" to `-advanced` (v7) or the lipsyncpatch fork — same API surface, so migration cost is **low-moderate**. Cubism-2 support is documented but **must be spike-verified** against an actual BanG Dream moc (TECH-STACK already scopes this spike).

### B. `@naari3/pixi-live2d-display` (PixiJS 8, Cubism 5 only)

- Repo: https://github.com/naari3/pixi-live2d-display · npm published 2025-11-24.
- **Coverage**: Cubism 5 (README lists only Cubism 5; ships `cubism5.*` bundles). Sibling `omniwaifu/pixi-live2d5` states Cubism 2 `.model.json`/moc **not supported**. **Fails the hard Cubism-2 requirement** (confirmed by prior research `web-stack-live2d-coverage.md`).
- **Stack fit**: clean PixiJS 8, but wrong coverage band.
- **Risk**: viable only for a hypothetical Cubism-5-only future. Not a primary candidate.

### C. `pixi-live2d-display-lipsyncpatch` / RaSan147 fork (PixiJS 7, Cubism 2.1 + 4)

- Repo: https://github.com/RaSan147/pixi-live2d-display · npm: https://www.npmjs.com/package/pixi-live2d-display-lipsyncpatch (published 2024-08-14) · origin issue: https://github.com/guansss/pixi-live2d-display/issues/102
- **Coverage**: "all versions" via Cubism 2.1 (`cubism2.js` + `live2d.min.js`) + Cubism 4 (`cubism4.js` + `live2dcubismcore.min.js`). Cubism 4 is backward-compatible with Cubism 3. **No Cubism 5.**
- **Lip-sync (the reason it exists)**: `model.speak(audioUrl, { volume, expression, resetExpression, crossOrigin, onFinish, onError })` + `model.stopSpeaking()`; also `model.internalModel.motionManager.attachAnalyzer()` for mic/realtime. Issue #102 confirms it works on **both Cubism 2 and Cubism 4** models. This is the most complete, ready-made lip-sync of any candidate — directly maps to TakiAgent's v2 TTS lip-sync.
- **Adoption (strongest of the field)**: used by **Open-LLM-VTuber** (before v1.2.0) and **LLM-Live2D-Desktop-Assistant** — the reference AI-vtuber/desktop-pet ecosystem. This is the de-facto battle-tested choice in exactly TakiAgent's domain.
- **Stack fit problem**: **PixiJS 7.x**. TECH-STACK commits to PixiJS v8. Adopting C means pinning Pixi to 7 (no WebGPU path, older per-frame cost) OR waiting on the lineage's v8 head (= candidate A). Cubism 2.1 requires `live2d.min.js`, only from the unofficial `dylanNew/live2d` mirror (supply-chain note; vendor it, don't hotlink).
- **Risk**: mature and proven, but **frozen on PixiJS 7** and **no Cubism 5**. If the BanG Dream moc3 set includes any Cubism-5-authored models, C cannot render them.

### D. `guansss/pixi-live2d-display` — original baseline (PixiJS 6, Cubism 2/3/4)

- Repo: https://github.com/guansss/pixi-live2d-display · docs: https://guansss.github.io/pixi-live2d-display/
- **Coverage**: Cubism 2.1 + 3 + 4; **no 5**. The battle-tested primitive source (focus, hitTest, motion/expression APIs) that every fork inherits.
- **Status**: **effectively unmaintained** — last npm publish v0.4.0 on 2022-09-04, still PixiJS 6. Open-LLM-VTuber's own migration issue #145 calls it "no longer maintained ... only compatible with Live2D models lower than 4" as the reason to leave it.
- **Verdict**: reference for the API surface only; not a live candidate (stale + PixiJS 6 + no lip-sync + no Cubism 5).

### E. Official Live2D Cubism SDK for Web (Framework + Core, no Pixi) — hand-rolled

- Repos: https://github.com/Live2D/CubismWebFramework · https://github.com/Live2D/CubismWebSamples · Vite tutorial: https://docs.live2d.com/en/cubism-sdk-tutorials/use-sdk-in-js/ · direct-use guide: https://docs.live2d.com/en/cubism-sdk-manual/use-framework-web/
- **Coverage**: Cubism 5 SDK Framework renders moc3 (Cubism 3/4/5). **Cubism 2.1 is a separate legacy SDK** (`live2d.min.js`) — the official modern SDK does **not** load moc. So official-SDK-only = **no Cubism 2** (same gap as B).
- **"No third-party risk" appeal**: first-party, guaranteed to track Cubism format changes, official Vite/TS support. This is the path Open-LLM-VTuber chose in v1.2.0 — and in doing so **explicitly dropped Cubism 2** ("adds support for Cubism 5 but removes support for Cubism 2"). Confirms official SDK ≠ Cubism 2.
- **Integration cost (high)**: no PixiJS integration. You hand-roll the WebGL renderer wiring (`CubismRenderer_WebGL`, matrix/projection, texture bind, motion manager, hit-test, focus) — everything PixiJS forks give for free. To keep PixiJS 8 for the rest of the Pet UI you'd either run the Cubism renderer on a **separate GL context/canvas** (compositing/click-through complexity) or write a PixiJS render-pipe adapter yourself (essentially re-building what candidate A already is). To also support Cubism 2 you'd bolt on the legacy SDK as a second runtime. **Highest engineering cost, and still needs a Cubism-2 side-path.**
- **Risk**: lowest dependency risk, highest build/maintenance cost, and does not by itself satisfy the Cubism-2 requirement.

---

## Per-angle comparison

### 认可度 / Adoption & bus-factor

| | A untitled | B naari3 | C lipsyncpatch | D guansss | E official SDK |
|---|---|---|---|---|---|
| GitHub stars | low (new) | low (new) | moderate (fork) | ~1380 (stale) | first-party |
| npm weekly dl | low | low | moderate | 10–25K (legacy) | n/a (vendored) |
| Real AI-vtuber/pet use | via lineage | none seen | **Open-LLM-VTuber, LLM-Live2D-Desktop-Assistant** | historical base | Open-LLM-VTuber v1.2+ |
| Maintainer base | shared lineage (7 contrib on sibling) | solo | RaSan147 + lineage | dormant | Live2D Inc. |
| Score | ◐ | ○ | ● (domain-proven) | ◐ (dead) | ● (vendor) |

Note: C has the clearest track record **in TakiAgent's exact domain**; A rides the same lineage but is newer; E is first-party but its ecosystem adoption (OLV) came at the cost of Cubism 2.

### 性能 / Performance & idle cost

- **PixiJS 8 (A, B)** is materially faster than v7 (official benchmark: 100k moving sprites ~50ms→~15ms CPU) and has a **reactive render loop that skips work when nothing changes** — a strong fit for a low-idle-cost desktop pet + frame governor. WebGL2 default, optional WebGPU. Source: https://pixijs.com/blog/pixi-v8-launches , v8 migration guide https://pixijs.com/8.x/guides/migrations/v8
- Caveat: a Live2D model always animates (breath/blink), so the "skip when static" win is partial; the real idle lever is **throttling the shared Ticker** when the window is unfocused/occluded (all Pixi forks accept an injected `Ticker`).
- **PixiJS 7 (C)** — solid but older; no WebGPU, higher per-frame CPU. **PixiJS 6 (D)** — oldest, effectively EOL for our purposes.
- **Texture memory** (BanG Dream large atlases): A exposes texture-LOD/quality + high-precision mask controls out of the box; PixiJS 8 texture-source model (upfront-loaded, no BaseTexture) gives predictable memory. E gives full manual control (double-edged). This is the most mobile-relevant perf axis.
- Score: A/B ● (v8), C ◐ (v7), D ○ (v6), E ◐ (manual — as good as you build it).

### 技术栈适配 / PixiJS 8 + Vite 8 + TS strict

- **A, B**: native PixiJS 8, strict TS types advertised, ESM, single-package v8 imports → cleanest fit with TECH-STACK's declared `PixiJS v8`. Only friction: PixiJS 8 renderer init is **async** (`await`), and the Cubism core is registered via `extensions.add(...)` — both trivial.
- **C**: PixiJS 7 — conflicts with the v8 decision; forces pinning Pixi to 7 for the whole Pet UI.
- **Cubism Core loading (all candidates, both WebViews)**: the runtimes are **plain JS globals** — `live2dcubismcore.min.js` (exposes `Live2DCubismCore`, Cubism 3/4/5) and `live2d.min.js` (Cubism 2.1). They are loaded via `<script>` or side-effect import, **not a separate `.wasm` fetch/instantiate**, so there is **no WASM-in-WebView instantiation gotcha** — they execute as ordinary JS in any Chromium WebView (WebView2 and Android System WebView) and in WKWebView. `live2dcubismcore.min.js` is user-supplied per license (TECH-STACK: "never bundled"); `live2d.min.js` (Cubism 2.1) is only on the unofficial `dylanNew/live2d` mirror — **vendor it locally, do not hotlink the CDN** (README itself warns the direct link is unreliable).
- Score: A/B ●, C ◐, D ○, E ● (official Vite/TS guide) but with high wiring cost.

### 可扩展性 / Extensibility (lip-sync, LLM-driven params, hit-areas, multi-instance)

- **Lip-sync**: C has the most complete ready-made path (`model.speak` with volume/expression/callbacks + `attachAnalyzer`); A inherits the same `model.speak` lineage; B/D/E require hand-wiring amplitude→`ParamMouthOpenY`. For amplitude→mouth, all can be driven; for text→viseme mouth-form shaping it's app logic in every case (prior research: 造/medium).
- **LLM-driven expressions/motions**: `model.expression(id)` / `model.motion(group, idx, priority)` across all Pixi forks; motion/expression **names extracted from the manifest** (`.model.json` motions map, `.model3.json` Groups/Expressions) — this is manifest parsing (app-side), independent of renderer. E exposes the same via `ICubismModelSetting`.
- **Raw parameter access (BandoriPet constraint — head tracking needs `ParamAngleX/Y`, `ParamBodyAngleX`, `ParamEyeBallX/Y`; lip-sync viseme needs `ParamMouthOpenY`/`ParamMouthForm`)**: the Pixi lineage exposes `model.internalModel.coreModel` → `setParameterValueById` (Cubism 4) / the Cubism 2 core model, so raw per-parameter control is available in **A, C, D**. E exposes it first-party (`CubismModel.setParameterValueById`). **B** shares the lineage so also exposes it (Cubism 5). This satisfies the "renderer must expose raw parameter access" constraint for A, C, E (verify per Cubism version in the spike).
- **Hit-areas**: `model.hitTest(x,y)` → area names + `model.on('hit', areas=>...)` in all Pixi forks (inherited from D); E requires reading `HitAreas` from the setting and testing yourself.
- **Multi-model instances**: N models on one stage or N canvases — app composition in all; TakiAgent already bus-architects this (prior research).
- Score: C ● (lip-sync ready), A ● (same APIs, v8), E ◐ (all possible, all manual), B/D ◐.

### 移动端 / Android System WebView (Capacitor) viability

- **WebGL2 in Android System WebView is "Widely available" (Baseline)** — Android WebView is Chromium, sharing Chrome for Android's engine. Sources: https://caniwebview.com/features/web-feature-webgl2/ , https://developer.chrome.com/docs/webview . So any of these libraries *can* run on Android WebView in principle.
- **Real-world Capacitor/WebView pitfalls to design around** (not library-specific, but they shape the choice toward PixiJS 8 + texture controls):
  - WebGL context/texture-mailbox errors when wrapping WebGL apps in Capacitor Android: https://github.com/ionic-team/capacitor/issues/4892 (root cause = WebView/driver, not Capacitor).
  - Device-specific driver flicker (Samsung S21 / Pixel 6) on PixiJS — workaround historically `CAN_UPLOAD_SAME_BUFFER=false`; PixiJS 8's reworked batcher changes this surface: https://github.com/pixijs/pixijs/discussions/8038
  - Large texture atlases (2048–4096) failing to load / OOM + relative-path issues on Capacitor Android: https://phaser.discourse.group/t/.../15571 and the Capgo animation-perf guide https://capgo.app/blog/ultimate-guide-to-animation-performance-in-capacitor-apps/ . **Directly relevant to BanG Dream's large atlases** → favors A's texture-LOD/quality knobs and testing on low-end devices.
  - WebGPU in Android WebView is not yet reliably available → **plan on WebGL2 as the mobile path** (PixiJS 8 auto-falls back to WebGL2; do not depend on WebGPU for mobile).
- No candidate has published evidence of being run *specifically inside a Capacitor Android build*; the closest proof is that the whole class (PixiJS + Live2D + Chromium WebView) is used in desktop Electron/Tauri-style pets today. **Mobile viability must be spike-verified** with a real device build; there is no library that de-risks this for you.
- Score: A/B ● (PixiJS 8, texture controls), C/D ◐ (older Pixi, still Chromium), E ◐ (manual GL, full control but you own every quirk).

### BandoriPet relevance (constraints on renderer choice)

- Prior research confirmed: the reference's **LuaJIT Cubism 2 core is a Python-only speed hack (eliminates Python↔C GIL tax); irrelevant to a WebGL/WASM stack — do NOT port or emulate it.**
- Presentation-layer constraints it *does* impose on the renderer: (1) **raw parameter get/set by ID** for head tracking (`Drag`→`ParamAngleX/Y`, `ParamBodyAngleX`, `ParamEyeBallX/Y`) and lip-sync (`ParamMouthOpenY`/`ParamMouthForm`) — satisfied by A/C/D/E (and B) via `internalModel.coreModel`/`setParameterValueById`; (2) **both moc and moc3 in one app** — the whole reason A leads; (3) named + pixel-alpha hit-test — named is 连 in all Pixi forks, pixel-alpha is app-side via PixiJS `extract` (prior research). Nothing in BandoriPet argues against A.

---

## Risk table

| Candidate | Maintenance risk | Cubism 2 status | Cubism 5 | Migration-if-it-dies |
|---|---|---|---|---|
| A untitled | Moderate (new, small team, shared lineage) | **Documented — spike-verify** | Yes | Low–mod → drop to `-advanced`/lipsyncpatch (same API) |
| B naari3 | Moderate (solo) | **No** (fails req) | Yes | n/a (wrong band) |
| C lipsyncpatch | Low (proven, but v7-frozen) | **Yes (proven, incl. lip-sync)** | **No** | Low → up-lineage to A |
| D guansss | High (unmaintained since 2022) | Yes | No | n/a (dead) |
| E official SDK | Lowest (first-party) | **No** by itself (needs legacy SDK bolt-on) | Yes | n/a (you own it) |

---

## Recommendation (input to decision — reversible, spike-gated, no ADR per TECH-STACK)

1. **Primary: A — `untitled-pixi-live2d-engine`.** It is the **only** candidate that satisfies the hard Cubism 2→5 requirement in a single library, is native PixiJS 8 (matches the stack), and bundles lip-sync + parallel motion + texture-LOD. Ratifies TECH-STACK's existing pick. **Make-or-break spike (run first): load one BanG Dream moc (Cubism 2) + one moc3 model with motions/expressions in a WebView2 build.**
2. **Runner-up / fallback: C — `pixi-live2d-display-lipsyncpatch`.** The domain-battle-tested choice (Open-LLM-VTuber, LLM-Live2D-Desktop-Assistant) with the most complete ready-made lip-sync and proven Cubism 2.1+4. Fall back to it if A's Cubism-2 path fails the spike or A proves unstable — at the cost of pinning to **PixiJS 7** and losing **Cubism 5** support.
3. **Do not use** B or E as primary: both drop Cubism 2 (E confirmed by Open-LLM-VTuber v1.2.0's explicit "removes support for Cubism 2"). D is dead. E remains the emergency "no-third-party" escape hatch if the whole Pixi lineage is judged too risky — accept the high hand-rolled-WebGL integration cost **and** a separate legacy runtime for Cubism 2.

**Open question for the spike to resolve:** do any BanG Dream moc3 assets require a Cubism **5** runtime specifically (vs 3/4)? If NO, C fully covers the set and its maturity may outweigh A's newness. If YES, only A covers the full set — decisive for A.

---

## Sources (all claims)

- untitled-pixi-live2d-engine: https://github.com/Untitled-Story/untitled-pixi-live2d-engine · https://www.jsdelivr.com/package/npm/untitled-pixi-live2d-engine
- pixi-live2d-display-advanced (lineage/contributors/stars): https://github.com/Untitled-Story/pixi-live2d-display-advanced
- RaSan147 lipsyncpatch (API, Cubism 2.1+4, model.speak): https://github.com/RaSan147/pixi-live2d-display · https://www.npmjs.com/package/pixi-live2d-display-lipsyncpatch · https://github.com/guansss/pixi-live2d-display/issues/102 · Sekai-World mulmotion attachAnalyzer: https://github.com/Sekai-World/pixi-live2d-display
- guansss original (stars/dl/stale): https://github.com/guansss/pixi-live2d-display · https://socket.dev/npm/package/pixi-live2d-display · https://www.repoportal.com/en/guansss-pixi-live2d-display
- @naari3 (Cubism 5 only) + Cubism-2 caveat: https://github.com/naari3/pixi-live2d-display · https://github.com/omniwaifu/pixi-live2d5 (via prior research)
- Open-LLM-VTuber adoption + migration (dropped Cubism 2): https://open-llm-vtuber.github.io/en/docs/user-guide/live2d/ · https://open-llm-vtuber.github.io/en/blog/v1.2.0-release/ · https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/releases/tag/1.2.0 · https://github.com/Open-LLM-VTuber/Open-LLM-VTuber/issues/145
- Official Cubism SDK for Web: https://github.com/Live2D/CubismWebFramework · https://github.com/Live2D/CubismWebSamples · https://docs.live2d.com/en/cubism-sdk-tutorials/use-sdk-in-js/ · https://docs.live2d.com/en/cubism-sdk-manual/use-framework-web/ · https://docs.live2d.com/en/cubism-sdk-manual/model-web/
- PixiJS 8 (perf, WebGPU/WebGL2, async init, reactive loop): https://pixijs.com/blog/pixi-v8-launches · https://pixijs.com/8.x/guides/migrations/v8
- Android WebView WebGL2 (Baseline / Chromium): https://caniwebview.com/features/web-feature-webgl2/ · https://developer.chrome.com/docs/webview
- Capacitor/Android WebGL pitfalls: https://github.com/ionic-team/capacitor/issues/4892 · https://github.com/pixijs/pixijs/discussions/8038 · https://phaser.discourse.group/t/phaser-3-capacitor-android-apk-white-screens-texture-rendering-failures-and-orientation-issues/15571 · https://capgo.app/blog/ultimate-guide-to-animation-performance-in-capacitor-apps/
</content>
</invoke>
