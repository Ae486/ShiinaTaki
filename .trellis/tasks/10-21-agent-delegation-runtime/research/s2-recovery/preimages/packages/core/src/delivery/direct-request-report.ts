/**
 * INPUT: exact committed primary request/work acceptance and canonical parent continuation result identity
 * OUTPUT: one independently held accepted report root and existing prepared-publication delivery
 * POS: core/delivery — trusted direct-request adapter; result text, JSON or lineage alone cannot grant speech
 */
import { randomUUID } from "node:crypto";
import { ACCEPTED_WORK_PROVIDER, type SubagentInput, type SubagentResultGroup, type SubagentWorkToken } from "@taki/shared";
import type { SubagentToolBinding } from "../agents/subagent-tools.ts";
import type { SubagentDependencies, WorkCurrentness } from "../harness/subagent-state.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import type { RunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { DeliveryCoordinator } from "./delivery-coordinator.ts";
import { createPreparedPublication, type PreparedPublicationOwner } from "./prepared-publication.ts";
import { createPreparedPublicationSource, type PreparedPublicationSourceOwner } from "./prepared-publication-source.ts";
import { createPreparedPublicationAuthorization } from "../harness/prepared-publication-authorization.ts";

interface DirectReport {
  work: SubagentInput; characterId: string; userEntryId: string; userSeq: number; userDigest: string;
  sourceRef: string; revision: string; closed: boolean; publishing: boolean;
  rootRunId?: string; rootAttemptId?: string; source?: PreparedPublicationSourceOwner; owner?: PreparedPublicationOwner;
  result?: SubagentResultGroup; timer?: ReturnType<typeof setTimeout>;
}
interface DirectReportDependencies {
  runtime: SubagentDependencies; deliveries: RunDeliveryRepo; delivery: DeliveryCoordinator;
  current(token: SubagentWorkToken): WorkCurrentness;
}

export function createDirectRequestReport(input: DirectReportDependencies) {
  const reports = new Map<string, DirectReport>(); const work = new Set<Promise<void>>(); let closed = false;
  const current = (report: DirectReport) => reportCurrent(input, report, closed);
  const stage = async (result: SubagentResultGroup): Promise<void> => {
    const report = reports.get(result.child.workInputId);
    if (!report || !current(report) || !result.parent || !result.parentDigest || result.parent.decision !== "reply"
      || result.parent.outcome !== "completed") { refuse(input, result, "reply_authority_unavailable"); return; }
    if (report.result && report.result.parentDigest !== result.parentDigest) {
      const previous = report.result.publication?.runId ? input.deliveries.get(report.result.publication.runId) : undefined;
      if (previous && ["dispatch_committed", "sent", "unknown", "no_target"].includes(previous.state)) {
        refuse(input, result, "report_already_published"); return;
      }
    }
    if (report.revision !== result.parentDigest) {
      const edit = report.owner?.beginEdit(report.revision);
      if (!edit) { refuse(input, result, "reply_source_unavailable"); return; }
      report.revision = result.parentDigest; report.result = result;
      if (!report.owner?.confirmEdit(edit, report.revision)) { refuse(input, result, "reply_source_unavailable"); return; }
    }
    await publishReport(input, report);
  };
  return {
    async capturePrimary(binding: SubagentToolBinding, accepted: SubagentInput): Promise<void> {
      if (closed || reports.has(accepted.inputId)) return;
      const report = captureRequest(input, binding, accepted);
      reports.set(accepted.inputId, report);
      try {
        await admitReportRoot(input, report, () => current(report));
        report.timer = setTimeout(() => retireReport(input, report, "expired"), Math.max(0, Date.parse(accepted.workExpiresAt) - Date.now()));
        report.timer.unref?.();
      } catch (error) { retireReport(input, report, "acceptance_failed"); throw error; }
    },
    canReply: (workInputId: string) => { const report = reports.get(workInputId); return report ? current(report) : false; },
    async stageReply(identity: { completionId: string; parentRunId: string; parentResultDigest: string }) {
      const result = input.runtime.executions.result(identity.completionId);
      if (!result || result.parentRunId !== identity.parentRunId || result.parentDigest !== identity.parentResultDigest) throw new Error("SUBAGENT_PARENT_RESULT_CONFLICT");
      await stage(result);
    },
    closeWork(workInputId: string) { const report = reports.get(workInputId); if (report) finishReport(input, report); },
    released() {
      for (const report of reports.values()) {
        if (report.closed || report.publishing || !report.result) continue;
        const pending = publishReport(input, report).catch(() => input.runtime.reportError("SUBAGENT_REPORT_PUBLICATION_FAILED"))
          .finally(() => { work.delete(pending); });
        work.add(pending);
      }
    },
    async close() {
      closed = true;
      for (const report of reports.values()) retireReport(input, report, "shutdown");
      await Promise.allSettled([...work]);
    },
  };
}
export type DirectRequestReport = ReturnType<typeof createDirectRequestReport>;

