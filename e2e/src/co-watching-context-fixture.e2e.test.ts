import { describe, expect, it } from "vitest";
import { startScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";
import { withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";

describe("Co-Watching acceptance fixture context wiring", () => {
  it("uses the main-model Utility fallback at the same 8000-token pressure without losing the shared child", async () => {
    let taskRequests = 0;
    let summaryRequests = 0;
    const provider = await startScriptedProvider((request): ScriptedReply => {
      const messages = request.messages as Array<{ role: string; content?: string }>;
      const system = messages.filter((message) => message.role === "system").map((message) => message.content ?? "").join("\n");
      const usage = { prompt_tokens: 101, completion_tokens: 17, total_tokens: 118 };
      if (request.stream !== true) {
        expect(system).toContain("Summarize completed private task work");
        summaryRequests++;
        return { text: "Private accepted 300-second video task. The original analysis has bounded moments first and second; evidence belongs to the external source, not the user's own experience. Complete the remaining checks and write the exact proposed plan; never publish or re-analyze. Completed read rounds remain retained evidence.", usage };
      }
      taskRequests++;
      const analysis = /Read (co-watching-inputs\/[^\s]+\/analysis\.json);/.exec(system)?.[1];
      const output = /to (co-watching\/[^\s]+\.json) with revision ([0-9a-f-]+)/.exec(system);
      if (!analysis || !output) throw new Error("fixture did not send its actual product preparation contract");
      if (taskRequests === 1) return { calls: [{ name: "load_skill", arguments: { name: "taki-co-watching" } },
        { name: "read_file", arguments: { path: analysis } }], usage };
      if (taskRequests < 19) return { text: `Completed pass ${taskRequests}. `
        + "External supplied evidence is distinct from the user's own experience; original bounded timing and source must remain intact. ".repeat(30),
      calls: [{ name: "read_file", arguments: { path: analysis } }], usage };
      if (taskRequests === 19) return { calls: [{ name: "write_file", arguments: { path: output[1],
        content: JSON.stringify({ revision: output[2], candidates: [{ candidateRef: "first-response", momentId: "first", text: "这一段的信息很清楚。" }] }) } }], usage };
      return { text: "The private proposed plan is ready for its owner to validate.", usage };
    });
    try {
      await withScriptedAgentContextScenario({ name: "cowatching-context-same-budget", providerBaseUrl: provider.baseUrl,
        evidenceRoot: process.env.TAKI_E2E_EVIDENCE_DIR ?? "../target/acceptance-implementation-20261030/cowatching-context",
        maxUpstreamRequests: 60 }, async (scenario) => {
        const { createModels } = await import(new URL("../../packages/core/src/config/provider-factory.ts", import.meta.url).href);
        const { coWatchingFixture } = await import(new URL("../../packages/core/src/testing/co-watching-fixture.ts", import.meta.url).href);
        const { model } = createModels({ provider: { baseUrl: scenario.providerBaseUrl, apiKey: "synthetic-observer-client",
          model: scenario.requestedModel }, vision: null, includeUsage: true });
        const fixture = await coWatchingFixture({ preparation: { model, modelId: model.modelId, provider: model.provider,
          contextTokens: 8000, historyRatio: 1, requestEnvelopeReserve: 0 } });
        try {
          await fixture.start();
          await expect.poll(() => ["ready", "failed", "paused_child"].includes(fixture.session().status),
            { timeout: 45_000, interval: 100 }).toBe(true);
          const session = fixture.session();
          const summary = fixture.subagents.summary(session.subagentId);
          scenario.checkpoint("cowatching-context-regression", { status: session.status, taskRequests, summaryRequests,
            errors: fixture.errors, progress: summary.progress, usage: summary.tokenUsage,
            summaryFailures: fixture.db.prepare("SELECT * FROM subagent_context_summary_failures").all() });
          expect(session.status).toBe("ready");
          expect(taskRequests).toBe(20);
          expect(summaryRequests).toBeGreaterThan(1);
          expect(summary.progress).toMatchObject({ completedSteps: 20, intervalSteps: 50, parentApprovalLimit: 3 });
          expect(fixture.db.prepare("SELECT revision FROM subagent_context_summaries").all().length).toBeGreaterThan(1);
          expect(fixture.db.prepare("SELECT attempt_id FROM run_attempts WHERE run_id IN (SELECT run_id FROM subagent_executions)").all()).toHaveLength(1);
          expect(fixture.db.prepare("SELECT event_id FROM subagent_checkins").all()).toHaveLength(0);
          expect(summary.tokenUsage).toMatchObject({ complete: true, modelEffects: taskRequests + summaryRequests,
            totalTokens: (taskRequests + summaryRequests) * 118 });
          expect(fixture.timeline.latestAscending("taki", 10)).toHaveLength(0);
          expect(fixture.submitNative.mock.calls).toHaveLength(0);
          expect(provider.errors).toEqual([]);
        } finally { await fixture.cleanup(); }
      });
    } finally { await provider.close(); }
  }, 90_000);
});
