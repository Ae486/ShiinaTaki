import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBAGENT_METHODS, SubagentControlResultSchema } from "@taki/shared";
import { startScriptedProvider, type ScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";
import { withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { seedTimeline } from "./fixture/seed-timeline.ts";
import { assertHandledEvent, deliveredInboxEvents, handledEvents, scriptedInboxReply } from "./fixture/agent-context-inbox.ts";

const SELECTED = "SELECTED_SCRIPTED_CONTEXT_462";
const EXCLUDED = "EXCLUDED_PARENT_CONTEXT_381";
const CORRECTED = "CORRECTED_CHILD_CONTEXT_905";

describe("delegation through production Core and authenticated WebSocket", () => {
  it.each([["record_only", false], ["request_parent", false], ["record_only", true]] as const)(
    "retains selected work and addressed input with %s completion (requested Memory mutations: %s)", async (completionPolicy, requestedMutations) => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "taki-agent-context-"));
    const evidenceRoot = process.env.TAKI_E2E_EVIDENCE_DIR ?? temporaryRoot;
    mkdirSync(evidenceRoot, { recursive: true });
    let delegated = false;
    let passed = false;
    const provider = await startScriptedProvider((request): ScriptedReply => {
      if (hasTool(request, "complete_subagent")) {
        if (requestedMutations) {
          expect(hasTool(request, "recall")).toBe(true);
          for (const name of ["retain", "update_memory", "invalidate_memory", "restore_memory"]) expect(hasTool(request, name)).toBe(false);
        }
        const messages = JSON.stringify(request.messages);
        expect(messages).toContain(SELECTED);
        expect(messages).not.toContain(EXCLUDED);
        return { calls: [{ name: "complete_subagent", arguments: { text: messages.includes(CORRECTED) ? `${SELECTED} ${CORRECTED}` : SELECTED, materials: [] } }] };
      }
      const inbox = scriptedInboxReply(request, (text) => ({ kind: "retained", note: `Retained child work reviewed internally: ${text}` }));
      if (inbox) return inbox;
      expect(hasTool(request, "delegate_subagent")).toBe(true);
      if (delegated) return { text: "The work was delegated." };
      delegated = true;
      return { calls: [{ name: "delegate_subagent", arguments: {
        label: "Selected context worker", subagentId: null, direction: "Return the selected marker using complete_subagent.",
        context: { kind: "snapshot", summary: SELECTED }, completionPolicy,
        toolSelection: { mode: "allow", names: requestedMutations
          ? ["recall", "complete_subagent", "retain", "update_memory", "invalidate_memory", "restore_memory"]
          : ["complete_subagent"] }, materials: [],
      } }] };
    });
    try {
      await withScriptedAgentContextScenario({ name: `scripted-${completionPolicy.replaceAll("_", "-")}${requestedMutations ? "-mutation-selection" : ""}`,
        providerBaseUrl: provider.baseUrl, evidenceRoot, maxUpstreamRequests: 8,
        seed(dataDir) { seedTimeline(dataDir, [{ role: "user", content: EXCLUDED }, { role: "assistant", content: "Previous unrelated conversation." }]); },
      }, async (scenario) => {
        await scenario.ask("Delegate the selected context task.");
        await expect.poll(async () => (await scenario.list()).entries.length, { timeout: 15_000 }).toBe(1);
        const child = (await scenario.list()).entries[0];
        if (!child) throw new Error("production delegate did not create a child");
        await expect.poll(async () => (await scenario.history(child.subagentId)).results.length, { timeout: 15_000 }).toBe(1);
        if (completionPolicy === "request_parent") {
          await expect.poll(() => handledEvents(scenario).length, { timeout: 15_000 }).toBe(1);
          assertHandledEvent(handledEvents(scenario)[0]!, { kind: "retained", marker: SELECTED });
        }
        const first = await scenario.history(child.subagentId);
        expect(first.results[0]?.result.child.body).toBe(SELECTED);
        const current = first.conversation;
        const sent = SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.send, {
          characterId: "taki", operationKey: randomUUID(), materials: [], direction: CORRECTED,
          target: { subagentId: child.subagentId, workInputId: current.latestWorkInputId,
            expectedControlVersion: current.controlVersion, expectedRunId: current.activeRunId },
        }));
        await expect.poll(async () => (await scenario.history(child.subagentId)).results.length, { timeout: 15_000 }).toBe(2);
        const history = await scenario.history(child.subagentId);
        expect(history.inputs.find((input) => input.inputId === sent.input?.inputId)?.consumed)
          .toMatchObject({ effectId: expect.any(String), runId: expect.any(String) });
        expect(history.results.some((result) => result.result.child.body === `${SELECTED} ${CORRECTED}`)).toBe(true);
        expect(new Set(history.executions.map((execution) => execution.runId)).size).toBe(2);
        if (completionPolicy === "record_only") {
          expect(history.results.every((result) => result.result.parentRunId === null && result.result.completionState === "not_requested")).toBe(true);
          expect(provider.requests.some((request) => deliveredInboxEvents(request).length > 0)).toBe(false);
          expect(scenario.rows("SELECT consumer_id FROM subagent_inbox_consumers")).toHaveLength(0);
          expect(scenario.rows("SELECT event_id FROM subagent_event_actions")).toHaveLength(0);
          expect(scenario.rows("SELECT consumer_id FROM subagent_inbox_deliveries")).toHaveLength(0);
        } else {
          await expect.poll(() => handledEvents(scenario).length, { timeout: 15_000 }).toBe(2);
          const events = handledEvents(scenario);
          assertHandledEvent(events[0]!, { kind: "retained", marker: SELECTED });
          assertHandledEvent(events[1]!, { kind: "retained", marker: CORRECTED });
          expect(new Set(events.map((event) => event.producer_run_id)).size).toBe(2);
          expect(new Set(provider.requests.flatMap(deliveredInboxEvents).map((event) => event.eventId)))
            .toEqual(new Set(events.map((event) => event.event_id)));
        }
        expect(scenario.rows("SELECT event_id FROM subagent_speech_publications")).toHaveLength(0);
        expect(scenario.rows("SELECT run_id FROM run_deliveries")).toHaveLength(0);
        expect(scenario.rows("SELECT content FROM timeline_messages").some((row) => String(row.content).includes(CORRECTED))).toBe(false);
        expect(provider.errors).toEqual([]);
        scenario.checkpoint("production-rpc-delegation-verified", await scenario.history(child.subagentId));
      });
      passed = true;
    } finally {
      await finishFixture({ temporaryRoot, provider, passed });
    }
  }, 120_000);
});

async function finishFixture(input: { temporaryRoot: string; provider: ScriptedProvider; passed: boolean }): Promise<void> {
  const results = await Promise.allSettled([input.provider.close(), Promise.resolve().then(() => {
    if (dirname(resolve(input.temporaryRoot)) !== resolve(tmpdir()) || !input.temporaryRoot.includes("taki-agent-context-")) {
      throw new Error("unsafe scripted fixture cleanup path");
    }
    rmSync(input.temporaryRoot, { recursive: true, force: true });
  })]);
  if (input.passed && results.some((result) => result.status === "rejected")) throw new Error("scripted fixture cleanup failed");
}

function hasTool(request: Record<string, unknown>, name: string): boolean {
  return Array.isArray(request.tools) && request.tools.some((tool: unknown) => {
    if (!tool || typeof tool !== "object" || !("function" in tool)) return false;
    const fn = tool.function;
    return fn && typeof fn === "object" && "name" in fn && fn.name === name;
  });
}
