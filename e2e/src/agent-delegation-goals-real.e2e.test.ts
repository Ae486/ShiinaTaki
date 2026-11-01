import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SUBAGENT_METHODS, SubagentControlResultSchema, type SubagentSummary } from "@taki/shared";
import { realAgentContextEnabled, withAgentContextScenario, type AgentContextScenario } from "./fixture/agent-context-scenario.ts";
import { acknowledgedChildren, deliveredInboxEvents, handledEvents } from "./fixture/agent-context-inbox.ts";
import { startAgentContextTimingRelay } from "./fixture/agent-context-timing-relay.ts";

// This suite has its own opt-in. Root credentials or the older directed-suite opt-in alone cannot spend here.
const ENABLED = process.env.TAKI_E2E_REAL_AGENT_DELEGATION_GOALS === "1" && realAgentContextEnabled;
const cases = Array.from({ length: 8 }, (_, index) => ({ case: index + 1,
  required: `Case ${index + 1} requires offline reads and preservation of existing records.`,
  option: index % 2 ? "Online-only reads; legacy records are copied without deletion." : "Offline reads; legacy records are deleted after import.",
  source: `External reviewer Mina-${index + 1}; these are synthetic proposals, not the user's own experiences.` }));
const auditFiles = Array.from({ length: 24 }, (_, index) =>
  `evidence-${createHash("sha256").update(`audit-source-${index}`).digest("hex").slice(0, 12)}.json`);

