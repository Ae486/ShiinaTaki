import { expect, it } from "vitest";
import { initiativeFixture } from "../testing/initiative-fixture.ts";
import { createInitiativeCompletionSource } from "./initiative-completion-source.ts";

it("reads only actual terminal background Runs and keeps Class A publication distinct", async () => {
  const f = initiativeFixture();
  try {
    const source = createInitiativeCompletionSource(f.db);
    const scheduled = await f.admit("class_a");
    const heartbeat = await f.admit("class_b");
    expect(source.read("taki")).toEqual([]);
    f.runs.settle(heartbeat.runId, heartbeat.attemptId, "completed");
    expect(source.read("taki")).toEqual([]);
    f.deliveries.stage({ ...scheduled, primaryVersion: 0, consideredCount: 1,
      decision: { outcome: "speak", text: "expected result", presentation: null, selectedCandidateIds: ["scheduled"], responseExpectation: "none" },
      expiresAt: new Date(Date.now() + 60_000).toISOString() });
    f.runs.settle(scheduled.runId, scheduled.attemptId, "completed");
    expect(source.read("taki")).toMatchObject([{ runId: scheduled.runId, initiator: "scheduled", deliveredClassA: false }]);
    expect(source.read("foreign")).toEqual([]);
    expect(source.choices("taki")[0]?.label).not.toContain(scheduled.runId);
    f.deliveries.commitPublication({ runId: scheduled.runId,
      policy: { hourLimit: 2, dayLimit: 8, gapMs: 0, dayStart: "2026-01-01T00:00:00.000Z", timezone: "UTC" },
      append: f.store.appendDelivery });
    expect(source.read("taki")).toMatchObject([{ runId: scheduled.runId, deliveredClassA: true }]);
    expect(source.choices("taki")).toEqual([]);
    expect(source.read("taki", Date.now() + 2 * 86_400_000)).toEqual([]);
  } finally { f.db.close(); }
});
