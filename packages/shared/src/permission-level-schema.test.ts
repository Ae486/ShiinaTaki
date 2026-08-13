import { describe, expect, it } from "vitest";
import {
  LegacyPermissionCellSetParamsSchema,
  LegacyPermissionCellStateSchema,
  LegacyPermissionLevelStateSchema,
  PERMISSION_METHODS,
  PermissionCellKeySchema,
  PermissionCellSetParamsSchema,
  PermissionCellStateSchema,
  PermissionLevelSetParamsSchema,
  PermissionLevelSchema,
  PermissionLevelStateSchema,
} from "./permission-level-schema.ts";

describe("permission-level-schema", () => {
  it("names the operator-role permission methods", () => {
    expect(PERMISSION_METHODS).toEqual({
      levelGet: "permission.levelGet",
      levelSet: "permission.levelSet",
      cellsGet: "permission.cellsGet",
      cellSet: "permission.cellSet",
    });
  });

  it("accepts exactly the three ordered levels", () => {
    for (const level of ["strict", "standard", "relaxed"]) {
      expect(PermissionLevelSchema.safeParse(level).success).toBe(true);
    }
    // "yolo" is Hermes vocabulary for relaxed, not a wire value; "full" is the rejected no-floor mode.
    for (const bad of ["yolo", "full", "Standard", ""]) {
      expect(PermissionLevelSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("keys canonical policy cells on capability or capability:class only", () => {
    for (const key of ["screenshot", "shell-open:url-safe", "exec:compound", "fs-write:dir-root"]) {
      expect(PermissionCellKeySchema.safeParse(key).success).toBe(true);
    }
    for (const bad of ["", "Shell-Open:x", ":url-safe", "shell open:x", "9cap", "fs-write:dir-root:C:\\data"]) {
      expect(PermissionCellKeySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("level reads and optimistic mutations carry durable generations", () => {
    expect(PermissionLevelStateSchema.safeParse({ level: "relaxed", policyGeneration: 2, registryRevision: 1 }).success).toBe(true);
    expect(PermissionLevelStateSchema.safeParse({ level: "relaxed", policyGeneration: 2, registryRevision: 1, extra: 1 }).success).toBe(false);
    expect(PermissionLevelStateSchema.safeParse({}).success).toBe(false);
    expect(PermissionLevelSetParamsSchema.safeParse({ level: "strict", expectedPolicyGeneration: 2 }).success).toBe(true);
  });

  it("a cell state distinguishes factory, override, effective, and edit mode", () => {
    const floor = {
      key: "shell-open:blocked", capabilityId: "shell-open", descriptorRevision: 1,
      level: "relaxed", factoryPosture: "deny", overridePosture: null, effectivePosture: "deny",
      approvalMemory: "once-only", overrideMode: "second-confirm",
    };
    expect(PermissionCellStateSchema.safeParse(floor).success).toBe(true);
    expect(PermissionCellStateSchema.safeParse({ ...floor, effectivePosture: "allow" }).success).toBe(false);
  });

  it("cellSet carries the optional second-confirm marker and stays strict", () => {
    const params = { key: "shell-open:local-exec", level: "standard", posture: "auto", expectedPolicyGeneration: 2 };
    expect(PermissionCellSetParamsSchema.safeParse(params).success).toBe(true);
    expect(PermissionCellSetParamsSchema.safeParse({ ...params, secondConfirm: true }).success).toBe(true);
    expect(PermissionCellSetParamsSchema.safeParse({ ...params, posture: null }).success).toBe(true);
    expect(PermissionCellSetParamsSchema.safeParse({ ...params, confirm: true }).success).toBe(false);
  });

  it("keeps the pre-Host-projection leaf contract isolated for Rust golden fixtures", () => {
    expect(LegacyPermissionLevelStateSchema.safeParse({ level: "standard" }).success).toBe(true);
    expect(LegacyPermissionCellStateSchema.safeParse({
      key: "shell-open:blocked", level: "relaxed", posture: "deny", denyByDefault: true,
    }).success).toBe(true);
    expect(LegacyPermissionCellSetParamsSchema.safeParse({
      key: "shell-open:local-exec", level: "standard", posture: "auto", secondConfirm: true,
    }).success).toBe(true);
  });
});
