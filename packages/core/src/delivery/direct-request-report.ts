/**
 * INPUT: trusted primary acceptance and canonical parent/inbox speech proposals
 * OUTPUT: one independently retained accepted report root and existing Class A publication
 * POS: core/delivery — bounded original-request adapter; copied labels/results never reconstruct reply authority
 */
import { randomUUID } from "node:crypto";
import { ACCEPTED_WORK_PROVIDER, type SubagentInput, type SubagentReplyAcceptance } from "@taki/shared";
import type { SubagentToolBinding } from "../agents/subagent-tools.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import type { RunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { Database } from "../db/sqlite.ts";
import type { RunService } from "../harness/run-service.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import { createPreparedPublicationAuthorization } from "../harness/prepared-publication-authorization.ts";
import { capturePrimaryRequestWitness } from "../harness/primary-request-witness.ts";
import { createPreparedPublicationSource, type PreparedPublicationSourceOwner } from "./prepared-publication-source.ts";
import { createPreparedPublication, type PreparedPublicationOwner } from "./prepared-publication.ts";
import type { DeliveryCoordinator } from "./delivery-coordinator.ts";
import { readInboxReportProposal, readLegacyReportProposal, type DirectRequestProposal } from "./direct-request-proposal.ts";

interface ReportDeps {
  db: Database; runs: RunService; inputs: SubagentInputRepo; executions: SubagentExecutionRepo; timeline: TimelineRepo;
  deliveries: RunDeliveryRepo; delivery: DeliveryCoordinator; queue: TurnQueue; turns: TurnRegistry;
  changed(characterId: string, subagentId: string): void;
  reportError(code: string): void;
}
type ReportAcceptance = Extract<SubagentReplyAcceptance, { validity: unknown }>;
interface ReportBinding {
  work: SubagentInput; acceptance: ReportAcceptance; revision: string; closed: boolean;
  source: PreparedPublicationSourceOwner; owner?: PreparedPublicationOwner;
  candidate?: { proposal: DirectRequestProposal; expiresAt: string }; publishing?: Promise<void>; expiry?: ReturnType<typeof setTimeout>;
}
// Freshness starts when a delayed answer is proposed, independently of the task's age or input waits.
const REPORT_CANDIDATE_FRESHNESS_MS = 5 * 60_000;

export function createDirectRequestReports(deps: ReportDeps) {
  const bindings = new Map<string, ReportBinding>(); const accepting = new Map<string, Promise<void>>(); let closed = false;
  const retiring = new Set<string>();
  const stage = (binding: ReportBinding) => {
    if (closed || binding.closed || binding.publishing || !binding.candidate || !binding.owner) return binding.publishing ?? Promise.resolve();
    binding.publishing = Promise.resolve().then(() => publishReport(deps, binding)).catch(() => deps.reportError("SUBAGENT_REPORT_PUBLICATION_FAILED"))
      .finally(() => { binding.publishing = undefined; });
    return binding.publishing;
  };
  return {
    capturePrimary(binding: SubagentToolBinding, work: SubagentInput): Promise<void> {
      if (closed) return Promise.reject(new Error("SUBAGENT_REPLY_UNAVAILABLE"));
      if (bindings.has(work.inputId)) return Promise.resolve();
      const pending = accepting.get(work.inputId);
      if (pending) return pending;
      const task = capture(deps, binding, work).then((value) => {
        if (closed || retiring.has(work.inputId)) closeReport(deps, value);
        bindings.set(work.inputId, value);
        if (!value.closed && work.workValidity.kind === "expires_at") {
          value.expiry = setTimeout(() => closeReport(deps, value), Math.max(0, Date.parse(work.workValidity.expiresAt) - Date.now()));
          value.expiry.unref?.();
        }
      }).finally(() => { accepting.delete(work.inputId); retiring.delete(work.inputId); });
      accepting.set(work.inputId, task); return task;
    },
    canReply(workInputId: string) { const binding = bindings.get(workInputId); return Boolean(binding && reportCurrent(deps, binding)); },
    async stageReply(input: { completionId: string; parentRunId: string; parentResultDigest: string }) {
      const binding = selectReportProposal(deps, bindings, readLegacyReportProposal(deps, input));
      if (binding) await stage(binding);
    },
    async stageEventReply(input: { eventId: string; consumerRunId: string; actionId: string }) {
      const binding = selectReportProposal(deps, bindings, readInboxReportProposal(deps.db, input));
      if (binding) await stage(binding);
    },
    released() { for (const binding of bindings.values()) if (binding.candidate) void stage(binding); },
    closeWork(workInputId: string) {
      if (accepting.has(workInputId)) retiring.add(workInputId);
      const binding = bindings.get(workInputId); if (binding) closeReport(deps, binding);
    },
    async close() {
      closed = true; await Promise.allSettled([...accepting.values()]);
      for (const binding of bindings.values()) closeReport(deps, binding);
      await Promise.allSettled([...bindings.values()].flatMap((binding) => binding.publishing ? [binding.publishing] : []));
    },
  };
}

