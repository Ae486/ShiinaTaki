import { describe, expect, it } from "vitest";
import type { SubagentConversationEntry } from "@taki/shared";
import { projectSubagentConversation } from "./subagent-conversation-transcript.ts";
import { activityItemKey } from "@/lib/chat-activity-state.js";
import type { SubagentLiveView } from "./subagent-activity-retention.ts";
import { conversation } from "../../../test/subagent-conversation-fixture.ts";
import { CHILD_A, WORK_A, WORK_B, work } from "../../../test/s7-subagent-data.ts";

function batch() {
  const source = conversation().entries.find((row) => row.kind === "message")!;
  if (source.kind !== "message") throw new Error("fixture");
  const text: SubagentConversationEntry = { ...source, seq: 3,
    message: { ...source.message, content: "Full streamed answer" },
    presentation: { messageId: "run-child-a", references: [{ kind: "text", itemId: "text-a", order: 0, start: 0, end: 20 }] },
    batch: { runId: "run-child-a", attemptId: "attempt-a", stepNumber: 0, entrySeqs: [3, 4] } };
  const tool: SubagentConversationEntry = { ...source, seq: 4,
    message: { ...source.message, seq: 2, parts: [{ type: "tool-result", toolName: "search", toolCallId: "call-a", output: { type: "text", value: "Found" } }] },
    presentation: { messageId: "run-child-a", references: [{ kind: "tool", itemId: "tool-a", order: 1, partIndex: 0, outcome: "completed" }] },
    batch: text.batch };
  const live: SubagentLiveView = { metadata: null, view: { stale: false, snapshot: { status: "active", characterId: "taki", runId: "run-child-a",
    messageId: "run-child-a", attemptId: "attempt-a", seq: 4, items: [
      { kind: "text", itemId: "text-a", order: 0, text: "Full streamed answer" },
      { kind: "tool", itemId: "tool-a", order: 1, toolName: "search", toolCallId: "call-a", status: { phase: "executing" } },
    ] } } };
  return { text, tool, live };
}
const project = (entries: SubagentConversationEntry[], live: SubagentLiveView | null = null) => projectSubagentConversation({ entries, live, acceptedInputs: [], label: "Researcher" });

describe("continuous private Chat projection", () => {
  it("interleaves user, parent, system and worker rows across works without execution-array joins", () => {
    const input = conversation();
    input.entries.splice(2, 0, { ...input.entries[0]!, kind: "input", seq: 2.5, workInputId: WORK_B,
      input: work({ inputId: WORK_B, workInputId: WORK_B, sender: { kind: "core", ownerRef: "scheduler" }, direction: "System context" }) });
    const result = project(input.entries);
    expect(result.slice(0, 4).map((item) => item.sender)).toEqual(["主助手", "你", "系统", "Researcher"]);
    expect(result.some((item) => "committed" in item)).toBe(false);
  });

  it("does not retire a whole live step on its first durable row, then preserves all DOM identities", () => {
    const f = batch();
    const partial = project([f.text], f.live);
    expect(partial).toHaveLength(2);
    expect(partial[1]).toMatchObject({ kind: "tool", status: { phase: "executing" } });
    const complete = project([f.text, f.tool], f.live);
    expect(complete.map((item) => item.key)).toEqual(partial.map((item) => item.key));
    expect(complete[1]).toMatchObject({ kind: "tool", status: { phase: "settled", outcome: "completed" }, output: { type: "text", value: "Found" } });
  });

  it("keeps live content while an exact body is still only a preview", () => {
    const f = batch();
    f.text.body = { digest: "a".repeat(64), totalChars: 50_000, nextOffset: 0 };
    const result = project([f.text, f.tool], f.live);
    expect(result[1]).toMatchObject({ status: { phase: "executing" } });
  });

  it("keeps an observed live item before a later asynchronous input and deduplicates accepted echoes", () => {
    const f = batch();
    f.live.positions = new Map([[activityItemKey("run-child-a", "text-a"), 1.5], [activityItemKey("run-child-a", "tool-a"), 1.75]]);
    const data = conversation().entries.slice(0, 2);
    const rows = projectSubagentConversation({ entries: data, live: f.live, label: "Researcher", acceptedInputs: [work()] });
    expect(rows.map((item) => item.kind)).toEqual(["text", "text", "tool", "text"]);
    expect(rows.filter((item) => item.key === `private-input:${WORK_A}`)).toHaveLength(1);
  });

  it("renders a report once in the accepted event position instead of a second JSON result card", () => {
    const f = batch();
    const entry: SubagentConversationEntry = { seq: 4, subagentId: CHILD_A, workInputId: WORK_A, historicalOrder: false,
      createdAt: f.text.createdAt, kind: "event", presentation: f.tool.presentation, batch: f.tool.batch,
      event: { eventId: "report-a", seq: 1, characterId: "taki", subagentId: CHILD_A, workInputId: WORK_A,
        kind: "final", producerRunId: "run-child-a", producerAttemptId: "attempt-a", producerKey: "terminal",
        body: "Final report", bodyDigest: "a".repeat(64), sourceContext: {}, throughWorkSeq: 1,
        acceptedAt: f.text.createdAt, eligible: true, suppressionReason: null, state: "accepted", reconciliationNeeded: false } };
    const rows = project([f.text, entry], f.live);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "text", text: "Final report", key: activityItemKey("run-child-a", "tool-a") });
  });
});
