import { describe, expect, it } from "vitest";
import { rememberPrivateActivity, type SubagentLiveView } from "./use-subagent-activity.ts";
import { activityItemKey } from "@/lib/chat-activity-state.js";

const view = (messageId: string): SubagentLiveView => ({ metadata: null,
  view: { stale: false, snapshot: { status: "active", characterId: "taki", messageId, seq: 2,
    items: [{ kind: "text", itemId: "text", order: 0, text: "Observed partial output" }] } } });

describe("retained child activity across reconnect", () => {
  it("keeps observed text when the replacement Core has no disposable stream snapshot", () => {
    const retained = new Map<string, SubagentLiveView>();
    rememberPrivateActivity(retained, view("old-run"), { entries: [], tailSeq: 5 });
    const idle = rememberPrivateActivity(retained, { metadata: null, view: { stale: false, snapshot: { status: "idle", characterId: "taki" } } }, { entries: [], tailSeq: 10 });
    expect(idle.retained).toHaveLength(1);
    expect(idle.retained?.[0]?.view.stale).toBe(true);
    expect(idle.retained?.[0]?.positions?.get(activityItemKey("old-run", "text"))).toBe(5.5);
  });
  it("holds the previous Run while a new Run starts and preserves the same-item anchor on recovery", () => {
    const retained = new Map<string, SubagentLiveView>();
    rememberPrivateActivity(retained, view("old-run"), { entries: [], tailSeq: 5 });
    const restored = rememberPrivateActivity(retained, view("old-run"), { entries: [], tailSeq: 100 });
    expect(restored.positions?.get(activityItemKey("old-run", "text"))).toBe(5.5);
    expect(rememberPrivateActivity(retained, view("new-run"), { entries: [], tailSeq: 100 }).retained).toHaveLength(1);
  });
});
