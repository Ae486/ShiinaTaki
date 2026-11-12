/**
 * INPUT:  a loaded Cubism 2 internal model and the vendored legacy runtime's mask caches.
 * OUTPUT: isolateLegacyMaskContext — context-owned mask allocation and destruction before the first stage render.
 * POS:    ui/renderer/live2d — compatibility boundary for engine 1.3.1; no React, asset, or draw-order changes.
 */

// Symbols and allocator state live with the SDK realm, not a Vite module instance. A hot-reloaded
// adapter must neither restart the counter nor wrap an already-owned internal model a second time.
const NEXT_SLOT = Symbol.for("taki.live2d.legacy-mask.next-slot");
const ISOLATED = Symbol.for("taki.live2d.legacy-mask.isolated");

export interface LegacyMaskBuffers {
  framebuffer: WebGLFramebuffer;
  renderbuffer: WebGLRenderbuffer;
  texture: WebGLTexture;
}

export interface LegacyMaskRuntime {
  frameBuffers: Array<LegacyMaskBuffers | undefined>;
  fTexture: Array<WebGLTexture | undefined>;
  [NEXT_SLOT]?: number;
}

interface LegacyMaskModel {
  updateWebGLContext: (gl: WebGLRenderingContext, contextId: number) => void;
  once: (event: "destroy", listener: () => void) => unknown;
  [ISOLATED]?: boolean;
}

// The proprietary Cubism 2 script loads before the module entry. This is its verified 2.1 cache
// surface, kept here instead of leaking SDK globals or undocumented fields into scene/React code.
declare const Live2D: LegacyMaskRuntime;

interface MaskAllocation {
  gl: WebGLRenderingContext;
  slot: number;
  buffers: LegacyMaskBuffers | undefined;
  texture: WebGLTexture | undefined;
}

export function isolateLegacyMaskContext(model: LegacyMaskModel, runtime: LegacyMaskRuntime = Live2D): void {
  if (model[ISOLATED]) return;
  model[ISOLATED] = true;
  const update = model.updateWebGLContext;
  let allocation: MaskAllocation | undefined;
  let destroyed = false;
  const release = () => {
    if (!allocation) return;
    releaseMaskAllocation(runtime, allocation);
    allocation = undefined;
  };

  // Engine 1.3.1 generates context IDs PER MODEL (each starts at 1), but the legacy SDK indexes
  // frameBuffers/fTexture globally. StrictMode's two async scenes therefore replace each other's
  // GL handles. Allocate for each model/context initialization, including restoration/recreation.
  model.updateWebGLContext = (gl) => {
    if (destroyed) throw new Error("Cannot initialize a destroyed Live2D mask context");
    release();
    const slot = Math.max(runtime[NEXT_SLOT] ?? 1, runtime.frameBuffers.length, runtime.fTexture.length);
    runtime[NEXT_SLOT] = slot + 1;
    let initialized = false;
    try {
      update.call(model, gl, slot);
      initialized = true;
    } finally {
      allocation = { gl, slot, buffers: runtime.frameBuffers[slot], texture: runtime.fTexture[slot] };
      if (!initialized) release();
    }
  };
  model.once("destroy", () => {
    destroyed = true;
    release();
  });
}

function releaseMaskAllocation(runtime: LegacyMaskRuntime, allocation: MaskAllocation): void {
  const { gl, slot, buffers, texture } = allocation;
  // Compare identities before touching global slots. Even a foreign writer replacing our slot
  // must not make this model's destruction delete that writer's resources or cache references.
  if (runtime.frameBuffers[slot] === buffers) delete runtime.frameBuffers[slot];
  if (runtime.fTexture[slot] === texture) delete runtime.fTexture[slot];
  if (buffers) {
    if (gl.isFramebuffer(buffers.framebuffer)) gl.deleteFramebuffer(buffers.framebuffer);
    if (gl.isRenderbuffer(buffers.renderbuffer)) gl.deleteRenderbuffer(buffers.renderbuffer);
  }
  // The two caches normally reference the same texture. Delete once; lost contexts already
  // released their GPU resources, and isTexture/isFramebuffer reject foreign-context handles.
  for (const ownedTexture of new Set([texture, buffers?.texture])) {
    if (ownedTexture && gl.isTexture(ownedTexture)) gl.deleteTexture(ownedTexture);
  }
}