function selectReportProposal(deps: ReportDeps, bindings: ReadonlyMap<string, ReportBinding>,
  proposal: DirectRequestProposal | undefined): ReportBinding | undefined {
  if (!proposal) return undefined;
  const binding = bindings.get(proposal.workInputId);
  if (!binding || binding.work.subagentId !== proposal.subagentId || binding.acceptance.characterId !== proposal.characterId
    || !reportCurrent(deps, binding) || deps.inputs.latestWorkSeq(proposal.workInputId) !== proposal.throughWorkSeq) {
    proposal.refuse(); return undefined;
  }
  if (binding.candidate && binding.candidate.proposal.identity !== proposal.identity) throw new Error("SUBAGENT_REPLY_ALREADY_SELECTED");
  if (!binding.candidate) {
    const edit = binding.owner?.beginEdit(binding.revision);
    if (!edit) throw new Error("SUBAGENT_REPLY_UNAVAILABLE");
    const validity = binding.work.workValidity;
    binding.candidate = { proposal, expiresAt: validity.kind === "expires_at" ? validity.expiresAt
      : new Date(Date.parse(proposal.proposedAt) + REPORT_CANDIDATE_FRESHNESS_MS).toISOString() };
    binding.revision = proposal.revision;
    if (!binding.owner?.confirmEdit(edit, binding.revision)) throw new Error("SUBAGENT_REPLY_UNAVAILABLE");
  }
  return binding;
}

