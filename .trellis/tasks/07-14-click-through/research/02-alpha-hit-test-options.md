# Research: The alpha-under-cursor test — options evaluated (topic 2)

- **Query**: how to test whether the pixel under the cursor is opaque (character) vs transparent (pass-through), on PixiJS 8 + Live2D.
- **Scope**: mixed (installed pixi/live2d types+dist, PixiJS docs)
- **Date**: 2026-07-14

## (a) Web-side alpha readback — PixiJS 8 `extract` — RECOMMENDED (with refinement)

Verified API, `pixi.js@8.19.0` `ExtractSystem.d.ts:576`:
```ts
pixels(options: ExtractOptions | Container | Texture): GetPixelsOutput; // SYNCHRONOUS
// GetPixelsOutput = { pixels: Uint8ClampedArray; width: number; height: number }  (RGBA, 0..255)
// ExtractOptions supports: target, frame?: Rectangle, resolution?, clearColor?, antialias?
```

**Per-call cost (verified in the installed dist `ExtractSystem.js:217`):**
```js
pixels(options) {
  ...
  const texture = target instanceof Texture ? target
      : renderer.textureGenerator.generateTexture(options);   // renders target into a NEW RenderTexture
  const pixelInfo = renderer.texture.getPixels(texture);       // gl.readPixels — GPU pipeline STALL
  if (target instanceof Container) texture.destroy(true);      // frees it again
  return pixelInfo;
}
```
So a `Container` target **allocates + renders + reads back + destroys** every call. The `frame` option narrows the *read region* but not the render cost. `gl.readPixels` (`GlTextureSystem.js:394`) is a synchronous GPU→CPU stall regardless of byte count. PixiJS docs: "Extraction operations are relatively expensive … one time per frame, but not more."

**Therefore: do NOT extract per cursor-poll.** Refined design:
- Keep a **persistent low-res `RenderTexture`** (e.g. model bbox at ¼ scale) created once.
- Inside the render loop, once per painted frame: `renderer.render({ container: model, target: maskRT })` then cache `renderer.texture.getPixels(maskRT).pixels` (a `Uint8ClampedArray`).
- The cursor poll maps global cursor → mask cell and reads `pixels[i*4 + 3]` (alpha). Compare against a threshold (BANDORI used alpha ≥ 8). This read is a plain array index — effectively free, and runs at poll rate independent of fps.

**Accuracy**: per-pixel (samples live rendered alpha). **Render-stall risk**: one small readback per painted frame — the governor already caps frames, so idle = fewer readbacks (see `04`). Note: `extract.pixels` in 8.19 is **sync only** (dist confirms; the async `readPixels` PR #9353 3-arg form is NOT in this version's public `pixels` signature), so the readback cannot be moved off the main thread here — another reason to do it once/frame, not per poll.

## (b) Live2D `model.hitTest` / bounds — coarse only, and named-areas FAIL for taki

Verified `untitled-pixi-live2d-engine` types:
- `hitTest(x, y): string[]` (index.d.ts:4577) — returns names of hit SDK/custom hit areas. **Returns `[]` for taki** (no defined hit areas — per task context). Cannot give per-pixel alpha. Unusable as the primary test.
- `containsPoint(point: Point): boolean` (index.d.ts:4591) — bounding-box test on the Pixi Container. **Useful as the cheap coarse first pass**: if the cursor is outside the model bbox it is definitely transparent → `ignore=true`, skip the mask read entirely. Only inside the bbox consult the alpha mask (a). This bounds the expensive path to the model rectangle.
- `toModelPosition(worldPoint)` (index.d.ts:4585) — maps world→model space if a mask indexed in model space is preferred.

## (c) CSS/DOM `document.elementFromPoint` — DOES NOT WORK, note why

The entire Live2D model renders into a **single `<canvas>`** element (`stage.ts` appends `app.canvas` as the only host child). `elementFromPoint`/`pointer-events` operate at DOM-element granularity, so the canvas is hit-testable as one opaque rectangle — DOM cannot see per-pixel canvas alpha. The `pointer-events:none / auto` CSS trick (from the Electron pattern in Tauri #6164) only works when interactive regions are *separate DOM elements*; it cannot cut out a canvas silhouette. Rejected.

## (d) Rust-side alpha (WebView2 CapturePreview) — works, heavier, wrong seam

Community Rust solution (Tauri #2090): `window.with_webview` → `ICoreWebView2.CapturePreview` → PNG bytes → decode → read alpha at cursor. Verified pattern exists and works, but per-frame it PNG-encodes+decodes the whole window (the author calls it "synchronous, resource-intensive", runs capture at 100 ms and toggle at 16 ms on separate threads). It also duplicates alpha that the renderer already holds and pushes rendering knowledge into Rust — against invariant #1 (keep agent/OS seams thin) and the "renderer owns pixels" split. Keep only as a fallback if (a)'s per-frame readback proves too costly.

## Recommendation

**(a) cached low-res alpha mask, gated by (b) `containsPoint` bbox.** Per-pixel accurate, tracks animation for free, keeps alpha in the webview, and bounds cost to one small readback per painted frame plus a free array read per poll. `hitTest` is dead for taki; DOM can't see canvas alpha; Rust capture is heavier and mis-seams.
