import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import type { SubagentEvent } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";

type Fixture = Awaited<ReturnType<typeof subagentFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });
async function drain(stream: AsyncIterable<string>) { let text = ""; for await (const delta of stream) text += delta; return text; }

describe("actual SDK completed-step failure fence", () => {
  it("surfaces a last natural-step write failure before the settled-text callback", async () => {
    const settled = vi.fn();
    const model = scriptedModel([{ kind: "text", deltas: ["Produced private text before storage failure"] }]);
    const f = await subagentFixture(model); fixtures.push(f);
    const originalStream = f.agent.stream;
    f.agent.stream = (params, turn) => originalStream(params, { ...turn, onSettledText: settled });
    f.db.exec("CREATE TRIGGER fail_last_step BEFORE INSERT ON run_messages WHEN NEW.entry_kind='output' BEGIN SELECT RAISE(ABORT,'last step write failure'); END");
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
      characterId: "taki", operationKey: "failed-last-step", label: "Worker", initialContext: { kind: "fresh" },
      direction: "Report the result", materials: [], completionPolicy: "record_only",
    });
    await vi.waitFor(() => expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result).toBeTruthy());
    expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result?.outcome).toBe("failed");
    expect(model.doStreamCalls).toHaveLength(1);
    expect(settled).not.toHaveBeenCalled();
  });

  it.each(["run_messages", "subagent_tool_results"])("stops after %s persistence fails without another model or tool call", async (table) => {
    const execute = vi.fn(async () => ({ result: "EXACT_COMPLETED_PROBE_EVIDENCE" }));
    const model = scriptedModel([{ kind: "tool", toolCallId: "probe", toolName: "probe", input: {} },
      { kind: "tool", toolCallId: "final", toolName: "complete_subagent", input: { text: "Must not report success", materials: [] } }]);
    const f = await subagentFixture(model, { tools: { probe: tool({ inputSchema: z.strictObject({}), execute }) } });
    fixtures.push(f);
    f.db.exec(`CREATE TRIGGER fail_completed_step BEFORE INSERT ON ${table}
      WHEN NEW.step_number=0 ${table === "run_messages" ? "AND NEW.entry_kind='output'" : ""}
      BEGIN SELECT RAISE(ABORT,'induced completed-step persistence failure'); END`);
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["probe"] }, {
      characterId: "taki", operationKey: "failed-checkpoint", label: "Checkpoint worker", initialContext: { kind: "fresh" },
      direction: "Run the probe and report the result", materials: [], completionPolicy: "record_only",
    });
    await vi.waitFor(() => expect(f.executions.list({ subagentId: accepted.conversation.subagentId })[0]?.result).toBeTruthy());
    const execution = f.executions.list({ subagentId: accepted.conversation.subagentId })[0]!;
    expect(execute).toHaveBeenCalledOnce();
    expect(model.doStreamCalls).toHaveLength(1);
    expect(execution.result?.outcome).toBe("failed");
    expect(execution.result?.outputKind).not.toBe("validated");
    expect(f.effects.list!(execution.runId).filter((effect) => effect.kind === "model")).toHaveLength(1);
    expect(f.effects.list!(execution.runId).filter((effect) => effect.kind === "model")[0]).toMatchObject({ state: "terminal", outcome: "completed" });
    expect(f.db.prepare("SELECT count(*) AS total FROM subagent_context_summaries").get()?.total).toBe(0);
    if (table === "run_messages") expect(f.db.prepare("SELECT output_json FROM subagent_tool_results WHERE run_id=:run")
      .get({ run: execution.runId })?.output_json).toContain("EXACT_COMPLETED_PROBE_EVIDENCE");
  });

  it("surfaces a foreground private-recording failure while preserving public text and the already executed inbox action", async () => {
    let mainCalls = 0;
    let event!: SubagentEvent;
    const child = scriptedModel([{ kind: "tool", toolCallId: "child-final", toolName: "complete_subagent",
      input: { text: "PRIVATE_CHILD_RESULT", materials: [] } }]);
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      if (options.tools?.some((entry) => entry.name === "complete_subagent")) return child.doStream(options);
      mainCalls += 1;
      return scriptedModel(mainCalls === 1 ? [{ kind: "textTool", deltas: ["Public text before the storage failure"],
        toolCallId: "private-action", toolName: "handle_agent_event", input: { eventId: event.eventId,
          intent: "record", text: "PRIVATE_ACTION_NOTE", target: null } }]
        : [{ kind: "text", deltas: ["Must not continue after missing private evidence"] }]).doStream(options);
    } });
    const f: Fixture = await subagentFixture(model, { agent: { foregroundInbox: (input) => f.service.prepareInbox(input) } });
    fixtures.push(f);
    const release = await f.queue.reservePrimary("taki").acquire();
    try {
      await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
        characterId: "taki", operationKey: "child", label: "Worker", initialContext: { kind: "fresh" },
        direction: "Return the result", materials: [], completionPolicy: "request_parent",
      });
      await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(1));
      event = f.service.events.list({ characterId: "taki" })[0]!;
      f.db.exec(`CREATE TRIGGER fail_private_recording BEFORE INSERT ON run_messages
        WHEN NEW.run_id='${f.parent.run.runId}' AND NEW.entry_kind='output'
        BEGIN SELECT RAISE(ABORT,'induced private recording failure'); END`);
      await expect(drain(f.agent.stream({ characterId: "taki", message: "Keep my real request" }, {
        runId: f.parent.run.runId, attemptId: f.parent.attempt.attemptId,
      }))).rejects.toThrow("induced private recording failure");
      expect(mainCalls).toBe(1);
      expect(f.db.prepare("SELECT count(*) AS total FROM subagent_event_actions WHERE event_id=:event")
        .get({ event: event.eventId })?.total).toBe(1);
      const rows = createTimelineRepo(f.db).latestAscending("taki", 30);
      expect(rows.map((row) => row.content)).toEqual(["Keep my real request", "Public text before the storage failure"]);
      expect(JSON.stringify(rows)).not.toContain("PRIVATE_ACTION_NOTE");
    } finally { release(); }
  });
});
