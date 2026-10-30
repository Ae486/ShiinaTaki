import { describe, expect, it } from "vitest";
import { createAvatarOutcomes, type AvatarOutcomesDeps } from "./avatar-outcomes.ts";

interface FakeTimers {
  setTimer: NonNullable<AvatarOutcomesDeps["setTimer"]>;
  fire(): void;
  pending(): number;
  unrefCalls: number;
}

function fakeTimers(): FakeTimers {
  const timers = new Map<number, () => void>();
  let next = 0;
  const api: FakeTimers = {
    unrefCalls: 0,
    setTimer: (fn) => {
      const id = ++next;
      timers.set(id, fn);
      return { unref: () => { api.unrefCalls += 1; }, clear: () => timers.delete(id) };
    },
    fire: () => {
      for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
    },
    pending: () => timers.size,
  };
  return api;
}

function fixture(overrides: Partial<AvatarOutcomesDeps> = {}) {
  const timers = fakeTimers();
  const outcomes = createAvatarOutcomes({ deadlineMs: () => 1000, setTimer: timers.setTimer, ...overrides });
  return { outcomes, timers };
}

const A = { id: "conn-a" };
const B = { id: "conn-b" };

describe("createAvatarOutcomes", () => {
  it("resolves not_rendered instantly with zero subscribers and keeps no entry", async () => {
    const { outcomes, timers } = fixture();
    await expect(outcomes.open({ commandId: "c1", subscribers: 0 })).resolves.toEqual({ outcome: "not_rendered" });
    expect(outcomes.size()).toBe(0);
    expect(timers.pending()).toBe(0);
  });

  it("resolves applied on the first applied report and drops the entry", async () => {
    const { outcomes, timers } = fixture();
    const wait = outcomes.open({ commandId: "c1", subscribers: 2 });
    expect(outcomes.report("c1", { connection: A, outcome: "rejected", reason: "motion_busy" })).toBe("recorded");
    expect(outcomes.report("c1", { connection: B, outcome: "applied" })).toBe("resolved");
    await expect(wait).resolves.toEqual({ outcome: "applied" });
    expect(outcomes.size()).toBe(0);
    expect(timers.pending()).toBe(0);
  });

  it("resolves the strongest report once every subscriber reported (rejected beats superseded)", async () => {
    const { outcomes } = fixture();
    const wait = outcomes.open({ commandId: "c1", subscribers: 2 });
    expect(outcomes.report("c1", { connection: A, outcome: "superseded" })).toBe("recorded");
    expect(outcomes.report("c1", { connection: B, outcome: "rejected", reason: "speaking" })).toBe("resolved");
    await expect(wait).resolves.toEqual({ outcome: "rejected", reason: "speaking" });
  });

  it("resolves a single subscriber's rejection immediately with its reason", async () => {
    const { outcomes } = fixture();
    const wait = outcomes.open({ commandId: "c1", subscribers: 1 });
    outcomes.report("c1", { connection: A, outcome: "rejected", reason: "already_active" });
    await expect(wait).resolves.toEqual({ outcome: "rejected", reason: "already_active" });
  });

  it("counts a duplicate report from the same connection once", async () => {
    const { outcomes, timers } = fixture();
    const wait = outcomes.open({ commandId: "c1", subscribers: 2 });
    expect(outcomes.report("c1", { connection: A, outcome: "superseded" })).toBe("recorded");
    expect(outcomes.report("c1", { connection: A, outcome: "superseded" })).toBe("recorded");
    expect(outcomes.size()).toBe(1);
    timers.fire();
    await expect(wait).resolves.toEqual({ outcome: "superseded" });
  });

  it("resolves unknown at the deadline when nobody reported, and the strongest partial report otherwise", async () => {
    const { outcomes, timers } = fixture();
    const silent = outcomes.open({ commandId: "s", subscribers: 1 });
    const partial = outcomes.open({ commandId: "p", subscribers: 2 });
    outcomes.report("p", { connection: A, outcome: "rejected", reason: "unavailable" });
    timers.fire();
    await expect(silent).resolves.toEqual({ outcome: "unknown" });
    await expect(partial).resolves.toEqual({ outcome: "rejected", reason: "unavailable" });
    expect(outcomes.size()).toBe(0);
  });

  it("reads the deadline per open and unrefs the timer", () => {
    const deadlines: number[] = [];
    const timers = fakeTimers();
    let deadline = 250;
    const outcomes = createAvatarOutcomes({
      deadlineMs: () => deadline,
      setTimer: (fn, ms) => { deadlines.push(ms); return timers.setTimer(fn, ms); },
    });
    void outcomes.open({ commandId: "c1", subscribers: 1 });
    deadline = 900;
    void outcomes.open({ commandId: "c2", subscribers: 1 });
    expect(deadlines).toEqual([250, 900]);
    expect(timers.unrefCalls).toBe(2);
  });

  it("resolves unknown immediately on abort and when the signal is already aborted", async () => {
    const { outcomes, timers } = fixture();
    const controller = new AbortController();
    const wait = outcomes.open({ commandId: "c1", subscribers: 1, signal: controller.signal });
    controller.abort("turn cancelled");
    await expect(wait).resolves.toEqual({ outcome: "unknown" });
    expect(outcomes.size()).toBe(0);
    expect(timers.pending()).toBe(0);
    await expect(outcomes.open({ commandId: "c2", subscribers: 1, signal: controller.signal })).resolves.toEqual({ outcome: "unknown" });
  });

  it("reports late after resolution and unknown_command for an id it never opened", async () => {
    const { outcomes } = fixture();
    const wait = outcomes.open({ commandId: "c1", subscribers: 1 });
    outcomes.report("c1", { connection: A, outcome: "applied" });
    await wait;
    expect(outcomes.report("c1", { connection: B, outcome: "rejected", reason: "motion_busy" })).toBe("late");
    expect(outcomes.report("never", { connection: A, outcome: "applied" })).toBe("unknown_command");
  });

  it("retires the oldest pending wait as unknown when maxPending is exceeded", async () => {
    const { outcomes } = fixture({ maxPending: 2 });
    const first = outcomes.open({ commandId: "c1", subscribers: 1 });
    void outcomes.open({ commandId: "c2", subscribers: 1 });
    void outcomes.open({ commandId: "c3", subscribers: 1 });
    await expect(first).resolves.toEqual({ outcome: "unknown" });
    expect(outcomes.size()).toBe(2);
  });

  it("uses a real unref'd timer by default", async () => {
    const outcomes = createAvatarOutcomes({ deadlineMs: () => 5 });
    await expect(outcomes.open({ commandId: "c1", subscribers: 1 })).resolves.toEqual({ outcome: "unknown" });
  });
});
