/**
 * INPUT:  createPetScene with all heavy renderer deps mocked (stage/loader/mask/controller/costume-switch) and the idle
 *         scheduler stubbed so its dispose is observable.
 * OUTPUT: assertions that the initial attach creates one idle scheduler, a costume switch disposes the previous one and
 *         creates a new one, scene.dispose() tears down the live scheduler (1a wiring), and abortSwitch marks an
 *         in-flight switch stale so its late-resolving model self-discards without attaching (1f Fix 1).
 * POS:    unit test for pet-scene's scheduler lifecycle. The engine value is never loaded (every engine-touching module
 *         is mocked), so this stays node-safe without a real Pixi stage. Exempt from size caps.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { idleDisposers, lifecycle, tickerHooks, maskHooks } = vi.hoisted(() => ({
  idleDisposers: [] as Array<ReturnType<typeof vi.fn>>,
  lifecycle: {
    order: [] as string[],
    removeModel: vi.fn(),
    destroyModel: vi.fn(),
    destroyApp: vi.fn(),
  },
  tickerHooks: { add: vi.fn(), remove: vi.fn() },
  maskHooks: { refresh: vi.fn() },
}));

vi.mock("./stage.ts", () => ({
  createStage: vi.fn(async () => ({
    ticker: { ...tickerHooks, start() { this.started = true; }, stop() { this.started = false; }, maxFPS: 0, started: false },
    screen: { width: 400, height: 600 },
    renderer: {},
    stage: { removeChild: lifecycle.removeModel },
    destroy: lifecycle.destroyApp,
  })),
}));
vi.mock("./alpha-mask-source.ts", () => ({
  createAlphaMaskSource: () => ({ refresh: maskHooks.refresh, isOpaque: () => false, dispose: vi.fn() }),
}));
vi.mock("./live2d/load-character-model.ts", () => ({
  loadCharacterModel: vi.fn(async () => ({ tag: "model", destroy: lifecycle.destroyModel })),
  DEV_MODEL_SOURCE: "dev",
}));
vi.mock("./live2d/avatar-controller.ts", () => ({
  createAvatarController: () => ({
    vocabulary: { motions: [], expressions: [] },
    applyCommand: vi.fn(),
    reactToClick: vi.fn(),
    focusAt: vi.fn(),
    handleProximity: vi.fn(),
  }),
}));
vi.mock("./live2d/costume-switch.ts", () => ({
  reloadModel: vi.fn(async () => ({ model: { tag: "next", destroy: lifecycle.destroyModel }, vocabulary: { motions: ["idle01"], expressions: [] } })),
}));
vi.mock("./live2d/idle-motion.ts", () => ({
  createIdleMotionScheduler: vi.fn(() => {
    const dispose = vi.fn();
    idleDisposers.push(dispose);
    return { dispose };
  }),
}));

import { createPetScene } from "./pet-scene.ts";
import { reloadModel } from "./live2d/costume-switch.ts";
import { loadCharacterModel } from "./live2d/load-character-model.ts";
import { createStage } from "./stage.ts";

const host = {} as unknown as HTMLElement;

beforeEach(() => {
  idleDisposers.length = 0;
  lifecycle.order.length = 0;
  lifecycle.removeModel.mockReset();
  lifecycle.destroyModel.mockReset();
  lifecycle.destroyApp.mockReset();
  tickerHooks.add.mockReset();
  tickerHooks.remove.mockReset();
  maskHooks.refresh.mockReset();
  lifecycle.removeModel.mockImplementation(() => {
    lifecycle.order.push("remove-model");
  });
  lifecycle.destroyModel.mockImplementation(() => {
    lifecycle.order.push("destroy-model");
  });
  lifecycle.destroyApp.mockImplementation(() => {
    lifecycle.order.push("destroy-app");
  });
});

describe("createPetScene idle scheduler lifecycle", () => {
  it("pauses a model-less scene through flag changes and resumes only after successful attachment", async () => {
    vi.mocked(loadCharacterModel).mockRejectedValueOnce(new Error("missing model"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const scene = await createPetScene(host);
    warning.mockRestore();
    const app = await vi.mocked(createStage).mock.results.at(-1)!.value;
    expect(app.ticker.started).toBe(false);
    scene.governor.setThrottling(false); scene.governor.setFocused(false);
    scene.governor.setHidden(true); scene.governor.setHidden(false); scene.setAvatarState("thinking");
    expect(app.ticker.started).toBe(false);
    expect(scene.reportSnapshot()).toEqual({ motions: [], expressions: [] });
    scene.governor.setThrottling(true);
    await scene.switchCostume({ settingsUrl: "asset://first", resolve: () => null });
    expect(app.ticker.started).toBe(true); expect(app.ticker.maxFPS).toBe(15);
    expect(maskHooks.refresh).toHaveBeenCalledTimes(2);
    scene.dispose(); expect(app.ticker.started).toBe(false);
  });

  it("creates one scheduler on the initial attach", async () => {
    await createPetScene(host, { renderThrottling: false });
    expect(idleDisposers).toHaveLength(1);
    expect(idleDisposers[0]).not.toHaveBeenCalled();
  });

  it("disposes the previous scheduler and creates a new one on a costume switch", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    await scene.switchCostume({ settingsUrl: "asset://x", resolve: () => null, costumeId: "arbeit" });
    expect(idleDisposers).toHaveLength(2);
    expect(idleDisposers[0]).toHaveBeenCalledTimes(1); // outgoing scheduler torn down
    expect(idleDisposers[1]).not.toHaveBeenCalled(); // incoming scheduler still live
    expect(scene.reportSnapshot()).toEqual({ motions: [], expressions: [], costume: "arbeit" });
  });

  it("does not invent a formal costume identity for the dev fallback scene", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    expect(scene.reportSnapshot()).toEqual({ motions: [], expressions: [] });
  });

  it("disposes the live scheduler on scene dispose", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    scene.dispose();
    expect(idleDisposers[0]).toHaveBeenCalledTimes(1);
  });

  it("destroys the Live2D model before the Pixi application and remains idempotent", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    lifecycle.destroyApp.mockImplementation(() => {
      lifecycle.order.push("destroy-app");
      if (lifecycle.destroyModel.mock.calls.length === 0) {
        throw new TypeError("Cannot read properties of null (reading 'next')");
      }
    });

    expect(() => scene.dispose()).not.toThrow();
    expect(() => scene.dispose()).not.toThrow();
    expect(lifecycle.order).toEqual(["remove-model", "destroy-model", "destroy-app"]);
    expect(lifecycle.removeModel).toHaveBeenCalledTimes(1);
    expect(lifecycle.destroyModel).toHaveBeenCalledTimes(1);
    expect(lifecycle.destroyApp).toHaveBeenCalledTimes(1);
  });
});

describe("createPetScene mask refresh wiring (P1c)", () => {
  it("registers exactly one gated ticker callback and removes that same callback on dispose", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    expect(tickerHooks.add).toHaveBeenCalledTimes(1);
    const [registered] = tickerHooks.add.mock.calls[0] ?? [];
    expect(typeof registered).toBe("function");
    scene.dispose();
    expect(tickerHooks.remove).toHaveBeenCalledTimes(1);
    expect(tickerHooks.remove).toHaveBeenCalledWith(registered);
  });

  it("forces a mask refresh at scene build and again when the initial model attaches", async () => {
    await createPetScene(host, { renderThrottling: false });
    expect(maskHooks.refresh).toHaveBeenCalledTimes(2); // rebuild prime + initial-attach force
  });

  it("forces a mask refresh when a costume switch attaches its model", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    maskHooks.refresh.mockClear();
    await scene.switchCostume({ settingsUrl: "asset://x", resolve: () => null, costumeId: "arbeit" });
    expect(maskHooks.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("createPetScene abortSwitch (1f Fix 1)", () => {
  it("marks an in-flight switch stale so a late-resolving load self-discards without attaching", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    expect(idleDisposers).toHaveLength(1); // initial attach

    // A controllable slow-but-finite load that honors isStale exactly like the real reloadModel (discard + throw when
    // superseded). It stays pending until the test releases it — mimicking a costume that loads AFTER the timeout.
    let capturedIsStale: (() => boolean) | undefined;
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const destroyLate = vi.fn();
    vi.mocked(reloadModel).mockImplementationOnce(async (deps) => {
      capturedIsStale = deps.isStale;
      await loadGate;
      if (deps.isStale?.() === true) {
        destroyLate();
        throw new Error("costume switch superseded by a newer one");
      }
      return { model: { tag: "late" } as never, vocabulary: { motions: [], expressions: [] } };
    });

    const switching = scene.switchCostume({ settingsUrl: "asset://x", resolve: () => null });
    const settled = switching.then(() => "ok", () => "rejected");

    expect(capturedIsStale?.()).toBe(false); // the in-flight switch is not yet stale
    scene.abortSwitch(); // timeout/failure path bumps the ticket
    expect(capturedIsStale?.()).toBe(true); // ...so the in-flight switch is now stale

    releaseLoad(); // the late load finally resolves → the mock sees isStale → discards + throws (no attach)
    expect(await settled).toBe("rejected");
    expect(destroyLate).toHaveBeenCalledTimes(1); // late model destroyed
    expect(idleDisposers).toHaveLength(1); // attachModel never ran → no new scheduler
    expect(idleDisposers[0]).not.toHaveBeenCalled(); // the pre-switch model's scheduler is untouched
  });

  it("is model-less + idempotent safe and does not wedge future switches", async () => {
    const scene = await createPetScene(host, { renderThrottling: false });
    expect(() => {
      scene.abortSwitch();
      scene.abortSwitch();
    }).not.toThrow();
    // A normal switch after the aborts still attaches (the ticket bumps do not stale a fresh switch's own ticket).
    await scene.switchCostume({ settingsUrl: "asset://y", resolve: () => null });
    expect(idleDisposers).toHaveLength(2);
  });
});
