import { describe, expect, it } from "vitest";
import { MemoryTidyFailureDetailsSchema, MemoryTidyResultSchema } from "@taki/shared";
import type { TidyRunOutcome } from "../../memory/tidy-pass.ts";
import type { MethodContext } from "../method-registry.ts";
import { memoryTidyMethod } from "./memory-tidy.ts";
import { createMethodRegistry } from "../method-registry.ts";

const CTX = {} as MethodContext;

function outcome(status: TidyRunOutcome["status"]): TidyRunOutcome {
  return {
    status,
    defects: { missingDisclosure: 1, overBudget: 0, stale: 2, nearDuplicate: 0, misfiled: 3 },
    edits: 2,
    steps: 4,
    usage: { calls: 1, inputTokens: 120, outputTokens: 30, usageUnknown: 0 },
  };
}

describe("memory.tidy method (batch 4b — operator-only maintenance surface)", () => {
  it("registers as memory.tidy for operators and requires a characterId", () => {
    const def = memoryTidyMethod({ runNow: async () => outcome("ran") });

    expect(def.method).toBe("memory.tidy");
    expect(def.roles).toEqual(["operator"]);
    expect(def.paramsSchema.safeParse({}).success).toBe(false);
    expect(def.paramsSchema.safeParse({ characterId: "taki" }).success).toBe(true);
  });

  it("returns the protocol result shape — counts and usage only, schema-conformant", async () => {
    let asked = "";
    const def = memoryTidyMethod({
      runNow: async (characterId) => {
        asked = characterId;
        return outcome("ran");
      },
    });

    const result = await def.handler({ characterId: "taki" }, CTX);

    expect(asked).toBe("taki");
    expect(MemoryTidyResultSchema.parse(result)).toMatchObject({ status: "ran", edits: 2, steps: 4 });
  });

  it("surfaces a failed pass as an ERROR, never a fake success", async () => {
    const def = memoryTidyMethod({ runNow: async () => outcome("failed") });

    await expect(def.handler({ characterId: "taki" }, CTX)).rejects.toThrow(/tidy pass failed/);
  });

  it("preserves actual partial edits and safe reasons through the real registry error envelope", async () => {
    const registry = createMethodRegistry();
    registry.register(memoryTidyMethod({ runNow: async () => ({ ...outcome("failed"),
      reason: "tool-errors", issues: [{ toolName: "memory_reinforce", code: "MEMORY_REVISION_MISMATCH" }], issueCount: 1,
    }) }));
    const context: MethodContext = { connection: { state: { status: "authenticated", deviceId: "operator", role: "operator", capabilities: [] } },
      notify: () => undefined, onClose: () => undefined, close: () => undefined };
    const response = await registry.dispatch({ jsonrpc: "2.0", id: 1, method: "memory.tidy", params: { characterId: "taki" } }, context);
    expect(response).toHaveProperty("error");
    if ("error" in response && response.error) {
      expect(response.error.code).toBe(-32603);
      expect(MemoryTidyFailureDetailsSchema.parse(response.error.data)).toMatchObject({
        kind: "memory-tidy", status: "partial", edits: 2, steps: 4, reason: "tool-errors", issueCount: 1,
      });
    }
  });

  it("uses generic failure detail when an existing adapter has no fine-grained producer", async () => {
    const method = memoryTidyMethod({ runNow: async () => ({ ...outcome("failed"), edits: 0 }) });
    await expect(method.handler({ characterId: "taki" }, CTX)).rejects.toMatchObject({ data: {
      status: "failed", edits: 0, reason: "execution-failed", issues: [], issueCount: 0,
    } });
  });
});
