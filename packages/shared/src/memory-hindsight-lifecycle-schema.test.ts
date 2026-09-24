import { describe, expect, it } from "vitest";
import { MemoryHindsightStatusSectionSchema } from "./memory-hindsight-lifecycle-schema.ts";

const at = "2026-09-24T00:00:00.000Z";
const global = { scope: "global", characterId: null, nativeBankId: "taki-hs-v1-g-a", readiness: "ready", errorCode: null } as const;
const section = {
  connection: { config: "ready", drift: "none", admittedAt: at },
  banks: [global,
    { scope: "character", characterId: "taki", nativeBankId: "taki-hs-v1-c-b", readiness: "syncing", errorCode: null },
    { scope: "character", characterId: "sayo", nativeBankId: "taki-hs-v1-c-c", readiness: "provisioning", errorCode: null },
    { scope: "character", characterId: "rana", nativeBankId: "taki-hs-v1-c-d", readiness: "failed", errorCode: "HINDSIGHT_TEMPLATE_INVALID" },
    { scope: "character", characterId: "mika", nativeBankId: null, readiness: "not_provisioned", errorCode: null }],
  actions: { revalidate: false, provision: [] },
} as const;

describe("Hindsight lifecycle status section", () => {
  it("accepts every readiness state and both new connection codes", () => {
    expect(MemoryHindsightStatusSectionSchema.parse(section)).toEqual(section);
    const occupied = { ...section, banks: [global, { ...section.banks[4], nativeBankId: "taki-hs-v1-c-e", errorCode: "HINDSIGHT_BANK_OCCUPIED" }] };
    expect(MemoryHindsightStatusSectionSchema.safeParse(occupied).success).toBe(true);
    const disabled = { ...section, connection: { config: "disabled", drift: "none", admittedAt: null },
      banks: [{ ...global, readiness: "failed", errorCode: "HINDSIGHT_CONNECTION_DISABLED" }] };
    expect(MemoryHindsightStatusSectionSchema.safeParse(disabled).success).toBe(true);
  });

  it.each(["none", "config_changed", "unreviewed"] as const)("accepts drift %s on a ready connection", (drift) => {
    expect(MemoryHindsightStatusSectionSchema.safeParse({ ...section, connection: { ...section.connection, drift } }).success).toBe(true);
  });

  it("refuses drift or admission evidence without a ready connection", () => {
    for (const connection of [{ config: "disabled", drift: "config_changed", admittedAt: null }, { config: "unconfigured", drift: "none", admittedAt: at }]) {
      expect(MemoryHindsightStatusSectionSchema.safeParse({ ...section, connection }).success).toBe(false);
    }
  });

  it("refuses contradictory Bank rows and duplicate actions", () => {
    const invalid = [
      [global, global],
      [{ ...global, characterId: "taki" }],
      [{ ...global, nativeBankId: null }],
      [{ ...global, errorCode: "HINDSIGHT_TIMEOUT" }],
      [{ ...global, readiness: "unknown" }],
    ];
    for (const banks of invalid) expect(MemoryHindsightStatusSectionSchema.safeParse({ ...section, banks }).success).toBe(false);
    expect(MemoryHindsightStatusSectionSchema.safeParse({ ...section, actions: { revalidate: true, provision: ["mika", "mika"] } }).success).toBe(false);
    expect(MemoryHindsightStatusSectionSchema.safeParse({ ...section, extra: true }).success).toBe(false);
  });
});
