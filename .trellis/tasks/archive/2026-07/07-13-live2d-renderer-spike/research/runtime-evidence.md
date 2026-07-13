# Runtime Evidence — Live2D Renderer Spike (#13)

- **Task**: `.trellis/tasks/07-13-live2d-renderer-spike`
- **Date**: 2026-07-13
- **Page probed**: http://localhost:1420/spike.html (dev server already running; not started/stopped by me)
- **Screenshot**: `.trellis/tasks/07-13-live2d-renderer-spike/research/spike-screenshot.png`

## How this evidence was captured (important caveat)

No chrome-devtools MCP tools were available in this agent's toolset, and neither
Playwright nor Puppeteer is installed. Evidence was instead collected by driving
**headless Microsoft Edge** (`msedge.exe`, Edge Chromium — the same engine as the
production Tauri **WebView2** target) over the Chrome DevTools Protocol via Node 24's
built-in `WebSocket`. Driver script: `research/cdp-driver.mjs` (scratch tool, spike-only).

Flags of note: `--headless=new --use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader`. WebGL therefore ran on **SwiftShader software
rasterization**, not the machine's GPU. This is a faithful-but-not-identical proxy for
the real WebView2 window: same browser engine and same JS/WebGL code paths, but GPU
rendering and true WebView2 idle behavior are NOT exercised here. Visual correctness and
GPU/CPU idle numbers still need the manual in-WebView2 check queued in the PRD.

## `window.__spikeStatus` (verbatim, final)

Polled `JSON.stringify(window.__spikeStatus)` every 2s; it settled almost immediately
(`finishedAt` set ~1.5s after `startedAt`). Final value:

```json
{
  "startedAt": "2026-07-13T13:28:46.060Z",
  "finishedAt": "2026-07-13T13:28:47.532Z",
  "engineVersion": "1.3.1",
  "pixiVersion": "8.19.0",
  "runtimeGlobals": {
    "cubismCore": true,
    "cubismLegacy": true
  },
  "models": [
    {
      "label": "cubism2:arbeit (moc)",
      "source": "/spike-assets/arbeit/model.json",
      "generation": "legacy",
      "loaded": { "ok": true, "detail": "legacy model loaded; canvas 2000x2500" },
      "motion": { "ok": true, "detail": "motion('ando01', 0) -> true (43 groups)" },
      "expression": { "ok": true, "detail": "expression(0) -> true (30 expressions)" },
      "hitTest": { "ok": true, "detail": "hitTest(center) -> [] (empty = no SDK hit areas defined)" },
      "paramRoundTrip": { "ok": true, "detail": "legacy PARAM_ANGLE_X: wrote 15, read 15.000" },
      "lipSyncApi": { "ok": true, "detail": "model.speak is function" },
      "manifestHitAreas": { "ok": true, "detail": "no standard SDK hit areas parsed from manifest" },
      "framing": { "ok": true, "detail": "original 2000x2500, layout 2000x2500 (layout-scale 1.000)" }
    },
    {
      "label": "cubism4:live_01 (moc3)",
      "source": "/spike-assets/live_01/adv_live2d_taki_005_live_01.model3.json",
      "generation": "modern",
      "loaded": { "ok": true, "detail": "modern model loaded; canvas 6000x9000" },
      "motion": { "ok": true, "detail": "motion('mtn_angry01_C', 0) -> true (63 groups)" },
      "expression": { "ok": true, "detail": "expression(0) -> true (33 expressions)" },
      "hitTest": { "ok": true, "detail": "hitTest(center) -> [] (empty = no SDK hit areas defined)" },
      "paramRoundTrip": { "ok": true, "detail": "modern ParamAngleX: wrote 15, read 15.000" },
      "lipSyncApi": { "ok": true, "detail": "model.speak is function" },
      "manifestHitAreas": { "ok": true, "detail": "no standard SDK hit areas parsed from manifest" },
      "framing": { "ok": true, "detail": "original 6000x9000, layout 6000x9000 (layout-scale 1.000)" }
    }
  ],
  "decision": "LOCK untitled-pixi-live2d-engine — both moc and moc3 render (motion + expression verified)",
  "fatalError": null
}
```

`fatalError` is `null`; every per-model `ProbeCheck` reports `ok: true`.

## Console messages (verbatim capture)

```
[log] Live2D %s 2.1.00_1
[log] profile : Desktop
[log]   [PROFILE_NAME] = Desktop
[log]   [USE_ADJUST_TRANSLATION] = false
[log]   [USE_CACHED_POLYGON_IMAGE] = false
[log]   [EXPAND_W] = 2
[debug] [vite] connecting...
[debug] [vite] connected.
[log:error] network: Failed to load resource: the server responded with a status of 404 (Not Found)
[warning] [Live2DModel(uninitialized)] options.autoInteract is deprecated since v0.5.0, use autoHitTest and autoFocus instead.
[warning] [Live2DModel(uninitialized)] options.autoInteract is deprecated since v0.5.0, use autoHitTest and autoFocus instead.
[log] [CSM][I]Live2D Cubism Core version: 05.01.0000 (83951616)
[log] [CSM][I]CubismFramework.startUp() is complete.
[log] [CSM][I]CubismFramework.initialize() is complete.
[log] Live2D Cubism SDK Core Version 5.1.0
```

Notes on the console output:
- **Cubism Core runtime is version 05.01.0000 / SDK 5.1.0** — the moc3 assets load and
  run under a Cubism **5** runtime. No Cubism-version incompatibility surfaced.
- The **legacy** Cubism 2.1 runtime (`Live2DModelWebGL`, "Live2D 2.1.00_1") also
  initialized; both runtime globals present (`cubismCore: true`, `cubismLegacy: true`).
- One **404** for a resource (`Failed to load resource: 404`). No URL was exposed in the
  log entry; it did not set `fatalError` and did not block either model (both `loaded.ok`).
  Most likely `favicon.ico` (spike.html declares none). Flagged as a minor caveat — not
  confirmed to be favicon.
- Two `autoInteract deprecated` warnings (one per model) — benign API-deprecation notices
  from the engine wrapper, not errors.
- No WebGL context-creation errors, no shader/link errors, no Cubism runtime errors.

## Visual verdict (I looked at the screenshot)

**Two fully-rendered anime characters, both drawing correctly — not blank, not garbled.**

- Left canvas = `cubism2:arbeit` (moc, legacy): a girl with long dark hair, arms crossed,
  wearing a dark short-sleeve polo (a "TKG" chest logo is visible) and dark jeans. Clean
  edges, correct textures, correct alpha.
- Center/right canvas = `cubism4:live_01` (moc3, modern): a girl with long dark hair in a
  blue-and-white dress with a yellow front panel and a belt, one hand on her hip. Also
  clean and fully textured.

The on-page text readout (right side of the screenshot) independently shows every probe
line as `PASS` and a final `DECISION: LOCK untitled-pixi-live2d-engine`, matching the JSON.

## Idle repaint note

Counted `requestAnimationFrame` ticks over a 1000ms window after probes settled:
`frames_in_1s = 10`. The page **does keep repainting** (render loop is live, not one-shot),
but ~10 fps is a headless/SwiftShader-throttled figure and is NOT a valid idle-GPU/CPU
measurement for the real WebView2 window. Treat it only as "the loop runs continuously";
real idle-cost numbers still require the manual in-WebView2 check.

## One-line summary

`decision` = **"LOCK untitled-pixi-live2d-engine — both moc and moc3 render (motion +
expression verified)"** — primary engine passes the whole decision tree; no fallback needed.
