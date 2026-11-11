import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadHindsightPolicyReviewConfig } from "../../config/hindsight-policy-config.ts";
import { createHindsightPolicyReviewRepo, readHindsightPolicyReviewStatus } from "../../db/hindsight-policy-review-repo.ts";
import { createCanonicalLocalWriteFence } from "../canonical-local-write-fence.ts";
import { createHindsightPolicySchedule } from "./hindsight-policy-schedule.ts";
import * as replicaQueries from "../../db/hindsight-application-replica-query.ts";
import { curatorTestFixture, curatorTestBank, curatorTestAssessDriver, curatorTestReport, curatorTestTarget,
} from "./hindsight-policy-curator-fixtures.ts";

// Failure modes: below-threshold/hidden candidates spin; capped reports strand tails; Global repeats per Character;
// busy/fenced periods or restart lose catch-up; saved commands are reassessed after disconnect; future claims look empty.
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); vi.restoreAllMocks(); });
function setup(f = curatorTestFixture({ driver: curatorTestAssessDriver }), threshold = 100,
  onPolicyReviewChanged?: (bankId: string) => void) {
  const banks = f.deps.resolveBanks(null);
  let idle: number | null = Date.parse(f.clock.at) - 10_000;
  let writable = true;
  const owner = createHindsightPolicySchedule({ db: f.db, deps: f.deps, curator: f.curator,
    config: () => ({ ...loadHindsightPolicyReviewConfig({}), threshold }), timezone: () => "UTC", now: () => f.clock.at,
    activity: { idleSince: () => idle }, writable: () => writable, onPolicyReviewChanged });
  owner.start(); closers.push(async () => { await owner.stop(); await f.close(); });
  const pulse = async () => {
    if ((owner.nextWake() ?? "~") > f.clock.at) return;
    await new Promise<void>((resolve) => owner.dispatch(banks, resolve));
  };
  const advance = (ms = 60_000) => { f.clock.at = new Date(Date.parse(f.clock.at) + ms).toISOString(); };
  const status = () => readHindsightPolicyReviewStatus(f.db, { epochId: "epoch", available: true });
  return { f, owner, pulse, advance, status, idle: (at: number | null) => { idle = at; owner.changed(); },
    writable: (value: boolean) => { writable = value; owner.changed(); } };
}

