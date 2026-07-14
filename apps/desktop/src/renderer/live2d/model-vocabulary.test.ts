/**
 * INPUT:  a fake model shaped like Live2DModel's manifest accessors (Cubism 2 `name`, Cubism 3 `Name`).
 * OUTPUT: assertions that motion group keys + expression names are read, and malformed/absent specs degrade.
 * POS:    unit test for the vocabulary reader (F3, Option A report). Type-only engine import ⇒ node-safe. Exempt from caps.
 */

import { describe, expect, it } from "vitest";
import type { Live2DModel } from "untitled-pixi-live2d-engine";
import { readVocabulary } from "./model-vocabulary.ts";

function fakeModel(motions: Record<string, unknown[]>, expressions: unknown[] | null): Live2DModel {
  const expressionManager = expressions === null ? undefined : { definitions: expressions };
  return { internalModel: { motionManager: { definitions: motions, expressionManager } } } as unknown as Live2DModel;
}

describe("readVocabulary", () => {
  it("reads motion group keys and Cubism 2 `name` expressions", () => {
    const vocabulary = readVocabulary(fakeModel({ angry01: [], smile01: [] }, [{ name: "default" }, { name: "smile01" }]));
    expect(vocabulary.motions).toEqual(["angry01", "smile01"]);
    expect(vocabulary.expressions).toEqual(["default", "smile01"]);
  });

  it("reads Cubism 3 `Name` expressions", () => {
    const vocabulary = readVocabulary(fakeModel({ mtn_smile01_C: [] }, [{ Name: "exp_smile05" }]));
    expect(vocabulary.expressions).toEqual(["exp_smile05"]);
  });

  it("degrades to no expressions when the model has no expression manager", () => {
    expect(readVocabulary(fakeModel({ idle01: [] }, null))).toEqual({ motions: ["idle01"], expressions: [] });
  });

  it("drops malformed expression specs instead of crashing", () => {
    expect(readVocabulary(fakeModel({}, [{}, { name: 42 }, { Name: "ok" }])).expressions).toEqual(["ok"]);
  });
});
