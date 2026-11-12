import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SubagentInboxActionSchema, SubagentTargetSchema, type SubagentTarget } from "@taki/shared";
import { handledEvents, modelToolOutputs, scriptedInboxReply } from "./fixture/agent-context-inbox.ts";
import { withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { assertEventAction, isWaitingCommand, requestTools } from "./fixture/agent-interface-evidence.ts";
import { startScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";

const QUESTION = "QUESTION_MARKER: What is the owner's latency limit?";
const ANSWER = "OWNER_ANSWER_300: maximum latency is 300 milliseconds.";
const FINAL = "FINAL_AMBER_250: Amber satisfies the owner's 300 millisecond limit.";

describe("flat interface through real SDK/Core/SQLite with a local scripted provider", () => {
  it.each(["atomic-inbox-answer", "ask-user-then-direct-answer"] as const)("preserves %s and its canonical receipts", async (mode) => {
    const evidenceRoot = resolve(process.env.TAKI_E2E_EVIDENCE_DIR ?? "../artifacts/delegation-interface-20261104/inbox-no-model");
    mkdirSync(evidenceRoot, { recursive: true });
    let assigned = false;
    let exactTarget: SubagentTarget | undefined;
    let questionId: string | undefined;
    const reply = (request: Record<string, unknown>): ScriptedReply => {
      const messages = JSON.stringify(request.messages);
      if (requestTools(request).includes("complete_subagent")) {
        return { calls: messages.includes(ANSWER)
          ? [{ name: "complete_subagent", arguments: { text: FINAL, materials: [] } }]
          : [{ name: "interact_parent", arguments: { kind: "needs_input", text: QUESTION } }] };
      }
      const outputs = modelToolOutputs(request);
      const inbox = scriptedInboxReply(request, (text) => {
        if (!text.includes(QUESTION)) return { kind: "speech_proposed", note: FINAL };
        if (mode === "ask-user-then-direct-answer") return { kind: "needs_user_input", note: QUESTION };
        const detail = outputs.find((output) => output.text === QUESTION && SubagentTargetSchema.safeParse(output.target).success);
        if (!detail || typeof detail.eventId !== "string") throw new Error("actual question detail missing");
        return { kind: "answered_child", target: SubagentTargetSchema.parse(detail.target), replyToEventId: detail.eventId, direction: ANSWER };
      });
      if (inbox) return inbox;
      if (mode === "ask-user-then-direct-answer" && messages.includes("TRUSTED_USER_ANSWER")) {
        if (messages.includes('"name":"send_subagent_message"') && outputs.some((output) => output.accepted === true)) {
          return { text: "The exact answer has been sent." };
        }
        if (!exactTarget || !questionId) throw new Error("question must already be handled before the later direct answer");
        return { calls: [{ name: "send_subagent_message", arguments: { target: exactTarget, continue: false,
          replyToEventId: questionId, direction: ANSWER, materials: [] } }] };
      }
      if (assigned) return { text: "The main conversation remains available." };
      assigned = true;
      return { calls: [{ name: "delegate_subagent", arguments: { label: "Exact question fixture", subagentId: null,
        direction: "Request the missing latency; keep the review pending, then choose Amber using the exact owner's answer.",
        context: { kind: "fresh" }, completionPolicy: "request_parent",
        toolSelection: { mode: "allow", names: ["complete_subagent"] }, materials: [] } }] };
    };
    const provider = await startScriptedProvider(reply);
    try {
      await withScriptedAgentContextScenario({ name: mode, maxUpstreamRequests: 16, mainMaxSteps: null,
        providerBaseUrl: provider.baseUrl, evidenceRoot }, async (s) => {
        await s.ask("Run the isolated latency decision.");
        await expect.poll(() => handledEvents(s).some((event) => event.kind === "needs_input"), { timeout: 30_000 }).toBe(true);
        const question = handledEvents(s).find((event) => event.kind === "needs_input")!;
        questionId = String(question.event_id);
        const child = (await s.list()).entries[0]!;
        if (mode === "ask-user-then-direct-answer") {
          const asked = assertEventAction(s, questionId, "needs_user_input");
          const originalAction = String(asked.action_json);
          await expect.poll(async () => (await s.history(child.subagentId)).conversation.activeRunId, { timeout: 15_000 }).toBeNull();
          const paused = (await s.history(child.subagentId)).conversation;
          expect(paused.pendingRequest?.eventId).toBe(questionId);
          exactTarget = { subagentId: child.subagentId, workInputId: paused.pendingRequest!.workInputId,
            expectedRunId: paused.activeRunId, expectedControlVersion: paused.controlVersion };
          await s.ask(`TRUSTED_USER_ANSWER: ${ANSWER}`);
          expect(String(handledEvents(s).find((event) => event.event_id === questionId)!.action_json)).toBe(originalAction);
        } else { assertEventAction(s, questionId, "answered_child"); }
        await expect.poll(async () => (await s.history(child.subagentId)).results.some((result) =>
          result.result.child.outputKind === "validated" && result.result.child.body === FINAL), { timeout: 30_000 }).toBe(true);
        const done = await s.history(child.subagentId);
        const answers = done.inputs.filter((input) => input.replyToEventId === questionId);
        expect(answers).toHaveLength(1);
        expect(answers[0]).toMatchObject({ direction: ANSWER, consumed: { effectId: expect.any(String) } });
        expect(done.conversation.pendingRequest).toBeNull();
        expect(new Set(done.executions.map((execution) => execution.workInputId)).size).toBe(1);
        expect(done.executions).toHaveLength(2);
        expect(SubagentInboxActionSchema.parse(JSON.parse(String(question.action_json))).kind)
          .toBe(mode === "atomic-inbox-answer" ? "answered_child" : "needs_user_input");
        expect(provider.errors).toEqual([]);
        s.checkpoint("exact-answer-and-historical-disposition-preserved", done);
      });
    } finally { await provider.close(); }
  }, 90_000);

  it.each(["Start-Sleep -Seconds 5", "sleep 2", "timeout /t 4", "ping -n 4 localhost", "powershell [Thread]::Sleep(500)"])(
    "records a waiting command even if governance would deny it: %s", (command) => expect(isWaitingCommand(command)).toBe(true));
  it("keeps useful hostname work distinct from waiting", () => expect(isWaitingCommand("hostname")).toBe(false));
});
