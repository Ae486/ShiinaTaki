import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });

async function fixture() {
  const model = new MockLanguageModelV4({ doStream: async (options) => {
    const child = options.tools?.some((entry) => entry.name === "complete_subagent");
    const event = f.service.events.list({ characterId: "taki" }).find((entry) => entry.state === "delivered");
    return scriptedModel([{ kind: "tool", toolCallId: child ? "final" : "handle", toolName: child ? "complete_subagent" : "handle_agent_event",
      input: child ? { text: "Result", materials: [] } : { eventId: event!.eventId, operationKey: `handle-${event!.eventId}`,
        action: { kind: "retained", note: "Handled" } } }]).doStream(options);
  } });
  const f = await subagentFixture(model); fixtures.push(f);
  const delegate = (operationKey: string) => f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
    characterId: "taki", operationKey, label: operationKey, initialContext: { kind: "fresh" }, direction: "Work", materials: [], completionPolicy: "request_parent" });
  const release = f.queue.tryAcquireBackground("taki")!;
  await delegate("first");
  await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(1));
  const admit = f.runs.admit; let attempts = 0;
  vi.spyOn(f.runs, "admit").mockImplementation(async (...args) => {
    if (args[0].provenance.provider === "core.subagent-inbox" && ++attempts === 1) throw new Error("temporary authority capture outage");
    return admit(...args);
  });
  release(); f.service.released();
  await vi.waitFor(() => expect(f.errors).toContain("SUBAGENT_INBOX_EXECUTION_UNAVAILABLE"));
  return { ...f, model, delegate, attempts: () => attempts };
}

describe("meaningful pre-intent inbox retry opportunities", () => {
  it("keeps delivered failure in reconciliation while a later event proceeds after the failed handler releases", async () => {
    let failed = false;
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      const child = options.tools?.some((entry) => entry.name === "complete_subagent");
      if (!child && !failed) {
        failed = true;
        await delegate("later-during-handler");
        await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })).toHaveLength(2));
        throw new Error("synthetic provider failure after actual intent");
      }
      const event = f.service.events.list({ characterId: "taki" }).find((entry) => entry.state === "delivered" && !entry.reconciliationNeeded);
      return scriptedModel([{ kind: "tool", toolCallId: child ? "report" : "handle", toolName: child ? "complete_subagent" : "handle_agent_event",
        input: child ? { text: "Result", materials: [] } : { eventId: event!.eventId, operationKey: "handle-later",
          action: { kind: "retained", note: "The later event" } } }]).doStream(options);
    } });
    const f = await subagentFixture(model); fixtures.push(f);
    const delegate = (operationKey: string) => f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
      characterId: "taki", operationKey, label: operationKey, initialContext: { kind: "fresh" },
      direction: "Work", materials: [], completionPolicy: "request_parent" });
    await delegate("initial");
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[1]?.state).toBe("handled"));
    const events = f.service.events.list({ characterId: "taki" });
    expect(events[0]).toMatchObject({ state: "delivered", reconciliationNeeded: true });
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_deliveries").get()?.n).toBe(2);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_event_actions").get()?.n).toBe(1);
  });

  it("does not retry on its own/repeated queue releases, but new accepted work unsticks the existing event", async () => {
    const f = await fixture();
    f.service.released(); f.service.released(); f.service.released();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(f.attempts()).toBe(1);
    expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("accepted");
    expect(f.service.inboxRecovery({ characterId: "taki", limit: 20 }).entries).toEqual([]);
    await f.delegate("fresh-work");
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("handled"));
    expect(f.attempts()).toBeGreaterThan(1);
  });

  it("retries under fresh capture after a successful primary opportunity through the existing terminal listener", async () => {
    const f = await fixture();
    f.runs.settle(f.parent.run.runId, f.parent.attempt.attemptId, "completed");
    await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("handled"));
    expect(f.attempts()).toBe(2);
    expect(f.db.prepare("SELECT count(*) AS n FROM subagent_inbox_deliveries").get()?.n).toBe(1);
  });
});
