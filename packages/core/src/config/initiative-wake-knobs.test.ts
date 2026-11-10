import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createConfigRepo } from "../db/config-repo.ts";
import { createConfigSource } from "./config-source.ts";
import { createConfigWriter } from "./config-writer.ts";
import { CONFIG_KNOBS } from "./knob-registry.ts";
import { INITIATIVE_TARGET_KEY, INITIATIVE_WAKE_KNOBS } from "./initiative-wake-knobs.ts";
import { INITIATIVE_WAKE_FIELDS, readInitiativeWakePolicy, validateInitiativeWakeChange } from "./initiative-wake-config.ts";
import { readInitiativePolicy } from "./initiative-policy-config.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function setup(env: Record<string, string | undefined> = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const repo = createConfigRepo(db); const onChanged = vi.fn();
  return { db, repo, onChanged, source: createConfigSource({ repo, env }), writer: createConfigWriter({ repo, env, onChanged }) };
}

describe("initiative wake config authority", () => {
  it("registers unique live knobs with valid declared defaults while dispatch remains opt-in", () => {
    const f = setup();
    for (const knob of INITIATIVE_WAKE_KNOBS) {
      expect(CONFIG_KNOBS.filter((entry) => entry.key === knob.key)).toHaveLength(1);
      expect(knob.apply).toBe("live");
      if (knob.default !== null) expect(knob.schema.safeParse(knob.default).success).toBe(true);
    }
    expect(readInitiativeWakePolicy(f.source)).toEqual(Object.fromEntries(Object.entries(INITIATIVE_WAKE_FIELDS).map(([field, value]) => [field, value.default])));
    expect(f.source.resolve(INITIATIVE_TARGET_KEY)?.value).toBeNull();
    expect(f.source.resolve("TAKI_INITIATIVE_ENABLED")?.value).toBe(false);
    expect(f.repo.all().size).toBe(0);
  });

  it.each([
    ["TAKI_INITIATIVE_CHECK_INTERVAL_MS", 999], ["TAKI_INITIATIVE_CHECK_INTERVAL_MS", 3_600_001],
    ["TAKI_INITIATIVE_MODEL_CADENCE_MS", 299_999], ["TAKI_INITIATIVE_JITTER_RATIO", 0.50001],
    ["TAKI_INITIATIVE_JITTER_RATIO", -0.01], ["TAKI_INITIATIVE_QUIET_START", "24:00"],
    ["TAKI_INITIATIVE_QUIET_END", "8:00"], ["TAKI_INITIATIVE_PERIODIC_ENABLED", "true"],
    [INITIATIVE_TARGET_KEY, "  "],
  ] as const)("refuses %s=%s before mutation or notification", (key, value) => {
    const f = setup();
    expect(f.writer.set({ key, value })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(f.repo.all().size).toBe(0); expect(f.onChanged).not.toHaveBeenCalled();
  });

  it("resolves stored/env/default precedence and applies resets without changing aggregate quotas", () => {
    const f = setup({ TAKI_INITIATIVE_MODEL_CADENCE_MS: "1200000" });
    const policy = readInitiativePolicy(f.source);
    expect(f.writer.set({ key: "TAKI_INITIATIVE_MODEL_CADENCE_MS", value: 900000 })).toMatchObject({ ok: true, apply: "live" });
    expect(f.writer.set({ key: "TAKI_INITIATIVE_EVENTS_ENABLED", value: false }).ok).toBe(true);
    expect(f.writer.set({ key: INITIATIVE_TARGET_KEY, value: " taki " })).toMatchObject({ ok: true, value: "taki", apply: "live" });
    expect(readInitiativeWakePolicy(f.source)).toMatchObject({ modelCadenceMs: 900000, eventsEnabled: false });
    expect(f.writer.set({ key: "TAKI_INITIATIVE_MODEL_CADENCE_MS", value: null }).ok).toBe(true);
    expect(readInitiativeWakePolicy(f.source).modelCadenceMs).toBe(1200000);
    expect(f.writer.set({ key: "TAKI_INITIATIVE_EVENTS_ENABLED", value: null }).ok).toBe(true);
    expect(readInitiativeWakePolicy(f.source).eventsEnabled).toBe(true);
    expect(f.repo.get("TAKI_INITIATIVE_EVENTS_ENABLED")).toBeNull();
    expect(readInitiativePolicy(f.source)).toEqual(policy);
    expect(f.source.resolve("TAKI_INITIATIVE_ENABLED")?.value).toBe(false);
  });

  it("validates the entire effective candidate and refuses corrupt sibling settings", () => {
    const f = setup({ TAKI_INITIATIVE_MODEL_CADENCE_MS: "invalid" });
    expect(() => readInitiativeWakePolicy(f.source)).toThrow();
    expect(validateInitiativeWakeChange(f.source, { key: "TAKI_INITIATIVE_QUIET_START", value: "22:00" })).toBeTypeOf("string");
    expect(f.writer.set({ key: "TAKI_INITIATIVE_QUIET_START", value: "22:00" })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(f.repo.all().size).toBe(0); expect(f.onChanged).not.toHaveBeenCalled();
    expect(validateInitiativeWakeChange(f.source, { key: "TAKI_MAX_STEPS", value: 5 })).toBeNull();
  });
});
