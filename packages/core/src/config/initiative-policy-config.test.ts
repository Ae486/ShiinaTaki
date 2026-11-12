import { afterEach, describe, expect, it } from "vitest";
import { createConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { createConfigSource } from "./config-source.ts";
import { createConfigWriter } from "./config-writer.ts";
import { INITIATIVE_POLICY_FIELDS, readInitiativePolicy } from "./initiative-policy-config.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });
function fixture(env: Record<string, string> = {}) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const repo = createConfigRepo(db); const changes: unknown[] = [];
  return { repo, changes, source: createConfigSource({ env, repo }),
    writer: createConfigWriter({ env, repo, onChanged: (change) => changes.push(change) }) };
}

describe("effective initiative policy", () => {
  it("registers each independent limit and TTL with stored > env > default precedence", () => {
    const f = fixture({ TAKI_INITIATIVE_MODEL_HOUR_LIMIT: "7" });
    expect(readInitiativePolicy(f.source)).toEqual({ modelHourLimit: 7, utteranceHourLimit: 2, utteranceDayLimit: 8,
      utteranceGapMs: 600_000, busyMaxWaitMs: 90_000, outputTtlMs: 600_000, scheduledOutputTtlMs: 86_400_000 });
    expect(f.writer.set({ key: "TAKI_INITIATIVE_MODEL_HOUR_LIMIT", value: 8 })).toMatchObject({ ok: true, apply: "live" });
    expect(readInitiativePolicy(f.source).modelHourLimit).toBe(8);
    expect(f.writer.set({ key: "TAKI_INITIATIVE_MODEL_HOUR_LIMIT", value: null }).ok).toBe(true);
    expect(readInitiativePolicy(f.source).modelHourLimit).toBe(7);
    for (const entry of Object.values(INITIATIVE_POLICY_FIELDS)) {
      expect(f.source.effectiveAll().find((value) => value.key === entry.key)).toMatchObject({ apply: "live" });
    }
    expect(f.writer.set({ key: "TAKI_INITIATIVE_OUTPUT_TTL_MS", value: 20_000 })).toMatchObject({ ok: true, apply: "live" });
    expect(f.writer.set({ key: "TAKI_SCHEDULED_OUTPUT_TTL_MS", value: 40_000 })).toMatchObject({ ok: true, apply: "live" });
    expect(readInitiativePolicy(f.source)).toMatchObject({ outputTtlMs: 20_000, scheduledOutputTtlMs: 40_000 });
  });

  it("rejects related-limit set and reset changes atomically before persistence or notification", () => {
    const f = fixture();
    expect(f.writer.set({ key: "TAKI_INITIATIVE_UTTERANCE_DAY_LIMIT", value: 1 })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(f.changes).toEqual([]); expect(f.repo.all().size).toBe(0);
    expect(f.writer.set({ key: "TAKI_INITIATIVE_UTTERANCE_DAY_LIMIT", value: 20 }).ok).toBe(true);
    expect(f.writer.set({ key: "TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT", value: 10 }).ok).toBe(true);
    expect(f.writer.set({ key: "TAKI_INITIATIVE_UTTERANCE_DAY_LIMIT", value: null })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(f.repo.get("TAKI_INITIATIVE_UTTERANCE_DAY_LIMIT")).toBe(20);
    expect(f.changes).toHaveLength(2);
  });

  it.each([0, -1, 1.5, 2_147_483_648, "invalid"])("refuses invalid configured duration %s without side effects", (value) => {
    const f = fixture();
    expect(f.writer.set({ key: "TAKI_INITIATIVE_BUSY_MAX_WAIT_MS", value })).toMatchObject({ ok: false, reason: "invalid-value" });
    expect(f.changes).toEqual([]); expect(f.repo.all().size).toBe(0);
  });

  it("fails closed for invalid environment policy and resets a valid scalar to its default", () => {
    expect(() => readInitiativePolicy(fixture({ TAKI_INITIATIVE_OUTPUT_TTL_MS: "invalid" }).source)).toThrow();
    const f = fixture();
    f.writer.set({ key: "TAKI_INITIATIVE_BUSY_MAX_WAIT_MS", value: 100 });
    expect(f.writer.set({ key: "TAKI_INITIATIVE_BUSY_MAX_WAIT_MS", value: null }).ok).toBe(true);
    expect(readInitiativePolicy(f.source).busyMaxWaitMs).toBe(90_000);
    expect(f.repo.all().size).toBe(0);
  });
});
