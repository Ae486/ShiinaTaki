import { afterEach, describe, expect, it, vi } from "vitest";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createRecoveryCoordinator } from "./recovery-coordinator.ts";

const fixtures: ReturnType<typeof initiativeFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.db.close(); });
function fixture() { const f = initiativeFixture(); fixtures.push(f); return f; }
const text = { outcome: "speak" as const, selectedCandidateIds: ["candidate"], text: "Original result",
  presentation: null, responseExpectation: "none" as const };
const policy = { hourLimit: 2, dayLimit: 8, gapMs: 600_000, dayStart: "2000-01-01T00:00:00.000Z", timezone: "UTC" };

describe("initiative crash-cut recovery", () => {
  it.each(["completed", "failed", "unknown"] as const)("preserves settled expression %s evidence after restart", async (continuation) => {
    const f = fixture(); const identity = await f.admit();
    const record = f.deliveries.stage({ ...identity, decision: { outcome: "express", selectedCandidateIds: ["candidate"],
      presentation: { kind: "expression", name: "happy" } }, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      primaryVersion: 0, consideredCount: 1 });
    f.deliveries.transition({ runId: identity.runId, expectedVersion: record.version, continuation,
      fact: { kind: "delivery.presentation_settled", state: continuation, reasonCode: "presentation" } });
    f.runs.settle(identity.runId, identity.attemptId, continuation === "unknown" ? "outcome_unknown" : continuation);
    const before = f.events.list(identity.runId); const delivery = f.deliveries.get(identity.runId);
    await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects }).scan();
    expect(f.events.list(identity.runId)).toEqual(before);
    expect(f.deliveries.get(identity.runId)).toEqual(delivery);
  });

  it.each(["staged", "dispatch_committed"] as const)("reconciles %s speech after Run completion without replay or quota refund", async (cut) => {
    const f = fixture(); const identity = await f.admit();
    f.deliveries.stage({ ...identity, decision: text, expiresAt: new Date(Date.now() + 60_000).toISOString(), primaryVersion: 0, consideredCount: 1 });
    f.runs.settle(identity.runId, identity.attemptId, "completed");
    if (cut === "dispatch_committed") f.deliveries.commitPublication({ runId: identity.runId, policy, append: f.store.appendDelivery });
    const before = f.runs.status(identity.runId); const chargedAt = f.deliveries.get(identity.runId)?.chargedAt;
    const recovery = createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects });
    await recovery.scan();
    expect(f.deliveries.get(identity.runId)).toMatchObject({ state: cut === "staged" ? "expired" : "unknown", chargedAt });
    expect(f.runs.status(identity.runId)).toEqual(before);
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(cut === "staged" ? 0 : 1);
    const tail = f.events.tail(identity.runId).seq;
    await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects }).scan();
    expect(f.events.tail(identity.runId).seq).toBe(tail);
    expect(f.deliveries.commitPublication({ runId: identity.runId, policy, append: f.store.appendDelivery })).toBeUndefined();
  });

  it.each([false, true])("never infers a missing decision from a terminal model Effect (unfinished=%s)", async (unfinished) => {
    const f = fixture(); const identity = await f.admit();
    const effect = f.effects.prepare({ ...identity, kind: "model", sourceRef: { type: "model", provider: "test", modelId: "test" }, replayPosture: "never" });
    if (!unfinished) f.effects.settle({ ...identity, effectId: effect.effectId, expectedVersion: effect.version, outcome: "completed" });
    const replay = vi.fn();
    await createRecoveryCoordinator({ db: f.db, runs: f.runRepo, effects: f.effects,
      adapters: [{ supports: () => true, replayPosture: () => "safe", reconcile: replay, replay }] }).scan();
    expect(f.runs.status(identity.runId).run.state).toBe(unfinished ? "outcome_unknown" : "failed");
    expect(f.runs.status(identity.runId).attempts).toHaveLength(1);
    expect(replay).not.toHaveBeenCalled();
    expect(f.deliveries.get(identity.runId)).toBeUndefined();
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
  });
});
