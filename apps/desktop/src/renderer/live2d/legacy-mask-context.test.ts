import { describe, expect, it, vi } from "vitest";
import { isolateLegacyMaskContext, type LegacyMaskRuntime } from "./legacy-mask-context.ts";

function createRuntime(): LegacyMaskRuntime {
  return { frameBuffers: [], fTexture: [] };
}

// WebGL silently rejects a handle owned by another context: the old target stays bound.
// This is the live failure signal, not merely a check that two generated numbers differ.
function createContext() {
  const framebuffers = new Set<object>();
  const textures = new Set<object>();
  const renderbuffers = new Set<object>();
  let bound: WebGLFramebuffer | null = null;
  let lost = false;
  const gl = {
    FRAMEBUFFER: 36160,
    createFramebuffer: () => { const value = {}; framebuffers.add(value); return value; },
    createTexture: () => { const value = {}; textures.add(value); return value; },
    createRenderbuffer: () => { const value = {}; renderbuffers.add(value); return value; },
    isFramebuffer: (value: object) => !lost && framebuffers.has(value),
    isTexture: (value: object) => !lost && textures.has(value),
    isRenderbuffer: (value: object) => !lost && renderbuffers.has(value),
    bindFramebuffer: (_target: number, value: WebGLFramebuffer | null) => {
      if (value === null || (!lost && framebuffers.has(value))) bound = value;
    },
    deleteFramebuffer: vi.fn((value: object) => { framebuffers.delete(value); }),
    deleteTexture: vi.fn((value: object) => { textures.delete(value); }),
    deleteRenderbuffer: vi.fn((value: object) => { renderbuffers.delete(value); }),
  };
  return {
    gl: gl as unknown as WebGLRenderingContext,
    calls: gl,
    bound: () => bound,
    lose: () => { lost = true; },
    resourceCount: () => framebuffers.size + textures.size + renderbuffers.size,
  };
}

// Mirrors engine 1.3.1's model-local generateUID and legacy SDK's realm-global slot lookup.
// A delayed StrictMode probe can overwrite slot 1 after the live model has already initialized.
function createModel(runtime: LegacyMaskRuntime) {
  let currentGl: WebGLRenderingContext | undefined;
  let localContextId = 0;
  let slot = 0;
  const destroyListeners: Array<() => void> = [];
  const internal = {
    updateWebGLContext(gl: WebGLRenderingContext, contextId: number) {
      slot = contextId;
      const buffers = {
        framebuffer: gl.createFramebuffer()!,
        texture: gl.createTexture()!,
        renderbuffer: gl.createRenderbuffer()!,
      };
      runtime.frameBuffers[slot] = buffers;
      runtime.fTexture[slot] = buffers.texture;
    },
    once(_event: "destroy", listener: () => void) { destroyListeners.push(listener); },
  };
  return {
    internal,
    slot: () => slot,
    render(context: ReturnType<typeof createContext>) {
      if (currentGl !== context.gl) {
        currentGl = context.gl;
        internal.updateWebGLContext(currentGl, ++localContextId);
      }
      context.gl.bindFramebuffer(context.gl.FRAMEBUFFER, null);
      context.gl.bindFramebuffer(context.gl.FRAMEBUFFER, runtime.frameBuffers[slot]!.framebuffer);
      return { maskWentToRoot: context.bound() === null };
    },
    destroy() { for (const listener of destroyListeners.splice(0)) listener(); },
  };
}

