/**
 * INPUT: canonical completed parent reports or delivered inbox speech actions
 * OUTPUT: immutable proposal identity, source frontier and separate publication outcome writer
 * POS: core/delivery — read-only acceptance join; stored proposals never grant speech authority
 */
import type { PreparedPublicationResult, SourceContext } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { RunService } from "../harness/run-service.ts";
import { readSubagentSpeechProposal, readSubagentSpeechPublication, recordSubagentSpeechPublication } from "../db/subagent-speech-repo.ts";

export interface DirectRequestProposal {
  identity: string; revision: string; workInputId: string; subagentId: string; characterId: string;
  throughWorkSeq: number; proposedAt: string; text: string; sourceContext: SourceContext;
  record(result: PreparedPublicationResult): void;
  refuse(): void;
}

export function readLegacyReportProposal(deps: { executions: SubagentExecutionRepo; runs: RunService },
  input: { completionId: string; parentRunId: string; parentResultDigest: string }): DirectRequestProposal | undefined {
  const { executions } = deps;
  const result = executions.result(input.completionId);
  if (!result?.parent || result.parent.runId !== input.parentRunId || result.parentDigest !== input.parentResultDigest
    || result.parent.outcome !== "completed" || result.parent.decision !== "reply") throw new Error("SUBAGENT_PARENT_RESULT_CONFLICT");
  if (result.publication?.state === "recorded" || result.publication?.state === "refused") return undefined;
  const key = { completionId: result.completionId, parentResultDigest: input.parentResultDigest };
  return { identity: `legacy:${result.completionId}`, revision: input.parentResultDigest,
    workInputId: result.child.workInputId, subagentId: result.child.subagentId, characterId: deps.runs.status(result.child.runId).run.characterId,
    throughWorkSeq: result.child.throughWorkSeq, proposedAt: result.parent.settledAt,
    text: result.parent.body ?? "", sourceContext: result.parent.sourceContext,
    record: (outcome) => executions.recordPublication({ ...key, publication: outcome.status === "recorded"
      ? { state: "recorded", runId: outcome.runId, deliveryId: outcome.deliveryId } : { state: outcome.status, reason: outcome.reason } }),
    refuse: () => {
      const state = executions.result(result.completionId)?.publication?.state;
      if (state !== "recorded" && state !== "refused") executions.recordPublication({ ...key,
        publication: { state: "refused", reason: "reply_authority_unavailable" } });
    },
  };
}

export function readInboxReportProposal(db: Database,
  input: { eventId: string; consumerRunId: string; actionId: string }): DirectRequestProposal | undefined {
  const proposal = readSubagentSpeechProposal(db, input);
  const previous = readSubagentSpeechPublication(db, input);
  if (previous?.status === "recorded" || previous?.status === "refused") return undefined;
  const event = proposal.event;
  const record = (result: PreparedPublicationResult) => recordSubagentSpeechPublication(db, { ...input, result });
  return { identity: `event:${event.eventId}:${proposal.actionId}`, revision: proposal.actionDigest,
    workInputId: event.workInputId, subagentId: event.subagentId, characterId: event.characterId,
    throughWorkSeq: proposal.throughWorkSeq, proposedAt: proposal.createdAt, text: proposal.text,
    sourceContext: { generatedBy: { runId: proposal.consumerRunId, attemptId: proposal.consumerAttemptId },
      materials: [{ label: "Delegated worker event", reference: `agent-event:${event.eventId}#${event.bodyDigest}`,
        speaker: `worker:${event.subagentId}` }] },
    record, refuse: () => {
      const state = readSubagentSpeechPublication(db, input)?.status;
      if (state !== "recorded" && state !== "refused") record({ status: "refused", reason: "source_unavailable" });
    },
  };
}