function captureRequest(input: DirectReportDependencies, binding: SubagentToolBinding, accepted: SubagentInput): DirectReport {
  const entry = binding.userEntry; const turn = binding.turn;
  if (!entry || !turn.runId || !turn.attemptId || entry.role !== "user" || entry.characterId !== binding.characterId
    || accepted.sender.kind !== "parent" || accepted.sender.runId !== turn.runId || accepted.kind !== "work") throw new Error("SUBAGENT_PRIMARY_ACCEPTANCE_REQUIRED");
  const run = input.runtime.runs.status(turn.runId).run;
  if (run.initiator !== "primary" || run.characterId !== entry.characterId || run.activeAttemptId !== turn.attemptId) throw new Error("SUBAGENT_PRIMARY_ACCEPTANCE_REQUIRED");
  const row = input.runtime.db.prepare("SELECT id,role,content FROM timeline_messages WHERE character_id=:character AND seq=:seq")
    .get({ character: entry.characterId, seq: entry.seq });
  if (!row || row.id !== entry.id || row.role !== "user" || row.content !== entry.content) throw new Error("SUBAGENT_PRIMARY_WITNESS_MISMATCH");
  return { work: accepted, characterId: entry.characterId, userEntryId: entry.id, userSeq: entry.seq,
    userDigest: digestRunValue(entry.content), sourceRef: `direct-request-report:${accepted.inputId}`,
    revision: "awaiting-result", closed: false, publishing: false };
}

async function admitReportRoot(input: DirectReportDependencies, report: DirectReport, current: () => boolean): Promise<void> {
  const runtime = input.runtime;
  const accepted = () => ({ sourceRef: report.sourceRef, acceptanceRef: report.userEntryId, characterId: report.characterId,
    revision: report.revision, expiresAt: report.work.workExpiresAt });
  const authorization = createPreparedPublicationAuthorization({ scope: { ...accepted(), deliveryClass: "class_a" }, isCurrent: current });
  report.source = createPreparedPublicationSource({ readAccepted: accepted, isCurrent: current, gate: () => "ready",
    resolve: ({ candidateRef, expectedRevision }) => candidateRef === `report:${report.work.inputId}` && expectedRevision === report.revision
      && report.result?.parent?.body ? { candidateRef, revision: report.revision, text: report.result.parent.body,
        sourceContext: report.result.parent.sourceContext, expiresAt: report.work.workExpiresAt } : undefined }, authorization);
  const admitted = await runtime.runs.admitAcceptedWork({ triggerRequestId: randomUUID(), idempotencyKey: report.sourceRef,
    characterId: report.characterId, initiator: "subagent", deliveryClass: "internal", contextMode: "autonomous",
    provenance: { provider: ACCEPTED_WORK_PROVIDER, sourceRef: report.sourceRef,
      parentRunId: report.work.sender.kind === "parent" ? report.work.sender.runId : undefined }, deadlineAt: report.work.workExpiresAt }, report.source.binding);
  report.rootRunId = admitted.run.runId; report.rootAttemptId = admitted.attempt.attemptId;
  if (!runtime.runs.start(admitted.run.runId, admitted.attempt.attemptId)) throw new Error("SUBAGENT_REPLY_ROOT_REFUSED");
  const held = runtime.runs.holdWork({ runId: admitted.run.runId, attemptId: admitted.attempt.attemptId,
    expectedRunVersion: runtime.runs.status(admitted.run.runId).run.stateVersion, reasonRef: report.sourceRef });
  if (!held.changed) throw new Error("SUBAGENT_REPLY_ROOT_REFUSED");
  report.owner = createPreparedPublication({ rootRunId: admitted.run.runId, source: report.source, runs: runtime.runs,
    repo: input.deliveries, delivery: input.delivery, queue: runtime.queue, turns: runtime.turns });
  const primaryRunId = report.work.sender.kind === "parent" ? report.work.sender.runId : "";
  const primaryRun = runtime.runs.status(primaryRunId).run;
  const row = runtime.db.prepare("SELECT content FROM timeline_messages WHERE id=:id").get({ id: report.userEntryId });
  runtime.inputs.bindReplyAcceptance({ characterId: report.characterId, workInputId: report.work.inputId, primaryRunId,
    primaryAttemptId: primaryRun.activeAttemptId!, userEntryId: report.userEntryId, userSeq: report.userSeq, userContentDigest: report.userDigest,
    originalWording: String(row?.content ?? ""), purpose: "One delayed answer to the original accepted request",
    acceptedAt: new Date().toISOString(), expiresAt: report.work.workExpiresAt, acceptedRootRunId: admitted.run.runId });
}

