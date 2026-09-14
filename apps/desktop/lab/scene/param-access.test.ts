/**
 * INPUT:  fake core models — a Cubism 2 shape (setParamFloat…) and a Cubism 3 shape (setParameterValueById + idManager).
 * OUTPUT: assertions on generation detection, per-generation write/read routing, handle caching, `has` semantics
 *         (C3 answers from the declared list, never via the registering getParameterIndex) and listIds (enumerated on C3, null on C2).
 * POS:    unit test for the lab's generation adapter. Structural fakes only — the engine is never imported. Exempt from caps.
 */

import { describe, expect, it, vi } from "vitest";

import { createParamAccess } from "./param-access.ts";

function legacyCore(values: Record<string, number> = {}) {
  return {
    setParamFloat: vi.fn((id: string, value: number) => void (values[id] = value)),
    addToParamFloat: vi.fn((id: string, value: number) => void (values[id] = (values[id] ?? 0) + value)),
    multParamFloat: vi.fn((id: string, value: number) => void (values[id] = (values[id] ?? 0) * value)),
    getParamFloat: vi.fn((id: string) => values[id] ?? 0),
    getParamIndex: vi.fn((id: string) => (id.startsWith("PARAM_") ? 3 : -1)),
  };
}

function modernCore(ids: string[]) {
  const values = new Map<string, number>();
  const key = (handle: unknown): string => String(handle);
  return {
    values,
    core: {
      setParameterValueById: vi.fn((handle: unknown, value: number) => void values.set(key(handle), value)),
      addParameterValueById: vi.fn((handle: unknown, value: number) =>
        void values.set(key(handle), (values.get(key(handle)) ?? 0) + value),
      ),
      multiplyParameterValueById: vi.fn((handle: unknown, value: number) =>
        void values.set(key(handle), (values.get(key(handle)) ?? 0) * value),
      ),
      getParameterValueById: vi.fn((handle: unknown) => values.get(key(handle)) ?? 0),
      // Mirrors the engine: looking an unknown id up by index REGISTERS it — so `has` must never call this.
      getParameterIndex: vi.fn(() => {
        throw new Error("getParameterIndex registers phantom ids");
      }),
      getParameterCount: () => ids.length,
      getParameterId: (index: number) => ({ getString: () => ({ s: ids[index] ?? "" }) }),
    },
  };
}

describe("createParamAccess — cubism 2", () => {
  it("detects the legacy core and routes every write through its string-keyed API with an explicit weight", () => {
    const core = legacyCore();
    const params = createParamAccess({ coreModel: core });
    expect(params.generation).toBe("cubism2");
    params.set("PARAM_ANGLE_X", 20);
    params.add("PARAM_ANGLE_X", 5);
    params.mult("PARAM_ANGLE_X", 2);
    expect(core.setParamFloat).toHaveBeenCalledWith("PARAM_ANGLE_X", 20, 1);
    expect(core.addToParamFloat).toHaveBeenCalledWith("PARAM_ANGLE_X", 5, 1);
    expect(core.multParamFloat).toHaveBeenCalledWith("PARAM_ANGLE_X", 2, 1);
    expect(params.get("PARAM_ANGLE_X")).toBe(50);
  });

  it("forwards an explicit weight and reports has() from the parameter index", () => {
    const core = legacyCore();
    const params = createParamAccess({ coreModel: core });
    params.set("PARAM_ANGLE_X", 10, 0.5);
    expect(core.setParamFloat).toHaveBeenCalledWith("PARAM_ANGLE_X", 10, 0.5);
    expect(params.has("PARAM_ANGLE_X")).toBe(true);
    expect(params.has("nope")).toBe(false);
  });

  it("cannot enumerate parameter ids", () => {
    expect(createParamAccess({ coreModel: legacyCore() }).listIds()).toBeNull();
  });
});

describe("createParamAccess — cubism 3", () => {
  const ids = ["ParamAngleX", "ParamMouthOpenY"];

  it("detects the modern core and routes writes through id handles", () => {
    const { core, values } = modernCore(ids);
    const idManager = { getId: vi.fn((id: string) => id) };
    const params = createParamAccess({ coreModel: core, idManager });
    expect(params.generation).toBe("cubism3");
    params.set("ParamAngleX", 20);
    params.add("ParamAngleX", 5);
    expect(core.setParameterValueById).toHaveBeenCalledWith("ParamAngleX", 20, 1);
    expect(values.get("ParamAngleX")).toBe(25);
    expect(params.get("ParamAngleX")).toBe(25);
  });

  it("resolves each id handle exactly once", () => {
    const { core } = modernCore(ids);
    const idManager = { getId: vi.fn((id: string) => id) };
    const params = createParamAccess({ coreModel: core, idManager });
    params.set("ParamAngleX", 1);
    params.set("ParamAngleX", 2);
    params.get("ParamAngleX");
    expect(idManager.getId).toHaveBeenCalledTimes(1);
  });

  it("answers has() from the declared id list without registering a phantom id or handle", () => {
    const { core } = modernCore(ids);
    const idManager = { getId: vi.fn((id: string) => id) };
    const params = createParamAccess({ coreModel: core, idManager });
    expect(params.has("ParamAngleX")).toBe(true);
    expect(params.has("ParamNotInThisMoc")).toBe(false);
    expect(core.getParameterIndex).not.toHaveBeenCalled();
    expect(idManager.getId).not.toHaveBeenCalled();
  });

  it("enumerates parameter ids by unwrapping the id handle", () => {
    const { core } = modernCore(ids);
    const params = createParamAccess({ coreModel: core, idManager: { getId: (id: string) => id } });
    expect(params.listIds()).toEqual(ids);
  });

  it("reports unknown instead of null or a fabricated zero for uninitialized phantom parameters", () => {
    const { core } = modernCore(ids);
    const target = { ...core, getParameterValueById: vi.fn(() => null) };
    const params = createParamAccess({ coreModel: target, idManager: { getId: (id) => id } });
    expect(params.has("NotInMoc")).toBe(false);
    expect(params.get("NotInMoc")).toBeNaN();
    expect(params.get("ParamAngleX")).toBeNaN();
  });
});

describe("createParamAccess — refusal", () => {
  it("throws when the core model exposes neither parameter API", () => {
    expect(() => createParamAccess({ coreModel: {} })).toThrow(/neither the Cubism 2 nor the Cubism 3/u);
  });

  it("throws when a modern core arrives without an id manager", () => {
    const { core } = modernCore(["ParamAngleX"]);
    expect(() => createParamAccess({ coreModel: core })).toThrow(/neither the Cubism 2 nor the Cubism 3/u);
  });
});
