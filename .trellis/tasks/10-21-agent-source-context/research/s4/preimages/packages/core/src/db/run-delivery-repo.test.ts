import { afterEach, describe, expect, it, vi } from "vitest";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createRunDeliveryRepo } from "./run-delivery-repo.ts";
import type { HeartbeatDecision } from "@taki/shared";

const fixtures: ReturnType<typeof initiativeFixture>[] = [];
afterEach(() => { for (const f of fixtures.splice(0)) f.db.close(); vi.useRealTimers(); });
const spoken: HeartbeatDecision = { outcome: "speak", selectedCandidateIds: ["candidate"], text: "The result", presentation: null, responseExpectation: "none" };
function fixture() { const f = initiativeFixture(); fixtures.push(f); return f; }
const policy = { hourLimit: 2, dayLimit: 8, gapMs: 600_000, dayStart: "2000-01-01T00:00:00.000Z", timezone: "UTC" };
async function staged(f: ReturnType<typeof fixture>, decision = spoken, deliveryClass: "class_a" | "class_b" = "class_b") {
  const identity = await f.admit(deliveryClass);
  const record = f.deliveries.stage({ ...identity, decision, expiresAt: new Date(Date.now() + 60_000).toISOString(), primaryVersion: 0, consideredCount: 1 });
  return record;
}