async function capture(deps: ReportDeps, binding: SubagentToolBinding, work: SubagentInput): Promise<ReportBinding> {
  const { original, witness } = capturePrimaryRequestWitness(deps, { binding, work });
  const validity = work.workValidity;
  const slot: { current?: ReportBinding } = {};
  const accepted = { sourceRef: `direct-request-report:${work.inputId}`, acceptanceRef: work.inputId,
    characterId: binding.characterId, revision: `accepted:${work.inputId}`, validity };
  const isCurrent = () => slot.current ? reportCurrent(deps, slot.current) : originalCurrent(deps, { ...original, validity });
  const authorization = createPreparedPublicationAuthorization({ scope: { sourceRef: accepted.sourceRef, acceptanceRef: accepted.acceptanceRef,
    characterId: accepted.characterId, validity, deliveryClass: "class_a" }, isCurrent, originalRequestWitness: witness });
  const source = createPreparedPublicationSource({ readAccepted: () => ({ ...accepted, revision: slot.current?.revision ?? accepted.revision }),
    isCurrent, gate: () => "ready", resolve: ({ candidateRef, expectedRevision }) => slot.current?.candidate
      && candidateRef === `report:${work.inputId}` && expectedRevision === slot.current.revision
      ? { candidateRef, revision: slot.current.revision, text: slot.current.candidate.proposal.text,
        expiresAt: slot.current.candidate.expiresAt, sourceContext: slot.current.candidate.proposal.sourceContext } : undefined }, authorization);
  const root = await deps.runs.admitAcceptedWork({ triggerRequestId: randomUUID(), idempotencyKey: `direct-request-report:${work.inputId}`,
    characterId: binding.characterId, initiator: "subagent", contextMode: "autonomous", deliveryClass: "internal",
    provenance: { provider: ACCEPTED_WORK_PROVIDER, sourceRef: accepted.sourceRef, parentRunId: original.primaryRunId },
    ...(validity.kind === "expires_at" ? { deadlineAt: validity.expiresAt } : {}) }, source.binding);
  const report: ReportBinding = { work, acceptance: { ...original, validity, acceptedRootRunId: root.run.runId },
    revision: accepted.revision, closed: false, source };
  slot.current = report;
  try {
    if (root.reused || !deps.runs.start(root.run.runId, root.attempt.attemptId)) throw new Error("SUBAGENT_REPLY_UNAVAILABLE");
    const current = deps.runs.status(root.run.runId).run;
    if (!deps.runs.holdWork({ runId: root.run.runId, attemptId: root.attempt.attemptId, expectedRunVersion: current.stateVersion,
      reasonRef: accepted.sourceRef }).changed) throw new Error("SUBAGENT_REPLY_UNAVAILABLE");
    deps.inputs.bindReplyAcceptance(report.acceptance);
    report.owner = createPreparedPublication({ rootRunId: root.run.runId, source, runs: deps.runs,
      repo: deps.deliveries, delivery: deps.delivery, queue: deps.queue, turns: deps.turns });
    return report;
  } catch (error) { closeReport(deps, report); throw error; }
}

function originalCurrent(deps: ReportDeps, acceptance: Omit<ReportAcceptance, "acceptedRootRunId">): boolean {
  const row = deps.timeline.rangeAscending(acceptance.characterId, acceptance.userSeq - 1, acceptance.userSeq)[0];
  return (acceptance.validity.kind === "until_cancelled" || Date.now() < Date.parse(acceptance.validity.expiresAt))
    && row?.id === acceptance.userEntryId && digestRunValue(row) === acceptance.userContentDigest;
}

function reportCurrent(deps: ReportDeps, report: ReportBinding): boolean {
  if (report.closed || !originalCurrent(deps, report.acceptance)) return false;
  const root = deps.runs.status(report.acceptance.acceptedRootRunId).run;
  if (!["running", "waiting"].includes(root.state) || deps.runs.context(root.runId)?.authorityCurrent?.() !== true) return false;
  return !report.candidate || deps.inputs.latestWorkSeq(report.work.inputId) === report.candidate.proposal.throughWorkSeq;
}

async function publishReport(deps: ReportDeps, report: ReportBinding): Promise<void> {
  const candidate = report.candidate!.proposal;
  const result = await report.owner!.publish({ candidateRef: `report:${report.work.inputId}`, expectedRevision: report.revision });
  if (report.closed && result.status === "deferred") { candidate.refuse(); return; }
  candidate.record(result);
  deps.changed(report.acceptance.characterId, report.work.subagentId);
  if (result.status === "refused") closeReport(deps, report);
  else if (result.status === "recorded" && !["staged", "held"].includes(result.state)) closeReport(deps, report, true);
}

function closeReport(deps: ReportDeps, report: ReportBinding, completed = false): void {
  if (report.closed) return;
  clearTimeout(report.expiry);
  if (!completed) {
    report.owner?.stop();
    // An in-flight publisher records its factual delivery outcome; closing cannot overwrite a committed send.
    if (!report.publishing) report.candidate?.proposal.refuse();
  }
  const root = deps.runs.status(report.acceptance.acceptedRootRunId).run;
  if (["queued", "running", "waiting", "cancel_requested"].includes(root.state) && root.activeAttemptId) {
    deps.runs.settle(root.runId, root.activeAttemptId, completed ? "completed" : "cancelled", { retryable: false });
  }
  report.closed = true; report.source.retire();
}
