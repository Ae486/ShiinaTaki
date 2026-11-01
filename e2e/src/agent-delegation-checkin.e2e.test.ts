import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBAGENT_METHODS, SubagentControlResultSchema } from "@taki/shared";
import { startScriptedProvider, type ScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";
import { withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { deliveredInboxEvents, scriptedInboxReply } from "./fixture/agent-context-inbox.ts";

describe("default check-in policy through production Core and authenticated WS", () => {
  it.each([36, 50, 56])("completes %i task steps with same-Attempt compaction and exact N50 continuation", async (finishStep) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "taki-delegation-checkin-"));
    const evidenceRoot = process.env.TAKI_E2E_EVIDENCE_DIR ?? temporaryRoot;
    mkdirSync(evidenceRoot, { recursive: true });
    let delegated = false;
    let taskSteps = 0;
    let summaries = 0;
    let passed = false;
    let provider: ScriptedProvider | undefined;
    const reply = (request: Record<string, unknown>): ScriptedReply => {
      const message = JSON.stringify(request.messages);
      const usage = { prompt_tokens: 101, completion_tokens: 17, total_tokens: 118 };
      if (request.stream !== true && message.includes("Summarize completed private task work")) {
        summaries++;
        return { text: "CHECKIN_WORK: user did not visit Osaka; external speaker Mina did. Completed action rounds are retained; continue the same work until the final report.", usage };
      }
      if (toolNames(request).includes("complete_subagent")) {
        taskSteps++;
        expect(message).toContain("CHECKIN_WORK");
        return taskSteps === finishStep
          ? { calls: [{ name: "complete_subagent", arguments: { text: "Final: Mina visited Osaka; the user did not.", materials: [] } }], usage }
          : { text: `Completed round ${taskSteps}. ` + "Mina's external report does not establish the user's experience. ".repeat(35),
            calls: [{ name: "interact_parent", arguments: { kind: "message", text: `Private round ${taskSteps}` } }], usage };
      }
      if (message.includes("This unattended inbox opportunity cannot create children.")) {
        expect(toolNames(request)).not.toContain("delegate_subagent");
        expect(toolNames(request)).toEqual(expect.arrayContaining(["send_subagent_message", "stop_subagent", "read_agent_inbox", "handle_agent_event"]));
      }
      const inbox = scriptedInboxReply(request, () => ({ kind: "retained", note: "Keep the check-in paused for explicit continuation." }));
      if (inbox) return { ...inbox, usage };
      expect(deliveredInboxEvents(request)).toHaveLength(0);
      if (delegated) return { text: "The main Companion remains available.", usage };
      delegated = true;
      return { calls: [{ name: "delegate_subagent", arguments: { label: "Check-in regression", subagentId: null,
        direction: "CHECKIN_WORK: user did not visit Osaka; external speaker Mina did. Complete the private rounds and final report.",
        context: { kind: "fresh" }, completionPolicy: "record_only", toolSelection: { mode: "allow", names: ["complete_subagent"] }, materials: [] } }], usage };
    };
    try {
      provider = await startScriptedProvider(reply);
      const runningProvider = provider;
      await withScriptedAgentContextScenario({ name: `checkin-default-${finishStep}`, providerBaseUrl: provider.baseUrl,
        evidenceRoot, maxUpstreamRequests: 110, contextTokens: 24000, historyRatio: 0.2, compactKeepMessages: 4 }, async (scenario) => {
        const defaults = await scenario.effectiveSettings();
        expect(defaults.entries.find((entry) => entry.key === "TAKI_SUBAGENT_CHECKIN_STEPS")?.value).toBe(50);
        expect(defaults.entries.find((entry) => entry.key === "TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS")?.value).toBe(3);
        await scenario.ask("Start the isolated long private regression work.");
        const child = (await scenario.list()).entries[0]!;
        expect(child).toBeDefined();
        let checkpointEvent: string | undefined;
        if (finishStep > 50) {
          await expect.poll(async () => (await scenario.history(child.subagentId)).conversation.pendingRequest?.reason,
            { timeout: 120_000, interval: 100 }).toBe("check_in");
          await expect.poll(async () => (await scenario.history(child.subagentId)).conversation.activeRunId,
            { timeout: 15_000 }).toBeNull();
          const paused = (await scenario.history(child.subagentId)).conversation;
          expect(taskSteps).toBe(50);
          expect(paused.pendingRequest?.checkIn).toMatchObject({ completedSteps: 50, intervalSteps: 50,
            consecutiveParentApprovals: 0, parentApprovalLimit: 3, requiredActor: "parent_or_user" });
          checkpointEvent = paused.pendingRequest!.eventId;
          expect((await scenario.history(child.subagentId)).executions).toHaveLength(1);
          expect(scenario.rows("SELECT attempt_id FROM run_attempts WHERE run_id IN (SELECT run_id FROM subagent_executions)")).toHaveLength(1);
          await scenario.ask("A normal foreground exchange while this work is paused.");
          expect(taskSteps).toBe(50);
          expect((await scenario.history(child.subagentId)).conversation.progress?.consecutiveParentApprovals).toBe(0);
          SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
            operationKey: randomUUID(), replyToEventId: checkpointEvent, direction: "Continue the same private work.", materials: [],
            target: { subagentId: child.subagentId, workInputId: paused.latestWorkInputId,
              expectedRunId: paused.activeRunId, expectedControlVersion: paused.controlVersion } }));
        }
        await expect.poll(async () => (await scenario.history(child.subagentId)).results.some((result) =>
          result.result.child.outputKind === "validated"), { timeout: 120_000, interval: 100 }).toBe(true);
        const complete = await scenario.history(child.subagentId);
        expect(taskSteps).toBe(finishStep);
        expect(complete.conversation.progress?.completedSteps).toBe(finishStep);
        expect(complete.conversation.pendingRequest).toBeNull();
        expect(complete.executions).toHaveLength(finishStep > 50 ? 2 : 1);
        expect(new Set(complete.executions.map((execution) => execution.workInputId)).size).toBe(1);
        expect(scenario.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL")).toHaveLength(finishStep);
        expect(summaries).toBeGreaterThan(1);
        expect(scenario.rows("SELECT revision FROM subagent_context_summaries").length).toBeGreaterThan(1);
        if (checkpointEvent) expect(complete.inputs.filter((input) => input.replyToEventId === checkpointEvent)).toHaveLength(1);
        else expect(scenario.rows("SELECT event_id FROM subagent_checkins")).toHaveLength(0);
        expect(complete.conversation.tokenUsage?.complete).toBe(true);
        expect(complete.conversation.tokenUsage?.totalTokens).toBe((finishStep + summaries) * 118);
        expect(scenario.rows("SELECT run_id FROM run_deliveries")).toHaveLength(0);
        expect(scenario.rows("SELECT content FROM timeline_messages").some((row) => /Mina|Private round/.test(String(row.content)))).toBe(false);
        expect(runningProvider.errors).toEqual([]);
        scenario.checkpoint("default-checkin-and-source-boundaries-verified", { finishStep, summaries, complete });
      });
      passed = true;
    } finally {
      await finishCheckInFixture({ provider, temporaryRoot, passed });
    }
  }, 240_000);
});

async function finishCheckInFixture(input: { provider: ScriptedProvider | undefined; temporaryRoot: string; passed: boolean }): Promise<void> {
  const closed = await Promise.allSettled([Promise.resolve().then(() => input.provider?.close()), Promise.resolve().then(() => {
    if (dirname(resolve(input.temporaryRoot)) !== resolve(tmpdir()) || !input.temporaryRoot.includes("taki-delegation-checkin-")) throw new Error("unsafe check-in fixture cleanup");
    rmSync(input.temporaryRoot, { recursive: true, force: true });
  })]);
  if (input.passed && closed.some((result) => result.status === "rejected")) throw new Error("check-in fixture cleanup failed");
}

function toolNames(request: Record<string, unknown>): string[] {
  if (!Array.isArray(request.tools)) return [];
  return request.tools.flatMap((item: unknown) => {
    if (!item || typeof item !== "object" || !("function" in item)) return [];
    const fn = item.function;
    return fn && typeof fn === "object" && "name" in fn && typeof fn.name === "string" ? [fn.name] : [];
  });
}
