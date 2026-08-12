import { describe, expect, it, vi } from "vitest";
import { createCostumeReportSyncTracker } from "./costume-report-sync.ts";

describe("costume report synchronization health", () => {
  it("exposes pending, recovery-needed, and reconnect recovery states", () => {
    const transitions = vi.fn();
    const tracker = createCostumeReportSyncTracker(transitions);
    const switchTicket = tracker.begin("arbeit", "switch");

    tracker.recoveryNeeded(switchTicket, new Error("avatar.report request exceeded 15000ms"));
    expect(tracker.snapshot()).toEqual({
      kind: "recovery-needed",
      costumeId: "arbeit",
      source: "switch",
      message: "avatar.report request exceeded 15000ms",
    });

    const reconnectTicket = tracker.begin("arbeit", "reconnect");
    tracker.synchronized(reconnectTicket);
    expect(tracker.snapshot()).toEqual({ kind: "synced", costumeId: "arbeit", source: "reconnect" });
    expect(transitions).toHaveBeenCalledTimes(4);
  });

  it("ignores a stale report outcome after a newer costume became current", () => {
    const tracker = createCostumeReportSyncTracker();
    const oldTicket = tracker.begin("arbeit", "switch");
    const currentTicket = tracker.begin("live_01", "switch");

    tracker.synchronized(oldTicket);
    expect(tracker.snapshot()).toEqual({ kind: "pending", costumeId: "live_01", source: "switch" });
    tracker.synchronized(currentTicket);
    expect(tracker.snapshot()).toEqual({ kind: "synced", costumeId: "live_01", source: "switch" });
  });
});
