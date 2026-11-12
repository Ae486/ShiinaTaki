import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBAGENT_METHODS, SubagentCheckInSchema, SubagentControlResultSchema, SubagentEventSchema, SubagentTargetSchema } from "@taki/shared";
import { assertEventAction, requestTools } from "./fixture/agent-interface-evidence.ts";
import { handledEvents, modelToolOutputs, scriptedInboxReply } from "./fixture/agent-context-inbox.ts";
import { withScriptedAgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { startScriptedProvider, type ScriptedReply } from "./fixture/scripted-provider.ts";

describe("authenticated check-in reset and subsequent parent approval", () => {
  it.each(["parent_continue", "ask_user"] as const)("resets user progress and supports the later %s decision", async (laterDecision) => {
    const evidenceRoot = resolve(process.env.TAKI_E2E_EVIDENCE_DIR ?? "../artifacts/delegation-interface-20261104/checkin-reset-no-model");
    mkdirSync(evidenceRoot, { recursive: true });
    let assigned = false;
    let steps = 0;
    const reply = (request: Record<string, unknown>): ScriptedReply => {
      if (requestTools(request).includes("complete_subagent")) {
        steps++;
        return { calls: steps === 11
          ? [{ name: "complete_subagent", arguments: { text: "RESET_REGRESSION_FINISHED", materials: [] } }]
          : [{ name: "read_file", arguments: { path: "checkin-source.txt" } }] };
      }
      const outputs = modelToolOutputs(request);
      const inbox = scriptedInboxReply(request, (text) => {
        if (text === "RESET_REGRESSION_FINISHED") return { kind: "retained", note: text };
        const detail = outputs.find((output) => typeof output.eventId === "string" && output.text === text
          && SubagentTargetSchema.safeParse(output.target).success);
        if (!detail) throw new Error("check-in must use its actual delivered detail");
        const pending = detail.pendingRequest;
        if (!pending || typeof pending !== "object" || !("checkIn" in pending)) throw new Error("actual check-in sidecar missing");
        const checkIn = SubagentCheckInSchema.parse(pending.checkIn);
        if (checkIn.requiredActor === "user" || (checkIn.completedSteps === 9 && laterDecision === "ask_user")) {
          return { kind: "needs_user_input", note: "This check-in asks for the user's explicit continuation." };
        }
        return { kind: "continue_child", target: SubagentTargetSchema.parse(detail.target), replyToEventId: SubagentEventSchema.shape.eventId.parse(detail.eventId),
          direction: "Continue the same private regression work." };
      });
      if (inbox) return inbox;
      if (assigned) return { text: "The main conversation is available." };
      assigned = true;
      return { calls: [{ name: "delegate_subagent", arguments: { label: "Check-in reset regression", subagentId: null,
        direction: "Complete the isolated private check-in reset regression.", context: { kind: "fresh" },
        completionPolicy: "request_parent", toolSelection: { mode: "allow", names: ["read_file"] }, materials: [] } }] };
    };
    const provider = await startScriptedProvider(reply);
    try {
      await withScriptedAgentContextScenario({ name: `checkin-reset-${laterDecision.replaceAll("_", "-")}`, providerBaseUrl: provider.baseUrl, evidenceRoot,
        maxUpstreamRequests: 40, mainMaxSteps: null, checkInSteps: 3, checkInParentApprovals: 1, seed(dataDir) {
          const workspace = join(dataDir, "workspace"); mkdirSync(workspace, { recursive: true });
          writeFileSync(join(workspace, "checkin-source.txt"), "A synthetic source for actual completed SDK read steps.\n", "utf8");
        } }, async (s) => {
        await s.ask("Start the isolated check-in reset regression.");
        const child = (await s.list()).entries[0]!;
        await expect.poll(async () => (await s.history(child.subagentId)).conversation.pendingRequest?.checkIn?.requiredActor,
          { timeout: 30_000 }).toBe("user");
        await expect.poll(async () => (await s.history(child.subagentId)).conversation.activeRunId, { timeout: 15_000 }).toBeNull();
        const paused = (await s.history(child.subagentId)).conversation;
        const eventId = paused.pendingRequest!.eventId;
        await expect.poll(() => handledEvents(s).some((event) => event.event_id === eventId), { timeout: 15_000 }).toBe(true);
        assertEventAction(s, eventId, "needs_user_input");
        const resumed = SubagentControlResultSchema.parse(await s.rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
          target: { subagentId: child.subagentId, workInputId: paused.pendingRequest!.workInputId,
            expectedRunId: paused.activeRunId, expectedControlVersion: paused.controlVersion },
          operationKey: randomUUID(), replyToEventId: eventId, direction: "Explicit user continuation of the same work.", materials: [] }));
        expect(resumed.input).toMatchObject({ kind: "continue", sender: { kind: "user" }, replyToEventId: eventId });
        expect(resumed.conversation.progress).toMatchObject({ completedSteps: 6, intervalStartSteps: 6,
          intervalSteps: 3, consecutiveParentApprovals: 0, parentApprovalLimit: 1 });
        s.checkpoint("immediate-user-reset-receipt", resumed);
        let latestUserContinuation = resumed;
        if (laterDecision === "ask_user") {
          await expect.poll(async () => (await s.history(child.subagentId)).conversation.pendingRequest?.checkIn?.completedSteps,
            { timeout: 30_000 }).toBe(9);
          await expect.poll(async () => (await s.history(child.subagentId)).conversation.activeRunId, { timeout: 15_000 }).toBeNull();
          const extraPaused = (await s.history(child.subagentId)).conversation;
          const extraEvent = extraPaused.pendingRequest!.eventId;
          await expect.poll(() => handledEvents(s).some((event) => event.event_id === extraEvent), { timeout: 15_000 }).toBe(true);
          const asked = assertEventAction(s, extraEvent, "needs_user_input");
          expect(s.rows("SELECT event_id,state,answer_input_id FROM subagent_input_waits").find((wait) => wait.event_id === extraEvent))
            .toMatchObject({ state: "open", answer_input_id: null });
          expect((await s.history(child.subagentId)).inputs.some((input) => input.replyToEventId === extraEvent)).toBe(false);
          expect(s.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL")).toHaveLength(9);
          const extra = SubagentControlResultSchema.parse(await s.rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
            target: { subagentId: child.subagentId, workInputId: extraPaused.pendingRequest!.workInputId,
              expectedRunId: extraPaused.activeRunId, expectedControlVersion: extraPaused.controlVersion },
            operationKey: randomUUID(), replyToEventId: extraEvent, direction: "I approve this one additional requested check-in.", materials: [] }));
          expect(extra.input).toMatchObject({ kind: "continue", sender: { kind: "user" }, replyToEventId: extraEvent });
          expect(extra.conversation.progress).toMatchObject({ completedSteps: 9, intervalStartSteps: 9, consecutiveParentApprovals: 0 });
          expect(handledEvents(s).find((event) => event.event_id === extraEvent)?.action_json).toBe(asked.action_json);
          latestUserContinuation = extra;
          s.checkpoint("one-additional-asked-user-reset-receipt", extra);
        }
        await expect.poll(async () => (await s.history(child.subagentId)).results.some((result) =>
          result.result.child.outputKind === "validated"), { timeout: 30_000 }).toBe(true);
        const done = await s.history(child.subagentId);
        const checkins = s.rows(`SELECT c.event_id,c.checkin_json FROM subagent_checkins c
          JOIN subagent_events e ON e.event_id=c.event_id ORDER BY e.seq`);
        expect(checkins.map((row) => JSON.parse(String(row.checkin_json)))).toMatchObject([
          { completedSteps: 3, intervalStartSteps: 0, consecutiveParentApprovals: 0, requiredActor: "parent_or_user" },
          { completedSteps: 6, intervalStartSteps: 3, consecutiveParentApprovals: 1, requiredActor: "user" },
          { completedSteps: 9, intervalStartSteps: 6, consecutiveParentApprovals: 0, requiredActor: "parent_or_user" }]);
        assertEventAction(s, String(checkins[2]!.event_id), laterDecision === "parent_continue" ? "continue_child" : "needs_user_input");
        const laterParentContinuations = done.inputs.filter((input) => input.kind === "continue" && input.sender.kind === "parent"
          && input.workSeq > latestUserContinuation.input!.workSeq && input.replyToEventId !== null);
        expect(laterParentContinuations).toHaveLength(laterDecision === "parent_continue" ? 1 : 0);
        expect(done.conversation.progress).toMatchObject({ completedSteps: 11, intervalStartSteps: 9,
          consecutiveParentApprovals: laterDecision === "parent_continue" ? 1 : 0 });
        expect(done.conversation.progress!.consecutiveParentApprovals).toBe(laterParentContinuations.length);
        expect(s.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL")).toHaveLength(11);
        expect(provider.errors).toEqual([]);
        s.checkpoint("reset-preserved-and-latest-user-counter-verified", { resumed, latestUserContinuation, checkins, laterParentContinuations, done });
      });
    } finally { await provider.close(); }
  }, 90_000);
});
