/**
 * INPUT:  a mocked PixiJS app/stage + fake Live2DModel handles + injected load/readVocab (the engine is not loaded).
 * OUTPUT: assertions that reloadModel tears down the previous model (removeChild + destroy), loads the new costume
 *         via the injected loader, and returns the re-read vocabulary the caller re-reports (prd §4.3 / T8).
 * POS:    unit test for costume-switch's pure swap core. Type-only engine import ⇒ node-safe. Exempt from caps.
 */

import { describe, expect, it, vi } from "vitest";
import type { Application } from "pixi.js";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import { reloadModel } from "./costume-switch.ts";

function fakeModel(tag: string): Live2DModel {
  return { tag, destroy: vi.fn() } as unknown as Live2DModel;
}

function fakeApp(): { app: Application; removed: unknown[] } {
  const removed: unknown[] = [];
  const app = { stage: { removeChild: (child: unknown) => removed.push(child) } } as unknown as Application;
  return { app, removed };
}

describe("reloadModel", () => {
  it("tears down the previous model, loads the new costume, and returns its re-read vocabulary", async () => {
    const { app, removed } = fakeApp();
    const previous = fakeModel("previous");
    const next = fakeModel("next");
    const load = vi.fn(async () => next);
    const readVocab = vi.fn(() => ({ motions: ["mtn_smile01_C"], expressions: ["exp_smile05"] }));

    const result = await reloadModel({ app, load, readVocab }, previous, "asset://characters/taki/live_01/x.model3.json");

    expect(removed).toEqual([previous]);
    expect((previous as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).toHaveBeenCalledWith({ children: true });
    expect(load).toHaveBeenCalledWith(app, "asset://characters/taki/live_01/x.model3.json");
    expect(result.model).toBe(next);
    expect(result.vocabulary).toEqual({ motions: ["mtn_smile01_C"], expressions: ["exp_smile05"] });
  });

  it("reads the NEW model's vocabulary (not the old one) so the re-report reflects the new costume", async () => {
    const { app } = fakeApp();
    const next = fakeModel("next");
    const readVocab = vi.fn(() => ({ motions: ["idle01"], expressions: [] }));
    const result = await reloadModel({ app, load: async () => next, readVocab }, fakeModel("previous"), "url");
    expect(readVocab).toHaveBeenCalledWith(next);
    expect(result.vocabulary.motions).toEqual(["idle01"]);
  });

  it("leaves the previous model intact when the new costume fails to load (load-before-teardown)", async () => {
    const { app, removed } = fakeApp();
    const previous = fakeModel("previous");
    const readVocab = vi.fn();
    const load = vi.fn(async () => {
      throw new Error("bad costume");
    });
    await expect(reloadModel({ app, load, readVocab }, previous, "url")).rejects.toThrow("bad costume");
    // A failed load must not destroy or remove the still-rendering previous model, and must not re-read vocab.
    expect(removed).toEqual([]);
    expect((previous as unknown as { destroy: ReturnType<typeof vi.fn> }).destroy).not.toHaveBeenCalled();
    expect(readVocab).not.toHaveBeenCalled();
  });

  it("attaches with nothing to tear down when previous is null (model-less boot's first promotion)", async () => {
    const { app, removed } = fakeApp();
    const next = fakeModel("next");
    const readVocab = vi.fn(() => ({ motions: ["smile01"], expressions: [] }));

    const result = await reloadModel({ app, load: async () => next, readVocab }, null, "url");

    expect(removed).toEqual([]); // no previous model — removeChild/destroy must not run
    expect(result.model).toBe(next);
    expect(result.vocabulary.motions).toEqual(["smile01"]);
  });
});
