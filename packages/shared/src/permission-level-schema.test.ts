import { describe, expect, it } from "vitest";
import {
  PERMISSION_METHODS,
  PermissionCellKeySchema,
  PermissionCellSetParamsSchema,
  PermissionCellStateSchema,
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

  it("keys cells on capability or capability:class without enumerating members", () => {
    // Future classes (exec batch B, dir-root batch C) must fit WITHOUT a schema change — the key is a shape,
    // not a closed union.
    for (const key of ["screenshot", "shell-open:url-safe", "exec:compound", "fs-write:root:C:\\data"]) {
      expect(PermissionCellKeySchema.safeParse(key).success).toBe(true);
    }
    for (const bad of ["", "Shell-Open:x", ":url-safe", "shell open:x", "9cap"]) {
      expect(PermissionCellKeySchema.safeParse(bad).success).toBe(false);
    }
  });

  it("levelSet/levelGet carry a single strict level field", () => {
    expect(PermissionLevelStateSchema.safeParse({ level: "relaxed" }).success).toBe(true);
    expect(PermissionLevelStateSchema.safeParse({ level: "relaxed", extra: 1 }).success).toBe(false);
    expect(PermissionLevelStateSchema.safeParse({}).success).toBe(false);
  });

  it("a cell state marks deny-by-default floor cells", () => {
    const floor = { key: "shell-open:blocked", level: "relaxed", posture: "deny", denyByDefault: true };
    expect(PermissionCellStateSchema.safeParse(floor).success).toBe(true);
    expect(PermissionCellStateSchema.safeParse({ ...floor, posture: "allow" }).success).toBe(false);
  });

  it("cellSet carries the optional second-confirm marker and stays strict", () => {
    const params = { key: "shell-open:local-exec", level: "standard", posture: "auto" };
    expect(PermissionCellSetParamsSchema.safeParse(params).success).toBe(true);
    expect(PermissionCellSetParamsSchema.safeParse({ ...params, secondConfirm: true }).success).toBe(true);
    expect(PermissionCellSetParamsSchema.safeParse({ ...params, confirm: true }).success).toBe(false);
  });
});
