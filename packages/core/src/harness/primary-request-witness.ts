/**
 * INPUT: actual primary Run/Attempt, committed user row and accepted delegated work
 * OUTPUT: process-owned original-request witness for until-cancelled report authorization
 * POS: core/harness — trusted acceptance boundary; serialized rows alone cannot mint or restore a witness
 */
import type { PreparedPublicationAuthorizationScope, SubagentInput, SubagentReplyAcceptance } from "@taki/shared";
import type { SubagentToolBinding } from "../agents/subagent-tools.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { digestRunValue } from "../db/run-row-mappers.ts";
import type { RunService } from "./run-service.ts";

const witnessIdentity = Symbol("primary-request-witness");
export interface PrimaryRequestWitness { readonly [witnessIdentity]: true }
type OriginalRequest = Pick<SubagentReplyAcceptance, "characterId" | "workInputId" | "primaryRunId" | "primaryAttemptId"
  | "userEntryId" | "userSeq" | "userContentDigest" | "originalWording" | "purpose" | "acceptedAt">;
const witnesses = new WeakMap<object, { original: Readonly<OriginalRequest>; unlimited: boolean }>();

export function capturePrimaryRequestWitness(deps: { runs: RunService; timeline: TimelineRepo; inputs: SubagentInputRepo },
  input: { binding: SubagentToolBinding; work: SubagentInput }) {
  const { binding, work } = input; const { turn, userEntry } = binding;
  if (!userEntry || !turn.runId || !turn.attemptId || (turn.turnKind ?? "primary") !== "primary"
    || work.sender.kind !== "parent" || work.sender.runId !== turn.runId || work.kind !== "work"
    || work.replyAcceptance || digestRunValue(deps.inputs.get(work.inputId)) !== digestRunValue(work)) {
    throw new Error("SUBAGENT_REPLY_UNAVAILABLE");
  }
  const primary = deps.runs.status(turn.runId).run;
  const actual = deps.timeline.rangeAscending(binding.characterId, userEntry.seq - 1, userEntry.seq)[0];
  if (primary.initiator !== "primary" || primary.characterId !== binding.characterId || primary.activeAttemptId !== turn.attemptId
    || !["running", "cancel_requested"].includes(primary.state) || !actual || actual.role !== "user"
    || actual.id !== userEntry.id || digestRunValue(actual) !== digestRunValue(userEntry)) throw new Error("SUBAGENT_REPLY_UNAVAILABLE");
  const original = Object.freeze({ characterId: binding.characterId, workInputId: work.inputId,
    primaryRunId: turn.runId, primaryAttemptId: turn.attemptId, userEntryId: actual.id, userSeq: actual.seq,
    userContentDigest: digestRunValue(actual), originalWording: actual.content,
    purpose: "One delayed answer to this original user request", acceptedAt: new Date().toISOString() });
  const witness = Object.freeze({ [witnessIdentity]: true as const });
  witnesses.set(witness, { original, unlimited: work.workValidity.kind === "until_cancelled" });
  return { original, witness };
}

export function matchesPrimaryRequestWitness(witness: unknown, scope: PreparedPublicationAuthorizationScope): boolean {
  if (typeof witness !== "object" || witness === null) return false;
  const accepted = witnesses.get(witness);
  return accepted?.unlimited === true && scope.sourceRef === `direct-request-report:${accepted.original.workInputId}`
    && scope.acceptanceRef === accepted.original.workInputId && scope.characterId === accepted.original.characterId;
}