describe("Run delivery atomicity", () => {
  it.each([false, 1, "true", {}, Promise.resolve(true)])("refuses non-true synchronous publication authority %s without writing", async (value) => {
    const f = fixture(); const record = await staged(f);
    f.runs.settle(record.runId, record.attemptId, "completed");
    const input = { runId: record.runId, policy, append: f.store.appendDelivery, isCurrent: () => true };
    Reflect.set(input, "isCurrent", () => value);
    expect(() => f.deliveries.commitPublication(input)).toThrow("DELIVERY_SOURCE_REFUSED");
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "staged", chargedAt: null, timelineSeq: null });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.events.list(record.runId).some((event) => event.kind === "delivery.dispatch_committed")).toBe(false);
  });

  it("evaluates final source validity within the same synchronous transaction as Timeline publication", async () => {
    const f = fixture(); const record = await staged(f);
    f.runs.settle(record.runId, record.attemptId, "completed");
    const transaction = f.db.transaction; let inside = false;
    vi.spyOn(f.db, "transaction").mockImplementation((write) => transaction(() => {
      inside = true; try { write(); } finally { inside = false; }
    }));
    const current = vi.fn(() => { expect(inside).toBe(true); return true; });
    expect(f.deliveries.commitPublication({ runId: record.runId, policy, append: f.store.appendDelivery, isCurrent: current })).toBeDefined();
    expect(current).toHaveBeenCalledTimes(1);
  });

  it("refuses a decision from a replaced Attempt after the replacement finishes", async () => {
    const f = fixture(); const record = await staged(f);
    const replacement = f.runs.retry(record.runId, record.attemptId, "publication_stale_attempt");
    const attemptId = replacement.run.activeAttemptId!;
    expect(attemptId).not.toBe(record.attemptId);
    f.runs.settle(record.runId, attemptId, "completed");
    const terminal = f.runs.status(record.runId);
    expect(() => f.deliveries.commitPublication({ runId: record.runId, policy, append: f.store.appendDelivery }))
      .toThrow("DELIVERY_RUN_REFUSED");
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "staged", timelineSeq: null, chargedAt: null });
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.events.list(record.runId).some((event) => event.kind === "delivery.dispatch_committed")).toBe(false);
    expect(f.runs.status(record.runId)).toEqual(terminal);
  });

  it.each(["character_id", "delivery_class"] as const)("rechecks immutable Run binding %s at publication", async (column) => {
    const f = fixture(); const record = await staged(f);
    f.runs.settle(record.runId, record.attemptId, "completed");
    // Fault injection models a mismatched retained row; ordinary callers cannot change these Run bindings.
    if (column === "character_id") f.db.prepare("UPDATE run_deliveries SET character_id='another-character' WHERE run_id=:runId").run({ runId: record.runId });
    else f.db.prepare("UPDATE run_deliveries SET delivery_class='class_a' WHERE run_id=:runId").run({ runId: record.runId });
    expect(() => f.deliveries.commitPublication({ runId: record.runId, policy, append: f.store.appendDelivery }))
      .toThrow("DELIVERY_RUN_REFUSED");
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.timeline.latestAscending("another-character", 10)).toEqual([]);
    expect(f.deliveries.get(record.runId)?.chargedAt).toBeNull();
  });

  it("carries a consumed 25-hour civil-day allowance across a timezone change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-11-01T04:15:00.000Z");
    const f = fixture(); const record = await staged(f); f.runs.settle(record.runId, record.attemptId, "completed");
    f.deliveries.commitPublication({ runId: record.runId, policy: { ...policy, dayLimit: 1, gapMs: 0,
      dayStart: "2026-11-01T04:00:00.000Z", timezone: "America/New_York" }, append: f.store.appendDelivery });
    // New York's fall-back day still has 30 minutes left. Selecting UTC must not mint another slot.
    vi.setSystemTime("2026-11-02T04:30:00.000Z");
    const next = await staged(f); f.runs.settle(next.runId, next.attemptId, "completed");
    expect(() => f.deliveries.commitPublication({ runId: next.runId, policy: { ...policy, dayLimit: 1, gapMs: 0,
      dayStart: "2026-11-02T00:00:00.000Z", timezone: "UTC" }, append: f.store.appendDelivery })).toThrow("DELIVERY_BUDGET");
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
  });

  it("enforces independent hourly and daily limits atomically across repository consumers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-09-26T06:00:00.000Z");
    const f = fixture(); const other = createRunDeliveryRepo({ db: f.db, events: f.events });
    const limits = { ...policy, hourLimit: 1, dayLimit: 2, gapMs: 0, dayStart: "2026-09-26T00:00:00.000Z" };
    const publish = async () => {
      const record = await staged(f); f.runs.settle(record.runId, record.attemptId, "completed");
      return other.commitPublication({ runId: record.runId, policy: limits, append: f.store.appendDelivery });
    };
    expect(await publish()).toBeDefined();
    await expect(publish()).rejects.toThrow("DELIVERY_BUDGET");
    vi.setSystemTime("2026-09-26T07:00:00.001Z");
    expect(await publish()).toBeDefined();
    vi.setSystemTime("2026-09-26T08:00:00.002Z");
    await expect(publish()).rejects.toThrow("DELIVERY_BUDGET");
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(2);
    expect(f.db.prepare("SELECT count(*) AS n FROM run_deliveries WHERE charged_at IS NOT NULL").get()?.n).toBe(2);
  });

  it("publishes one ordinary Timeline identity, charges once, and conservatively retains uncertain charge", async () => {
    const f = fixture(); const record = await staged(f);
    f.runs.settle(record.runId, record.attemptId, "completed");
    const entry = f.deliveries.commitPublication({ runId: record.runId, policy, append: f.store.appendDelivery });
    expect(entry?.content).toBe("The result");
    expect(f.deliveries.commitPublication({ runId: record.runId, policy, append: f.store.appendDelivery })).toBeUndefined();
    const current = f.deliveries.get(record.runId)!;
    f.deliveries.transition({ runId: record.runId, expectedVersion: current.version, state: "unknown", fact: { kind: "delivery.unknown", state: "unknown" } });
    expect(f.deliveries.get(record.runId)?.chargedAt).not.toBeNull();
    expect(f.timeline.latestAscending("taki", 10)).toHaveLength(1);
    const other = await staged(f); f.runs.settle(other.runId, other.attemptId, "completed");
    expect(() => f.deliveries.commitPublication({ runId: other.runId, policy, append: f.store.appendDelivery })).toThrow("DELIVERY_GAP");
    expect(f.deliveries.get(other.runId)?.chargedAt).toBeNull();
  });

  it("rolls Timeline, quota and linkage back if required event persistence fails", async () => {
    const f = fixture(); const record = await staged(f); f.runs.settle(record.runId, record.attemptId, "completed");
    const repo = createRunDeliveryRepo({ db: f.db, events: { ...f.events, append: () => { throw new Error("disk full"); } } });
    expect(() => repo.commitPublication({ runId: record.runId, policy, append: f.store.appendDelivery })).toThrow("disk full");
    expect(f.timeline.latestAscending("taki", 10)).toEqual([]);
    expect(f.deliveries.get(record.runId)).toMatchObject({ state: "staged", timelineSeq: null, chargedAt: null });
  });

  it("keeps Class A publication independent of exhausted Class B counters", async () => {
    const f = fixture(); const record = await staged(f, spoken, "class_a"); f.runs.settle(record.runId, record.attemptId, "completed");
    expect(f.deliveries.commitPublication({ runId: record.runId, policy: { ...policy, hourLimit: 0, dayLimit: 0 }, append: f.store.appendDelivery })).toBeDefined();
  });

  it("holds and resumes only the same active Attempt with exact delivery CAS and no effect dispatch while waiting", async () => {
    const f = fixture(); const record = await staged(f, { outcome: "express", selectedCandidateIds: ["candidate"], presentation: { kind: "expression", name: "happy" } });
    expect(f.runs.holdDelivery(record.runId, record.attemptId, record.version)).toBe(true);
    expect(f.runRepo.guardDispatch(record.runId, record.attemptId)).toBe(false);
    expect(f.runs.resumeDelivery(record.runId, record.attemptId, record.version)).toBe(false);
    expect(f.runs.resumeDelivery(record.runId, record.attemptId, record.version + 1)).toBe(true);
    expect(f.runs.status(record.runId).attempts).toHaveLength(1);
    expect(f.runs.status(record.runId).run.activeAttemptId).toBe(record.attemptId);
    f.runs.settle(record.runId, record.attemptId, "completed");
    expect(f.runs.resumeDelivery(record.runId, record.attemptId, record.version + 2)).toBe(false);
    expect(f.events.list(record.runId).filter((event) => event.schemaVersion === "run-event.v2").map((event) => event.kind))
      .toEqual(["initiative.decision", "delivery.staged", "delivery.held", "delivery.resumed"]);
  });
});