describe("durable policy scheduling over the actual curator journal", () => {
  it("does not review below threshold and does not spin on hidden-only rows", async () => {
    const driver = vi.fn(curatorTestAssessDriver);
    const s = setup(curatorTestFixture({ driver, banks: [curatorTestBank({ characterId: "taki", memories: [
      { id: "hidden", policy: { visibility: "hidden" } },
      { id: "mood", policy: { layerId: "intentions", visibility: "mood-gated", disclosure: "mood" } },
      { id: "expired", policy: { retention: { kind: "expiring", expiresAt: "2020-01-01T00:00:00.000Z" } } },
    ] })] }), 1);
    await s.pulse();
    expect(s.status()[0]).toMatchObject({ state: null, eligibleRemaining: 0 });
    expect(s.owner.nextWake()).toBe("2026-09-12T03:00:00.000Z");
    expect(driver).not.toHaveBeenCalled();
    const ordinary = setup(curatorTestFixture({ driver })); await ordinary.pulse();
    expect(ordinary.status()[0]?.eligibleRemaining).toBe(1); expect(driver).not.toHaveBeenCalled();
  });
  it("keeps a failed scan unknown, rearms once, and clears the error after a successful below-threshold scan", async () => {
    const states: Array<string | null> = [];
    const s = setup(undefined, 100, () => { states.push(s.status()[0]!.state); });
    vi.spyOn(replicaQueries, "readApplicationBindingWork").mockImplementationOnce(() => { throw new Error("temporary read failure"); });
    await s.pulse();
    expect(s.status()[0]).toMatchObject({ state: "error", eligibleRemaining: null, lastCompletedAt: null });
    expect(s.owner.nextWake()).toBe("2026-09-11T08:01:00.000Z");
    s.advance(); await s.pulse();
    expect(s.status()[0]).toMatchObject({ state: null, eligibleRemaining: 1, lastCompletedAt: null });
    expect(s.owner.nextWake()).toBe("2026-09-12T03:00:00.000Z");
    expect(states).toEqual(["error", null]);
  });
  it("drains more than a report cap and reviews Global once in each multi-Bank pass", async () => {
    const reports: string[] = [];
    const f = curatorTestFixture({ banks: [curatorTestBank({ bankId: "global", memories: [{ id: "g" }] }),
      curatorTestBank({ bankId: "taki", characterId: "taki", memories: Array.from({ length: 5 }, (_, i) => ({ id: `t${i}` })) }),
      curatorTestBank({ bankId: "saki", characterId: "saki", memories: [{ id: "s" }] })], driver: async (input) => {
      reports.push(curatorTestReport(input).bank.id); return curatorTestAssessDriver(input);
    } });
    f.config.memory.reportClassCap = 2;
    const s = setup(f, 1);
    for (let i = 0; i < 4; i++) { await s.pulse(); s.advance(); }
    expect(reports.filter((id) => id === "global")).toHaveLength(1);
    expect(s.status()).toHaveLength(3);
    expect(s.status().every((row) => row.eligibleRemaining === 0 && row.state === null)).toBe(true);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM hindsight_policy_work WHERE work_kind='policy' AND state='completed'").get()?.n).toBe(7);
  });
  it("keeps one catch-up through busy chat, a fence, reconnects and concurrent threshold/time triggers", async () => {
    const driver = vi.fn(curatorTestAssessDriver); const states: Array<string | null> = [];
    const s = setup(curatorTestFixture({ driver }), 100, () => { states.push(s.status()[0]!.state); });
    await s.pulse(); s.advance(5 * 86_400_000);
    await s.owner.stop(); s.owner.start(); s.idle(null); await s.pulse();
    const id = s.status()[0]?.catchUpOccurrenceId;
    expect(id).toBeTruthy(); expect(s.status()[0]?.state).toBe("paused"); expect(driver).not.toHaveBeenCalled();
    s.owner.changed(); s.owner.changed(); await s.pulse(); expect(s.status()[0]?.catchUpOccurrenceId).toBe(id);
    s.idle(Date.parse(s.f.clock.at) - 10_000); s.writable(false); s.advance(); await s.pulse();
    expect(driver).not.toHaveBeenCalled(); expect(s.status()[0]?.catchUpOccurrenceId).toBe(id);
    s.writable(true); s.advance(); await s.pulse();
    expect(driver).toHaveBeenCalledOnce(); expect(s.status()[0]).toMatchObject({ state: null, catchUpOccurrenceId: id });
    expect(states).toContain("paused"); expect(states).toContain("running"); expect(states.at(-1)).toBeNull();
  });
  it("does not notify a schedule save rejected by SQLite", async () => {
    const changed = vi.fn(); const s = setup(undefined, 100, changed);
    s.f.db.exec(`CREATE TRIGGER review_fail_schedule BEFORE INSERT ON hindsight_policy_review_schedule
      BEGIN SELECT RAISE(ABORT,'fixture write rejected'); END;`);
    await s.pulse(); expect(s.status()).toEqual([]); expect(changed).not.toHaveBeenCalled();
  });
  it("keeps a claimed item pending until its original claim expires", async () => {
    const driver = vi.fn(curatorTestAssessDriver); const f = curatorTestFixture({ driver });
    const record = f.work.prepare({ scope: { ...f.banks[0]!.scope, authorityEpochId: "epoch" }, target: curatorTestTarget(f) });
    f.work.claim({ key: record.key, leaseMs: 120_000 });
    const s = setup(f); await s.pulse();
    expect(s.status()[0]).toMatchObject({ state: "pending", eligibleRemaining: 1, lastCompletedAt: null });
    expect(driver).not.toHaveBeenCalled();
    s.advance(120_000); await s.pulse(); expect(driver).toHaveBeenCalledOnce();
  });
  it("does not rescan a below-threshold Bank on chat idle and gives a later catch-up its own notice identity", async () => {
    const driver = vi.fn(curatorTestAssessDriver); const s = setup(curatorTestFixture({ driver }));
    await s.pulse(); const inventory = vi.spyOn(replicaQueries, "readApplicationBindingWork");
    s.owner.changed("activity"); await s.pulse(); expect(inventory).not.toHaveBeenCalled();
    s.advance(5 * 86_400_000); await s.owner.stop(); s.owner.start(); await s.pulse();
    const first = s.status()[0]?.catchUpOccurrenceId; expect(first).toBeTruthy();
    s.advance(2 * 86_400_000); await s.owner.stop(); s.owner.start(); await s.pulse();
    expect(s.status()[0]?.catchUpOccurrenceId).not.toBe(first); expect(driver).toHaveBeenCalledOnce();
  });
  it("reports live saved counts and unknown remaining while the model is still running", async () => {
    let ready!: () => void; let release!: () => void;
    const saved = new Promise<void>((resolve) => { ready = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const hints = vi.fn();
    const s = setup(curatorTestFixture({ onPolicyReviewChanged: hints, driver: async (input) => {
      const result = await curatorTestAssessDriver(input); ready(); await hold; return result;
    } }), 1);
    const running = s.pulse(); await saved;
    try {
      expect(s.status()[0]).toMatchObject({ state: "running", eligibleRemaining: null, savedAwaitingPublication: 2 });
      expect(hints).toHaveBeenCalledTimes(2);
    }
    finally { release(); await running; }
    expect(s.status()[0]).toMatchObject({ state: null, eligibleRemaining: 0, savedAwaitingPublication: 0 });
    expect(hints).toHaveBeenCalledTimes(4);
  });
  it("excludes another generation's retained schedule evidence from current Bank status", async () => {
    const s = setup(); await s.pulse(); const repo = createHindsightPolicyReviewRepo(s.f.db);
    const current = repo.get({ ...s.f.banks[0]!.scope, authorityEpochId: "epoch" })!;
    repo.save({ ...current, scope: { ...current.scope, namespace: { ...current.scope.namespace,
      bank_generation: "33333333-3333-4333-8333-333333333333" } } });
    expect(s.status()).toHaveLength(1);
    expect(readHindsightPolicyReviewStatus(s.f.db, { epochId: "epoch", available: false })[0]?.eligibleRemaining).toBeNull();
  });
  it("reopens and publishes the original saved request after a lost ACK without model replay", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "p2w2a-")), "review.db");
    const driver = vi.fn(curatorTestAssessDriver); const f = curatorTestFixture({ path, driver });
    const bank = f.banks[0]!; const commit = bank.server.client.commitApplication;
    vi.spyOn(bank.server.client, "commitApplication").mockImplementationOnce(async (input) => { await commit(input); throw new Error("ack lost"); });
    const s = setup(f, 1); await s.pulse();
    expect(s.status()[0]).toMatchObject({ state: "error", eligibleRemaining: 0, savedAwaitingPublication: 1, lastCompletedAt: null });
    const request = f.db.prepare("SELECT command_request_id FROM hindsight_policy_work WHERE work_kind='policy'").get()?.command_request_id;
    await s.owner.stop(); await f.close(); s.advance(180_000);
    const resumed = setup(curatorTestFixture({ path, banks: f.banks, clock: f.clock, driver }), 1);
    await resumed.pulse();
    expect(driver).toHaveBeenCalledOnce(); expect(resumed.status()[0]).toMatchObject({ state: null, savedAwaitingPublication: 0 });
    expect(resumed.f.db.prepare("SELECT command_request_id FROM hindsight_policy_work WHERE work_kind='policy'").get()?.command_request_id).toBe(request);
  });
  it("does not complete a failed assessment that is waiting for its new policy retry", async () => {
    const driver = vi.fn(curatorTestAssessDriver).mockRejectedValueOnce(new Error("provider unavailable"));
    const s = setup(curatorTestFixture({ driver }), 1); await s.pulse();
    expect(s.status()[0]).toMatchObject({ state: "error", eligibleRemaining: 1, lastCompletedAt: null });
    expect(s.owner.nextWake()).toBe("2026-09-11T08:01:00.000Z");
    s.advance(); await s.pulse(); expect(s.status()[0]?.state).toBeNull(); expect(driver).toHaveBeenCalledTimes(2);
  });
  it.each(["prompt", "result", "receipt", "application"] as const)("resumes after process loss at %s without replaying saved answers", async (stage) => {
    const path = join(mkdtempSync(join(tmpdir(), "p2w2a-crash-")), "review.db");
    const driver = vi.fn(async (input: Parameters<typeof curatorTestAssessDriver>[0]) => {
      if (stage === "prompt") { stop(); return { steps: 1, usage: { inputTokens: undefined, outputTokens: undefined } }; }
      const result = await curatorTestAssessDriver(input);
      if (stage === "result") stop();
      return result;
    });
    const f = curatorTestFixture({ path, driver });
    if (stage === "receipt") f.deps.refreshBank = async () => { throw new Error("process lost after receipt"); };
    if (stage === "application") vi.spyOn(f.work, "complete").mockImplementationOnce(() => { throw new Error("process lost after application"); });
    const s = setup(f, 1); const stop = () => { void s.owner.stop(); };
    await s.pulse(); await s.owner.stop();
    const ids = f.db.prepare("SELECT work_id,command_request_id FROM hindsight_policy_work ORDER BY work_id").all();
    expect(ids.length).toBeGreaterThan(0);
    await f.close(); s.advance(180_000);
    const retryDriver = vi.fn(curatorTestAssessDriver);
    const resumed = setup(curatorTestFixture({ path, banks: f.banks, clock: f.clock, driver: retryDriver }), 1);
    for (let i = 0; i < 4; i++) { await resumed.pulse(); resumed.advance(180_000); }
    expect(resumed.status()[0]).toMatchObject({ state: null, savedAwaitingPublication: 0, eligibleRemaining: 0 });
    // An unsaved Block can be retried separately from the unsaved Memory assessment; neither is a saved answer.
    if (stage === "prompt") expect(retryDriver.mock.calls.flatMap(([input]) => curatorTestReport(input).policies.map((row) => row.nativeId))).toEqual(["memory-a"]);
    else expect(retryDriver).not.toHaveBeenCalled();
    for (const id of ids) expect(resumed.f.db.prepare("SELECT command_request_id FROM hindsight_policy_work WHERE work_id=:id")
      .get({ id: id.work_id! })?.command_request_id).toBe(id.command_request_id);
  });
  it("leaves model work outside the backup fence and saves remain publishable after resume", async () => {
    const fence = createCanonicalLocalWriteFence(); const driver = vi.fn(async (input: Parameters<typeof curatorTestAssessDriver>[0]) => {
      const result = await curatorTestAssessDriver(input);
      await fence.quiesce({ timeoutMs: 20 });
      return result;
    });
    const f = curatorTestFixture({ driver }); f.deps.publish = fence.admit;
    const s = setup(f, 1); await s.pulse();
    // Both the policy answer and its unchanged Block answer were saved before the fence closed.
    expect(s.status()[0]).toMatchObject({ eligibleRemaining: 0, savedAwaitingPublication: 2, lastCompletedAt: null });
    fence.release(); s.advance(180_000); s.owner.changed(); await s.pulse();
    expect(s.status()[0]?.state).toBeNull(); expect(driver).toHaveBeenCalledOnce();
  });
});
