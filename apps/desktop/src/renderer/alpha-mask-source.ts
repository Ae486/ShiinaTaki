/**
 * INPUT:  a PixiJS renderer + the Container to snapshot (the scene stage) + the logical canvas size.
 * OUTPUT: an AlphaMaskSource — refresh() renders the container into a persistent low-res RenderTexture and caches
 *         its alpha readback; sampleAlpha/isOpaque read the cached bitmap (a plain array index, ~free per call).
 * POS:    ui/renderer — framework-free (ZERO React imports). The Pixi half of the click-through mask; refresh is
 *         driven by the governed ticker in pet-scene.ts so it rides the frame governor, never a separate loop.
 */

import { RenderTexture } from "pixi.js";
import type { Container, Renderer } from "pixi.js";
import { isOpaqueAt, sampleAlphaAt, type AlphaBitmap, type LogicalSize } from "./alpha-mask.ts";

// 1/4 logical resolution: enough silhouette fidelity for cursor hit-testing at ~1/16 the readback bytes of full-res.
const MASK_RESOLUTION = 0.25;

export type AlphaMaskSource = {
  refresh: () => void;
  sampleAlpha: (x: number, y: number) => number;
  isOpaque: (x: number, y: number) => boolean;
  dispose: () => void;
};

export function createAlphaMaskSource(renderer: Renderer, source: Container, logical: LogicalSize): AlphaMaskSource {
  const size: LogicalSize = {
    width: Math.max(1, Math.round(logical.width)),
    height: Math.max(1, Math.round(logical.height)),
  };
  const texture = RenderTexture.create({ width: size.width, height: size.height, resolution: MASK_RESOLUTION });
  // Empty until the first refresh so a sample before the first painted frame reads as pass-through, not undefined.
  let bitmap: AlphaBitmap = { pixels: new Uint8ClampedArray(0), width: 0, height: 0 };

  return {
    refresh: () => {
      renderer.render({ container: source, target: texture });
      // The texture IS a Texture, so extract.pixels skips generate/destroy and goes straight to one readback.
      const out = renderer.extract.pixels(texture);
      bitmap = { pixels: out.pixels, width: out.width, height: out.height };
    },
    sampleAlpha: (x, y) => sampleAlphaAt(bitmap, size, { x, y }),
    isOpaque: (x, y) => isOpaqueAt(bitmap, size, { x, y }),
    dispose: () => texture.destroy(true),
  };
}
