import { afterEach, describe, expect, it } from "vitest";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createInitiativeOpportunityRepo } from "./initiative-opportunity-repo.ts";

const fixtures: ReturnType<typeof initiativeFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.db.close(); });
const start = "2026-09-26T12:00:00.000Z";

function fixture() {
  let at = start;
  const f = initiativeFixture(() => at); fixtures.push(f);
  const repo = createInitiativeOpportunityRepo(f.db, () => at);
  return { ...f, repo, now: () => at, advance: (ms: number) => { at = new Date(Date.parse(at) + ms).toISOString(); },
    reserve: (key: string, hourLimit = 1) => repo.reserve({ key, hourLimit, expiresAt: "2026-09-27T12:00:00.000Z" }),
    row: (key: string) => f.db.prepare("SELECT * FROM initiative_model_opportunities WHERE opportunity_key=:key").get({ key }) };
}

describe("initiative model-opportunity budget", () => {
  it("reserves globally before a Run and releases unused capacity without charging", () => {
    const f = fixture();
    expect(f.reserve("character-a:one")).toBe(true);
    expect(f.reserve("character-b:two")).toBe(false);
    expect(f.reserve("character-a:one")).toBe(false);
    expect(() => f.repo.charge("character-a:one", 1)).toThrow("INITIATIVE_MODEL_BUDGET");
    f.repo.release("character-a:one");
    expect(f.reserve("character-b:two")).toBe(true);
    expect(f.row("character-a:one")).toMatchObject({ state: "released", charged_at: null });
    expect(f.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(0);
  });

  it("counts one opportunity across model Effects and preserves the charge after failure and repository recreation", async () => {
    const f = fixture(); const run = await f.admit();
    expect(f.reserve("one")).toBe(true); f.repo.link("one", run.runId);
    for (let i = 0; i < 2; i++) {
      const effect = f.effects.prepare({ ...run, kind: "model", sourceRef: { type: "model", provider: "test", modelId: "test" },
        replayPosture: "never", onCommitIntent: () => f.repo.charge("one", 1) });
      f.effects.settle({ ...run, effectId: effect.effectId, expectedVersion: effect.version, outcome: "failed" });
    }
    f.runs.settle(run.runId, run.attemptId, "failed"); f.repo.release("one");
    const reopened = createInitiativeOpportunityRepo(f.db, f.now);
    expect(reopened.reserve({ key: "one", hourLimit: 1, expiresAt: "2026-09-27T12:00:00.000Z" })).toBe(true);
    expect(f.reserve("two")).toBe(false);
    expect(f.row("one")).toMatchObject({ state: "charged", charged_at: start });
    expect(f.effects.list?.(run.runId)).toHaveLength(2);
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    f.advance(3_600_000);
    expect(f.reserve("two")).toBe(true);
  });

  it("rolls the first charge back with a failed model intent before any provider dispatch", async () => {
    const f = fixture(); const run = await f.admit();
    f.reserve("one"); f.repo.link("one", run.runId);
    f.db.exec(`CREATE TRIGGER fail_model_intent BEFORE INSERT ON run_events
      WHEN NEW.kind='effect.intent_committed' BEGIN SELECT RAISE(ABORT,'event write failed'); END`);
    expect(() => f.effects.prepare({ ...run, kind: "model", sourceRef: { type: "model", provider: "test", modelId: "test" },
      replayPosture: "never", onCommitIntent: () => f.repo.charge("one", 1) })).toThrow("event write failed");
    expect(f.row("one")).toMatchObject({ state: "reserved", charged_at: null });
    expect(f.effects.list?.(run.runId)).toEqual([]);
    f.repo.release("one"); expect(f.reserve("two")).toBe(true);
  });

  it("rechecks a tightened model limit at the first intent without changing charged history", async () => {
    const f = fixture(); const run = await f.admit();
    f.reserve("one", 2); f.reserve("two", 2); f.repo.link("one", run.runId);
    expect(() => f.repo.charge("one", 1)).toThrow("INITIATIVE_MODEL_BUDGET");
    expect(f.row("one")?.charged_at).toBeNull();
    f.repo.release("two"); f.repo.charge("one", 1);
    expect(f.row("one")?.charged_at).toBe(start);
    expect(() => f.repo.link("one", "another-run")).toThrow("INITIATIVE_OPPORTUNITY_CONFLICT");
  });

  it("uses absolute expiry for offset manifests so expired reservations cannot block a later opportunity", () => {
    const f = fixture();
    expect(f.repo.reserve({ key: "offset", hourLimit: 1, expiresAt: "2026-09-26T20:00:01+08:00" })).toBe(true);
    expect(f.row("offset")?.expires_at).toBe("2026-09-26T12:00:01.000Z");
    f.advance(1_000);
    expect(f.reserve("later")).toBe(true);
  });
});
