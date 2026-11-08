import { describe, expect, it } from "vitest";
import { MemoryReplicaConfigureParamsSchema, MemoryReplicaChangedSchema } from "./memory-replica-rpc-schema.ts";

const config = { automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 604_800_000 };
describe("replica configuration protocol", () => {
  it("requires a complete config without defaulting an omitted interval on mode edits", () => {
    expect(MemoryReplicaConfigureParamsSchema.parse({ bankId: "global", config })).toEqual({ bankId: "global", config });
    for (const field of ["automatic", "autoIntervalMs", "fullReconciliationIntervalMs"]) {
      const partial = { ...config }; Reflect.deleteProperty(partial, field);
      expect(MemoryReplicaConfigureParamsSchema.safeParse({ bankId: "global", config: partial }).success).toBe(false);
    }
    expect(MemoryReplicaConfigureParamsSchema.safeParse({ bankId: "global", config: { ...config, extra: true } }).success).toBe(false);
  });
  it("retains existing one-minute and 31/90-day bounds", () => {
    expect(MemoryReplicaConfigureParamsSchema.safeParse({ bankId: "global", config: { ...config, autoIntervalMs: 60_000, fullReconciliationIntervalMs: 90 * 86_400_000 } }).success).toBe(true);
    for (const patch of [{ autoIntervalMs: 59_999 }, { autoIntervalMs: 31 * 86_400_000 + 1 }, { fullReconciliationIntervalMs: 90 * 86_400_000 + 1 }]) {
      expect(MemoryReplicaConfigureParamsSchema.safeParse({ bankId: "global", config: { ...config, ...patch } }).success).toBe(false);
    }
    expect(MemoryReplicaChangedSchema.parse({ bankId: "character-taki" })).toEqual({ bankId: "character-taki" });
    expect(MemoryReplicaChangedSchema.safeParse({ bankId: "global", operation: {} }).success).toBe(false);
  });
});