describe("S12 goal-only real-model delegation on the configured production route", () => {
  it.skipIf(!ENABLED)("observes the actual simple Co-Watching plan child below the default fifty-step check-in", async () => {
    await withAgentContextScenario({ name: "goals-simple-cowatching-plan", maxUpstreamRequests: 24,
      sessionDeadlineMs: 420_000, mainMaxSteps: null }, async (scenario) => {
      const { observeRealCoWatchingPlan } = await import(new URL("./fixture/co-watching-real-plan.mjs", import.meta.url).href);
      const settings = Object.fromEntries((await scenario.effectiveSettings()).entries.map((entry) => [entry.key, entry.value]));
      expect(typeof settings.TAKI_PROVIDER_CONTEXT_TOKENS).toBe("number");
      expect(typeof settings.TAKI_CONTEXT_HISTORY_RATIO).toBe("number");
      await observeRealCoWatchingPlan({ baseUrl: scenario.providerBaseUrl, modelId: scenario.requestedModel,
        checkpoint: scenario.checkpoint, contextTokens: settings.TAKI_PROVIDER_CONTEXT_TOKENS,
        historyRatio: settings.TAKI_CONTEXT_HISTORY_RATIO, useProviderUsage: settings.TAKI_PROVIDER_INCLUDE_USAGE === true });
      assertProductionRequests(scenario, "load_skill", false);
    });
  }, 480_000);

  it.skipIf(!ENABLED)("delegates independent useful reviews and keeps the foreground available", async () => {
    await withAgentContextScenario({ name: "goals-natural-delegation", maxUpstreamRequests: 24,
      sessionDeadlineMs: 420_000, mainMaxSteps: null, seed: seedCases }, async (scenario) => {
      await scenario.ask("Please assign separate independent reviewers to assess the compatibility and migration risks of the synthetic proposals in review-cases.json. "
        + "Let each reviewer own one perspective, report its conclusion to you, and keep helping me while they work. Acknowledge the assignments promptly; combine their findings when available.");
      const children = await waitChildren(scenario, 2);
      expect(children).toHaveLength(2);
      await scenario.ask("While those reviews continue, please acknowledge that I am still here and can discuss another question with you.");
      for (const child of children) await waitCompleted(scenario, child.subagentId);
      const answerFrontier = timelineFrontier(scenario);
      await scenario.ask("Please review the returned findings and explain the compatibility and migration risks, preserving the distinction between external reviewers and my own experience.");
      await waitHandled(scenario, children.map((child) => child.subagentId));
      await waitPublicRiskSummary(scenario, { afterSeq: answerFrontier });
      assertProductionRequests(scenario);
      assertChildReadOnly(scenario);
      scenario.checkpoint("natural-independent-reviews-and-foreground-verified");
    });
  }, 480_000);

  it.skipIf(!ENABLED)("sends a natural correction to the already running reviewer", async () => {
    let timing: Awaited<ReturnType<typeof startAgentContextTimingRelay>> | undefined;
    await withAgentContextScenario({ name: "goals-running-followup", maxUpstreamRequests: 32,
      sessionDeadlineMs: 480_000, mainMaxSteps: null, seed: seedCases,
      async transport(baseUrl, evidenceDir) {
        timing = await startAgentContextTimingRelay({ baseUrl, evidenceDir,
          gate: (request) => toolNames(request).includes("complete_subagent") ? "running-reviewer" : undefined });
        return timing;
      } }, async (scenario) => {
      await scenario.ask("Please assign one compatibility reviewer to read review-cases.json, compare the proposals, and report its recommendation to you. "
        + "The reviewer should work independently; acknowledge the assignment promptly so I can send a correction while it works.");
      const child = (await waitChildren(scenario, 1))[0]!;
      await expect.poll(() => timing?.requests.some((request) => request.heldAt !== null), { timeout: 60_000 }).toBe(true);
      const work = child.activeWorkInputId ?? child.latestWorkInputId;
      await scenario.ask("The compatibility reviewer already working on this must treat offline reading as a hard requirement. "
        + "Send that correction to the same reviewer now. Please do not start another review or decide in its place.");
      await expect.poll(async () => (await scenario.history(child.subagentId)).inputs.some((input) =>
        input.kind === "message" && input.sender.kind === "parent"), { timeout: 60_000 }).toBe(true);
      expect((await scenario.list()).entries).toHaveLength(1);
      timing!.release("running-reviewer");
      const completed = await waitCompleted(scenario, child.subagentId);
      const correction = completed.inputs.find((input) => input.kind === "message" && input.sender.kind === "parent");
      expect(correction?.workInputId).toBe(work);
      expect(correction?.direction).toMatch(/offline|离线/iu);
      expect(correction?.consumed?.effectId).toEqual(expect.any(String));
      expect(completed.results.some((result) => /offline|离线/iu.test(result.result.child.body ?? ""))).toBe(true);
      expect(completed.executions.every((execution) => execution.workInputId === work)).toBe(true);
      assertProductionRequests(scenario);
      scenario.checkpoint("natural-same-work-followup-consumed", completed);
    });
  }, 540_000);

  it.skipIf(!ENABLED).each([
    { name: "obtains a genuine missing requirement and answers the exact question", interimFormat: false },
    { name: "keeps an interim clarification report pending until the exact answer", interimFormat: true },
  ])("$name", async ({ interimFormat }) => {
    await withAgentContextScenario({ name: interimFormat ? "goals-interim-clarification" : "goals-needs-input-roundtrip", maxUpstreamRequests: 40,
      sessionDeadlineMs: 540_000, mainMaxSteps: null, seed(dataDir) {
        writeWorkspace(dataDir, "decision-options.json", JSON.stringify({
          requirements: { existingRecords: "must survive", offlineReads: "essential", maximumAcceptableLatencyMs: null },
          options: [{ name: "Amber", offline: true, preservesExistingRecords: true, latencyMs: 250 },
            { name: "Cobalt", offline: true, preservesExistingRecords: true, latencyMs: 700 }],
          note: "The owner's maximum acceptable latency is unknown. It cannot be inferred from these options." }, null, 2));
      } }, async (scenario) => {
      const assignment = await scenario.ask("Have one independent reviewer choose an option from decision-options.json using my hard requirements. "
        + "One essential requirement is missing. The reviewer must obtain clarification from me before making a final recommendation; do not assume the missing value. "
        + "Keep that same review pending while the reviewer asks for my missing value, then resume it with my answer and finish the recommendation. Acknowledge the assignment promptly."
        + (interimFormat ? " The reviewer's initial clarification report must be plain text, without a preamble, structured as STATUS: awaiting clarification; QUESTION TO OWNER; NEXT. Its final report must name the recommended option and explain why it satisfies the requirements." : ""));
      expect(assignment.text.trim().length).toBeGreaterThan(0);
      const child = (await waitChildren(scenario, 1))[0]!;
      assertReportsRequested(scenario);
      await expect.poll(async () => (await scenario.history(child.subagentId)).conversation.pendingRequest?.reason,
        { timeout: 180_000, interval: 300 }).toBe("question");
      const waiting = await scenario.history(child.subagentId);
      const question = waiting.conversation.pendingRequest!;
      expect(waiting.conversation.activeRunId).toBeNull();
      await expect.poll(() => scenario.requests.some((request) => deliveredInboxEvents(parseRequest(request.body))
        .some((event) => event.eventId === question.eventId)), { timeout: 60_000, interval: 300 }).toBe(true);
      const event = scenario.rows("SELECT body FROM subagent_events WHERE kind='needs_input'");
      expect(event.some((row) => /latency|毫秒|延迟/i.test(String(row.body)))).toBe(true);
      expect(waiting.results.some((result) => result.result.child.outputKind === "validated")).toBe(false);
      if (interimFormat) expect(event.some((row) => /STATUS:/i.test(String(row.body)) && /QUESTION TO OWNER/i.test(String(row.body)))).toBe(true);
      const work = question.workInputId;
      const answerFrontier = Number(scenario.rows("SELECT coalesce(max(seq),0) AS seq FROM timeline_messages")[0]?.seq);
      await scenario.ask("My maximum acceptable latency is 300 milliseconds. Tell the same reviewer that this answers its pending question. "
        + "Keep offline reads and all existing records, and ask it to continue its current decision work.");
      await expect.poll(async () => (await scenario.history(child.subagentId)).inputs.some((input) =>
        input.replyToEventId === question.eventId), { timeout: 60_000, interval: 300 }).toBe(true);
      await waitCompleted(scenario, child.subagentId);
      await waitHandled(scenario, [child.subagentId]);
      const completed = await waitCompleted(scenario, child.subagentId);
      const answer = completed.inputs.find((input) => input.replyToEventId === question.eventId);
      expect(answer?.workInputId).toBe(work);
      expect(answer?.sender.kind).toBe("parent");
      expect(answer?.direction).toContain("300");
      expect(answer?.consumed?.effectId).toEqual(expect.any(String));
      expect(completed.conversation.pendingRequest).toBeNull();
      expect(completed.results.some((result) => /Amber/.test(result.result.child.body ?? ""))).toBe(true);
      expect(new Set(completed.executions.map((execution) => execution.workInputId))).toEqual(new Set([work]));
      expect(new Set(completed.executions.map((execution) => execution.runId)).size).toBeGreaterThanOrEqual(2);
      await expect.poll(() => scenario.rows("SELECT seq,content FROM timeline_messages WHERE role='assistant'")
        .some((row) => Number(row.seq) > answerFrontier && /Amber|琥珀/i.test(String(row.content))),
      { timeout: 60_000, interval: 300 }).toBe(true);
      assertProductionRequests(scenario);
      scenario.checkpoint("genuine-question-addressed-answer-and-new-run", completed);
    });
  }, 600_000);

  it.skipIf(!ENABLED)("handles an actual full eight-event inbox with unchanged model responses", async () => {
    let timing: Awaited<ReturnType<typeof startAgentContextTimingRelay>> | undefined;
    await withAgentContextScenario({ name: "goals-full-eight-inbox", maxUpstreamRequests: 64,
      sessionDeadlineMs: 600_000, mainMaxSteps: null, seed: seedCases,
      async transport(baseUrl, evidenceDir) {
        timing = await startAgentContextTimingRelay({ baseUrl, evidenceDir, gate(request) {
          if (toolNames(request).includes("complete_subagent")) return "eight-reviewers";
          if (acknowledgedChildren(request).length >= 8 && deliveredInboxEvents(request).length === 0) return "main-after-eight-delegations";
          return undefined;
        } });
        return timing;
      } }, async (scenario) => {
      const assigned = scenario.ask("Ask eight independent reviewers to check the eight supplied cases in review-cases.json separately, one reviewer per case. "
        + "Each should decide whether its proposal satisfies that case's requirements and report its finding to you. "
        + "Acknowledge all eight assignments promptly; review every returned finding and summarize unresolved decisions afterwards.");
      // Observe rejection immediately while the test coordinates real request timing.
      let assignmentFailed = false;
      void assigned.catch(() => { assignmentFailed = true; });
      const children = await waitChildren(scenario, 8);
      expect(children).toHaveLength(8);
      assertReportsRequested(scenario);
      await expect.poll(() => timing?.requests.some((request) => request.gate === "main-after-eight-delegations" && request.heldAt !== null),
        { timeout: 60_000 }).toBe(true);
      timing!.release("eight-reviewers");
      await expect.poll(() => assignmentFailed || firstTerminalEvents(scenario, children).length === 8,
        { timeout: 240_000, interval: 300 }).toBe(true);
      expect(assignmentFailed, "The held foreground request failed before the terminal batch was available").toBe(false);
      const initialEvents = firstTerminalEvents(scenario, children);
      expect(initialEvents).toHaveLength(8);
      const answerFrontier = timelineFrontier(scenario);
      timing!.release("main-after-eight-delegations");
      await assigned;
      await expect.poll(() => scenario.requests.some((request) => deliveredInboxEvents(parseRequest(request.body)).length === 8),
        { timeout: 180_000, interval: 300 }).toBe(true);
      for (const child of children) {
        const completed = await waitCompleted(scenario, child.subagentId);
        const originalWork = child.activeWorkInputId ?? child.latestWorkInputId;
        expect(originalWork).toEqual(expect.any(String));
        expect(new Set(completed.executions.map((execution) => execution.workInputId))).toEqual(new Set([originalWork]));
        const initial = initialEvents.find((event) => event.subagent_id === child.subagentId)!;
        expect(initial.work_input_id).toBe(originalWork);
        if (initial.kind === "interrupted") {
          expect(completed.inputs.some((input) => (input.kind === "message" || input.kind === "continue") && input.sender.kind === "parent"
            && input.workInputId === originalWork && input.consumed?.runId !== initial.producer_run_id
            && input.consumed?.effectId)).toBe(true);
        }
      }
      expect((await scenario.list()).entries).toHaveLength(8);
      await waitHandled(scenario, children.map((child) => child.subagentId));
      const finalEvents = handledEvents(scenario).filter((event) => event.kind === "final");
      expect(finalEvents).toHaveLength(8);
      expect(new Set(finalEvents.map((event) => event.event_id)).size).toBe(8);
      const requiredEvents = new Set([...initialEvents, ...finalEvents].map((event) => String(event.event_id)));
      await expect.poll(() => [...requiredEvents].every((id) => handledEvents(scenario).filter((event) => event.event_id === id).length === 1),
        { timeout: 180_000, interval: 300 }).toBe(true);
      expect(scenario.rows("SELECT event_id,count(*) AS n FROM subagent_event_actions GROUP BY event_id").every((row) => row.n === 1)).toBe(true);
      const finalIds = new Set(finalEvents.map((event) => String(event.event_id)));
      const deliveredAt = scenario.rows(`SELECT m.event_id,d.created_at FROM subagent_inbox_members m
        JOIN subagent_inbox_deliveries d USING(consumer_id)`).filter((row) => finalIds.has(String(row.event_id)))
        .map((row) => String(row.created_at)).sort().at(-1);
      expect(deliveredAt).toEqual(expect.any(String));
      await waitPublicRiskSummary(scenario, { afterSeq: answerFrontier, deliveredAt });
      expect(scenario.rows("SELECT input_id FROM subagent_inputs WHERE input_kind='work'")).toHaveLength(8);
      expect((await scenario.list()).entries).toHaveLength(8);
      assertProductionRequests(scenario);
      scenario.checkpoint("actual-eight-member-intent-and-exact-once-actions", { initialEvents,
        requiredEventIds: [...requiredEvents], finalDeliveredAt: deliveredAt });
    });
  }, 660_000);

  it.skipIf(!ENABLED)("continues one long private audit through actual compaction and a user check-in", async () => {
    await withAgentContextScenario({ name: "goals-long-audit-checkin", maxUpstreamRequests: 224,
      sessionDeadlineMs: 1_800_000, turnDeadlineMs: 180_000, mainMaxSteps: null, checkInSteps: 8, checkInParentApprovals: 0,
      contextTokens: 48000, historyRatio: 0.2, seed: seedLongAudit }, async (scenario) => {
      await scenario.ask("Assign one independent reviewer to audit the evidence chain starting at audit-manifest.json. Each source identifies the next source; cover the complete chain. "
        + "The sources are separate synthetic stakeholder reports and must stay separate. For each case, compare the original and amended constraints, identify contradictions and preserve negation and exact references. "
        + "Keep a concise per-case audit record, then perform a cross-case consistency pass before the final report. "
        + "Let the reviewer obtain my confirmation at a progress check-in and continue that same review afterwards. Acknowledge the assignment promptly.");
      const child = (await waitChildren(scenario, 1))[0]!;
      await expect.poll(async () => {
        const history = await scenario.history(child.subagentId);
        return history.conversation.pendingRequest !== null
          || history.results.length > 0 && history.conversation.activeRunId === null;
      }, { timeout: Math.max(1, scenario.remainingMs()), interval: 500 }).toBe(true);
      const paused = await scenario.history(child.subagentId);
      expect(paused.conversation.pendingRequest?.reason).toBe("check_in");
      const request = paused.conversation.pendingRequest!;
      expect(request.checkIn).toMatchObject({ completedSteps: 8, requiredActor: "user", intervalSteps: 8, parentApprovalLimit: 0 });
      const firstRun = paused.executions[0]!.runId;
      expect(scenario.rows("SELECT run_id,attempt_id FROM run_attempts").filter((row) => row.run_id === firstRun)).toHaveLength(1);
      // Count actual task-model witnesses, not HTTP retries or Utility calls.
      expect(scenario.rows("SELECT model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL")).toHaveLength(8);
      scenario.checkpoint("first-real-user-checkin", paused);
      let compactedCheckpoint: { eventId: string; workInputId: string; producerRunId: string; revision: number } | undefined;
      let coreCheckIns = 0;
      let phaseConfirmations = 0;
      // Exact-history paging legitimately costs model steps. Keep a finite test budget without imposing a product cap.
      for (let continuation = 0; continuation < 20; continuation++) {
        const current = await scenario.history(child.subagentId);
        const previousRuns = new Set(current.executions.map((execution) => execution.runId));
        const pending = current.conversation.pendingRequest;
        if (!pending) break;
        const producer = scenario.rows("SELECT event_id,producer_run_id FROM subagent_events")
          .find((event) => event.event_id === pending.eventId)?.producer_run_id;
        const witness = summaryIntents(scenario).find((intent) => intent.run_id === producer && intent.work_input_id === pending.workInputId);
        if (pending.reason === "check_in") {
          coreCheckIns += 1;
          expect(pending.checkIn?.completedSteps).toBe(coreCheckIns * 8);
          if (!compactedCheckpoint && witness) compactedCheckpoint = { eventId: pending.eventId, workInputId: pending.workInputId,
            producerRunId: String(producer), revision: Number(witness.revision) };
          SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.continue, { characterId: "taki",
            target: target(current.conversation), operationKey: randomUUID(), replyToEventId: pending.eventId,
            direction: "Continue the same audit. Preserve all original sources and corrections, complete the remaining case checks and cross-case comparison before reporting.", materials: [] }));
        } else {
          // The goal also permits a model-authored midpoint confirmation; it is distinct from the Core N-step gate.
          const question = scenario.rows("SELECT event_id,body FROM subagent_events").find((event) => event.event_id === pending.eventId);
          expect(String(question?.body)).toMatch(/confirm|proceed|continue|确认|继续/i);
          expect(phaseConfirmations).toBe(0);
          phaseConfirmations += 1;
          SubagentControlResultSchema.parse(await scenario.rpc(SUBAGENT_METHODS.send, { characterId: "taki",
            target: target(current.conversation), operationKey: randomUUID(), replyToEventId: pending.eventId,
            direction: "Yes. Proceed with the remaining evidence checks, cross-case consistency pass and final report for this same audit. This confirmation authorizes analysis and reporting only. Preserve the source facts and report unresolved discrepancies explicitly; do not invent or alter them.", materials: [] }));
          scenario.checkpoint("addressed-midpoint-confirmation", { eventId: pending.eventId });
        }
        let reachedBoundary = false;
        await expect.poll(async () => {
          const state = await scenario.history(child.subagentId);
          reachedBoundary = state.results.some((result) => result.result.child.outputKind === "validated")
            || state.conversation.pendingRequest?.eventId !== pending.eventId && state.conversation.pendingRequest !== null;
          // Stop promptly on an actual new terminal failure/omitted final. A slow active interval keeps only
          // the original global time/request budget; Utility summaries need not fit an arbitrary 180s sub-limit.
          return reachedBoundary || state.conversation.activeRunId === null
            && state.executions.some((execution) => !previousRuns.has(execution.runId)
              && ["completed", "failed", "cancelled", "deadline_exceeded", "outcome_unknown", "skipped"].includes(execution.state));
        }, { timeout: Math.max(1, scenario.remainingMs()), interval: 500 }).toBe(true);
        expect(reachedBoundary, "Audit ended without a new check-in or validated final; inspect retained execution evidence").toBe(true);
      }
      const completed = await waitCompleted(scenario, child.subagentId);
      expect(compactedCheckpoint).toBeDefined();
      const resumedInput = completed.inputs.find((input) => input.replyToEventId === compactedCheckpoint!.eventId);
      const resumedRunId = resumedInput?.consumed?.runId;
      expect(resumedRunId).toEqual(expect.any(String));
      expect(resumedRunId).not.toBe(compactedCheckpoint!.producerRunId);
      expect(summaryIntents(scenario).some((intent) => intent.run_id === resumedRunId
        && intent.work_input_id === compactedCheckpoint!.workInputId && Number(intent.revision) >= compactedCheckpoint!.revision)).toBe(true);
      const steps = scenario.rows("SELECT completed_ordinal,model_effect_id FROM subagent_task_steps WHERE completed_ordinal IS NOT NULL ORDER BY completed_ordinal");
      expect(steps.map((step) => Number(step.completed_ordinal))).toEqual(Array.from({ length: steps.length }, (_, index) => index + 1));
      expect(new Set(steps.map((step) => step.model_effect_id)).size).toBe(steps.length);
      expect(completed.conversation.progress?.completedSteps).toBe(steps.length);
      expect(completed.conversation.tokenUsage?.modelEffects).toBeGreaterThan(steps.length);
      expect(new Set(completed.executions.map((execution) => execution.workInputId)).size).toBe(1);
      expect(new Set(completed.executions.map((execution) => execution.runId)).size).toBeGreaterThanOrEqual(2);
      expect(completed.results.some((result) => /Mina|negation|did not|not the user/i.test(result.result.child.body ?? ""))).toBe(true);
      expect(completed.conversation.tokenUsage?.modelEffects).toBeGreaterThan(8);
      const retainedReads = scenario.rows("SELECT output_json FROM subagent_tool_results WHERE tool_name='read_file'")
        .map((row) => JSON.parse(String(row.output_json)) as { ok?: boolean; path?: string });
      const readPaths = new Set(retainedReads.filter((result) => result.ok === true).map((result) => result.path));
      for (const path of auditFiles) expect(readPaths.has(path)).toBe(true);
      assertProductionRequests(scenario);
      assertChildReadOnly(scenario);
      scenario.checkpoint("same-long-work-finished-with-truthful-usage", completed);
    });
  }, 1_860_000);
});

