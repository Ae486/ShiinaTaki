import { describe, expect, it } from "vitest";
import { createRunEventLiveBus } from "./run-event-live.ts";
import type { RunEvent } from "@taki/shared";
const event = (seq: number): RunEvent => ({ eventId: `e${seq}`, runId: "r", seq, schemaVersion: "run-event.v1", category: "lifecycle", kind: "run.started", occurredAt: "2026-08-24T00:00:00.000Z", source: "core.run-repo", payload: { kind: "run.started", state: "running", operationPhase: "executing" } });
const flush = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

it("isolates the local committed observer while keeping durable backfill separate", async () => {
  const seen: number[] = []; const local: number[] = [];
  const bus = createRunEventLiveBus(() => [event(1)], (events) => {
    local.push(...events.map((item) => item.seq)); throw new Error("local observer failed");
  });
  bus.subscribe("r", (item) => { seen.push(item.seq); });
  await flush(); expect(local).toEqual([]);
  expect(() => bus.publish([event(2)])).not.toThrow(); await flush();
  expect(local).toEqual([2]); expect(seen).toEqual([1, 2]);
});
describe("RunEventLiveBus", () => { it("isolates observers and resumes after cursor", async () => { const bus = createRunEventLiveBus(); const seen: number[] = []; const bad = bus.subscribe("r", () => { throw new Error("observer"); }); const good = bus.subscribe("r", (e) => { seen.push(e.seq); }, { afterSeq: 1 }); bus.publish([event(1), event(2)]); await flush(); expect(seen).toEqual([2]); expect(good.cursor).toBe(2); expect(bad.overflowed).toBe(true); bad.close(); good.close(); }); });

it("signals bounded overflow and exposes the last delivered cursor", async () => {
  const bus = createRunEventLiveBus(); const seen: number[] = [];
  const sub = bus.subscribe("r", (e) => { seen.push(e.seq); }, { capacity: 1 });
  bus.publish([event(1), event(2), event(3)]);
  await flush();
  expect(sub.overflowed).toBe(true); expect(seen).toEqual([]); expect(sub.cursor).toBe(0);
  sub.close();
});

it("backfills a durable suffix before accepting live events", async () => {
  const seen: number[] = [];
  const bus = createRunEventLiveBus((runId, afterSeq) => runId === "r" ? [event(1), event(2)].filter((item) => item.seq > afterSeq) : []);
  const sub = bus.subscribe("r", (item) => { seen.push(item.seq); }, { afterSeq: 1 });
  await flush();
  bus.publish([event(3)]);
  await flush();
  expect(seen).toEqual([2, 3]); expect(sub.cursor).toBe(3); expect(sub.overflowed).toBe(false);
  sub.close();
});

it("bounds a slow asynchronous consumer and leaves a backfillable cursor", async () => {
  let release: (() => void) | undefined;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const bus = createRunEventLiveBus();
  const sub = bus.subscribe("r", async (item) => { if (item.seq === 1) await first; }, { capacity: 2 });
  bus.publish([event(1)]); await flush();
  bus.publish([event(2), event(3), event(4)]);
  expect(sub.overflowed).toBe(true); expect(sub.cursor).toBe(0);
  release?.(); await first; await flush();
  expect(sub.cursor).toBe(1);
  sub.close();
});
