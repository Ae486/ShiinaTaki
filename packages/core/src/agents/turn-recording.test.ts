import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createTurnRecording } from "./turn-recording.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function store() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  databases.push(db);
  return createConversationStore({ repo: createTimelineRepo(db) });
}

describe("private durable recording frontiers", () => {
  it("releases old rows without losing the produced-output fence or accepting duplicate captures", () => {
    const recording = createTurnRecording();
    for (let step = 0; step < 100; step += 1) {
      recording.observe({ type: "start-step" });
      recording.capture(step, [{ role: "assistant", content: `durable private step ${step}` }]);
      recording.observe({ type: "finish-step" });
      recording.releaseThrough(step);
    }
    expect(recording.hasProduced()).toBe(true);
    recording.capture(0, [{ role: "assistant", content: "duplicate released step" }]);
    recording.observe({ type: "start-step" });
    recording.observe({ type: "text-delta", text: "unfinished current step" });
    expect(recording.partial()).toEqual({ stepNumber: 100, text: "unfinished current step" });
    const entries = recording.commit({ characterId: "taki", store: store() });
    expect(entries.map((entry) => entry.content)).toEqual(["unfinished current step"]);
    expect(recording.hasProduced()).toBe(true);
  });

  it("does not turn an already captured and released step's buffered delta into another partial", () => {
    const recording = createTurnRecording();
    recording.observe({ type: "start-step" });
    recording.observe({ type: "text-delta", text: "already durable" });
    recording.capture(0, [{ role: "assistant", content: "already durable" }]);
    recording.releaseThrough(0);
    expect(recording.partial()).toBeUndefined();
    expect(recording.commit({ characterId: "taki", store: store() })).toEqual([]);
    expect(recording.hasProduced()).toBe(true);
  });

  it("refuses an incomplete frontier and retains the real unfinished text", () => {
    const recording = createTurnRecording();
    recording.observe({ type: "start-step" });
    recording.observe({ type: "text-delta", text: "not yet durable" });
    expect(() => recording.releaseThrough(0)).toThrow("TURN_RECORDING_FRONTIER_NOT_COMPLETED");
    expect(recording.partial()).toEqual({ stepNumber: 0, text: "not yet durable" });
    expect(recording.hasProduced()).toBe(true);
  });
});