function seedCases(dataDir: string): void { writeWorkspace(dataDir, "review-cases.json", JSON.stringify(cases, null, 2)); }
function writeWorkspace(dataDir: string, name: string, content: string): void {
  const workspace = join(dataDir, "workspace"); mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, name), content, "utf8");
}
function seedLongAudit(dataDir: string): void {
  // Each next source is learned from actual evidence, so long work need not forbid legitimate parallel tool use.
  writeWorkspace(dataDir, "audit-manifest.json", JSON.stringify({ firstFile: auditFiles[0], caseFileCount: auditFiles.length,
    requirement: "Keep per-source attribution. The user did not visit Osaka; external speaker Mina did. Preserve every amended offline/data constraint." }));
  for (const [index, name] of auditFiles.entries()) writeWorkspace(dataDir, name, JSON.stringify({ case: index + 1,
    nextFile: auditFiles[index + 1] ?? null,
    speaker: "Mina", userExperience: "The user did not visit Osaka", original: {
      ...cases[index % 8], case: index + 1,
      required: `Case ${index + 1} requires offline reads and preservation of existing records.`,
      source: `External reviewer Mina-${index + 1}; this synthetic proposal is not the user's own experience.`,
    },
    amendment: { offline: true, preserveData: true, rejectedAssumption: "Deleting legacy records is NOT approved." },
    evidence: Array.from({ length: 28 }, (_, paragraph) => ({ reference: `${name}#${paragraph + 1}`,
      text: `Source ${index + 1} item ${paragraph + 1}: offline reads and original records must remain available; source Mina, not the user. `
        + "The proposal must be checked against its own amended contract; copying another case's conclusion does not establish this case." })) }, null, 2));
}
async function waitChildren(scenario: AgentContextScenario, count: number): Promise<SubagentSummary[]> {
  await expect.poll(async () => (await scenario.list()).entries.length, { timeout: 60_000, interval: 300 }).toBe(count);
  return (await scenario.list()).entries;
}
async function waitCompleted(scenario: AgentContextScenario, subagentId: string) {
  await expect.poll(async () => {
    const history = await scenario.history(subagentId);
    return history.conversation.activeRunId === null && history.results.some((result) =>
      result.result.child.outcome === "completed" && result.result.child.outputKind === "validated"
      && result.result.child.currentness === "current");
  }, { timeout: 180_000, interval: 300 }).toBe(true);
  return scenario.history(subagentId);
}
function assertReportsRequested(scenario: AgentContextScenario): void {
  const work = scenario.rows("SELECT completion_policy FROM subagent_inputs WHERE input_kind='work'");
  expect(work.length).toBeGreaterThan(0);
  expect(work.every((row) => row.completion_policy === "request_parent")).toBe(true);
}
function summaryIntents(scenario: AgentContextScenario) {
  return scenario.rows("SELECT i.work_input_id,i.revision,e.run_id FROM subagent_context_summary_intents i JOIN run_effects e ON e.effect_id=i.effect_id WHERE e.state='terminal' AND e.outcome='completed'");
}
async function waitHandled(scenario: AgentContextScenario, children: string[]): Promise<void> {
  await expect.poll(() => new Set(handledEvents(scenario).filter((event) => event.kind === "final"
    && children.includes(String(event.subagent_id))).map((event) => event.subagent_id)).size,
  { timeout: 180_000, interval: 300 }).toBe(children.length);
}
function timelineFrontier(scenario: AgentContextScenario): number {
  return Number(scenario.rows("SELECT coalesce(max(seq),0) AS seq FROM timeline_messages")[0]?.seq ?? 0);
}
function firstTerminalEvents(scenario: AgentContextScenario, children: SubagentSummary[]): Record<string, unknown>[] {
  const ids = new Set(children.map((child) => child.subagentId));
  const first = new Map<string, Record<string, unknown>>();
  for (const event of scenario.rows(`SELECT event_id,subagent_id,work_input_id,producer_run_id,kind FROM subagent_events
    WHERE eligible=1 AND kind IN ('final','interrupted') ORDER BY seq`)) {
    const child = String(event.subagent_id);
    if (ids.has(child) && !first.has(child)) first.set(child, event);
  }
  return [...first.values()];
}
async function waitPublicRiskSummary(scenario: AgentContextScenario, boundary: { afterSeq: number; deliveredAt?: string }): Promise<void> {
  // Only actual public text after the result delivery counts. Private action notes and early acknowledgements do not.
  // These checks establish a substantive answer; the retained report still needs a per-case semantic review.
  await expect.poll(() => scenario.rows("SELECT seq,content,created_at FROM timeline_messages WHERE role='assistant'")
    .filter((row) => Number(row.seq) > boundary.afterSeq && (!boundary.deliveredAt || String(row.created_at) >= boundary.deliveredAt))
    .some((row) => /offline|离线/iu.test(String(row.content))
      && /legacy|record|preserv|delet|旧|记录|保留|删除|数据/iu.test(String(row.content))
      && /incompatib|fail|violat|reject|conflict|not (?:meet|satisf|compl)|不(?:满足|符合|兼容|通过|合规|合格|达标)|没有(?:一条|一个|任何).{0,20}满足|违[反背]|未(?:满足|通过)|冲突|都不行|不能接受/iu.test(String(row.content))),
  { timeout: 90_000, interval: 300 }).toBe(true);
  scenario.checkpoint("public-risk-summary-after-results", boundary);
}
function target(child: SubagentSummary) {
  const workInputId = child.activeWorkInputId ?? child.latestWorkInputId;
  if (!workInputId) throw new Error("goal campaign child has no work identity");
  return { subagentId: child.subagentId, workInputId, expectedControlVersion: child.controlVersion, expectedRunId: child.activeRunId };
}
function parseRequest(body: string): Record<string, unknown> { return JSON.parse(body) as Record<string, unknown>; }
function toolNames(request: Record<string, unknown>): string[] {
  if (!Array.isArray(request.tools)) return [];
  return request.tools.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || !("function" in value)) return [];
    const fn = value.function;
    return fn && typeof fn === "object" && "name" in fn && typeof fn.name === "string" ? [fn.name] : [];
  });
}
function assertProductionRequests(scenario: AgentContextScenario, childTool = "complete_subagent", checkProcessAttempts = true): void {
  const actual = scenario.requests.filter((request) => scenario.observations.some((observation) =>
    observation.requestNumber === request.requestNumber && observation.upstreamAttempted === true));
  expect(actual.length).toBeGreaterThan(0);
  expect(actual.some((request) => toolNames(parseRequest(request.body)).includes(childTool))).toBe(true);
  for (const request of actual) {
    const body = parseRequest(request.body);
    expect(body.model).toBe(scenario.requestedModel);
    const messages = JSON.stringify(body.messages);
    if (messages.includes("This unattended inbox opportunity cannot create children.")) {
      expect(toolNames(body)).not.toContain("delegate_subagent");
      expect(toolNames(body)).toEqual(expect.arrayContaining(["send_subagent_message", "stop_subagent", "read_agent_inbox", "handle_agent_event"]));
    }
  }
  if (checkProcessAttempts) expect(scenario.rows("SELECT DISTINCT model_id FROM run_attempts").map((row) => row.model_id)).toContain(scenario.requestedModel);
}
function assertChildReadOnly(scenario: AgentContextScenario): void {
  const mutations = ["retain", "update_memory", "invalidate_memory", "restore_memory"];
  const childRequests = scenario.requests.filter((request) => toolNames(parseRequest(request.body)).includes("complete_subagent"));
  for (const request of childRequests) expect(toolNames(parseRequest(request.body)).filter((name) => mutations.includes(name))).toEqual([]);
  expect(scenario.rows("SELECT * FROM canonical_memory_primary_commits").some((row) =>
    scenario.rows("SELECT run_id FROM subagent_executions").some((execution) => execution.run_id === row.run_id))).toBe(false);
}
