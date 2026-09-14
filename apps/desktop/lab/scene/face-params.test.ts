/**
 * INPUT:  hand-written expression JSON in both shapes (C2 .exp.json / C3 .exp3.json) mirroring the imported costumes.
 * OUTPUT: assertions on parse output, effective calc classification (numeric Blend -> add), face-set dedupe and the
 *         excludeMult option.
 * POS:    unit test for the lab's pure face-params module. No engine, no DOM. Exempt from caps.
 */

import { describe, expect, it } from "vitest";

import { deriveFaceSet, parseExpressionFile } from "./face-params.ts";

const C2_ANGRY = {
  type: "Live2D Expression",
  fade_in: 500,
  params: [
    { id: "PARAM_EYE_R_OPEN", val: 0.92, calc: "mult" },
    { id: "PARAM_BROW_R_Y", val: -0.08 },
    { id: "PARAM_BROW_L_FORM", val: -1, calc: "add" },
    { nope: true },
  ],
};

const C3_SMILE = {
  Type: "Live2D Expression",
  Parameters: [
    { Id: "ParamEyeLOpen", Value: 1.1, Blend: 2 },
    { Id: "ParamEyeLSmile", Value: 0.0, Blend: 1 },
    { Id: "ParamBrowLY", Value: 0.3, Blend: "Multiply" },
    { Id: "ParamBrowRY", Value: 0.3, Blend: "Overwrite" },
    { Id: 7, Value: 1 },
  ],
};

describe("parseExpressionFile", () => {
  it("reports C2 effective set writes while preserving declared calc", () => {
    expect(parseExpressionFile(C2_ANGRY)).toEqual([
      { id: "PARAM_EYE_R_OPEN", value: 0.92, calc: "set", blend: "mult" },
      { id: "PARAM_BROW_R_Y", value: -0.08, calc: "set", blend: undefined },
      { id: "PARAM_BROW_L_FORM", value: -1, calc: "set", blend: "add" },
    ]);
  });

  it("normalizes C2 values exactly as the engine constructor before effective set", () => {
    expect(parseExpressionFile({ params: [
      { id: "add", val: 0.8, def: 0.3 },
      { id: "mult", val: 0.8, def: 2, calc: "mult" },
      { id: "zero", val: 0.8, def: 0, calc: "mult" },
      { id: "set", val: 0.8, def: 0.3, calc: "set" },
    ] }).map((entry) => entry.value)).toEqual([0.5, 0.4, 0.8, 0.8]);
  });

  it("reads the Cubism 3 shape: numeric Blend is effectively add, only the exact strings change the mode", () => {
    expect(parseExpressionFile(C3_SMILE)).toEqual([
      { id: "ParamEyeLOpen", value: 1.1, calc: "add", blend: 2 },
      { id: "ParamEyeLSmile", value: 0, calc: "add", blend: 1 },
      { id: "ParamBrowLY", value: 0.3, calc: "mult", blend: "Multiply" },
      { id: "ParamBrowRY", value: 0.3, calc: "set", blend: "Overwrite" },
    ]);
  });

  it("answers an empty list for anything unshaped", () => {
    expect(parseExpressionFile(null)).toEqual([]);
    expect(parseExpressionFile({ params: "x" })).toEqual([]);
    expect(parseExpressionFile({ Type: "Live2D Expression" })).toEqual([]);
  });
});

describe("deriveFaceSet", () => {
  const entries = [...parseExpressionFile(C2_ANGRY), ...parseExpressionFile(C2_ANGRY), ...parseExpressionFile(C3_SMILE)];

  it("dedupes ids across expression files, keeping first-seen order", () => {
    expect(deriveFaceSet(entries)).toEqual([
      "PARAM_EYE_R_OPEN",
      "PARAM_BROW_R_Y",
      "PARAM_BROW_L_FORM",
      "ParamEyeLOpen",
      "ParamEyeLSmile",
      "ParamBrowLY",
      "ParamBrowRY",
    ]);
  });

  it("drops mult params on request so the C2 eye-open multiplier stays with the motion", () => {
    const set = deriveFaceSet(entries, { excludeMult: true });
    expect(set).not.toContain("PARAM_EYE_R_OPEN");
    expect(set).not.toContain("ParamBrowLY");
    expect(set).toContain("PARAM_BROW_R_Y");
    expect(set).toContain("ParamEyeLOpen");
  });
});
