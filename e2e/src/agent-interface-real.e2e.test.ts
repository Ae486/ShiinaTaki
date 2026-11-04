import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBAGENT_METHODS, PreparedPublicationResultSchema, SubagentControlResultSchema, type SubagentSummary } from "@taki/shared";
import { handledEvents } from "./fixture/agent-context-inbox.ts";
import { realAgentContextEnabled, withAgentContextScenario, type AgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { startAgentContextTimingRelay } from "./fixture/agent-context-timing-relay.ts";
import { assertEventAction, assertNoWaitingOrPolling, requestTools, saveInterfaceEvidence } from "./fixture/agent-interface-evidence.ts";

// This new 18/20/32 campaign is never enabled by provider credentials or the previous campaigns' gates alone.
const ENABLED = process.env.TAKI_E2E_REAL_AGENT_INTERFACE === "1" && realAgentContextEnabled;
const POLL = { timeout: 90_000, interval: 250 };

describe("natural flat delegation interface with bounded real-model requests", () => {
  it.skipIf(!ENABLED)("delayed two-report delivery preserves useful native foreground work (cap 18)", async () => {
    let timing: Awaited<ReturnType<typeof startAgentContextTimingRelay>> | undefined;
    const workers = new Map<string, string>();
    const durations: Record<string, number> = {};
    await withAgentContextScenario({ name: "interface-delayed-native", nativeHost: "exec", maxUpstreamRequests: 18,
      mainMaxSteps: null, sessionDeadlineMs: 420_000, async transport(baseUrl, evidenceDir) {
        timing = await startAgentContextTimingRelay({ baseUrl, evidenceDir, gate(body) {
          if (!requestTools(body).includes("complete_subagent")) return;
          const messages = body.messages as Array<{ role: string; content: unknown }>;
          const key = JSON.stringify(messages.find((message) => message.role === "user"));
          if (!workers.has(key)) workers.set(key, `worker-${workers.size + 1}`);
          return workers.get(key);
        } });
        return timing;
      } }, async (s) => {
      try {
        const initialAt = performance.now();
        await s.ask("Please assign two independent reviewers to check these reimbursement groups, one reviewer per group. "
          + "Group A has 17 and 28 yuan; group B has 70 and 19 yuan. Acknowledge the assignments promptly and remain available. "
          + "When both reports arrive, give each total, the larger group, and the exact difference in one final answer without another reminder.");
        durations.initialReplyMs = performance.now() - initialAt;
        await expect.poll(() => workers.size, POLL).toBe(2);
        expect((await s.list()).entries).toHaveLength(2);
        expect(finalEvents(s)).toHaveLength(0);
        const nativeBaseline = s.nativeHost!.audit().length;
        const foregroundAt = performance.now();
        const foreground = await s.ask("While those reviews are pending, please obtain this computer's actual host name and tell me what it is. This is a separate useful task.");
        durations.foregroundTaskMs = performance.now() - foregroundAt;
        const hostnameAudit = s.nativeHost!.audit().slice(nativeBaseline).filter((entry) => entry.capability === "exec"
          && entry.command === "hostname" && entry.decision === "auto-allowed");
        expect(hostnameAudit).toHaveLength(1);
        expect(foreground.text).toContain(s.nativeHost!.hostname);
        expect(finalEvents(s)).toHaveLength(0);
        expect(integratedAnswers(s)).toHaveLength(0);
        s.checkpoint("useful-foreground-finished-with-two-real-children-held", { durations, hostnameAudit });

        timing!.release("worker-1");
        await expect.poll(() => finalEvents(s).length, POLL).toBe(1);
        await expect.poll(() => inboxSettled(s), POLL).toBe(true);
        expect(handledEvents(s)).toHaveLength(1);
        expect(integratedAnswers(s)).toHaveLength(0);
        s.checkpoint("first-report-handled-second-not-forwarded");
        timing!.release("worker-2");
        await expect.poll(() => finalEvents(s).length, POLL).toBe(2);
        await expect.poll(() => integratedAnswers(s).length, POLL).toBe(1);
        await expect.poll(() => inboxSettled(s), POLL).toBe(true);
        const events = finalEvents(s);
        expect(handledEvents(s)).toHaveLength(2);
        for (const event of events) {
          const row = handledEvents(s).find((action) => action.event_id === event.event_id)!;
          assertEventAction(s, String(event.event_id), JSON.parse(String(row.action_json)).kind);
        }
        assertActualPublication(s);
        expect(s.rows("SELECT seq FROM timeline_messages WHERE role='user'")).toHaveLength(2);
        assertNoWaitingOrPolling(s);
      } finally { saveInterfaceEvidence(s, timing?.requests, durations); }
    });
  }, 480_000);

  it.skipIf(!ENABLED)("ordinary guidance and genuine exact inbox question round-trip (cap 20)", async () => {
    let timing: Awaited<ReturnType<typeof startAgentContextTimingRelay>> | undefined;
    await withAgentContextScenario({ name: "interface-exact-question", maxUpstreamRequests: 20,
      mainMaxSteps: null, sessionDeadlineMs: 540_000, seed(dataDir) {
        writeWorkspace(dataDir, "decision-options.json", {
          requirements: { existingRecords: "must survive", offlineReads: "essential", maximumAcceptableLatencyMs: null },
          options: [{ name: "Amber", offline: true, preservesExistingRecords: true, latencyMs: 250 },
            { name: "Cobalt", offline: true, preservesExistingRecords: true, latencyMs: 700 }],
          note: "The missing owner's latency limit requires clarification before the final recommendation." });
      }, async transport(baseUrl, evidenceDir) {
        timing = await startAgentContextTimingRelay({ baseUrl, evidenceDir,
          gate: (body) => requestTools(body).includes("complete_subagent") ? "reviewer-held" : undefined });
        return timing;
      } }, async (s) => {
      try {
        await s.ask("Assign one independent reviewer to decide between the options in decision-options.json. "
          + "It must request the missing essential latency limit before choosing, keep its review pending until answered, "
          + "then finish the same decision work. Acknowledge the assignment promptly so I can supply ordinary guidance.");
        const child = await onlyChild(s);
        await expect.poll(() => timing?.requests.some((request) => request.heldAt !== null), POLL).toBe(true);
        const before = (await s.history(child.subagentId)).conversation;
        const work = before.activeWorkInputId ?? before.latestWorkInputId;
        await s.ask("Tell the already working reviewer that offline reads and preserving every existing record are hard requirements. "
          + "For our conversation, my maximum acceptable latency is 300 milliseconds. Keep that value available to answer its clarification when it asks; "
          + "send the ordinary offline/preservation guidance now, and keep the same review rather than creating another reviewer.");
        const guided = await s.history(child.subagentId);
        expect(guided.inputs.some((input) => input.kind === "message" && input.sender.kind === "parent" && input.workInputId === work)).toBe(true);
        expect(guided.conversation.pendingRequest).toBeNull();
        expect((await s.list()).entries).toHaveLength(1);
        timing!.release("reviewer-held");
        const questions = () => s.rows(`SELECT w.event_id,w.work_input_id FROM subagent_input_waits w
          WHERE NOT EXISTS(SELECT 1 FROM subagent_checkins c WHERE c.event_id=w.event_id)`);
        await expect.poll(() => questions().length, POLL).toBe(1);
        const question = questions()[0]!;
        const questionId = String(question.event_id);
        await expect.poll(() => handledEvents(s).some((event) => event.event_id === questionId), POLL).toBe(true);
        assertEventAction(s, questionId, "answered_child");
        await expect.poll(async () => (await s.history(child.subagentId)).results.some((result) =>
          result.result.child.outputKind === "validated" && /Amber/iu.test(result.result.child.body ?? "")), POLL).toBe(true);
        const done = await s.history(child.subagentId);
        const answer = done.inputs.filter((input) => input.replyToEventId === questionId);
        expect(answer).toHaveLength(1);
        expect(answer[0]).toMatchObject({ workInputId: work, sender: { kind: "parent" },
          direction: expect.stringContaining("300"), consumed: { effectId: expect.any(String), runId: expect.any(String) } });
        expect(done.conversation.pendingRequest).toBeNull();
        expect(new Set(done.executions.map((execution) => execution.workInputId))).toEqual(new Set([work]));
        expect(new Set(done.executions.map((execution) => execution.runId)).size).toBeGreaterThanOrEqual(2);
        await expect.poll(() => publicAnswers(s).some((row) => /Amber/iu.test(String(row.content))), POLL).toBe(true);
        await expect.poll(() => inboxSettled(s), POLL).toBe(true);
        assertActualPublication(s);
        assertNoWaitingOrPolling(s);
      } finally { saveInterfaceEvidence(s, timing?.requests); }
    });
  }, 600_000);

  it.skipIf(!ENABLED)("short factual check-in, user escalation and Stop authority (cap 32)", async () => {
    let chainFiles: string[] = [];
    const evidenceValues = [17, 23, 41, 59, 61, 37, 70];
    await withAgentContextScenario({ name: "interface-checkin-stop", maxUpstreamRequests: 32,
      mainMaxSteps: null, checkInSteps: 3, checkInParentApprovals: 1, sessionDeadlineMs: 600_000, seed(dataDir) {
        const workspace = join(dataDir, "workspace"); mkdirSync(workspace, { recursive: true });
        chainFiles = ["chain-1.json", ...Array.from({ length: 6 }, () => `evidence-${randomUUID()}.json`)];
        for (let i = 0; i < 7; i++) writeWorkspace(dataDir, chainFiles[i]!, {
          evidence: evidenceValues[i], nextFile: chainFiles[i + 1] ?? null,
          instruction: "Read the linked next file separately after this one; the final total requires every original source." });
      } }, async (s) => {
      try {
        await s.ask("Assign one independent reviewer to follow the serial evidence chain starting at chain-1.json. "
          + "It must open each linked file separately, retain the seven original values, and report their sum, without guessing unseen values. "
          + "Acknowledge promptly; if it asks for a routine progress check-in, you may approve one continuation without involving me, "
          + "then let me decide at the next check-in. Deliver the finished total when it arrives.");
        const child = await onlyChild(s);
        await expect.poll(async () => (await s.history(child.subagentId)).conversation.pendingRequest?.checkIn?.requiredActor, POLL).toBe("user");
        await expect.poll(async () => (await s.history(child.subagentId)).conversation.activeRunId, POLL).toBeNull();
        const paused = (await s.history(child.subagentId)).conversation;
        const work = paused.pendingRequest!.workInputId;
        const waits = s.rows(`SELECT c.event_id FROM subagent_checkins c
          JOIN subagent_events e ON e.event_id=c.event_id ORDER BY e.seq`);
        expect(waits).toHaveLength(2);
        const firstId = String(waits[0]!.event_id);
        assertEventAction(s, firstId, "continue_child");
        expect(paused.pendingRequest!.checkIn).toMatchObject({ completedSteps: 6, intervalStartSteps: 3,
          intervalSteps: 3, consecutiveParentApprovals: 1, parentApprovalLimit: 1, requiredActor: "user" });
        expect(s.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL")).toHaveLength(6);
        await expect.poll(() => inboxSettled(s), POLL).toBe(true);
        const originalWork = (await s.history(child.subagentId)).inputs.find((input) => input.inputId === work);
        const reportRoot = originalWork?.replyAcceptance?.acceptedRootRunId;
        expect(reportRoot).toEqual(expect.any(String));
        const stepsBeforeStop = s.rows("SELECT * FROM subagent_task_steps").length;
        const eventsBeforeStop = s.rows("SELECT event_id FROM subagent_events ORDER BY seq");
        const stopped = SubagentControlResultSchema.parse(await s.rpc(SUBAGENT_METHODS.stop, { characterId: "taki", target: target(paused) }));
        expect(stopped.conversation.stopOrigin).toBe("user");
        expect(s.rows("SELECT run_id,state FROM runs").find((run) => run.run_id === reportRoot)?.state).toBe("cancelled");
        const stoppedVersion = stopped.conversation.controlVersion;
        await s.ask("Tell the same reviewer to keep all original evidence and finish its remaining current work when permitted. I am sending guidance, not lifting my Stop.");
        const afterGuidance = (await s.history(child.subagentId)).conversation;
        expect(afterGuidance.stopOrigin).toBe("user");
        expect(afterGuidance.controlVersion).toBe(stoppedVersion);
        expect(afterGuidance.activeRunId).toBeNull();
        expect(s.rows("SELECT * FROM subagent_task_steps")).toHaveLength(stepsBeforeStop);
        expect(s.rows("SELECT event_id FROM subagent_events ORDER BY seq")).toEqual(eventsBeforeStop);
        const resumed = SubagentControlResultSchema.parse(await s.rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
          target: target(afterGuidance), operationKey: randomUUID(), replyToEventId: paused.pendingRequest!.eventId,
          direction: "I explicitly lift my Stop for this same review. Finish the remaining evidence chain and report its verified total.", materials: [] }));
        expect(resumed.conversation.stopOrigin).toBeNull();
        expect(resumed.input).toMatchObject({ workInputId: work, kind: "continue", sender: { kind: "user" },
          replyToEventId: paused.pendingRequest!.eventId });
        expect(resumed.conversation.progress).toMatchObject({ completedSteps: 6, intervalStartSteps: 6,
          intervalSteps: 3, consecutiveParentApprovals: 0, parentApprovalLimit: 1 });
        s.checkpoint("explicit-user-continue-reset-receipt", resumed);
        let latestUserContinuation = resumed;
        const userContinuations = [resumed];
        const outcome = async () => {
          const history = await s.history(child.subagentId);
          if (history.results.some((result) => result.result.child.outputKind === "validated"
            && /308/u.test(result.result.child.body ?? ""))) return "final";
          const pending = history.conversation.pendingRequest;
          if (pending?.reason !== "check_in" || pending.workInputId !== work || history.conversation.activeRunId !== null) return "waiting";
          const asked = handledEvents(s).some((event) => event.event_id === pending.eventId
            && JSON.parse(String(event.action_json)).kind === "needs_user_input");
          const open = s.rows("SELECT event_id,state,answer_input_id FROM subagent_input_waits").some((wait) =>
            wait.event_id === pending.eventId && wait.state === "open" && wait.answer_input_id === null);
          const answered = history.inputs.some((input) => input.replyToEventId === pending.eventId);
          return asked && open && !answered ? "ask_user" : "waiting";
        };
        await expect.poll(outcome, POLL).not.toBe("waiting");
        if (await outcome() === "ask_user") {
          const extraHistory = await s.history(child.subagentId);
          const extraPaused = extraHistory.conversation;
          const extraEvent = extraPaused.pendingRequest!;
          const boundary = extraEvent.checkIn!.completedSteps;
          expect(extraPaused).toMatchObject({ activeRunId: null, stopOrigin: null });
          expect(extraEvent).toMatchObject({ workInputId: work, reason: "check_in" });
          expect(s.rows("SELECT event_id,state,answer_input_id FROM subagent_input_waits").find((wait) => wait.event_id === extraEvent.eventId))
            .toMatchObject({ state: "open", answer_input_id: null });
          expect(extraHistory.inputs.some((input) => input.replyToEventId === extraEvent.eventId)).toBe(false);
          expect(boundary).toBeGreaterThan(6);
          expect(boundary % 3).toBe(0);
          expect(s.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL")).toHaveLength(boundary);
          const asked = assertEventAction(s, extraEvent.eventId, "needs_user_input");
          const extra = SubagentControlResultSchema.parse(await s.rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
            target: target(extraPaused), operationKey: randomUUID(), replyToEventId: extraEvent.eventId,
            direction: "I approve this additional progress check-in. Continue the same review and finish its verified report.", materials: [] }));
          expect(extra.input).toMatchObject({ workInputId: work, kind: "continue", sender: { kind: "user" }, replyToEventId: extraEvent.eventId });
          expect(extra.conversation.progress).toMatchObject({ completedSteps: boundary, intervalStartSteps: boundary,
            intervalSteps: 3, consecutiveParentApprovals: 0, parentApprovalLimit: 1 });
          expect(handledEvents(s).find((event) => event.event_id === extraEvent.eventId)?.action_json).toBe(asked.action_json);
          latestUserContinuation = extra;
          userContinuations.push(extra);
          s.checkpoint("one-additional-asked-user-checkin-reset-receipt", { asked, extra });
          await expect.poll(outcome, POLL).not.toBe("waiting");
          expect(await outcome(), "Only one additional user decision is allowed in this bounded scenario").toBe("final");
        }
        const done = await s.history(child.subagentId);
        expect(new Set(done.executions.map((execution) => execution.workInputId))).toEqual(new Set([work]));
        const laterParentContinuations = done.inputs.filter((input) => input.kind === "continue" && input.sender.kind === "parent"
          && input.workSeq > latestUserContinuation.input!.workSeq && input.replyToEventId !== null);
        expect(done.conversation.progress?.consecutiveParentApprovals).toBe(laterParentContinuations.length);
        expect(laterParentContinuations.length).toBeLessThanOrEqual(1);
        expect(done.conversation.progress?.completedSteps)
          .toBe(s.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL").length);
        const firstResetInterval = s.rows("SELECT checkin_json FROM subagent_checkins WHERE interval_start_steps=6")
          .map((row) => JSON.parse(String(row.checkin_json)));
        for (const interval of firstResetInterval) expect(interval).toMatchObject({ completedSteps: 9,
          intervalStartSteps: 6, intervalSteps: 3, consecutiveParentApprovals: 0, parentApprovalLimit: 1, requiredActor: "parent_or_user" });
        const retainedReads = s.rows("SELECT output_json FROM subagent_tool_results WHERE tool_name='read_file'")
          .map((row) => JSON.parse(String(row.output_json)) as { ok?: boolean; path?: string });
        const readPaths = new Set(retainedReads.filter((read) => read.ok === true).map((read) => read.path));
        for (const file of chainFiles) expect(readPaths.has(file), `Original chain source was not actually read: ${file}`).toBe(true);
        const finalEvent = s.rows("SELECT event_id,work_input_id,eligible,body FROM subagent_events WHERE kind='final'")
          .find((event) => event.work_input_id === work);
        expect(finalEvent).toMatchObject({ eligible: 1, body: expect.stringMatching(/308/u) });
        await expect.poll(() => handledEvents(s).some((event) => event.event_id === finalEvent!.event_id), POLL).toBe(true);
        await expect.poll(() => inboxSettled(s), POLL).toBe(true);
        const handledFinal = handledEvents(s).find((event) => event.event_id === finalEvent!.event_id)!;
        if (JSON.parse(String(handledFinal.action_json)).kind === "speech_proposed") {
          await expect.poll(() => s.rows("SELECT event_id,result_json FROM subagent_speech_publications")
            .some((publication) => publication.event_id === finalEvent!.event_id
              && JSON.parse(String(publication.result_json)).reason === "source_unavailable"), POLL).toBe(true);
        }
        expect(s.rows("SELECT run_id,state FROM runs").find((run) => run.run_id === reportRoot)?.state).toBe("cancelled");
        expect(s.rows("SELECT state FROM run_deliveries").some((row) => row.state === "sent")).toBe(false);
        s.checkpoint("same-work-reporting-resumed-original-publication-right-stays-revoked", {
          reportRoot, finalEvent, handledFinal, chainFiles, evidenceValues, retainedReads,
          explicitUserReset: resumed, userContinuations, latestUserContinuation, firstResetInterval,
          laterParentContinuations, finalProgress: done.conversation.progress,
          publication: s.rows("SELECT * FROM subagent_speech_publications"),
          limitation: "User Stop revokes the original delayed speech root. User Continue restores child reporting, not old publication authority." });
        const frontier = Math.max(0, ...publicAnswers(s).map((row) => Number(row.seq)));
        const answer = await s.ask("Now that I explicitly resumed that same review, please read its completed finding and tell me its verified final total.");
        expect(answer.text).toMatch(/308/u);
        expect(publicAnswers(s).some((row) => Number(row.seq) > frontier && /308/u.test(String(row.content)))).toBe(true);
        assertNoWaitingOrPolling(s);
      } finally { saveInterfaceEvidence(s); }
    });
  }, 660_000);
});

