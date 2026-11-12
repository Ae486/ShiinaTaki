import { describe, expect, it } from "vitest";
import { EXTENSION_METHODS, ExtensionConvergenceResultSchema } from "./extension-discovery-schema.ts";
import {
  EXTENSION_CHANGE_TARGETS, ExtensionChangedSchema, ExtensionChangeTargetSchema,
  ExtensionSubscribeParamsSchema, ExtensionSubscribeResultSchema,
} from "./extension-change-schema.ts";

describe("extension subscription and change protocol", () => {
  it("adds one opt-in channel while retaining the existing extension status method", () => {
    expect(EXTENSION_METHODS).toEqual({ status: "extension.status", subscribe: "extension.subscribe", changed: "extension.changed" });
    expect(ExtensionSubscribeParamsSchema.parse({})).toEqual({});
    expect(ExtensionSubscribeResultSchema.parse({ status: "ok" })).toEqual({ status: "ok" });
    for (const params of [null, [], { targets: ["mcp"] }, { hostId: "private-host" }]) {
      expect(ExtensionSubscribeParamsSchema.safeParse(params).success).toBe(false);
    }
    for (const result of [{}, { status: "unknown" }, { status: "ok", revision: 1 }]) {
      expect(ExtensionSubscribeResultSchema.safeParse(result).success).toBe(false);
    }
  });

  it("accepts only a nonempty unique subset of the three bounded targets", () => {
    for (const target of EXTENSION_CHANGE_TARGETS) expect(ExtensionChangeTargetSchema.parse(target)).toBe(target);
    for (const targets of [["mcp"], ["skills", "mcp"], [...EXTENSION_CHANGE_TARGETS]]) {
      expect(ExtensionChangedSchema.parse({ revision: 1, targets })).toEqual({ revision: 1, targets });
    }
    for (const targets of [[], ["mcp", "mcp"], ["mcp", "skills", "extension-status", "mcp"], ["unknown"], ["skill"], "mcp", null]) {
      expect(ExtensionChangedSchema.safeParse({ revision: 1, targets }).success).toBe(false);
    }
  });

  it("accepts safe nonnegative revisions and rejects source data or parallel identity fields", () => {
    for (const revision of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(ExtensionChangedSchema.parse({ revision, targets: ["mcp"] })).toEqual({ revision, targets: ["mcp"] });
    }
    for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, "1", null]) {
      expect(ExtensionChangedSchema.safeParse({ revision, targets: ["mcp"] }).success).toBe(false);
    }
    for (const field of ["hostId", "serverId", "packageId", "config", "secretRef", "secret", "path", "error", "output"]) {
      expect(ExtensionChangedSchema.safeParse({ revision: 1, targets: ["mcp"], [field]: "private" }).success).toBe(false);
    }
  });

  it("does not turn the existing status response into a versioned snapshot", () => {
    const status = { observedAt: "2026-09-08T00:00:00.000Z", coreHostId: "11111111-1111-4111-8111-111111111111", hosts: [], entries: [], collisions: [] };
    expect(ExtensionConvergenceResultSchema.parse(status)).toEqual(status);
    expect(ExtensionConvergenceResultSchema.safeParse({ ...status, revision: 1 }).success).toBe(false);
  });
});
