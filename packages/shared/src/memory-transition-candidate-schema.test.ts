import { describe, expect, it } from "vitest";
import { MemoryTransitionLocalStateSchema, MemoryTransitionLocalCaptureSchema } from "./memory-transition-candidate-schema.ts";

const at = "2026-10-01T00:00:00.000Z";
const bank = { authorityEpochId: "epoch", bankId: "bank", scope: { kind: "global", characterId: null }, name: "Global",
  disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "", config: JSON.parse('{"__proto__":{"literal":true},"empty":"","value":null}'),
  revision: 1, createdAt: at, updatedAt: at };
const state = { banks: [bank], sources: [], records: [], derived: [], blocks: [], history: [] };
describe("complete transition storage schema", () => {
  it("preserves inert own JSON keys, null and empty values", () => {
    const parsed = MemoryTransitionLocalStateSchema.parse(state);
    expect(parsed.banks[0]?.config).toEqual(bank.config); expect(Object.hasOwn(parsed.banks[0]!.config, "__proto__")).toBe(true);
  });
  it("rejects duplicate logical scope and a wrong capture epoch", () => {
    expect(MemoryTransitionLocalStateSchema.safeParse({ ...state, banks: [bank, { ...bank, bankId: "other" }] }).success).toBe(false);
    expect(MemoryTransitionLocalCaptureSchema.safeParse({ version: 1, captureId: "a".repeat(64),
      transitionId: "11111111-1111-4111-8111-111111111111", epochId: "foreign", capturedAt: at,
      contentHash: "a".repeat(64), inventoryHash: "a".repeat(64), witnesses: [], dispositions: [], state }).success).toBe(false);
  });
});
