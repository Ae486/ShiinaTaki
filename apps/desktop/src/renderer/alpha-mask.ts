/**
 * INPUT:  a cached RGBA alpha bitmap (one per-frame mask readback) + the logical canvas size it covers.
 * OUTPUT: pure alpha lookups — sampleAlphaAt maps a logical-canvas point to a mask cell and returns its alpha byte;
 *         isOpaqueAt applies the opacity threshold. Out-of-bounds / missing mask reads as fully transparent.
 * POS:    ui/renderer — framework-free (ZERO React/Pixi imports). The pure, unit-tested half of the click-through
 *         mask; the Pixi RenderTexture owner that produces the bitmap lives in alpha-mask-source.ts.
 */

// BANDORI reference: alpha >= 8/255 counts as the character's opaque body; anti-aliased edges below it read as
// pass-through. Tunable if edge haloing proves too grabby in manual testing.
export const OPAQUE_ALPHA_THRESHOLD = 8;

/** One frame's readback: a tightly-packed RGBA buffer of `width` x `height` cells, top-left origin. */
export type AlphaBitmap = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

/** The logical (CSS px) canvas rectangle the bitmap covers, so a window-local point maps to a mask cell. */
export type LogicalSize = { width: number; height: number };

/** A point in logical canvas px (top-left origin). */
export type LocalPoint = { x: number; y: number };

/**
 * Alpha byte (0..255) under a point given in logical canvas px (top-left origin). Returns 0 when the point or the
 * bitmap is out of bounds — a missing mask is treated as fully transparent (pass-through), never a throw.
 */
export function sampleAlphaAt(bitmap: AlphaBitmap, logical: LogicalSize, point: LocalPoint): number {
  const { pixels, width, height } = bitmap;
  const { x, y } = point;
  if (width <= 0 || height <= 0 || logical.width <= 0 || logical.height <= 0) return 0;
  if (x < 0 || y < 0 || x >= logical.width || y >= logical.height) return 0;
  const cx = Math.min(width - 1, Math.floor((x / logical.width) * width));
  const cy = Math.min(height - 1, Math.floor((y / logical.height) * height));
  return pixels[(cy * width + cx) * 4 + 3] ?? 0;
}

/** Whether the character's opaque body is under the point (alpha >= threshold). */
export function isOpaqueAt(bitmap: AlphaBitmap, logical: LogicalSize, point: LocalPoint): boolean {
  return sampleAlphaAt(bitmap, logical, point) >= OPAQUE_ALPHA_THRESHOLD;
}
