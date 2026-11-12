import { afterEach, describe, expect, it, vi } from "vitest";
import type { Application } from "pixi.js";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import type { LegacyMaskRuntime } from "./legacy-mask-context.ts";

const engine = vi.hoisted(() => {
  class LegacyInternalModel {
    slot = 0;
    destroyListeners: Array<() => void> = [];
    readonly runtime: LegacyMaskRuntime;
    constructor(runtime: LegacyMaskRuntime) { this.runtime = runtime; }
    updateWebGLContext(gl: WebGLRenderingContext, contextId: number) {
      this.slot = contextId;
      const buffers = {
        framebuffer: gl.createFramebuffer()!,
        renderbuffer: gl.createRenderbuffer()!,
        texture: gl.createTexture()!,
      };
      this.runtime.frameBuffers[contextId] = buffers;
      this.runtime.fTexture[contextId] = buffers.texture;
    }
    once(_event: "destroy", listener: () => void) { this.destroyListeners.push(listener); }
    destroy() { for (const listener of this.destroyListeners.splice(0)) listener(); }
  }
  return { LegacyInternalModel, from: vi.fn<() => Promise<Live2DModel>>() };
});

vi.mock("untitled-pixi-live2d-engine", () => ({
  CubismLegacyInternalModel: engine.LegacyInternalModel,
  CubismLegacyModelSettings: class {},
  CubismModelSettings: class {},
  ModelSettings: class {},
  Live2DModel: { from: engine.from },
}));

import { loadCharacterModel } from "./load-character-model.ts";

// The stage's addChild forces a first render, just like the attachment alpha-mask capture.
// A context accepts only its own handles; a foreign SDK cache entry leaves the root bound.
function createStage() {
  const handles = new Set<object>();
  let bound: WebGLFramebuffer | null = null;
  const create = () => { const handle = {}; handles.add(handle); return handle; };
  const gl = {
    FRAMEBUFFER: 36160,
    createFramebuffer: create, createRenderbuffer: create, createTexture: create,
    isFramebuffer: (handle: object) => handles.has(handle),
    isRenderbuffer: (handle: object) => handles.has(handle),
    isTexture: (handle: object) => handles.has(handle),
    deleteFramebuffer: (handle: object) => handles.delete(handle),
    deleteRenderbuffer: (handle: object) => handles.delete(handle),
    deleteTexture: (handle: object) => handles.delete(handle),
    bindFramebuffer: (_target: number, handle: WebGLFramebuffer | null) => {
      if (handle === null || handles.has(handle)) bound = handle;
    },
  } as unknown as WebGLRenderingContext;
  const addChild = vi.fn((model: { internalModel: unknown }) => {
    if (model.internalModel instanceof engine.LegacyInternalModel) {
      model.internalModel.updateWebGLContext(gl, 1);
    }
  });
  const app = {
    ticker: {}, screen: { width: 400, height: 600 }, stage: { addChild },
  } as unknown as Application;
  return {
    app, addChild,
    render(internal: InstanceType<typeof engine.LegacyInternalModel>) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, internal.runtime.frameBuffers[internal.slot]!.framebuffer);
      return { maskWentToRoot: bound === null };
    },
    resourceCount: () => handles.size,
  };
}

function createModel(internalModel: unknown): Live2DModel {
  return {
    internalModel, height: 600,
    anchor: { set: vi.fn() }, position: { set: vi.fn() }, scale: { set: vi.fn() },
  } as unknown as Live2DModel;
}

afterEach(() => {
  engine.from.mockReset();
  vi.unstubAllGlobals();
});

describe("loadCharacterModel mask isolation", () => {
  it("isolates both loaded models before their first stage render", async () => {
    const runtime: LegacyMaskRuntime = { frameBuffers: [], fTexture: [] };
    vi.stubGlobal("Live2D", runtime);
    const first = new engine.LegacyInternalModel(runtime);
    const second = new engine.LegacyInternalModel(runtime);
    const firstStage = createStage();
    const secondStage = createStage();
    engine.from.mockResolvedValueOnce(createModel(first)).mockResolvedValueOnce(createModel(second));
    await loadCharacterModel(firstStage.app, "/first/model.json");
    await loadCharacterModel(secondStage.app, "/second/model.json");
    expect(firstStage.render(first).maskWentToRoot).toBe(false);
    expect(secondStage.render(second).maskWentToRoot).toBe(false);
    expect(engine.from).toHaveBeenNthCalledWith(1, "/first/model.json", expect.objectContaining({ ticker: firstStage.app.ticker }));
    first.destroy();
    expect(firstStage.resourceCount()).toBe(0);
    expect(secondStage.render(second).maskWentToRoot).toBe(false);
    second.destroy();
  });

  it("keeps the live mask valid when a late async StrictMode scene loads and is discarded", async () => {
    const runtime: LegacyMaskRuntime = { frameBuffers: [], fTexture: [] };
    vi.stubGlobal("Live2D", runtime);
    const late = new engine.LegacyInternalModel(runtime);
    const live = new engine.LegacyInternalModel(runtime);
    const lateStage = createStage();
    const liveStage = createStage();
    let finishLate!: (model: Live2DModel) => void;
    engine.from.mockReturnValueOnce(new Promise((resolve) => { finishLate = resolve; }));
    const pending = loadCharacterModel(lateStage.app, "/late/model.json");
    engine.from.mockResolvedValueOnce(createModel(live));
    await loadCharacterModel(liveStage.app, "/live/model.json");
    expect(lateStage.addChild).not.toHaveBeenCalled();
    finishLate(createModel(late));
    await pending;
    late.destroy();
    expect(lateStage.resourceCount()).toBe(0);
    expect(liveStage.render(live).maskWentToRoot).toBe(false);
    live.destroy();
  });

  it("loads Cubism 3+ without requiring the legacy runtime or installing its adapter", async () => {
    vi.stubGlobal("Live2D", undefined);
    const modern = { updateWebGLContext: vi.fn(), once: vi.fn() };
    const stage = createStage();
    const model = createModel(modern);
    engine.from.mockResolvedValueOnce(model);
    await expect(loadCharacterModel(stage.app, "/modern/model3.json")).resolves.toBe(model);
    expect(stage.addChild).toHaveBeenCalledWith(model);
    expect(modern.once).not.toHaveBeenCalled();
  });
});