describe("legacy mask context ownership", () => {
  it("reproduces the unadapted cross-context mask leak", () => {
    const runtime = createRuntime();
    const live = createModel(runtime);
    const probe = createModel(runtime);
    const liveContext = createContext();
    const probeContext = createContext();
    expect(live.render(liveContext).maskWentToRoot).toBe(false);
    probe.render(probeContext);
    probeContext.lose();
    expect(live.render(liveContext).maskWentToRoot).toBe(true);
  });

  it("keeps the live mask valid after a late StrictMode probe renders and is destroyed", () => {
    const runtime = createRuntime();
    const live = createModel(runtime);
    const lateProbe = createModel(runtime);
    const liveContext = createContext();
    const probeContext = createContext();
    isolateLegacyMaskContext(live.internal, runtime);
    isolateLegacyMaskContext(lateProbe.internal, runtime);
    live.render(liveContext);
    lateProbe.render(probeContext);
    lateProbe.destroy();
    probeContext.lose();
    expect(live.render(liveContext).maskWentToRoot).toBe(false);
    expect(probeContext.resourceCount()).toBe(0);
    expect(liveContext.resourceCount()).toBe(3);
  });

  it("isolates models sharing a context and destroys only the outgoing costume's mask", () => {
    const runtime = createRuntime();
    const context = createContext();
    const previous = createModel(runtime);
    const next = createModel(runtime);
    isolateLegacyMaskContext(previous.internal, runtime);
    isolateLegacyMaskContext(next.internal, runtime);
    previous.render(context);
    const previousBuffers = runtime.frameBuffers[previous.slot()];
    next.render(context);
    expect(runtime.frameBuffers[previous.slot()]).toBe(previousBuffers);
    previous.destroy();
    previous.destroy();
    expect(next.render(context).maskWentToRoot).toBe(false);
    expect(context.resourceCount()).toBe(3);
    next.destroy();
    expect(context.resourceCount()).toBe(0);
    expect(context.calls.deleteTexture).toHaveBeenCalledTimes(2);
  });

  it("releases old-context resources before a model moves to a new renderer", () => {
    const runtime = createRuntime();
    const oldContext = createContext();
    const newContext = createContext();
    const model = createModel(runtime);
    isolateLegacyMaskContext(model.internal, runtime);
    model.render(oldContext);
    const oldSlot = model.slot();
    expect(model.render(newContext).maskWentToRoot).toBe(false);
    expect(runtime.frameBuffers[oldSlot]).toBeUndefined();
    expect(oldContext.resourceCount()).toBe(0);
    model.destroy();
    expect(newContext.resourceCount()).toBe(0);
  });

  it("removes lost-context cache references without deleting a foreign replacement", () => {
    const runtime = createRuntime();
    const lostContext = createContext();
    const otherContext = createContext();
    const model = createModel(runtime);
    isolateLegacyMaskContext(model.internal, runtime);
    model.render(lostContext);
    const slot = model.slot();
    const foreign = {
      framebuffer: otherContext.gl.createFramebuffer()!,
      renderbuffer: otherContext.gl.createRenderbuffer()!,
      texture: otherContext.gl.createTexture()!,
    };
    runtime.frameBuffers[slot] = foreign;
    runtime.fTexture[slot] = foreign.texture;
    lostContext.lose();
    model.destroy();
    expect(runtime.frameBuffers[slot]).toBe(foreign);
    expect(runtime.fTexture[slot]).toBe(foreign.texture);
    expect(otherContext.resourceCount()).toBe(3);
    expect(lostContext.calls.deleteFramebuffer).not.toHaveBeenCalled();
  });

  it("clears a lost allocation and creates a new slot when the engine reinitializes the same context", () => {
    const runtime = createRuntime();
    const context = createContext();
    const model = createModel(runtime);
    isolateLegacyMaskContext(model.internal, runtime);
    model.render(context);
    const oldSlot = model.slot();
    model.internal.updateWebGLContext(context.gl, 1);
    expect(model.slot()).not.toBe(oldSlot);
    expect(runtime.frameBuffers[oldSlot]).toBeUndefined();
    expect(context.resourceCount()).toBe(3);
    const newSlot = model.slot();
    context.lose();
    model.destroy();
    expect(runtime.frameBuffers[newSlot]).toBeUndefined();
    expect(runtime.fTexture[newSlot]).toBeUndefined();
    expect(context.calls.deleteFramebuffer).toHaveBeenCalledTimes(1);
  });

  it("releases an allocation when initialization throws and rejects initialization after destruction", () => {
    const runtime = createRuntime();
    const context = createContext();
    const model = createModel(runtime);
    const initialize = model.internal.updateWebGLContext;
    model.internal.updateWebGLContext = (gl, contextId) => {
      initialize(gl, contextId);
      throw new Error("initialization failed");
    };
    isolateLegacyMaskContext(model.internal, runtime);
    expect(() => model.render(context)).toThrow("initialization failed");
    expect(context.resourceCount()).toBe(0);
    expect(runtime.frameBuffers[model.slot()]).toBeUndefined();
    model.destroy();
    expect(() => model.internal.updateWebGLContext(context.gl, 1)).toThrow("destroyed");
  });

  it("survives module reload, duplicate installation, and model destruction/recreation", async () => {
    const runtime = createRuntime();
    const oldContext = createContext();
    const newContext = createContext();
    const oldModel = createModel(runtime);
    isolateLegacyMaskContext(oldModel.internal, runtime);
    oldModel.render(oldContext);
    const oldSlot = oldModel.slot();
    vi.resetModules();
    const reloaded = await import("./legacy-mask-context.ts");
    reloaded.isolateLegacyMaskContext(oldModel.internal, runtime);
    const newModel = createModel(runtime);
    reloaded.isolateLegacyMaskContext(newModel.internal, runtime);
    newModel.render(newContext);
    oldModel.destroy();
    expect(newModel.render(newContext).maskWentToRoot).toBe(false);
    expect(oldContext.calls.deleteFramebuffer).toHaveBeenCalledTimes(1);
    const replacement = createModel(runtime);
    reloaded.isolateLegacyMaskContext(replacement.internal, runtime);
    replacement.render(oldContext);
    expect(replacement.slot()).not.toBe(oldSlot);
    expect(newModel.render(newContext).maskWentToRoot).toBe(false);
  });
});
