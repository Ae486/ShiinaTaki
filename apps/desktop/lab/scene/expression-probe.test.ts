import { describe, expect, it } from "vitest";

import { describeExpressionProbe, pickExpressionProbe, type ExpressionProbeInput } from "./expression-probe.ts";
import { parseExpressionFile } from "./face-params.ts";

const base: ExpressionProbeInput = {
  state: { kind: "applied", name: "smile", settleAt: 1200 },
  probe: { id: "EYE_FORM", value: 1, calc: "set", blend: "add" },
  sample: { before: -1, after: -1, final: 1 },
  available: true,
  playing: true,
  nowMs: 1500,
};

describe("expression parameter probe", () => {
  it("uses effective C2 set writes while skipping declared eye-open mult", () => {
    const params = parseExpressionFile({ params: [
      { id: "EYE_OPEN", val: 2, calc: "mult" },
      { id: "EYE_FORM", val: 1, calc: "add" },
    ] });
    expect(pickExpressionProbe(params)?.id).toBe("EYE_FORM");
  });

  it("reports only an applied, settled and available single-parameter comparison during motion", () => {
    expect(describeExpressionProbe(base)).toContain("expression parameter probe: yes");
    expect(describeExpressionProbe({ ...base, sample: { before: -1, after: -1, final: -1 } })).toContain("expression parameter probe: no");
    expect(describeExpressionProbe(base)).toContain("single parameter");
  });

  it("never certifies motion-only, failed Set, pending Set, settling, idle or unavailable samples", () => {
    const invalid: Partial<ExpressionProbeInput>[] = [
      { state: { kind: "none" } },
      { state: { kind: "failed", name: "smile", reason: "rejected" } },
      { state: { kind: "pending", name: "smile" } },
      { nowMs: 1000 },
      { playing: false },
      { available: false },
      { sample: undefined },
      { sample: { before: 0, after: 0, final: Number.NaN } },
      { sample: { before: 0, after: Number.POSITIVE_INFINITY, final: 1 } },
    ];
    for (const input of invalid) expect(describeExpressionProbe({ ...base, ...input })).not.toMatch(/probe: (yes|no)\b/u);
    expect(describeExpressionProbe({ ...base, playing: false })).toContain("reference");
  });
});
