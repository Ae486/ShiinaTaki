import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { ChatActivity, SubagentEvent } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel, streamingMockModel } from "../testing/mock-language-model.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createChatTurnActivity } from "./chat-activity.ts";

type Fixture = Awaited<ReturnType<typeof subagentFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

describe("late first foreground inbox claim", () => {
  it("delivers a newly arriving child event at the next SDK request with one immutable consumer and precise source attribution", async () => {
    let mainCalls = 0; let childCalls = 0;
    const events: SubagentEvent[] = [];
    const mainPrompts: string[] = []; const mainTools: string[][] = [];
    const first = scriptedModel([{ kind: "textTool", deltas: ["Public preface before any event"],
      toolCallId: "ordinary-first", toolName: "echo", input: {} }]);
    const last = streamingMockModel(["Public final answer"]);
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      if (options.tools?.some((entry) => entry.name === "complete_subagent")) {
        childCalls += 1;
        return scriptedModel([{ kind: "tool", toolCallId: `child-${childCalls}`, toolName: "complete_subagent",
          input: { text: `PRIVATE_CHILD_EVENT_${childCalls}`, materials: [] } }]).doStream(options);
      }
      mainPrompts.push(JSON.stringify(options.prompt)); mainTools.push(options.tools?.map((entry) => entry.name) ?? []);
      mainCalls += 1;
      if (mainCalls === 1) return first.doStream(options);
      if (mainCalls === 2) return scriptedModel([{ kind: "tools", calls: [
        { toolCallId: "private-handling", toolName: "handle_agent_event", input: { eventId: events[0]!.eventId,
          operationKey: "handle-late-event", action: { kind: "retained", note: "PRIVATE_HANDLING_NOTE" } } },
        { toolCallId: "ordinary-second", toolName: "echo", input: {} },
      ] }]).doStream(options);
      return last.doStream(options);
    } });
    let issued = 0;
    const f: Fixture = await subagentFixture(model, { agent: {
      foregroundInbox: (input) => f.service.prepareInbox(input),
      extraTools: { echo: tool({ inputSchema: z.strictObject({}), execute: async () => {
        issued += 1;
        await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
          characterId: "taki", operationKey: `arriving-child-${issued}`, label: `Worker ${issued}`,
          initialContext: { kind: "fresh" }, direction: "Report the requested private work", materials: [], completionPolicy: "request_parent",
        });
        await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(issued));
        events.splice(0, events.length, ...f.service.events.list({ characterId: "taki" }));
        return { text: "PUBLIC_TOOL_RESULT" };
      } }) },
    } });
    fixtures.push(f);
    const release = await f.queue.reservePrimary("taki").acquire();
    const activityEvents: ChatActivity[] = [];
    const activity = createChatTurnActivity({ identity: { characterId: "taki", messageId: "lazy-inbox" },
      publish: (event) => activityEvents.push(event) });
    activity.start();
    try {
      for await (const text of f.agent.stream({ characterId: "taki", message: "Keep the current conversation going" },
        { runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId, activity })) void text;
      expect(mainCalls).toBe(3); expect(childCalls).toBe(2);
      expect(mainTools[0]).not.toContain("handle_agent_event");
      expect(mainTools[1]).toContain("handle_agent_event");
      expect(mainPrompts[0]).not.toContain("PRIVATE_CHILD_EVENT");
      expect(mainPrompts[1]).toContain("PRIVATE_CHILD_EVENT_1");
      expect(mainPrompts[2]).toContain("PRIVATE_HANDLING_NOTE");
      expect(mainPrompts[2]).not.toContain("PRIVATE_CHILD_EVENT_2");
      expect(f.service.events.get(events[0]!.eventId).state).toBe("handled");
      expect(f.service.events.get(events[1]!.eventId).state).toBe("accepted");
      const consumers = f.db.prepare("SELECT consumer_id FROM subagent_inbox_consumers WHERE run_id=:run")
        .all({ run: f.parent.run.runId });
      expect(consumers).toHaveLength(1);
      const delivered = f.db.prepare("SELECT step_number FROM subagent_inbox_deliveries WHERE consumer_id=:consumer ORDER BY step_number")
        .all({ consumer: String(consumers[0]!.consumer_id) });
      expect(delivered.map((row) => row.step_number)).toEqual([1, 2]);
      const rows = createTimelineRepo(f.db).latestAscending("taki", 50);
      const early = rows.find((row) => row.content.includes("Public preface before any event"))!;
      expect(early.sourceContext).toBeUndefined();
      const final = rows.find((row) => row.content === "Public final answer")!;
      expect(JSON.stringify(final.sourceContext)).toContain(events[0]!.eventId);
      expect(JSON.stringify(final.sourceContext)).not.toContain(events[1]!.eventId);
      const speech = f.db.prepare("SELECT timeline_id FROM subagent_primary_speech WHERE consumer_id=:consumer")
        .all({ consumer: String(consumers[0]!.consumer_id) });
      expect(speech.some((row) => row.timeline_id === early.id)).toBe(false);
      expect(speech.some((row) => row.timeline_id === final.id)).toBe(true);
      for (const secret of ["PRIVATE_CHILD_EVENT", "PRIVATE_HANDLING_NOTE", "handle_agent_event", "private-handling"]) {
        expect(JSON.stringify([rows, activityEvents])).not.toContain(secret);
      }
    } finally { release(); }
  });
});
