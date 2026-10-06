import { afterEach, describe, expect, it, vi } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { seedTransition, startTransition, TRANSITION_AT } from "../db/memory-transition-fixtures.ts";
import { readTransitionAttempt, renewTransitionLease, requireTransitionLease } from "../db/memory-transition-repo.ts";
import { createTransitionExecutionHeartbeat } from "../memory/transitions/transition-execution-heartbeat.ts";

const modulePath = new URL("../../../../.trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-owned-audit-boundary.mjs", import.meta.url).href;
const { auditWithHeartbeat } = await import(modulePath) as {
  auditWithHeartbeat<T>(input: { db: Database; transitionId: string; name: string; now(): string;
    record?(value: { completed: boolean; elapsedMs: number }): void }, run: () => T): Promise<T>;
};
afterEach(() => vi.restoreAllMocks());

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  const intent = seedTransition(db); const lease = startTransition(db, intent);
  const initial = readTransitionAttempt(db, intent.transitionId)!;
  let at = TRANSITION_AT; const now = () => at;
  const controller = new AbortController(); const errors: unknown[] = [];
  const renew = vi.fn(() => renewTransitionLease(db, { lease, now: now() }));
  // Deliver the real production heartbeat callback from an actual timer at the audit's event-loop boundary.
  // Only the fixture clock jumps; neither the helper nor the assertions renew the executor.
  const interval = globalThis.setInterval; let tick: () => void = () => { throw new Error("missing heartbeat timer"); };
  vi.spyOn(globalThis, "setInterval").mockImplementation((run, delay) => {
    expect(delay).toBe(30_000); tick = () => run(); return interval(run, delay);
  });
  const heartbeat = createTransitionExecutionHeartbeat({ signal: controller.signal, abort: () => controller.abort(), renew,
    assertCurrent: () => requireTransitionLease(db, { lease, now: now() }), failure: (error) => errors.push(error) });
  const advance = (ms: number) => { at = new Date(Date.parse(at) + ms).toISOString(); };
  return { db, intent, lease, initial, now, advance, renew, controller, errors, heartbeat,
    due: () => setTimeout(tick, 0), input: { db, transitionId: intent.transitionId, name: "extra-audit", now },
    close: async () => { await heartbeat.stop(); db.close(); } };
}

describe("task-owned synchronous audit heartbeat boundary", () => {
  it("joins the existing timer renewal and keeps the same executor across cumulative work beyond its initial lease", async () => {
    const f = fixture();
    try {
      for (let n = 0; n < 2; n++) {
        const value = await auditWithHeartbeat(f.input, () => {
          f.advance(45_000); f.due(); expect(f.renew).toHaveBeenCalledTimes(n); return n;
        });
        expect(value).toBe(n); expect(f.renew).toHaveBeenCalledTimes(n + 1);
      }
      expect(Date.parse(f.now()) - Date.parse(TRANSITION_AT)).toBe(90_000);
      expect(readTransitionAttempt(f.db, f.intent.transitionId)).toMatchObject({ attemptId: f.lease.attemptId,
        generation: f.lease.generation, ownerId: f.lease.ownerId, revision: f.lease.revision,
        leaseUntil: new Date(Date.parse(f.now()) + 300_000).toISOString() });
      expect(f.errors).toEqual([]);
    } finally { await f.close(); }
  });

  it("refuses an already expired audit before allowing a due timer to revive it", async () => {
    const f = fixture();
    try {
      await expect(auditWithHeartbeat(f.input, () => { f.advance(60_000); f.due(); })).rejects.toThrow("MEMORY_TRANSITION_LEASE_LOST");
      expect(f.renew).not.toHaveBeenCalled();
      expect(readTransitionAttempt(f.db, f.intent.transitionId)!.leaseUntil).toBe(f.initial.leaseUntil);
    } finally { await f.close(); }
  });

  it("refuses a replacement owner at the yield without adopting its live lease", async () => {
    const f = fixture();
    try {
      await expect(auditWithHeartbeat(f.input, () => {
        setTimeout(() => f.db.prepare("UPDATE memory_transition_attempts SET attempt_json=:json WHERE transition_id=:id")
          .run({ id: f.intent.transitionId, json: JSON.stringify({ ...f.initial, ownerId: "foreign-owner" }) }), 0);
      })).rejects.toThrow("MEMORY_TRANSITION_LEASE_LOST");
      expect(f.renew).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });

  it.each(["stopped", "renewal-failed"] as const)("does not continue long synchronous work when the heartbeat is %s", async (fault) => {
    const f = fixture(); const next = vi.fn();
    try {
      if (fault === "stopped") await f.heartbeat.stop();
      else f.renew.mockImplementationOnce(() => { throw new Error("owned renewal failure"); });
      const run = async () => {
        await auditWithHeartbeat(f.input, () => { f.advance(45_000); f.due(); }); next();
      };
      await expect(run()).rejects.toThrow("W6_ACTIVE_HEARTBEAT_REQUIRED");
      expect(next).not.toHaveBeenCalled(); expect(f.controller.signal.aborted).toBe(true);
      expect(readTransitionAttempt(f.db, f.intent.transitionId)!.leaseUntil).toBe(f.initial.leaseUntil);
    } finally { await f.close(); }
  });

  it("rejects async audit misuse and records failed timing instead of treating it as completed", async () => {
    const f = fixture(); const record = vi.fn();
    try {
      await expect(auditWithHeartbeat({ ...f.input, record }, () => Promise.resolve())).rejects.toThrow("W6_SYNCHRONOUS_AUDIT_REQUIRED");
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ completed: false, elapsedMs: expect.any(Number) }));
      expect(f.renew).not.toHaveBeenCalled();
    } finally { await f.close(); }
  });
});