function writeWorkspace(dataDir: string, filename: string, value: unknown) {
  const workspace = join(dataDir, "workspace"); mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, filename), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
async function onlyChild(s: AgentContextScenario) {
  await expect.poll(async () => (await s.list()).entries.length, POLL).toBe(1);
  return (await s.list()).entries[0]!;
}
function finalEvents(s: AgentContextScenario) { return s.rows("SELECT event_id FROM subagent_events WHERE kind='final'"); }
function publicAnswers(s: AgentContextScenario) { return s.rows("SELECT seq,content FROM timeline_messages WHERE role='assistant'"); }
function integratedAnswers(s: AgentContextScenario) {
  return publicAnswers(s).filter((row) => /\b45\b|四十五/u.test(String(row.content))
    && /\b89\b|八十九/u.test(String(row.content)) && /\b44\b|四十四/u.test(String(row.content)));
}
function inboxSettled(s: AgentContextScenario) {
  const rows = s.rows("SELECT state FROM subagent_inbox_consumers");
  return rows.length > 0 && rows.every((row) => row.state === "settled");
}
function target(child: SubagentSummary) {
  return { subagentId: child.subagentId, workInputId: child.activeWorkInputId ?? child.latestWorkInputId,
    expectedRunId: child.activeRunId, expectedControlVersion: child.controlVersion };
}
function assertActualPublication(s: AgentContextScenario) {
  const publications = s.rows("SELECT result_json FROM subagent_speech_publications")
    .map((row) => PreparedPublicationResultSchema.parse(JSON.parse(String(row.result_json))));
  expect(publications.some((publication) => publication.status === "recorded" && publication.state === "sent")).toBe(true);
  expect(s.rows("SELECT state FROM run_deliveries").some((row) => row.state === "sent")).toBe(true);
}