function reportCurrent(input: DirectReportDependencies, report: DirectReport, closing: boolean): boolean {
  if (closing || report.closed || Date.now() >= Date.parse(report.work.workExpiresAt)) return false;
  const row = input.runtime.db.prepare("SELECT id,role,content FROM timeline_messages WHERE character_id=:character AND seq=:seq")
    .get({ character: report.characterId, seq: report.userSeq });
  if (!row || row.id !== report.userEntryId || row.role !== "user" || digestRunValue(row.content) !== report.userDigest) return false;
  if (report.rootRunId && input.runtime.runs.context(report.rootRunId)?.authorityCurrent?.() !== true) return false;
  if (report.result) return input.current(input.runtime.executions.token(report.result.completionId)).state === "current";
  return true;
}

async function publishReport(input: DirectReportDependencies, report: DirectReport): Promise<void> {
  const result = report.result;
  if (report.closed || report.publishing || !report.owner || !result?.parentDigest) return;
  report.publishing = true;
  try {
    const published = await report.owner.publish({ candidateRef: `report:${report.work.inputId}`, expectedRevision: report.revision });
    const publication = published.status === "recorded" ? { state: "recorded" as const, runId: published.runId, deliveryId: published.deliveryId }
      : published.status === "deferred" ? { state: "deferred" as const, reason: published.reason }
        : { state: "refused" as const, reason: published.reason };
    input.runtime.executions.recordPublication({ completionId: result.completionId, parentResultDigest: result.parentDigest, publication });
    input.runtime.changed(report.characterId, result.child.subagentId);
    if (published.status === "refused") retireReport(input, report, "publication_refused");
    else if (published.status === "recorded" && !["staged", "held"].includes(published.state)) finishReport(input, report);
  } finally { report.publishing = false; }
}

function refuse(input: DirectReportDependencies, result: SubagentResultGroup, reason: string): void {
  if (!result.parentDigest || result.publication?.state === "recorded" || result.publication?.state === "refused") return;
  input.runtime.executions.recordPublication({ completionId: result.completionId, parentResultDigest: result.parentDigest,
    publication: { state: "refused", reason } });
}

function finishReport(input: DirectReportDependencies, report: DirectReport): void {
  if (report.closed) return;
  if (report.rootRunId && report.rootAttemptId) input.runtime.runs.settle(report.rootRunId, report.rootAttemptId, "completed", { retryable: false });
  report.closed = true; clearTimeout(report.timer); report.source?.retire();
}

function retireReport(input: DirectReportDependencies, report: DirectReport, reason: string): void {
  if (report.closed) return;
  report.closed = true; clearTimeout(report.timer); report.source?.retire(); report.owner?.stop();
  if (report.rootRunId && report.rootAttemptId) {
    input.runtime.runs.requestCancel(report.rootRunId, reason);
    input.runtime.runs.settle(report.rootRunId, report.rootAttemptId, "cancelled", { retryable: false });
  }
}
