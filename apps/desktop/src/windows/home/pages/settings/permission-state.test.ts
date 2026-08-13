import { describe, expect, it } from "vitest";
import type { PermissionCellsState } from "@taki/shared";
import {
  applyCellResult,
  applyPermissionLoad,
  beginPermissionLoad,
  beginPermissionMutation,
  failPermissionLoad,
  failPermissionMutation,
  previousData,
  PermissionSnapshotValidationError,
} from "./permission-state.ts";

function snapshot(generation = 1): PermissionCellsState {
  return {
    level: "standard",
    policyGeneration: generation,
    registryRevision: 1,
    cells: [
      {
        key: "screenshot", level: "standard", capabilityId: "screenshot", descriptorRevision: 1,
        factoryPosture: "ask", overridePosture: null, effectivePosture: "ask",
        approvalMemory: "rememberable", overrideMode: "ordinary",
      },
    ],
  };
}

describe("permission state", () => {
  it("accepts only matching generation reads and suppresses retired-client results", () => {
    const old = beginPermissionLoad(1, null);
    const current = beginPermissionLoad(2, null);
    const late = applyPermissionLoad(current, { token: 1, level: snapshot(), cells: snapshot() });
    expect(late).toBe(current);
    expect(applyPermissionLoad(old, { token: 1, level: snapshot(), cells: snapshot() })).toMatchObject({
      kind: "ready",
      token: 1,
    });
  });

  it("rejects inconsistent level/cell snapshots as a validation/read failure", () => {
    const state = beginPermissionLoad(3, null);
    expect(applyPermissionLoad(state, { token: 3, level: snapshot(1), cells: snapshot(2) })).toMatchObject({
      kind: "failure",
      failureKind: "validation",
      message: "Core returned inconsistent permission snapshots",
    });
  });

  it("classifies controller-detected cross-method drift as validation failure", () => {
    expect(failPermissionLoad(
      beginPermissionLoad(4, null),
      4,
      new PermissionSnapshotValidationError(),
    )).toMatchObject({ kind: "failure", failureKind: "validation" });
  });

  it("applies a cell mutation echo and reset without classifying policy locally", () => {
    const ready = applyPermissionLoad(beginPermissionLoad(1, null), {
      token: 1,
      level: snapshot(),
      cells: snapshot(),
    });
    const pending = beginPermissionMutation(ready, 1, "screenshot");
    const saved = applyCellResult(pending, {
      token: 1,
      result: {
        policyGeneration: 2,
        registryRevision: 1,
        cell: { ...snapshot().cells[0]!, overridePosture: "auto", effectivePosture: "auto" },
      },
      message: "Cell override saved",
    });
    expect(previousData(saved)).toMatchObject({ policyGeneration: 2, cells: [{ overridePosture: "auto" }] });
    const reset = applyCellResult(saved, {
      token: 1,
      result: { policyGeneration: 3, registryRevision: 1, cell: snapshot().cells[0]! },
      message: "Override reset",
    });
    expect(previousData(reset)).toMatchObject({ policyGeneration: 3, cells: [{ overridePosture: null }] });
  });

  it("maps conflict, second-confirm and immutable structured errors without guessing from labels", () => {
    const ready = applyPermissionLoad(beginPermissionLoad(1, null), {
      token: 1,
      level: snapshot(),
      cells: snapshot(),
    });
    const conflict = failPermissionMutation(ready, 1, { data: { code: "POLICY_CONFLICT", currentPolicyGeneration: 9 } });
    const confirm = failPermissionMutation(ready, 1, { data: { code: "GOVERNANCE_REFUSED", reason: "second-confirm-required" } });
    const immutable = failPermissionMutation(ready, 1, { data: { code: "GOVERNANCE_REFUSED", reason: "immutable" } });
    expect(conflict).toMatchObject({ feedback: { kind: "conflict" } });
    expect(confirm).toMatchObject({ feedback: { kind: "refused", reason: "second-confirm-required" } });
    expect(immutable).toMatchObject({ feedback: { kind: "refused", reason: "immutable" } });
  });
});
