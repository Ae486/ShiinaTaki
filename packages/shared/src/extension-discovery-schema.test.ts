import { describe, expect, it } from "vitest";
import {
  ExtensionConvergenceResultSchema,
  ExtensionCallResultSchema,
  ExtensionDescriptorSchema,
  ExtensionDescribeResultSchema,
  ExtensionRunSnapshotSchema,
  EXTENSION_DISCOVERY_BUDGET,
} from "./extension-discovery-schema.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const entry = {
  identity: {
    extensionId: "capability:11111111:screenshot",
    kind: "capability" as const,
    ownerHostId: HOST,
    subjectId: "screenshot",
    subjectRevision: "descriptor.1",
    connectionGeneration: 2,
    catalogGeneration: 4,
  },
  displayName: "Screenshot",
  summary: "Read the current screen",
  callMode: "capability" as const,
  modelKey: "ext_capability_11111111_screenshot",
  available: true,
};

describe("extension discovery schemas", () => {
  it("accepts an optional bounded direct tool name only on describe results", () => {
    const result = { runId: HOST, entry, toolName: "server_exact_echo" };
    expect(ExtensionDescribeResultSchema.parse(result)).toEqual(result);
    expect(ExtensionDescribeResultSchema.safeParse({ runId: HOST, entry: null }).success).toBe(true);
    expect(ExtensionDescriptorSchema.safeParse({ ...entry, toolName: result.toolName }).success).toBe(false);
    for (const toolName of ["", "../path", "name with spaces", "x".repeat(257)]) {
      expect(ExtensionDescribeResultSchema.safeParse({ ...result, toolName }).success).toBe(false);
    }
    for (const extra of [{ inputSchema: { type: "object" } }, { parameters: {} }]) {
      expect(ExtensionDescribeResultSchema.safeParse({ ...result, ...extra }).success).toBe(false);
      expect(ExtensionDescriptorSchema.safeParse({ ...entry, ...extra }).success).toBe(false);
    }
  });

  it("accepts a bounded host-qualified run snapshot", () => {
    expect(ExtensionRunSnapshotSchema.safeParse({
      runId: HOST,
      primaryHostId: HOST,
      hosts: [{ hostId: HOST, available: true, connectionGeneration: 2, catalogGeneration: 4, extensionCount: 1 }],
      entries: [entry],
      collisions: [],
      budget: EXTENSION_DISCOVERY_BUDGET,
    }).success).toBe(true);
    expect(ExtensionConvergenceResultSchema.safeParse({
      observedAt: "2026-08-18T00:00:00.000Z",
      coreHostId: HOST,
      hosts: [{ hostId: HOST, available: true, connectionGeneration: 2, catalogGeneration: 4, extensionCount: 1 }],
      entries: [entry],
      collisions: [],
    }).success).toBe(true);
  });

  it("rejects identity fields that could become a path or unbounded key", () => {
    expect(ExtensionDescriptorSchema.safeParse({ ...entry, identity: { ...entry.identity, extensionId: "../evil" } }).success).toBe(false);
    expect(ExtensionDescriptorSchema.safeParse({ ...entry, displayName: "x".repeat(161) }).success).toBe(false);
  });

  it("requires owner provenance for every resolved extension result", () => {
    const failure = {
      ok: false,
      code: "EXTENSION_STALE_GENERATION",
      message: "the captured extension generation is stale",
      owner: entry.identity,
    };
    expect(ExtensionCallResultSchema.safeParse(failure).success).toBe(true);
    expect(ExtensionCallResultSchema.safeParse({ ...failure, owner: undefined }).success).toBe(false);
    expect(ExtensionCallResultSchema.safeParse({ ...failure, code: "ARBITRARY" }).success).toBe(false);
    expect(ExtensionCallResultSchema.safeParse({ ok: true, owner: entry.identity, code: failure.code }).success).toBe(false);
    expect(ExtensionCallResultSchema.safeParse({ ok: false, owner: entry.identity }).success).toBe(false);
    expect(ExtensionCallResultSchema.safeParse({
      ok: false,
      code: "EXTENSION_NOT_FOUND",
      message: "the extension id is not present in this Run snapshot",
    }).success).toBe(true);
    expect(ExtensionCallResultSchema.safeParse({
      ok: false,
      code: "EXTENSION_CALL_FAILED",
      message: "the extension call failed",
    }).success).toBe(false);
  });
});
