import { describe, expect, it } from "vitest";
import { MemoryStatusResultSchema } from "@taki/shared";
import type { MethodContext } from "../method-registry.ts";
import { memoryStatusMethod, type MemoryStatusDeps } from "./memory-status.ts";

const CTX = {} as MethodContext;

const SLOT = { slot: "main", effectiveWindow: 120_000, factor: 1.08, updatedAt: "2026-08-03T10:00:00.000Z" };
const META = { throughSeq: 42, textChars: 900, updatedAt: "2026-08-03T10:01:00.000Z" };
const AUTO = { lastEpisodicSeq: 40, lastFlushSeq: 38, lastTidyAt: "2026-08-02T09:00:00.000Z" };

function deps(overrides: Partial<MemoryStatusDeps> = {}): MemoryStatusDeps {
  return {
    windowState: { list: () => [SLOT] },
    summaries: { getMeta: () => META },
    autoState: { get: () => AUTO },
    ...overrides,
  };
}

describe("memory.status method (#26 batch 4 — operator status read)", () => {
  it("registers as memory.status for operators and requires a characterId", () => {
    const def = memoryStatusMethod(deps());

    expect(def.method).toBe("memory.status");
    expect(def.roles).toEqual(["operator"]);
    expect(def.paramsSchema.safeParse({}).success).toBe(false);
    expect(def.paramsSchema.safeParse({ characterId: "taki" }).success).toBe(true);
  });

  it("round-trips the repo values through the protocol schema", () => {
    let asked = "";
    const def = memoryStatusMethod(
      deps({
        summaries: {
          getMeta: (characterId) => {
            asked = characterId;
            return META;
          },
        },
      }),
    );

    const result = MemoryStatusResultSchema.parse(def.handler({ characterId: "taki" }, CTX));

    expect(asked).toBe("taki");
    expect(result).toEqual({ windowSlots: [SLOT], summary: META, auto: AUTO });
  });

  it("reports a never-compacted, never-tidied character as nulls rather than absent fields", () => {
    const def = memoryStatusMethod(
      deps({
        windowState: { list: () => [] },
        summaries: { getMeta: () => null },
        autoState: { get: () => ({ lastEpisodicSeq: 0, lastFlushSeq: 0, lastTidyAt: null }) },
      }),
    );

    const result = MemoryStatusResultSchema.parse(def.handler({ characterId: "taki" }, CTX));

    expect(result.summary).toBeNull();
    expect(result.auto.lastTidyAt).toBeNull();
    expect(result.windowSlots).toEqual([]);
  });

  it("lets NO memory content cross: the response carries the summary's length, never its text", () => {
    const def = memoryStatusMethod(deps());

    const result = MemoryStatusResultSchema.parse(def.handler({ characterId: "taki" }, CTX));

    expect(JSON.stringify(result)).not.toContain("text\"");
    expect(Object.keys(result.summary ?? {})).toEqual(["throughSeq", "textChars", "updatedAt"]);
  });
});
