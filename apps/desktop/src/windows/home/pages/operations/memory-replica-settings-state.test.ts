import { describe, expect, it } from "vitest";
import { replicaSettingsConfig, replicaSettingsDraft } from "./memory-replica-settings-state.ts";

describe("replica settings form", () => {
  it("keeps both configured intervals when automatic mode changes and represents defaults with visible units", () => {
    const config = { automatic: true, autoIntervalMs: 21_600_000, fullReconciliationIntervalMs: 604_800_000 };
    const draft = replicaSettingsDraft(config);
    expect(draft).toEqual({ automatic: true, incremental: { value: "6", unit: "hours" }, full: { value: "7", unit: "days" } });
    expect(replicaSettingsConfig({ ...draft, automatic: false })).toEqual({ ...config, automatic: false });
    const precise = { ...config, autoIntervalMs: 60_001, fullReconciliationIntervalMs: 120_001 };
    expect(replicaSettingsConfig(replicaSettingsDraft(precise))).toEqual(precise);
  });
  it("rejects empty, invalid and out-of-range intervals before save", () => {
    const draft = replicaSettingsDraft({ automatic: false, autoIntervalMs: 120_000, fullReconciliationIntervalMs: 604_800_000 });
    for (const value of ["", " ", "NaN", "0", "-1", "44641"]) {
      expect(replicaSettingsConfig({ ...draft, incremental: { value, unit: "minutes" } })).toBeNull();
    }
    expect(replicaSettingsConfig({ ...draft, full: { value: "90", unit: "days" } })).toMatchObject({ fullReconciliationIntervalMs: 90 * 86_400_000 });
    expect(replicaSettingsConfig({ ...draft, full: { value: "91", unit: "days" } })).toBeNull();
  });
});
